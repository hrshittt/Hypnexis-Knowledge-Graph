"""
Interactive Knowledge Base — Topic-Augmented Knowledge Graph Builder
====================================================================
Upload PDF/TXT → chunk with source offsets → extract (subject, predicate, object)
triples with verbatim evidence → resolve/dedupe entities → persist nodes, edges and
provenance in the graph store (Neo4j; local SQLite + NetworkX fallback) → Louvain topic
communities with grounded summaries → routed hybrid retrieval (ChromaDB + BM25 +
CrossEncoder + Cypher graph paths) through a LangGraph workflow → cited answers + highlight payload.

Entry point for the API layer: backend.kb.service.get_kb()
"""
