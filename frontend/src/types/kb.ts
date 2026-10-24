// Types mirroring backend/api/kb.py payloads.

export type Route = 'thematic' | 'factual' | 'multi_hop' | 'comparison';

export interface EntityBrief {
  id: string;
  name: string;
  type: string;
  community?: string | null;
}

export interface GraphNode {
  id: string;
  name: string;
  type: string;
  community: string | null;
  degree: number;
  mentions: number;
  doc_count: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  predicate: string;
  evidence_count: number;
  doc_count: number;
  cross_topic: boolean;
  methods?: string | null;
}

export interface Topic {
  id: string;
  label: string;
  summary: string;
  keywords: string[];
  size: number;
  doc_ids: string[];
  evidence_chunk_ids: string[];
  method: 'llm' | 'extractive';
  color_index: number;
  top_entities: EntityBrief[];
}

export interface TopicLink {
  source: string;
  target: string;
  weight: number;
  bridges: { relation_id: string; predicate: string; subject: EntityBrief; object: EntityBrief }[];
}

export interface GraphPayload {
  version: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  topics: Topic[];
  topic_links: TopicLink[];
  truncated: boolean;
  documents: { doc_id: string; filename: string }[];
}

export interface KBDocument {
  doc_id: string;
  filename: string;
  title: string | null;
  file_type: 'pdf' | 'text';
  size_bytes: number;
  num_pages: number;
  num_chunks: number;
  num_entities: number;
  num_relations: number;
  status: 'queued' | 'processing' | 'ready' | 'failed';
  error: string | null;
  extractor: 'llm' | 'heuristic' | null;
  uploaded_at: number;
}

export interface Job {
  id: string;
  status: 'queued' | 'running' | 'done' | 'partial' | 'failed';
  doc_ids: string[];
  done: string[];
  failed: { doc_id: string; error: string }[];
  errors: string[];
  stage: string;
  progress: { chunks_done: number; chunks_total: number };
}

export interface UploadResult {
  filename: string;
  status: 'queued' | 'duplicate' | 'rejected';
  doc_id?: string;
  code?: string;
  error?: string;
}

export interface KBStatus {
  stats: { documents: number; documents_total: number; chunks: number; entities: number; relations: number; topics: number };
  graph_version: number;
  llm: { configured: boolean; active: boolean; model: string | null; last_error: string | null; mode: string };
  embedding_model: string;
  reranker: string | null;
  dense_index: boolean;
  graph_store: string;
  neo4j: { enabled: boolean; ok?: boolean; error?: string };
  warnings: string[];
  jobs: Job[];
}

export interface Source {
  id: string;
  chunk_id: string;
  doc_id: string;
  filename: string;
  page: number;
  text: string;
  score: number;
  rerank?: number | null;
  highlights: [number, number][];
  cited: boolean;
}

export interface GraphFact {
  id: string;
  relation_id: string;
  subject: EntityBrief;
  predicate: string;
  object: EntityBrief;
  evidence_count: number;
  source_ids: string[];
  evidence: { source_id: string; sentence: string; method: string }[];
  sentence: string;
  cited: boolean;
}

export interface EvidencePath {
  nodes: EntityBrief[];
  edge_ids: string[];
  fact_ids: string[];
  hops: number;
  text: string;
  steps: string[];
}

export interface Highlight {
  nodes: string[];
  edges: string[];
  path_edges: string[];
  communities: string[];
}

export interface StageEvent {
  node: string;
  detail: string;
  t: number;
}

export interface Answer {
  question: string;
  route: Route;
  route_reason: string;
  route_method: string;
  answer: string;
  sufficient: boolean;
  sufficiency_reason: string;
  mode: 'llm' | 'extractive';
  sources: Source[];
  graph_facts: GraphFact[];
  paths: EvidencePath[];
  topics: { id: string; label: string; summary: string; size: number; source_ids: string[] }[];
  comparison: { kind: string; targets: { label: string; kind: string; id: string }[] } | null;
  highlight: Highlight;
  linked_entities: (EntityBrief & { matched: string })[];
  citations_used: string[];
  warnings: string[];
  followups: string[];
  trace: StageEvent[];
  latency_ms: number;
}

export interface EntityDetail {
  id: string;
  name: string;
  type: string;
  description: string;
  aliases: string[];
  relations: { id: string; direction: 'in' | 'out'; predicate: string; other: EntityBrief; evidence_count: number }[];
  passages: { chunk_id: string; doc_id: string; filename: string; page: number; text: string; highlights: [number, number][] }[];
  mention_count: number;
  documents: string[];
  topic: { id: string; label: string; summary: string } | null;
}

export interface RelationDetail {
  id: string;
  predicate: string;
  subject: EntityBrief;
  object: EntityBrief;
  evidence: { chunk_id: string; filename: string; page: number; sentence: string; text: string; highlights: [number, number][]; method: string; confidence: number }[];
}

export interface ChunkDetail {
  chunk_id: string;
  doc_id: string;
  filename: string;
  page: number;
  text: string;
  entity_ids: string[];
}

export interface ExampleQuestion {
  category: string;
  question: string;
  expect?: string;
}

export type Selection =
  | { kind: 'entity'; id: string }
  | { kind: 'relation'; id: string }
  | { kind: 'source'; source: Source }
  | { kind: 'topic'; id: string }
  | null;
