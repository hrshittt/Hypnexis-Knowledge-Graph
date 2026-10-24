"""
Interactive Knowledge Base — Topic-Augmented Knowledge Graph Builder
====================================================================
Upload PDF/TXT → chunk with source offsets → extract (subject, predicate, object)
triples with verbatim evidence → resolve/dedupe entities → persist nodes & edges
(SQLite graph store, optional Neo4j mirror) → Louvain topic communities with
grounded summaries → routed hybrid retrieval (ChromaDB + BM25 + CrossEncoder +
graph paths) through a LangGraph workflow → cited answers + highlight payload.

Entry point for the API layer: backend.kb.service.get_kb()
"""
