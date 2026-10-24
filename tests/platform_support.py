"""
Fixtures for the platform layer (auth, workspaces, placement, analyses).

Everything runs against a temporary data directory with the offline hashing embedder and
no LLM; the shared corpus is the isolated `kb` fixture from conftest.py, so the real data/
directory is never touched. Import with `from platform_support import *` in a test module.
"""

import io
import time
import zipfile

import pytest

from conftest import ROOT, wait_job  # noqa: F401  (re-exported for test modules)

PASSWORD = "correct horse 42"


@pytest.fixture
def app(kb, tmp_path, monkeypatch):
    from fastapi import FastAPI

    from backend import services
    from backend.api import auth as auth_api, intel as intel_api, kb as kb_api, placement as placement_api
    from backend.api import platform as platform_api, workspaces as ws_api
    from backend.config import load_platform_settings
    from backend.kb.embeddings import HashingEmbedder
    import backend.kb.service as svc_mod

    settings = load_platform_settings(data_dir=tmp_path / "data", samples_dir=ROOT / "samples" / "workspaces",
                                      admin_emails=frozenset({"admin@example.com"}))
    services.reset(settings, models_provider=lambda: (HashingEmbedder(), None, None))
    monkeypatch.setattr(svc_mod, "_kb", kb)
    for mod in (kb_api, auth_api, placement_api, intel_api, platform_api):
        monkeypatch.setattr(mod.limiter, "enabled", False)
    a = FastAPI()
    for r in (kb_api.router, auth_api.router, ws_api.router, ws_api.kb_router, placement_api.router,
              intel_api.router, platform_api.router):
        a.include_router(r)
    a.state.shared_kb_write = "admin"
    a.state.test_clients = []
    yield a
    for c in a.state.test_clients:
        c.__exit__(None, None, None)
    services.reset()


def make_client(app):
    """A started TestClient (its event loop must outlive the request so ingestion jobs can run)."""
    from fastapi.testclient import TestClient
    c = TestClient(app)
    c.__enter__()
    app.state.test_clients.append(c)
    return c


class Session:
    """A signed-in browser: cookie jar + the CSRF token the SPA would hold in memory."""

    def __init__(self, client, payload):
        self.c = client
        self.payload = payload
        self.csrf = payload["csrf_token"]
        self.user = payload["user"]

    def _h(self, kw):
        h = dict(kw.pop("headers", {}) or {})
        h["X-CSRF-Token"] = self.csrf
        return h

    def get(self, url, **kw):
        return self.c.get(url, **kw)

    def post(self, url, **kw):
        return self.c.post(url, headers=self._h(kw), **kw)

    def put(self, url, **kw):
        return self.c.put(url, headers=self._h(kw), **kw)

    def patch(self, url, **kw):
        return self.c.patch(url, headers=self._h(kw), **kw)

    def delete(self, url, **kw):
        return self.c.delete(url, headers=self._h(kw), **kw)


def register(client, email, workspace_type=None, name="Test User", password=PASSWORD) -> Session:
    r = client.post("/api/auth/register", json={"name": name, "email": email, "password": password,
                                                 "workspace_type": workspace_type, "accept_terms": True})
    assert r.status_code == 201, r.text
    return Session(client, r.json())


def first_workspace(s: Session, wtype: str) -> str:
    return next(w["id"] for w in s.payload["workspaces"] if w["type"] == wtype)


def wait_ws(s: Session, ws: str, timeout: float = 120.0) -> None:
    """Block until the workspace knowledge base has no queued or running ingestion jobs."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if not s.get(f"/api/workspaces/{ws}/kb/status").json()["jobs"]:
            return
        time.sleep(0.1)
    raise AssertionError("workspace ingestion did not finish")


def csv_bytes(rows) -> bytes:
    import csv
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerows(rows)
    return buf.getvalue().encode("utf-8")


def xlsx_bytes(rows, shared_strings: bool = True) -> bytes:
    """A minimal valid .xlsx (one sheet) for reader tests."""
    def col(i):
        s = ""
        i += 1
        while i:
            i, r = divmod(i - 1, 26)
            s = chr(65 + r) + s
        return s
    strings, index = [], {}
    sheet_rows = []
    for ri, row in enumerate(rows, start=1):
        cells = []
        for ci, v in enumerate(row):
            ref = f"{col(ci)}{ri}"
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                cells.append(f'<c r="{ref}"><v>{v}</v></c>')
            elif shared_strings:
                if v not in index:
                    index[v] = len(strings)
                    strings.append(v)
                cells.append(f'<c r="{ref}" t="s"><v>{index[v]}</v></c>')
            else:
                cells.append(f'<c r="{ref}" t="inlineStr"><is><t>{v}</t></is></c>')
        sheet_rows.append(f'<row r="{ri}">{"".join(cells)}</row>')
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    rel_ns = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
        z.writestr("xl/workbook.xml", f'<?xml version="1.0"?><workbook {ns} {rel_ns}><sheets>'
                                      f'<sheet name="Records" sheetId="1" r:id="rId1"/></sheets></workbook>')
        z.writestr("xl/_rels/workbook.xml.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.'
                   'openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" '
                   'Target="worksheets/sheet1.xml"/></Relationships>')
        z.writestr("xl/worksheets/sheet1.xml", f'<?xml version="1.0"?><worksheet {ns}><sheetData>'
                                               f'{"".join(sheet_rows)}</sheetData></worksheet>')
        if shared_strings:
            sis = "".join(f"<si><t>{s}</t></si>" for s in strings)
            z.writestr("xl/sharedStrings.xml", f'<?xml version="1.0"?><sst {ns}>{sis}</sst>')
    return buf.getvalue()


def stage_and_commit(s: Session, ws: str, kind: str, filename: str, data: bytes, policy: str = "skip",
                     mapping=None, defaults=None):
    r = s.post(f"/api/workspaces/{ws}/placement/imports", data={"kind": kind}, files={"file": (filename, data)})
    assert r.status_code == 201, r.text
    prev = r.json()
    body = {"mapping": mapping or prev["mapping"], "defaults": defaults or {}, "duplicate_policy": policy}
    r = s.post(f"/api/workspaces/{ws}/placement/imports/{prev['import']['id']}/commit", json=body)
    return prev, r
