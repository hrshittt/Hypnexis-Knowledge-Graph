"""
Neo4j graph store — the primary knowledge-graph store when Neo4j is active.

What lives where
  Neo4j   entities, aliases, mentions, relations with per-sentence evidence (provenance),
          topic communities and cross-topic links. Every graph read — relations, neighbours,
          multi-hop paths — is a Cypher query (see Neo4jTraversal).
  SQLite  documents (uploads, ingestion status), chunk text + offsets, summary cache, graph_version
          (inherited from KnowledgeStore).
  Chroma  chunk embeddings (vector_index.py).

Graph model — every node carries `ns` (NEO4J_NAMESPACE) and a unique `uid` = "<ns>:<id>":
  (:Document {id, filename, title})
  (:Chunk {id, doc_id, page, chunk_index, start_char, end_char})-[:PART_OF]->(:Document)
  (:Entity {id, name, norm, type, description, community_id})
  (:Alias {norm, alias, entity_id})-[:ALIAS_OF]->(:Entity)
  (:Entity)-[:MENTIONED_IN {source, doc_id}]->(:Chunk)
  (:Entity)-[:RELATES {id, predicate, evidence_count, doc_ids, evidence}]->(:Entity)
  (:Evidence {relation_id, chunk_id, doc_id, sentence, method, confidence})-[:FROM_CHUNK]->(:Chunk)
  (:Entity)-[:IN_TOPIC]->(:Topic {id, label, summary, keywords, ...})
  (:Topic)-[:TOPIC_LINK {weight, bridges}]->(:Topic)
RELATES.doc_ids / .evidence summarise the Evidence nodes so a relationship's sources are visible
directly in Neo4j Browser; the Evidence nodes remain the source of truth for provenance.
"""

import hashlib
import json
import time
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from neo4j import GraphDatabase, RoutingControl

from backend.kb.store import KnowledgeStore, StoreError
from backend.utils.logger import get_logger

log = get_logger(__name__)

_SCHEMA = [
    # the old optional mirror (neo4j_sync.py) made Entity.id unique, which breaks namespaces
    "DROP CONSTRAINT kb_entity IF EXISTS",
    *[f"CREATE CONSTRAINT kb_{label.lower()}_uid IF NOT EXISTS FOR (n:{label}) REQUIRE n.uid IS UNIQUE"
      for label in ("Entity", "Alias", "Document", "Chunk", "Evidence", "Topic")],
    "CREATE INDEX kb_entity_ns IF NOT EXISTS FOR (n:Entity) ON (n.ns)",
    "CREATE INDEX kb_alias_ns IF NOT EXISTS FOR (n:Alias) ON (n.ns)",
    "CREATE INDEX kb_chunk_ns IF NOT EXISTS FOR (n:Chunk) ON (n.ns)",
    "CREATE INDEX kb_chunk_doc IF NOT EXISTS FOR (n:Chunk) ON (n.ns, n.doc_id)",
    "CREATE INDEX kb_evidence_rel IF NOT EXISTS FOR (n:Evidence) ON (n.ns, n.relation_id)",
    "CREATE INDEX kb_evidence_doc IF NOT EXISTS FOR (n:Evidence) ON (n.ns, n.doc_id)",
    "CREATE INDEX kb_topic_ns IF NOT EXISTS FOR (n:Topic) ON (n.ns)",
    "CREATE INDEX kb_relates_uid IF NOT EXISTS FOR ()-[x:RELATES]-() ON (x.uid)",
]

_GRAPH_LABELS = ("Evidence", "Alias", "Topic", "Entity", "Chunk", "Document")

_REFRESH_RELATIONS = """
UNWIND $ids AS rid
MATCH ()-[x:RELATES {uid: $ns + ':' + rid}]->()
OPTIONAL MATCH (ev:Evidence {ns: $ns, relation_id: rid})
WITH x, collect(DISTINCT ev.doc_id) AS docs, collect(DISTINCT ev.sentence) AS sents
SET x.doc_ids = docs, x.evidence = sents, x.evidence_count = size(sents)
"""

# a relationship counts only if at least one of its evidence sentences comes from a ready document
_READY = "any(d IN x.doc_ids WHERE d IN $ready)"


def _entity_row(e: Dict[str, Any]) -> Dict[str, Any]:
    return {"entity_id": e["id"], "name": e["name"], "norm": e["norm"], "type": e.get("type") or "Other",
            "description": e.get("description") or "", "community_id": e.get("community_id"),
            "created_at": e.get("created_at")}


def _evidence_key(relation_id: str, chunk_id: str, sentence: str) -> str:
    return hashlib.sha1(f"{relation_id}|{chunk_id}|{sentence}".encode("utf-8")).hexdigest()[:20]


class Neo4jKnowledgeStore(KnowledgeStore):
    graph_backend = "neo4j"

    def __init__(self, path, uri: str, user: str, password: str, database: str = "neo4j",
                 namespace: str = "default"):
        super().__init__(path)
        self.uri, self.database, self.ns = uri, database, namespace
        self.graph_id = f"neo4j:{database}:{namespace}"
        self._ping: Tuple[float, bool, Optional[str]] = (0.0, False, None)
        try:
            self._driver = GraphDatabase.driver(
                uri, auth=(user, password), connection_timeout=5.0, connection_acquisition_timeout=10.0,
                max_transaction_retry_time=5.0,
                # "unknown property key" notices are expected while a namespace is still empty
                notifications_disabled_categories=["UNRECOGNIZED"])
            self._driver.verify_connectivity()
            for stmt in _SCHEMA:
                self._driver.execute_query(stmt, database_=self.database)
            self.owns_namespace = self._claim_namespace()
        except Exception as e:
            try:
                self._driver.close()
            except Exception:
                pass
            super().close()
            raise StoreError(f"cannot use Neo4j at {uri} (database '{database}'): {type(e).__name__}: {e}") from e
        log.success(f"Graph store: Neo4j at {uri} (database '{database}', namespace '{namespace}')")

    # ── plumbing ──────────────────────────────────────────────────────────────
    def _read(self, cypher: str, **params) -> List[Dict[str, Any]]:
        records, _, _ = self._driver.execute_query(cypher, {"ns": self.ns, **params}, database_=self.database,
                                                   routing_=RoutingControl.READ)
        return [r.data() for r in records]

    def _write(self, statements: Sequence[Tuple[str, Dict[str, Any]]]) -> List[List[Dict[str, Any]]]:
        """Run several statements in one write transaction (all or nothing)."""
        def work(tx):
            return [[r.data() for r in tx.run(c, {"ns": self.ns, **p})] for c, p in statements]
        with self._driver.session(database=self.database) as s:
            return s.execute_write(work)

    def _ready(self) -> List[str]:
        return [r["doc_id"] for r in self._q("SELECT doc_id FROM documents WHERE status='ready'")]

    def _claim_namespace(self) -> bool:
        """Record which knowledge base owns this namespace, so a second knowledge base pointed at the same
        NEO4J_NAMESPACE by mistake never prunes the first one's graph (see service._graph_out_of_sync)."""
        me = self.instance_id()
        owner = self._write([("MERGE (n:KBNamespace {uid: $ns}) ON CREATE SET n.ns = $ns, n.owner = $me "
                              "RETURN n.owner AS owner", {"me": me})])[0][0]["owner"]
        if owner != me:
            log.warning(f"Neo4j namespace '{self.ns}' belongs to another knowledge base; graph data of documents "
                        f"unknown here will be left untouched. Use a distinct NEO4J_NAMESPACE per knowledge base.")
        return owner == me

    def close(self) -> None:
        try:
            self._driver.close()
        finally:
            super().close()

    def graph_info(self) -> Dict[str, Any]:
        t, ok, err = self._ping
        if time.monotonic() - t > 5.0:  # /status is polled; don't hit the server on every call
            try:
                self._driver.verify_connectivity()
                ok, err = True, None
            except Exception as e:
                ok, err = False, f"{type(e).__name__}: {e}"[:300]
            self._ping = (time.monotonic(), ok, err)
        return {"backend": "neo4j", "traversal": "cypher", "connected": ok, "error": err, "uri": self.uri,
                "database": self.database, "namespace": self.ns, "owns_namespace": self.owns_namespace}

    def traversal(self) -> "Neo4jTraversal":
        return Neo4jTraversal(self)

    # ── documents / chunks: SQLite records + provenance nodes in Neo4j ─────────
    def add_chunks(self, chunks) -> None:
        chunks = list(chunks)
        super().add_chunks(chunks)
        for doc_id in dict.fromkeys(c.doc_id for c in chunks):
            self.ensure_graph_chunks(doc_id)

    def update_document(self, doc_id: str, **fields) -> None:
        super().update_document(doc_id, **fields)
        if "title" in fields:
            self._write([("MATCH (d:Document {uid: $ns + ':' + $id}) SET d.title = $title",
                          {"id": doc_id, "title": fields["title"]})])

    def ensure_graph_chunks(self, doc_id: str) -> None:
        doc = self.get_document(doc_id)
        if doc is None:
            return
        rows = [dict(r) for r in self._q("SELECT chunk_id, doc_id, page, chunk_index, start_char, end_char "
                                         "FROM chunks WHERE doc_id=? ORDER BY chunk_index", (doc_id,))]
        self._write([("""
            MERGE (d:Document {uid: $ns + ':' + $doc.doc_id})
            SET d.ns = $ns, d.id = $doc.doc_id, d.filename = $doc.filename, d.title = $doc.title
            WITH d
            UNWIND $chunks AS c
            MERGE (x:Chunk {uid: $ns + ':' + c.chunk_id})
            SET x.ns = $ns, x.id = c.chunk_id, x.doc_id = c.doc_id, x.page = c.page,
                x.chunk_index = c.chunk_index, x.start_char = c.start_char, x.end_char = c.end_char
            MERGE (x)-[:PART_OF]->(d)""",
            {"doc": {"doc_id": doc_id, "filename": doc["filename"], "title": doc.get("title")}, "chunks": rows})])

    def graph_doc_ids(self) -> set:
        return {r["d"] for r in self._read("MATCH (c:Chunk {ns: $ns}) RETURN DISTINCT c.doc_id AS d")}

    # ── entities / aliases / mentions ────────────────────────────────────────
    def alias_index(self) -> Dict[str, str]:
        return {r["norm"]: r["entity_id"] for r in self._read(
            "MATCH (a:Alias {ns: $ns}) RETURN a.norm AS norm, a.entity_id AS entity_id")}

    def entity_info(self) -> Dict[str, Tuple[str, str]]:
        return {r["id"]: (r["name"], r["type"]) for r in self._read(
            "MATCH (e:Entity {ns: $ns}) RETURN e.id AS id, e.name AS name, e.type AS type")}

    def concept_norms(self) -> List[str]:
        return [r["norm"] for r in self._read("MATCH (e:Entity {ns: $ns}) WHERE e.type = 'Concept' RETURN e.norm AS norm")]

    def named_norms(self) -> List[str]:
        return [r["norm"] for r in self._read("MATCH (e:Entity {ns: $ns}) WHERE e.type <> 'Concept' RETURN e.norm AS norm")]

    def write_extraction(self, entities: Dict[str, Dict[str, Any]], aliases: Dict[str, Tuple[str, str]],
                         mentions: Iterable[Tuple[str, str, str, str]], relations: Iterable[Dict[str, Any]]) -> None:
        relations = list(relations)
        ent_rows = [{"id": eid, "name": e["name"], "norm": e["norm"], "type": e.get("type") or "Other",
                     "description": e.get("description") or ""} for eid, e in entities.items()]
        alias_rows = [{"norm": n, "entity_id": eid, "alias": surf} for n, (eid, surf) in aliases.items()]
        mention_rows = [{"entity_id": e, "chunk_id": c, "doc_id": d, "source": s} for e, c, d, s in mentions]
        rel_rows = [dict(r, evidence_key=_evidence_key(r["relation_id"], r["chunk_id"], r["sentence"]))
                    for r in relations]
        self._write([
            ("""UNWIND $rows AS e
                MERGE (n:Entity {uid: $ns + ':' + e.id})
                ON CREATE SET n.ns = $ns, n.id = e.id, n.name = e.name, n.norm = e.norm, n.type = e.type,
                              n.description = e.description, n.created_at = timestamp()
                ON MATCH SET n.type = CASE WHEN n.type IN ['Other', 'Concept'] AND NOT e.type IN ['Other', 'Concept']
                                           THEN e.type ELSE n.type END,
                             n.description = CASE WHEN coalesce(n.description, '') = '' THEN e.description
                                                  ELSE n.description END""", {"rows": ent_rows}),
            ("""UNWIND $rows AS a
                MERGE (al:Alias {uid: $ns + ':' + a.norm})
                ON CREATE SET al.ns = $ns, al.norm = a.norm, al.alias = a.alias, al.entity_id = a.entity_id
                WITH al, a WHERE al.entity_id = a.entity_id
                MATCH (e:Entity {uid: $ns + ':' + a.entity_id})
                MERGE (al)-[:ALIAS_OF]->(e)""", {"rows": alias_rows}),
            ("""UNWIND $rows AS m
                MATCH (e:Entity {uid: $ns + ':' + m.entity_id}), (c:Chunk {uid: $ns + ':' + m.chunk_id})
                MERGE (e)-[x:MENTIONED_IN]->(c)
                ON CREATE SET x.source = m.source, x.doc_id = m.doc_id""", {"rows": mention_rows}),
            ("""UNWIND $rows AS r
                MATCH (s:Entity {uid: $ns + ':' + r.subject_id}), (o:Entity {uid: $ns + ':' + r.object_id})
                MERGE (s)-[x:RELATES {uid: $ns + ':' + r.relation_id}]->(o)
                ON CREATE SET x.ns = $ns, x.id = r.relation_id, x.predicate = r.predicate, x.created_at = timestamp()
                MERGE (ev:Evidence {uid: $ns + ':' + r.evidence_key})
                ON CREATE SET ev.ns = $ns, ev.relation_id = r.relation_id, ev.chunk_id = r.chunk_id,
                              ev.doc_id = r.doc_id, ev.sentence = r.sentence, ev.method = r.method,
                              ev.confidence = r.confidence, ev.subject_id = r.subject_id,
                              ev.predicate = r.predicate, ev.object_id = r.object_id
                WITH ev, r
                MATCH (c:Chunk {uid: $ns + ':' + r.chunk_id})
                MERGE (ev)-[:FROM_CHUNK]->(c)""", {"rows": rel_rows}),
            (_REFRESH_RELATIONS, {"ids": sorted({r["relation_id"] for r in relations})}),
        ])
        self.bump_version()

    def replace_scan_mentions(self, rows: Iterable[Tuple[str, str, str]]) -> None:
        self._write([
            ("MATCH (:Entity {ns: $ns})-[x:MENTIONED_IN {source: 'scan'}]->() DELETE x", {}),
            ("""UNWIND $rows AS m
                MATCH (e:Entity {uid: $ns + ':' + m[0]}), (c:Chunk {uid: $ns + ':' + m[1]})
                MERGE (e)-[x:MENTIONED_IN]->(c)
                ON CREATE SET x.source = 'scan', x.doc_id = m[2]""", {"rows": [list(r) for r in rows]}),
        ])

    def entity_mentions(self) -> List[Tuple[str, str, str]]:
        return [(r["e"], r["c"], r["d"]) for r in self._read(
            """MATCH (e:Entity {ns: $ns})-[x:MENTIONED_IN]->(c:Chunk) WHERE x.doc_id IN $ready
               RETURN e.id AS e, c.id AS c, x.doc_id AS d ORDER BY e, c""", ready=self._ready())]

    def get_entity(self, entity_id: str) -> Optional[Dict[str, Any]]:
        rows = self._read("MATCH (e:Entity {uid: $ns + ':' + $id}) RETURN e {.*} AS e", id=entity_id)
        return _entity_row(rows[0]["e"]) if rows else None

    def get_entities(self, ids: Sequence[str]) -> Dict[str, Dict[str, Any]]:
        if not ids:
            return {}
        rows = self._read("UNWIND $ids AS id MATCH (e:Entity {uid: $ns + ':' + id}) RETURN e {.*} AS e",
                          ids=list(dict.fromkeys(ids)))
        return {r["e"]["id"]: _entity_row(r["e"]) for r in rows}

    def entity_aliases(self, entity_id: str) -> List[str]:
        return [r["alias"] for r in self._read(
            "MATCH (a:Alias {ns: $ns}) WHERE a.entity_id = $id RETURN a.alias AS alias", id=entity_id)]

    def entity_chunk_ids(self, entity_id: str) -> List[str]:
        return [r["id"] for r in self._read(
            """MATCH (:Entity {uid: $ns + ':' + $id})-[x:MENTIONED_IN]->(c:Chunk) WHERE x.doc_id IN $ready
               RETURN c.id AS id ORDER BY x.doc_id, c.id""", id=entity_id, ready=self._ready())]

    def chunk_entity_ids(self, chunk_id: str) -> List[str]:
        return [r["id"] for r in self._read(
            "MATCH (e:Entity)-[:MENTIONED_IN]->(:Chunk {uid: $ns + ':' + $id}) RETURN e.id AS id", id=chunk_id)]

    # ── relations / evidence ─────────────────────────────────────────────────
    def relations(self, ready_only: bool = True) -> List[Dict[str, Any]]:
        rows = self._read(
            """MATCH (s:Entity {ns: $ns})-[x:RELATES]->(o:Entity)
               MATCH (ev:Evidence {ns: $ns, relation_id: x.id})
               WHERE NOT $ready_only OR ev.doc_id IN $ready
               WITH x, s, o, count(DISTINCT ev.sentence) AS n, count(DISTINCT ev.doc_id) AS dc,
                    max(ev.confidence) AS conf, collect(DISTINCT ev.method) AS methods
               RETURN x.id AS relation_id, s.id AS subject_id, x.predicate AS predicate, o.id AS object_id,
                      n AS evidence_count, dc AS doc_count, conf AS confidence, methods
               ORDER BY relation_id""", ready_only=ready_only, ready=self._ready())
        for r in rows:
            r["methods"] = ",".join(sorted(r["methods"]))
        return rows

    def get_relation(self, relation_id: str) -> Optional[Dict[str, Any]]:
        rows = self._read(
            """MATCH (s:Entity)-[x:RELATES {uid: $ns + ':' + $id}]->(o:Entity)
               RETURN x.id AS relation_id, s.id AS subject_id, x.predicate AS predicate, o.id AS object_id,
                      x.created_at AS created_at""", id=relation_id)
        return rows[0] if rows else None

    def relation_evidence(self, relation_ids: Sequence[str]) -> Dict[str, List[Dict[str, Any]]]:
        if not relation_ids:
            return {}
        rows = self._read(
            """MATCH (ev:Evidence {ns: $ns}) WHERE ev.relation_id IN $ids AND ev.doc_id IN $ready
               RETURN ev.relation_id AS relation_id, ev.chunk_id AS chunk_id, ev.doc_id AS doc_id,
                      ev.sentence AS sentence, ev.method AS method, ev.confidence AS confidence
               ORDER BY confidence DESC, chunk_id""", ids=list(dict.fromkeys(relation_ids)), ready=self._ready())
        chunks = self.get_chunks([r["chunk_id"] for r in rows])  # chunk text + filename live in SQLite
        out: Dict[str, List[Dict[str, Any]]] = {}
        seen = set()
        for r in rows:
            ch = chunks.get(r["chunk_id"])
            key = (r["relation_id"], r["sentence"])
            if ch is None or key in seen:
                continue  # same sentence repeated in overlapping chunks
            seen.add(key)
            out.setdefault(r["relation_id"], []).append(
                dict(r, page=ch["page"], chunk_text=ch["text"], filename=ch["filename"]))
        return out

    # ── communities ──────────────────────────────────────────────────────────
    def replace_communities(self, assignments: Dict[str, Optional[str]], communities: List[Dict[str, Any]],
                            links: List[Dict[str, Any]]) -> None:
        topics = [{"id": t["community_id"], "label": t["label"], "summary": t["summary"], "keywords": t["keywords"],
                   "size": t["size"], "method": t["method"], "evidence_chunk_ids": t["evidence_chunk_ids"],
                   "doc_ids": t["doc_ids"], "signature": t["signature"], "rank": t["rank"],
                   "top_entities": t["top_entities"]} for t in communities]
        assign = [{"entity_id": eid, "community_id": cid} for eid, cid in assignments.items()]
        self._write([
            ("MATCH (e:Entity {ns: $ns}) WHERE e.community_id IS NOT NULL SET e.community_id = null", {}),
            ("MATCH (t:Topic {ns: $ns}) DETACH DELETE t", {}),
            ("UNWIND $rows AS t CREATE (x:Topic) SET x = t, x.uid = $ns + ':' + t.id, x.ns = $ns", {"rows": topics}),
            ("""UNWIND $rows AS a
                MATCH (e:Entity {uid: $ns + ':' + a.entity_id})
                SET e.community_id = a.community_id
                WITH e, a WHERE a.community_id IS NOT NULL
                MATCH (t:Topic {uid: $ns + ':' + a.community_id})
                MERGE (e)-[:IN_TOPIC]->(t)""", {"rows": assign}),
            ("""UNWIND $rows AS l
                MATCH (a:Topic {uid: $ns + ':' + l.source}), (b:Topic {uid: $ns + ':' + l.target})
                CREATE (a)-[:TOPIC_LINK {weight: l.weight, bridges: l.bridges}]->(b)""",
             {"rows": [dict(l, bridges=json.dumps(l["bridges"])) for l in links]}),
        ])
        self.bump_version()

    def communities(self) -> List[Dict[str, Any]]:
        out = []
        for r in self._read("MATCH (t:Topic {ns: $ns}) RETURN t {.*} AS t ORDER BY t.rank"):
            t = r["t"]
            out.append({"community_id": t["id"], "label": t["label"], "summary": t["summary"],
                        "keywords": list(t.get("keywords") or []), "size": t["size"], "method": t["method"],
                        "evidence_chunk_ids": list(t.get("evidence_chunk_ids") or []),
                        "doc_ids": list(t.get("doc_ids") or []), "signature": t["signature"], "rank": t["rank"],
                        "top_entities": list(t.get("top_entities") or [])})
        return out

    def community_links(self) -> List[Dict[str, Any]]:
        rows = self._read(
            """MATCH (a:Topic {ns: $ns})-[l:TOPIC_LINK]->(b:Topic)
               RETURN a.id AS source, b.id AS target, l.weight AS weight, l.bridges AS bridges
               ORDER BY weight DESC""")
        return [dict(r, bridges=json.loads(r["bridges"])) for r in rows]

    # ── deletion ─────────────────────────────────────────────────────────────
    def delete_doc_graph(self, doc_id: str) -> Dict[str, int]:
        def work(tx):
            p = {"ns": self.ns, "doc": doc_id}
            ids = tx.run("MATCH (ev:Evidence {ns: $ns, doc_id: $doc}) RETURN collect(DISTINCT ev.relation_id) AS ids",
                         p).single()["ids"]
            tx.run("MATCH (ev:Evidence {ns: $ns, doc_id: $doc}) DETACH DELETE ev", p).consume()
            r_del = tx.run("""UNWIND $ids AS rid
                              MATCH ()-[x:RELATES {uid: $ns + ':' + rid}]->()
                              WHERE NOT EXISTS { MATCH (:Evidence {ns: $ns, relation_id: rid}) }
                              DELETE x RETURN count(*) AS n""", dict(p, ids=ids)).single()["n"]
            tx.run(_REFRESH_RELATIONS, dict(p, ids=ids)).consume()
            tx.run("MATCH (c:Chunk {ns: $ns, doc_id: $doc}) DETACH DELETE c", p).consume()
            e_del = tx.run("""MATCH (e:Entity {ns: $ns})
                              WHERE NOT (e)-[:MENTIONED_IN]->() AND NOT (e)-[:RELATES]-()
                              DETACH DELETE e RETURN count(*) AS n""", p).single()["n"]
            tx.run("""MATCH (a:Alias {ns: $ns})
                      WHERE NOT EXISTS { MATCH (:Entity {uid: $ns + ':' + a.entity_id}) }
                      DETACH DELETE a""", p).consume()
            tx.run("MATCH (d:Document {uid: $ns + ':' + $doc}) DETACH DELETE d", p).consume()
            return {"relations_removed": r_del, "entities_removed": e_del}
        with self._driver.session(database=self.database) as s:
            stats = s.execute_write(work)
        self.bump_version()
        return stats

    def delete_document(self, doc_id: str) -> Dict[str, int]:
        stats = self.delete_doc_graph(doc_id)
        with self.tx() as c:
            c.execute("DELETE FROM chunks WHERE doc_id=?", (doc_id,))
            c.execute("DELETE FROM documents WHERE doc_id=?", (doc_id,))
            self.bump_version(c)
        return stats

    def reset(self) -> None:
        """Explicit wipe of this namespace (incl. its ownership record; the next start claims it again)."""
        self._write([(f"MATCH (n:{label} {{ns: $ns}}) DETACH DELETE n", {})
                     for label in (*_GRAPH_LABELS, "KBNamespace")])
        super().reset()
        self.owns_namespace = True

    def doc_counts(self, doc_id: str) -> Tuple[int, int]:
        r = self._read(
            """OPTIONAL MATCH (e:Entity)-[:MENTIONED_IN]->(:Chunk {ns: $ns, doc_id: $doc})
               WITH count(DISTINCT e) AS ents
               OPTIONAL MATCH (ev:Evidence {ns: $ns, doc_id: $doc})
               RETURN ents, count(DISTINCT ev.relation_id) AS rels""", doc=doc_id)[0]
        return int(r["ents"]), int(r["rels"])

    def stats(self) -> Dict[str, int]:
        base = super().stats()  # documents + chunks from SQLite
        g = self._read(
            """RETURN COUNT { MATCH (:Entity {ns: $ns}) } AS entities,
                      COUNT { MATCH (:Entity {ns: $ns})-[:RELATES]->() } AS relations,
                      COUNT { MATCH (:Topic {ns: $ns}) } AS topics""")[0]
        return {**base, "entities": int(g["entities"]), "relations": int(g["relations"]), "topics": int(g["topics"])}


class Neo4jTraversal:
    """Graph traversal as Cypher queries (the retriever's Neo4j backend; see NetworkXTraversal)."""

    name = "neo4j"

    def __init__(self, store: Neo4jKnowledgeStore):
        self.s = store

    def neighbors(self, eid: str) -> List[Tuple[str, str]]:
        return [(r["rid"], r["other"]) for r in self.s._read(
            f"""MATCH (:Entity {{uid: $ns + ':' + $id}})-[x:RELATES]-(o:Entity) WHERE {_READY}
                RETURN x.id AS rid, o.id AS other""", id=eid, ready=self.s._ready())]

    def candidate_paths(self, a: str, b: str, max_hops: int, limit: int = 200) -> List[Tuple[List[str], List[List[str]]]]:
        """Simple paths a…b no longer than the shortest + 1 hop; each hop lists its parallel relation ids."""
        ready = self.s._ready()
        hops = int(max_hops)
        sp = self.s._read(
            f"""MATCH (a:Entity {{uid: $ns + ':' + $a}}), (b:Entity {{uid: $ns + ':' + $b}})
                MATCH p = shortestPath((a)-[:RELATES*..{hops}]-(b))
                WHERE all(x IN relationships(p) WHERE {_READY})
                RETURN length(p) AS hops""", a=a, b=b, ready=ready)
        if not sp:
            return []
        upper = min(hops, int(sp[0]["hops"]) + 1)
        rows = self.s._read(
            f"""MATCH (a:Entity {{uid: $ns + ':' + $a}}), (b:Entity {{uid: $ns + ':' + $b}})
                MATCH p = (a)-[:RELATES*1..{upper}]-(b)
                WHERE all(x IN relationships(p) WHERE {_READY})
                  AND all(i IN range(0, length(p) - 1) WHERE NOT nodes(p)[i] IN nodes(p)[i + 1..])
                RETURN [n IN nodes(p) | n.id] AS nodes, [x IN relationships(p) | x.id] AS rels
                LIMIT $limit""", a=a, b=b, ready=ready, limit=limit)
        return _group_paths(rows)

    def reach(self, eid: str, hops: int) -> Dict[str, int]:
        return {r["id"]: int(r["dist"]) for r in self.s._read(
            f"""MATCH p = (:Entity {{uid: $ns + ':' + $id}})-[:RELATES*0..{int(hops)}]-(n:Entity)
                WHERE all(x IN relationships(p) WHERE {_READY})
                RETURN n.id AS id, min(length(p)) AS dist""", id=eid, ready=self.s._ready())}

    def two_hop(self, eid: str, limit: int = 200) -> List[Tuple[List[str], List[List[str]]]]:
        """Paths to entities exactly two hops away (not directly connected)."""
        rows = self.s._read(
            f"""MATCH (e:Entity {{uid: $ns + ':' + $id}})
                MATCH p = (e)-[:RELATES*2]-(n:Entity)
                WHERE n <> e AND NOT (e)-[:RELATES]-(n) AND all(x IN relationships(p) WHERE {_READY})
                RETURN [m IN nodes(p) | m.id] AS nodes, [x IN relationships(p) | x.id] AS rels
                LIMIT $limit""", id=eid, ready=self.s._ready(), limit=limit)
        return _group_paths(rows)


def _group_paths(rows: List[Dict[str, Any]]) -> List[Tuple[List[str], List[List[str]]]]:
    """Merge rows that differ only in which parallel relationship they used for a hop."""
    groups: Dict[Tuple[str, ...], List[set]] = {}
    for r in rows:
        key = tuple(r["nodes"])
        hops = groups.setdefault(key, [set() for _ in range(len(key) - 1)])
        for i, rid in enumerate(r["rels"]):
            hops[i].add(rid)
    return [(list(k), [sorted(h) for h in v]) for k, v in groups.items()]
