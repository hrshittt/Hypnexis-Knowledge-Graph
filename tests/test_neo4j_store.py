"""Graph store selection, fallback behaviour, and LIVE Neo4j integration.

Two kinds of tests, kept apart on purpose:

  * Store selection / fallback — always run, no Neo4j needed. They make real connection
    attempts to an address where nothing listens (no mocks).
  * Live Neo4j integration (marker `neo4j`) — run only when NEO4J_TEST_URI points at a reachable
    Neo4j server (credentials: NEO4J_TEST_USER / NEO4J_TEST_PASSWORD). They are SKIPPED otherwise;
    a skip is not a pass. Every test knowledge base uses its own random namespace and is wiped
    afterwards, so a developer's graph is never touched. Assertions about what is stored are made
    with direct Cypher through a separate driver, not through the store under test.

    NEO4J_TEST_URI=bolt://localhost:7687 NEO4J_TEST_PASSWORD=... python -m pytest -m neo4j
"""

import os
import uuid

import pytest
from conftest import SAMPLES, make_service, run, sample_payload
from platform_support import app, first_workspace, make_client, register, wait_ws  # noqa: F401

from backend.kb.store import StoreError

URI = os.getenv("NEO4J_TEST_URI", "")
USER = os.getenv("NEO4J_TEST_USER", "neo4j")
PASSWORD = os.getenv("NEO4J_TEST_PASSWORD", "")
NOTHING_LISTENS = "bolt://127.0.0.1:1"

MULTI_HOP = {
    "How is the Clean Horizon Act connected to childhood asthma?":
        "Clean Horizon Act → Harbor Coal Plant → fine particulate pollution → childhood asthma",
    "How is Dr. Lena Park connected to Voltaic Systems?":
        "Lena Park → Aurora Institute → Ravi Menon → Voltaic Systems",
}


def _probe():
    if not URI:
        return False, "NEO4J_TEST_URI not set — live Neo4j integration tests skipped"
    try:
        from neo4j import GraphDatabase
        with GraphDatabase.driver(URI, auth=(USER, PASSWORD), connection_timeout=3) as d:
            d.verify_connectivity()
        return True, ""
    except Exception as e:  # noqa: BLE001 — any failure means "not available here"
        return False, f"Neo4j at {URI} unreachable ({type(e).__name__}) — live tests skipped"


NEO4J_OK, WHY = _probe()
live = pytest.mark.skipif(not NEO4J_OK, reason=WHY)


def cypher(query, **params):
    """Independent read of the database (own driver, not the store under test)."""
    from neo4j import GraphDatabase
    with GraphDatabase.driver(URI, auth=(USER, PASSWORD)) as d:
        records, _, _ = d.execute_query(query, params)
        return [r.data() for r in records]


def neo4j_kb(path, namespace=None):
    return make_service(path, graph_store="neo4j", neo4j_uri=URI, neo4j_user=USER, neo4j_password=PASSWORD,
                        neo4j_namespace=namespace or f"test_{uuid.uuid4().hex[:10]}")


def wipe(kb):
    try:
        kb.store.reset()
    finally:
        kb.store.close()


# ═════════════════════════════════════════════════════════════════════════════
# Store selection and fallback (no Neo4j required)
# ═════════════════════════════════════════════════════════════════════════════

def test_auto_without_uri_uses_local_store_and_says_so(tmp_path):
    kb = make_service(tmp_path / "kb", graph_store="auto", neo4j_uri="")
    gs = kb.status()["graph_store"]
    assert gs["backend"] == "sqlite" and gs["traversal"] == "networkx"
    assert "NEO4J_URI is not set" in gs["fallback_reason"]
    kb.store.close()


def test_auto_with_unreachable_neo4j_falls_back_loudly(tmp_path):
    kb = make_service(tmp_path / "kb", graph_store="auto", neo4j_uri=NOTHING_LISTENS, neo4j_password="x")
    st = kb.status()
    assert st["graph_store"]["backend"] == "sqlite"
    assert "Neo4j is unavailable" in st["graph_store"]["fallback_reason"]
    assert any("Neo4j is unavailable" in w for w in st["warnings"])  # shown as a banner in the UI
    run(kb.ingest_files_and_wait(sample_payload("voltaic_systems_brief.txt")))
    assert run(kb.answer("Who founded Voltaic Systems?"))["sufficient"]  # the fallback really works
    kb.store.close()


def test_strict_neo4j_mode_never_falls_back(tmp_path):
    with pytest.raises(StoreError, match="Neo4j is unavailable"):
        make_service(tmp_path / "a", graph_store="neo4j", neo4j_uri=NOTHING_LISTENS, neo4j_password="x")
    with pytest.raises(StoreError, match="NEO4J_URI is not set"):
        make_service(tmp_path / "b", graph_store="neo4j", neo4j_uri="")
    with pytest.raises(StoreError, match="KB_GRAPH_STORE must be"):
        make_service(tmp_path / "c", graph_store="mongo")


def test_workspace_knowledge_bases_get_distinct_graph_namespaces(app):
    from backend import services
    s = register(make_client(app), "ns@example.com", "research")
    ws1 = first_workspace(s, "research")
    ws2 = s.post("/api/workspaces", json={"type": "legal"}).json()["workspace"]["id"]
    k1, k2 = services.workspaces().kb(ws1), services.workspaces().kb(ws2)
    assert k1.settings.neo4j_namespace.endswith(f".ws-{ws1}")
    assert k2.settings.neo4j_namespace.endswith(f".ws-{ws2}")
    assert k1.settings.neo4j_namespace != k2.settings.neo4j_namespace


# ═════════════════════════════════════════════════════════════════════════════
# LIVE Neo4j integration
# ═════════════════════════════════════════════════════════════════════════════

@pytest.fixture(scope="module")
def neo_kb(tmp_path_factory):
    if not NEO4J_OK:
        pytest.skip(WHY)
    kb = neo4j_kb(tmp_path_factory.mktemp("neo") / "kb")
    reg = run(kb.ingest_files_and_wait(sample_payload()))
    assert reg["job"]["status"] == "done", reg
    yield kb
    wipe(kb)


@pytest.mark.neo4j
@live
def test_graph_is_persisted_in_neo4j_not_sqlite(neo_kb):
    ns = neo_kb.store.ns
    db = cypher("""RETURN COUNT { MATCH (:Entity {ns: $ns}) } AS entities,
                          COUNT { MATCH (:Entity {ns: $ns})-[:RELATES]->() } AS relations,
                          COUNT { MATCH (:Topic {ns: $ns}) } AS topics,
                          COUNT { MATCH (:Evidence {ns: $ns}) } AS evidence,
                          COUNT { MATCH (:Document {ns: $ns}) } AS documents,
                          COUNT { MATCH (:Entity {ns: $ns})-[:IN_TOPIC]->(:Topic) } AS in_topic""", ns=ns)[0]
    stats = neo_kb.store.stats()
    assert (db["entities"], db["relations"], db["topics"]) == (stats["entities"], stats["relations"], stats["topics"])
    assert db["relations"] >= 40 and db["topics"] >= 3 and db["documents"] == 5
    assert db["evidence"] >= db["relations"] and db["in_topic"] > 0
    # SQLite keeps documents + chunks only — its graph tables stay empty (Neo4j is primary, not a mirror)
    for table in ("entities", "aliases", "mentions", "relations", "evidence", "communities"):
        assert neo_kb.store._q(f"SELECT COUNT(*) FROM {table}")[0][0] == 0, table
    assert all(d["graph_backend"] == neo_kb.store.graph_id for d in neo_kb.store.list_documents())
    gs = neo_kb.status()["graph_store"]
    assert gs["backend"] == "neo4j" and gs["traversal"] == "cypher" and gs["connected"] is True


@pytest.mark.neo4j
@live
def test_every_relationship_traces_to_a_verbatim_source_sentence(neo_kb):
    ns = neo_kb.store.ns
    rows = cypher("""MATCH (:Entity {ns: $ns})-[x:RELATES]->(:Entity)
                     MATCH (ev:Evidence {ns: $ns, relation_id: x.id})-[:FROM_CHUNK]->(c:Chunk)-[:PART_OF]->(d:Document)
                     RETURN x.id AS rid, x.doc_ids AS doc_ids, ev.sentence AS sentence, ev.doc_id AS ev_doc,
                            c.id AS chunk_id, d.id AS doc_id""", ns=ns)
    all_rels = {r["rid"] for r in cypher("MATCH (:Entity {ns: $ns})-[x:RELATES]->() RETURN x.id AS rid", ns=ns)}
    assert {r["rid"] for r in rows} == all_rels  # no relationship without provenance
    chunks = neo_kb.store.get_chunks([r["chunk_id"] for r in rows])
    for r in rows:
        assert r["ev_doc"] == r["doc_id"] and r["doc_id"] in r["doc_ids"]
        assert r["sentence"] in chunks[r["chunk_id"]]["text"]


@pytest.mark.neo4j
@live
def test_multi_hop_answers_traverse_neo4j_and_match_the_local_store(neo_kb, loaded_kb):
    from backend.kb.neo4j_store import Neo4jTraversal
    neo_kb.retriever.refresh()
    assert isinstance(neo_kb.retriever.traversal, Neo4jTraversal)
    for question, expected in MULTI_HOP.items():
        a = run(neo_kb.answer(question))
        assert a["route"] == "multi_hop" and a["sufficient"]
        assert a["paths"][0]["text"] == expected
        assert any("via neo4j" in t["detail"] for t in a["trace"] if t["node"] == "retrieve_multi_hop")
        b = run(loaded_kb.answer(question))  # same corpus in the SQLite + NetworkX fallback
        assert [p["text"] for p in a["paths"]] == [p["text"] for p in b["paths"]]
        assert [f["relation_id"] for f in a["graph_facts"]] == [f["relation_id"] for f in b["graph_facts"]]
    for q in ("Who founded Voltaic Systems?", "What are the main themes across these documents?",
              "Compare Aurora Institute and Voltaic Systems.", "What is Voltaic Systems' current stock price?"):
        a, b = run(neo_kb.answer(q)), run(loaded_kb.answer(q))
        assert (a["route"], a["sufficient"]) == (b["route"], b["sufficient"]), q
        assert [f["relation_id"] for f in a["graph_facts"]] == [f["relation_id"] for f in b["graph_facts"]], q


@pytest.mark.neo4j
@live
def test_graph_reads_come_from_neo4j(tmp_path):
    """Remove one edge directly in Neo4j (bypassing the app): the next answer must no longer use it."""
    kb = neo4j_kb(tmp_path / "kb")
    try:
        run(kb.ingest_files_and_wait(sample_payload("meridian_grid_annual_report.pdf", "port_calder_health_study.txt")))
        q = "How is the Clean Horizon Act connected to childhood asthma?"
        before = run(kb.answer(q))
        hop = next(f for f in before["graph_facts"] if f["predicate"] == "contributes to")
        removed = cypher("MATCH ()-[x:RELATES {uid: $uid}]->() DELETE x RETURN count(*) AS n",
                         uid=f"{kb.store.ns}:{hop['relation_id']}")[0]["n"]
        assert removed == 1
        kb.store.bump_version()  # the app's cache key; the data itself is only in Neo4j
        after = run(kb.answer(q))
        assert hop["relation_id"] not in {f["relation_id"] for f in after["graph_facts"]}
        assert not after["paths"] or after["paths"][0]["text"] != before["paths"][0]["text"]
    finally:
        wipe(kb)


@pytest.mark.neo4j
@live
def test_delete_document_prunes_its_graph_data(tmp_path):
    kb = neo4j_kb(tmp_path / "kb")
    try:
        run(kb.ingest_files_and_wait(sample_payload("voltaic_systems_brief.txt", "aurora_institute_profile.txt")))
        doc = next(d for d in kb.store.list_documents() if d["filename"] == "voltaic_systems_brief.txt")
        run(kb.delete_document(doc["doc_id"]))
        ns = kb.store.ns
        left = cypher("""RETURN COUNT { MATCH (e:Evidence {ns: $ns, doc_id: $d}) } AS evidence,
                                COUNT { MATCH (c:Chunk {ns: $ns, doc_id: $d}) } AS chunks,
                                COUNT { MATCH (x:Document {ns: $ns, id: $d}) } AS docs,
                                COUNT { MATCH (e:Entity {ns: $ns}) WHERE NOT (e)-[:MENTIONED_IN]->()
                                        AND NOT (e)-[:RELATES]-() } AS orphans,
                                COUNT { MATCH ()-[x:RELATES]->() WHERE x.ns = $ns AND $d IN x.doc_ids } AS stale""",
                      ns=ns, d=doc["doc_id"])[0]
        assert left == {"evidence": 0, "chunks": 0, "docs": 0, "orphans": 0, "stale": 0}
        assert kb.store.stats()["relations"] > 0  # the other document's graph is intact
        ans = run(kb.answer("Who founded Voltaic Systems?"))
        assert "voltaic_systems_brief.txt" not in {s["filename"] for s in ans["sources"]}
    finally:
        wipe(kb)


@pytest.mark.neo4j
@live
def test_namespaces_are_isolated(tmp_path):
    a, b = neo4j_kb(tmp_path / "a"), neo4j_kb(tmp_path / "b")
    try:
        for kb in (a, b):
            run(kb.ingest_files_and_wait(sample_payload("port_calder_health_study.txt")))
        n_b = b.store.stats()["entities"]
        run(a.reset())
        assert cypher("MATCH (n) WHERE n.ns = $ns RETURN count(n) AS n", ns=a.store.ns)[0]["n"] == 0
        assert b.store.stats()["entities"] == n_b > 0
    finally:
        wipe(a)
        wipe(b)


@pytest.mark.neo4j
@live
def test_switching_graph_store_reextracts_documents(tmp_path):
    """Documents ingested into the local store are re-extracted into Neo4j (and back) from stored chunks."""
    path = tmp_path / "kb"
    local = make_service(path)
    run(local.ingest_files_and_wait(sample_payload()))
    local_stats, local_answer = local.store.stats(), run(local.answer(next(iter(MULTI_HOP))))
    local.store.close()

    neo = neo4j_kb(path)
    try:
        assert len(neo.pending_resync) == 5 and any("re-extracted" in w for w in neo.warnings)
        job = run(neo.resync_graph_and_wait())
        assert job["status"] == "done" and len(job["done"]) == 5
        assert not any("re-extracted" in w for w in neo.warnings)  # the notice clears once it is done
        assert neo.store.stats() == local_stats
        assert run(neo.answer(next(iter(MULTI_HOP))))["paths"][0]["text"] == local_answer["paths"][0]["text"]
        neo.store.close()
        back = make_service(path)  # and back to the local store: the SQLite graph is rebuilt too
        assert len(back.pending_resync) == 5
        assert run(back.resync_graph_and_wait())["status"] == "done"
        assert back.store.stats() == local_stats
        back.store.close()
    finally:
        neo = neo4j_kb(path, namespace=neo.store.ns)
        wipe(neo)


@pytest.mark.neo4j
@live
def test_api_reports_neo4j_and_serves_graph_from_it(neo_kb, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    import backend.api.kb as kb_api
    import backend.kb.service as svc_mod

    monkeypatch.setattr(svc_mod, "_kb", neo_kb)
    app = FastAPI()
    app.include_router(kb_api.router)
    with TestClient(app) as c:
        gs = c.get("/api/kb/status").json()["graph_store"]
        assert gs["backend"] == "neo4j" and gs["connected"] and gs["namespace"] == neo_kb.store.ns
        g = c.get("/api/kb/graph").json()
        assert len(g["edges"]) == neo_kb.store.stats()["relations"] and g["doc_links"]
        rel = c.get(f"/api/kb/relations/{g['edges'][0]['id']}").json()
        assert rel["evidence"] and rel["evidence"][0]["sentence"] in rel["evidence"][0]["text"]


@pytest.mark.neo4j
@live
def test_shared_namespace_never_prunes_another_knowledge_base(tmp_path):
    """Two knowledge bases pointed at one NEO4J_NAMESPACE by mistake: the second must not delete the first's graph."""
    ns = f"test_{uuid.uuid4().hex[:10]}"
    first = neo4j_kb(tmp_path / "first", namespace=ns)
    try:
        run(first.ingest_files_and_wait(sample_payload("port_calder_health_study.txt")))
        before = cypher("RETURN COUNT { MATCH (:Evidence {ns: $ns}) } AS n", ns=ns)[0]["n"]
        second = neo4j_kb(tmp_path / "second", namespace=ns)  # its SQLite knows none of first's documents
        try:
            assert second.store.owns_namespace is False and first.store.owns_namespace is True
            assert any("shared with another knowledge base" in w for w in second.warnings)
            assert cypher("RETURN COUNT { MATCH (:Evidence {ns: $ns}) } AS n", ns=ns)[0]["n"] == before > 0
        finally:
            second.store.close()  # not reset(): that would wipe the namespace both point at
    finally:
        wipe(first)


@pytest.mark.neo4j
@live
def test_workspace_graphs_live_in_their_own_neo4j_namespaces(app, monkeypatch):
    base = f"test_{uuid.uuid4().hex[:10]}"
    for k, v in {"KB_GRAPH_STORE": "neo4j", "NEO4J_URI": URI, "NEO4J_USER": USER,
                 "NEO4J_PASSWORD": PASSWORD, "NEO4J_NAMESPACE": base}.items():
        monkeypatch.setenv(k, v)
    try:
        s = register(make_client(app), "neo@example.com", "research")
        ws1 = first_workspace(s, "research")
        ws2 = s.post("/api/workspaces", json={"type": "legal"}).json()["workspace"]["id"]
        body = (SAMPLES / "port_calder_health_study.txt").read_bytes()
        assert s.post(f"/api/workspaces/{ws1}/kb/documents",
                      files=[("files", ("port_calder_health_study.txt", body))]).status_code == 202
        wait_ws(s, ws1)
        gs1 = s.get(f"/api/workspaces/{ws1}/kb/status").json()["graph_store"]
        gs2 = s.get(f"/api/workspaces/{ws2}/kb/status").json()["graph_store"]
        assert gs1["backend"] == gs2["backend"] == "neo4j"
        assert (gs1["namespace"], gs2["namespace"]) == (f"{base}.ws-{ws1}", f"{base}.ws-{ws2}")
        per_ns = {r["ns"]: r["n"] for r in cypher(
            "MATCH (e:Entity) WHERE e.ns STARTS WITH $base RETURN e.ns AS ns, count(*) AS n", base=base)}
        assert per_ns.get(gs1["namespace"], 0) > 0 and gs2["namespace"] not in per_ns  # isolated in Neo4j
        g1 = s.get(f"/api/workspaces/{ws1}/kb/graph").json()
        assert any(n["name"] == "Amina Diallo" for n in g1["nodes"])
        assert not s.get(f"/api/workspaces/{ws2}/kb/graph").json()["nodes"]
    finally:
        cypher("MATCH (n) WHERE n.ns STARTS WITH $base DETACH DELETE n", base=base)
