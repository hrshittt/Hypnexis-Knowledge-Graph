"""Workspaces: isolation, roles enforced server-side, shared-corpus write policy, metadata, samples, activity."""

from conftest import SAMPLES
from platform_support import app, first_workspace, make_client, register, wait_ws  # noqa: F401


def _upload(s, ws, name):
    return s.post(f"/api/workspaces/{ws}/kb/documents", files=[("files", (name, (SAMPLES / name).read_bytes()))])


def test_non_members_cannot_see_a_workspace(app):
    alice = register(make_client(app), "alice@example.com", "corporate")
    bob = register(make_client(app), "bob@example.com", "research")
    ws = first_workspace(alice, "corporate")
    for path in (f"/api/workspaces/{ws}", f"/api/workspaces/{ws}/kb/status", f"/api/workspaces/{ws}/kb/graph",
                 f"/api/workspaces/{ws}/documents", f"/api/workspaces/{ws}/corporate/analysis"):
        r = bob.get(path)
        assert r.status_code == 404, (path, r.text)  # 404, not 403: workspace ids don't leak
    assert [w["id"] for w in bob.get("/api/workspaces").json()["workspaces"]] == [first_workspace(bob, "research")]
    assert make_client(app).get(f"/api/workspaces/{ws}/kb/status").status_code == 401


def test_roles_viewer_analyst_owner(app):
    owner = register(make_client(app), "owner@example.com", "corporate")
    member = register(make_client(app), "member@example.com")
    ws = first_workspace(owner, "corporate")
    assert owner.post(f"/api/workspaces/{ws}/members", json={"email": "member@example.com", "role": "viewer"}).status_code == 201
    assert member.get(f"/api/workspaces/{ws}/kb/status").status_code == 200
    r = _upload(member, ws, "voltaic_systems_brief.txt")
    assert r.status_code == 403 and r.json()["detail"]["code"] == "insufficient_role"
    assert member.post(f"/api/workspaces/{ws}/members", json={"email": "x@example.com"}).status_code == 403
    uid = member.user["id"]
    assert owner.patch(f"/api/workspaces/{ws}/members/{uid}", json={"role": "analyst"}).status_code == 200
    r = _upload(member, ws, "voltaic_systems_brief.txt")
    assert r.status_code == 202
    wait_ws(member, ws)
    doc_id = r.json()["results"][0]["doc_id"]
    # analysts upload but only owners delete
    assert member.delete(f"/api/workspaces/{ws}/kb/documents/{doc_id}").status_code == 403
    assert member.delete(f"/api/workspaces/{ws}/kb?confirm=true").status_code == 403
    # a workspace can't lose its last owner
    r = owner.patch(f"/api/workspaces/{ws}/members/{owner.user['id']}", json={"role": "viewer"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "last_owner"


def test_workspace_knowledge_bases_are_isolated(app):
    s = register(make_client(app), "iso@example.com", "research")
    ws1 = first_workspace(s, "research")
    ws2 = s.post("/api/workspaces", json={"type": "legal"}).json()["workspace"]["id"]
    r = _upload(s, ws1, "port_calder_health_study.txt")
    assert r.status_code == 202
    wait_ws(s, ws1)
    assert s.get(f"/api/workspaces/{ws1}/kb/status").json()["stats"]["documents"] == 1
    assert s.get(f"/api/workspaces/{ws2}/kb/status").json()["stats"]["documents"] == 0
    assert s.get("/api/kb/status").json()["stats"]["documents"] == 0  # the shared corpus is untouched
    g = s.get(f"/api/workspaces/{ws1}/kb/graph").json()
    assert any(n["name"] == "Amina Diallo" for n in g["nodes"])
    assert not s.get(f"/api/workspaces/{ws2}/kb/graph").json()["nodes"]


def test_shared_corpus_reads_public_writes_need_admin(app):
    anon = make_client(app)
    assert anon.get("/api/kb/graph").status_code == 200
    assert anon.get("/api/kb/status").status_code == 200
    r = anon.post("/api/kb/samples/load")
    assert r.status_code == 401
    member = register(make_client(app), "plain@example.com")
    r = member.post("/api/kb/samples/load")
    assert r.status_code == 403 and r.json()["detail"]["code"] == "admin_required"
    assert member.delete("/api/kb?confirm=true").status_code == 403
    admin = register(make_client(app), "admin@example.com")
    assert admin.c.post("/api/kb/samples/load").status_code == 403  # admins still need the CSRF token
    assert admin.post("/api/kb/samples/load").status_code == 202


def test_document_metadata_validation(app):
    s = register(make_client(app), "meta@example.com", "legal")
    ws = first_workspace(s, "legal")
    r = _upload(s, ws, "coastal_energy_policy_brief.txt")
    doc_id = r.json()["results"][0]["doc_id"]
    wait_ws(s, ws)
    bad = s.put(f"/api/workspaces/{ws}/documents/{doc_id}/meta", json={"source_url": "javascript:alert(1)"})
    assert bad.status_code == 422
    ok = s.put(f"/api/workspaces/{ws}/documents/{doc_id}/meta",
               json={"jurisdiction": "Coastal State", "source_url": "https://example.org/brief", "verified": True})
    assert ok.status_code == 200 and ok.json()["meta"]["verified_at"]
    assert s.put(f"/api/workspaces/{ws}/documents/d_missing/meta", json={"company": "X"}).status_code == 404


def test_workspace_samples_carry_metadata_and_activity(app):
    s = register(make_client(app), "demo@example.com", "corporate")
    ws = first_workspace(s, "corporate")
    r = s.post(f"/api/workspaces/{ws}/kb/samples/load")
    assert r.status_code == 202
    assert {x["filename"] for x in r.json()["results"]} == {"meridian_grid_financial_review_2024.txt",
                                                            "meridian_grid_annual_report.pdf", "voltaic_systems_brief.txt"}
    wait_ws(s, ws)
    docs = s.get(f"/api/workspaces/{ws}/documents").json()["documents"]
    review = next(d for d in docs if d["filename"].startswith("meridian_grid_financial"))
    assert review["is_sample"] and review["meta"]["company"] == "Meridian Grid" and review["meta"]["fiscal_year"] == "FY2024"
    acts = s.get("/api/activity").json()["activity"]
    assert any(a["kind"] == "upload" and "sample" in a["summary"].lower() for a in acts)
    over = s.get("/api/overview").json()
    assert over["workspaces"][0]["stats"]["documents"] == 3 and len(over["recent_documents"]) == 3


def test_search_respects_membership(app):
    a = register(make_client(app), "sa@example.com", "research")
    b = register(make_client(app), "sb@example.com", "research")
    ws_a = first_workspace(a, "research")
    _upload(a, ws_a, "port_calder_health_study.txt")
    wait_ws(a, ws_a)
    ra = a.get("/api/search", params={"q": "childhood asthma"}).json()
    assert any(p["workspace_id"] == ws_a for p in ra["passages"])
    rb = b.get("/api/search", params={"q": "childhood asthma"}).json()
    assert not any(p["workspace_id"] == ws_a for p in rb["passages"])
    assert b.get("/api/search", params={"q": "asthma", "scope": ws_a}).status_code == 404


def test_saved_analyses_are_private(app):
    a = register(make_client(app), "save1@example.com", "legal")
    b = register(make_client(app), "save2@example.com")
    ws = first_workspace(a, "legal")
    r = a.post("/api/saved", json={"workspace_id": ws, "kind": "legal", "title": "Card data duties", "payload": {"x": 1}})
    assert r.status_code == 201
    aid = r.json()["saved"]["analysis_id"]
    assert a.get(f"/api/saved/{aid}").json()["saved"]["payload"] == {"x": 1}
    assert b.get(f"/api/saved/{aid}").status_code == 404
    assert b.post("/api/saved", json={"workspace_id": ws, "kind": "legal", "title": "x", "payload": {}}).status_code == 404
    assert a.delete(f"/api/saved/{aid}").status_code == 200
