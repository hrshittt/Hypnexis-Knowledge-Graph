"""API integration: upload → background ingestion → graph → inspectors → query (JSON + SSE) → delete/reset."""

import json
import re

from conftest import SAMPLES, wait_job


def _upload(client, *names):
    files = [("files", (n, (SAMPLES / n).read_bytes())) for n in names]
    r = client.post("/api/kb/documents", files=files)
    assert r.status_code == 202, r.text
    return r.json()


def test_status_on_empty_kb(client):
    r = client.get("/api/kb/status")
    assert r.status_code == 200
    body = r.json()
    assert body["stats"]["documents"] == 0
    assert body["llm"]["active"] is False
    assert body["graph_store"] == "sqlite"


def test_upload_builds_graph_and_topics(client):
    reg = _upload(client, "voltaic_systems_brief.txt", "meridian_grid_annual_report.pdf", "aurora_institute_profile.txt")
    assert [r["status"] for r in reg["results"]] == ["queued"] * 3
    job = wait_job(client, reg["job"]["id"])
    assert job["status"] == "done", job
    docs = client.get("/api/kb/documents").json()["documents"]
    assert {d["status"] for d in docs} == {"ready"}
    pdf = next(d for d in docs if d["filename"].endswith(".pdf"))
    assert pdf["num_pages"] == 2 and pdf["num_relations"] > 0

    g = client.get("/api/kb/graph").json()
    ids = {n["id"] for n in g["nodes"]}
    assert len(g["nodes"]) >= 10 and len(g["edges"]) >= 10
    assert all(e["source"] in ids and e["target"] in ids for e in g["edges"])
    assert g["topics"], "topic communities should be discovered"
    assert all(t["summary"] and t["evidence_chunk_ids"] for t in g["topics"])


def test_duplicate_and_invalid_files(client):
    reg = _upload(client, "voltaic_systems_brief.txt")
    wait_job(client, reg["job"]["id"])
    files = [
        ("files", ("voltaic_copy.txt", (SAMPLES / "voltaic_systems_brief.txt").read_bytes())),
        ("files", ("malware.exe", b"MZ\x90\x00binary")),
        ("files", ("empty.txt", b"")),
        ("files", ("fake.pdf", b"this is not a pdf at all")),
        ("files", ("scanned.pdf", b"%PDF-1.4\n%%EOF")),
    ]
    r = client.post("/api/kb/documents", files=files)
    assert r.status_code == 202
    res = {x["filename"]: x for x in r.json()["results"]}
    assert res["voltaic_copy.txt"]["status"] == "duplicate"
    assert res["malware.exe"]["code"] == "unsupported_type"
    assert res["empty.txt"]["code"] == "empty_file"
    assert res["fake.pdf"]["code"] == "invalid_pdf"
    assert res["scanned.pdf"]["status"] == "rejected"
    assert r.json()["job"] is None


def test_unreadable_pdf_fails_gracefully_and_can_be_deleted(client):
    # passes the magic-byte check but pypdf can't parse it → document marked failed, not a 500
    r = client.post("/api/kb/documents", files=[("files", ("broken.pdf", b"%PDF-1.4\n garbage " * 50))])
    body = r.json()
    if body["job"]:
        job = wait_job(client, body["job"]["id"])
        assert job["status"] == "failed" and job["failed"][0]["error"]
        doc_id = job["failed"][0]["doc_id"]
        doc = next(d for d in client.get("/api/kb/documents").json()["documents"] if d["doc_id"] == doc_id)
        assert doc["status"] == "failed"
        assert client.delete(f"/api/kb/documents/{doc_id}").status_code == 200
    else:
        assert body["results"][0]["status"] == "rejected"


def test_inspectors_return_verbatim_evidence(client):
    wait_job(client, _upload(client, "port_calder_health_study.txt")["job"]["id"])
    g = client.get("/api/kb/graph").json()
    edge = g["edges"][0]
    rel = client.get(f"/api/kb/relations/{edge['id']}").json()
    assert rel["evidence"], "every edge must have evidence"
    for ev in rel["evidence"]:
        assert ev["sentence"] in ev["text"]
        a, b = ev["highlights"][0]
        assert ev["text"][a:b] == ev["sentence"]
    node = next(n for n in g["nodes"] if n["degree"] > 0)
    ent = client.get(f"/api/kb/entities/{node['id']}").json()
    assert ent["name"] == node["name"] and ent["relations"] and ent["passages"]
    for p in ent["passages"]:
        for a, b in p["highlights"]:
            assert p["text"][a:b].lower() in {x.lower() for x in ent["aliases"]}
    chunk = client.get(f"/api/kb/chunks/{ent['passages'][0]['chunk_id']}").json()
    assert node["id"] in chunk["entity_ids"]
    assert client.get("/api/kb/entities/e_doesnotexist").status_code == 404
    assert client.get("/api/kb/relations/r_doesnotexist").status_code == 404


def test_query_json_and_stream(client):
    wait_job(client, client.post("/api/kb/samples/load").json()["job"]["id"])
    r = client.post("/api/kb/query", json={"question": "Who founded Voltaic Systems?"})
    assert r.status_code == 200
    ans = r.json()
    assert ans["route"] == "factual" and ans["sufficient"]
    assert "Ravi Menon" in ans["answer"]
    valid = {s["id"] for s in ans["sources"]} | {f["id"] for f in ans["graph_facts"]}
    cited = set(re.findall(r"\[([SG]\d+)\]", ans["answer"]))
    assert cited and cited <= valid
    assert ans["highlight"]["edges"], "the supporting edge should be highlighted"

    with client.stream("POST", "/api/kb/query/stream",
                       json={"question": "How is the Clean Horizon Act connected to childhood asthma?"}) as s:
        events = [json.loads(line[6:]) for line in s.iter_lines()
                  if line.startswith("data: ") and line != "data: [DONE]"]
    stages = [e["node"] for e in events if e["type"] == "stage"]
    assert stages[0] == "route_query" and "retrieve_multi_hop" in stages
    result = next(e for e in events if e["type"] == "result")
    assert result["route"] == "multi_hop" and result["paths"]
    assert result["highlight"]["path_edges"]


def test_query_validation(client):
    assert client.post("/api/kb/query", json={"question": ""}).status_code == 422
    assert client.post("/api/kb/query", json={}).status_code == 422


def test_delete_document_prunes_graph(client):
    wait_job(client, client.post("/api/kb/samples/load").json()["job"]["id"])
    before = client.get("/api/kb/graph").json()
    docs = client.get("/api/kb/documents").json()["documents"]
    target = next(d for d in docs if d["filename"] == "port_calder_health_study.txt")
    r = client.delete(f"/api/kb/documents/{target['doc_id']}")
    assert r.status_code == 200 and r.json()["relations_removed"] > 0
    after = client.get("/api/kb/graph").json()
    names = {n["name"] for n in after["nodes"]}
    assert "Amina Diallo" not in names  # only mentioned in the deleted document
    assert len(after["edges"]) < len(before["edges"])
    assert client.delete(f"/api/kb/documents/{target['doc_id']}").status_code == 404


def test_reset_requires_confirmation(client):
    wait_job(client, _upload(client, "voltaic_systems_brief.txt")["job"]["id"])
    assert client.delete("/api/kb").status_code == 400
    r = client.delete("/api/kb?confirm=true")
    assert r.status_code == 200 and r.json()["documents_removed"] == 1
    assert client.get("/api/kb/status").json()["stats"]["documents"] == 0


def test_examples_endpoint(client):
    qs = client.get("/api/kb/examples").json()["questions"]
    cats = {q["category"] for q in qs}
    assert {"thematic", "factual", "multi_hop", "comparison", "insufficient_evidence"} <= cats


def test_kb_init_failure_returns_503(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    import backend.api.kb as kb_api
    import backend.kb.service as svc_mod

    def boom():
        raise RuntimeError("database is locked")

    monkeypatch.setattr(svc_mod, "get_kb", boom)
    app = FastAPI()
    app.include_router(kb_api.router)
    with TestClient(app) as c:
        r = c.get("/api/kb/graph")
        assert r.status_code == 503 and "database is locked" in r.json()["detail"]
        assert c.get("/api/kb/status").status_code == 503
