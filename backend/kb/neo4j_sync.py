"""
Optional Neo4j mirror of the knowledge graph (SQLite remains the source of truth).

Enabled when NEO4J_URI is set and the `neo4j` driver is installed (`pip install neo4j`).
After every ingestion / deletion the full graph snapshot is upserted:
  (:Entity {id, name, type, community})-[:RELATES {id, predicate, evidence_count}]->(:Entity)
  (:Entity)-[:IN_TOPIC]->(:Topic {id, label, summary})
  (:Document {id, filename})
Nodes/edges no longer present in SQLite are removed so both stores stay identical.
Failures are reported in /api/kb/status and never break ingestion.
"""

from typing import Any, Dict

from backend.utils.logger import get_logger

log = get_logger(__name__)


def sync_graph(store, settings) -> Dict[str, Any]:
    try:
        from neo4j import GraphDatabase
    except ImportError:
        return {"enabled": True, "ok": False, "error": "neo4j driver not installed (pip install neo4j)"}
    try:
        rels = store.relations()
        ids = {r["subject_id"] for r in rels} | {r["object_id"] for r in rels}
        ents = store.get_entities(list(ids))
        topics = store.communities()
        docs = store.list_documents(status="ready")
        driver = GraphDatabase.driver(settings.neo4j_uri, auth=(settings.neo4j_user, settings.neo4j_password))
        with driver, driver.session(database=settings.neo4j_database) as s:
            s.run("CREATE CONSTRAINT kb_entity IF NOT EXISTS FOR (e:Entity) REQUIRE e.id IS UNIQUE")
            s.run("UNWIND $rows AS r MERGE (e:Entity {id: r.id}) SET e.name=r.name, e.type=r.type, e.community=r.community",
                  rows=[{"id": e["entity_id"], "name": e["name"], "type": e["type"], "community": e["community_id"]}
                        for e in ents.values()])
            s.run("MATCH (e:Entity) WHERE NOT e.id IN $ids DETACH DELETE e", ids=list(ents))
            s.run("UNWIND $rows AS r MATCH (a:Entity {id: r.s}), (b:Entity {id: r.o}) "
                  "MERGE (a)-[x:RELATES {id: r.id}]->(b) SET x.predicate=r.p, x.evidence_count=r.n",
                  rows=[{"id": r["relation_id"], "s": r["subject_id"], "o": r["object_id"], "p": r["predicate"],
                         "n": int(r["evidence_count"])} for r in rels])
            s.run("MATCH ()-[x:RELATES]->() WHERE NOT x.id IN $ids DELETE x", ids=[r["relation_id"] for r in rels])
            s.run("MATCH (t:Topic) DETACH DELETE t")
            s.run("UNWIND $rows AS t CREATE (:Topic {id: t.id, label: t.label, summary: t.summary})",
                  rows=[{"id": t["community_id"], "label": t["label"], "summary": t["summary"]} for t in topics])
            s.run("MATCH (e:Entity), (t:Topic {id: e.community}) MERGE (e)-[:IN_TOPIC]->(t)")
            s.run("MATCH (d:Document) WHERE NOT d.id IN $ids DETACH DELETE d", ids=[d["doc_id"] for d in docs])
            s.run("UNWIND $rows AS d MERGE (x:Document {id: d.id}) SET x.filename=d.filename",
                  rows=[{"id": d["doc_id"], "filename": d["filename"]} for d in docs])
        log.info(f"Neo4j mirror synced: {len(ents)} entities, {len(rels)} relations, {len(topics)} topics")
        return {"enabled": True, "ok": True, "entities": len(ents), "relations": len(rels), "topics": len(topics)}
    except Exception as e:
        log.warning(f"Neo4j sync failed: {e}")
        return {"enabled": True, "ok": False, "error": str(e)[:300]}
