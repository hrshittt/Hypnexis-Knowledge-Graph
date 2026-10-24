// Types mirroring the platform API (backend/api/auth.py, workspaces.py, platform.py, intel.py, placement.py).
import type { Citation, GraphPayload, KBDocument } from './kb';

export type WorkspaceType = 'corporate' | 'research' | 'legal' | 'placement';
export type Role = 'owner' | 'analyst' | 'viewer';

// ── auth ─────────────────────────────────────────────────────────────────────
export interface User {
  id: string;
  email: string;
  name: string;
  role: 'member' | 'admin';
  primary_workspace_type: WorkspaceType | null;
  created_at: number;
  last_login_at: number | null;
}

export interface WorkspaceStats {
  documents?: number;
  entities?: number;
  relations?: number;
  topics?: number;
  processing?: number;
  placement_records?: number;
  placement_students?: number;
  error?: string;
}

export interface Workspace {
  id: string;
  type: WorkspaceType;
  type_label: string;
  name: string;
  description: string;
  created_at: number;
  role: Role | null;
  member_count: number | null;
  stats?: WorkspaceStats;
}

export interface SessionPayload {
  user: User;
  csrf_token: string;
  workspaces: Workspace[];
  session: { expires_at: number; remember: boolean };
  permissions?: { shared_kb_write: boolean };
}

export interface AuthConfig {
  registration_open: boolean;
  workspace_types: WorkspaceType[];
  password: { min_length: number; max_length: number; rules: string[] };
  password_reset: 'administrator';
  session_hours: number;
  remember_days: number;
}

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  added_at: number;
}

// ── documents, activity, search ──────────────────────────────────────────────
export interface DocMeta {
  company: string | null;
  fiscal_year: string | null;
  doc_kind: string | null;
  jurisdiction: string | null;
  authority: string | null;
  effective_date: string | null;
  source_url: string | null;
}

export interface WorkspaceDocument extends KBDocument {
  meta: DocMeta;
  is_sample: boolean;
  verified_at: number | null;
  uploaded_by: string | null;
}

export interface PlatformDocument extends KBDocument {
  meta: Partial<DocMeta>;
  is_sample: boolean;
  verified_at?: number | null;
  workspace_id: string | null;
  workspace_name: string;
  workspace_type: WorkspaceType | 'shared';
  role: Role;
  can_upload: boolean;
  can_delete: boolean;
}

export interface Activity {
  activity_id: number;
  workspace_id: string | null;
  kind: string;
  summary: string;
  detail: Record<string, unknown>;
  created_at: number;
  workspace_name: string | null;
  workspace_type: WorkspaceType | null;
}

export interface SavedAnalysisSummary {
  analysis_id: string;
  workspace_id: string | null;
  kind: string;
  title: string;
  created_at: number;
  workspace_name: string | null;
  workspace_type: WorkspaceType | null;
}

export interface SavedAnalysis extends SavedAnalysisSummary {
  user_id: string;
  payload: Record<string, unknown>;
}

export interface ProcessingJob {
  id: string;
  status: string;
  doc_ids: string[];
  done: string[];
  stage: string;
  progress: { chunks_done: number; chunks_total: number };
  workspace_id: string;
  workspace_name: string;
}

export interface Overview {
  user: { id: string; name: string; primary_workspace_type: WorkspaceType | null };
  workspaces: Workspace[];
  recent_documents: (KBDocument & { workspace_id: string; workspace_name: string; workspace_type: WorkspaceType })[];
  recent_queries: Activity[];
  recent_topics: Activity[];
  saved: SavedAnalysisSummary[];
  processing: ProcessingJob[];
  shared_corpus: { documents: number; entities: number; relations: number; topics: number; chunks: number } | null;
}

export interface SearchPassage {
  workspace_id: string | null;
  workspace_name: string;
  workspace_type: WorkspaceType | 'shared';
  doc_id?: string;
  filename?: string;
  page?: number;
  chunk_id?: string;
  text?: string;
  score?: number;
  highlights?: [number, number][];
  error?: string;
}

export interface SearchResult {
  query: string;
  scope: string;
  passages: SearchPassage[];
  entities: { workspace_id: string | null; workspace_name: string; workspace_type: string; id: string; name: string; type: string }[];
  placement: { workspace_id: string; workspace_name: string; kind: 'company' | 'student'; label: string }[];
  searched: number;
}

// ── corporate ────────────────────────────────────────────────────────────────
export interface Period { year: number; label: string; source?: string }

export interface FigurePoint {
  metric: string;
  metric_label: string;
  reported_label: string;
  value: number;
  currency: string | null;
  display: string;
  as_written: string;
  period: Period;
  basis: 'reported';
  method: string;
  citation: Citation;
  conflict: boolean;
  variants: { value: number; display: string; citation: Citation }[];
  sources: Citation[];
  labels: string[];
  segment?: string;
}

export interface MetricSeries {
  metric: string;
  label: string;
  points: FigurePoint[];
}

export interface DerivedInput {
  metric: string;
  label: string;
  period: string;
  value: number;
  display: string;
  basis: string;
  citation?: Citation;
}

export interface DerivedMetric {
  metric: string;
  label: string;
  period: { year: number; label: string };
  currency: string | null;
  value: number;
  unit: string;
  display: string;
  basis: 'calculated';
  formula: string;
  inputs: DerivedInput[];
}

export interface Risk {
  category: string;
  category_label: string;
  basis: 'disclosed' | 'inferred';
  title: string;
  explanation: string;
  severity: 'high' | 'medium' | 'low';
  severity_basis: string;
  in_risk_section?: boolean;
  rule?: string;
  condition?: string;
  period: Period | null;
  evidence: Citation[];
  inputs?: DerivedInput[];
  follow_ups: string[];
  evidence_strength: string;
  supporting_sentences_in_category?: number;
}

export interface CorporateAnalysis {
  company: string | null;
  companies: string[];
  documents: { doc_id: string; title: string; filename: string; meta: Partial<DocMeta> & { is_sample?: number | boolean } }[];
  unassigned_documents: number;
  metrics: Record<string, MetricSeries>;
  derived: DerivedMetric[];
  segments: FigurePoint[];
  periods: number[];
  currencies: string[];
  risks: {
    disclosed: Risk[];
    inferred: Risk[];
    summary: { category: string; label: string; disclosed: number; inferred: number; max_severity: string | null }[];
  };
  methodology: { rule: string; category: string; severity: string; condition: string }[];
  limitations: string[];
  notes: string[];
  figure_count: number;
}

// ── research ─────────────────────────────────────────────────────────────────
export interface PaperFieldItem { text: string; page?: number; citation?: Citation }
export interface PaperField {
  label: string;
  found: boolean;
  method: string | null;
  items: PaperFieldItem[];
  note: string | null;
}

export interface Paper {
  doc_id: string;
  filename: string;
  title: string;
  authors: { value: string[]; found: boolean; method?: string | null; note: string | null };
  affiliations?: string[];
  year: { value: number | null; found: boolean; note: string | null };
  fields: Record<string, PaperField>;
  sections_found: string[];
  pages: number;
  meta: Partial<DocMeta> & { is_sample?: number | boolean };
}

export interface RelatedPaper {
  doc_id: string;
  similarity: number;
  shared_entities: { id: string; name: string }[];
  title: string;
  filename: string;
}

export interface PaperComparison {
  a: Pick<Paper, 'doc_id' | 'filename' | 'title' | 'authors' | 'year'>;
  b: Pick<Paper, 'doc_id' | 'filename' | 'title' | 'authors' | 'year'>;
  rows: { field: string; label: string; a: PaperField; b: PaperField }[];
  shared_entities: { id: string; name: string }[];
  only_a: { id: string; name: string }[];
  only_b: { id: string; name: string }[];
  note: string;
}

// ── legal ────────────────────────────────────────────────────────────────────
export interface LegalSentence {
  text: string;
  classes: string[];
  provision: string;
  citation: Citation;
}

export interface LegalSource {
  doc_id: string;
  title: string;
  filename: string;
  meta: Partial<DocMeta> & { verified_at?: number | null; is_sample?: number | boolean };
  provisions: number;
  counts: Record<string, number>;
}

export interface Provision {
  id: string;
  ref: string;
  title: string;
  label: string;
  page: number;
  counts: Record<string, number>;
  sentences: LegalSentence[];
  references: string[];
}

export interface LegalLaw {
  doc_id: string;
  law: string;
  filename: string;
  jurisdiction: string | null;
  authority: string | null;
  authorities_mentioned: string[];
  effective_date: string | null;
  source_url: string | null;
  verified_at: number | null;
  is_sample: boolean;
  applicability: 'potential';
  why: string[];
  matched_facts: { key: string; label: string }[];
  provisions: { ref: string; label: string; page: number }[];
  scope: LegalSentence[];
  obligations: LegalSentence[];
  deadlines: LegalSentence[];
  exceptions: LegalSentence[];
  conditions: LegalSentence[];
  penalties: LegalSentence[];
  facts_to_confirm: { phrase: string; provision: string; citation: Citation }[];
  evidence_strength: string;
  score: number;
  limitations: string[];
}

export interface LegalAnalysis {
  question: string;
  facts: { key: string; label: string }[];
  jurisdiction: string | null;
  clarifications: string[];
  laws: LegalLaw[];
  sources_considered: number;
  message?: string;
  disclaimer: string;
  status_note?: string;
}

// ── placement ────────────────────────────────────────────────────────────────
export interface Cycle {
  academic_year: string;
  status: 'ongoing' | 'completed';
  status_source: 'configured' | 'default';
  start_date: string;
}

export interface Kpi {
  key: string;
  value: number | null;
  numerator: number | null;
  denominator: number | null;
  unit: string | null;
  definition: string;
  note: string | null;
  available: boolean;
}

export interface YearMetrics {
  cycle: Cycle;
  kpis: Record<string, Kpi>;
  data_quality: {
    records: number; roster_students: number; unknown_outcomes: number;
    students_not_in_roster: number | null; dated_offers: number; offers: number;
  };
  policy: { denominator: string; placed_definition: string; count_ppo_as_placement: boolean };
}

export interface DepartmentRow {
  department: string;
  roster: number;
  group: number;
  placed: number;
  unplaced: number;
  in_process: number;
  offers: number;
  placement_rate: number | null;
  denominator: string;
}

export interface YearRow {
  academic_year: string;
  cycle: Cycle;
  placement_rate: number | null;
  students_placed: number | null;
  total_offers: number | null;
  unique_students_with_offers: number | null;
  internship_offers: number | null;
  ppo_offers: number | null;
  ppo_conversion_rate: number | null;
  companies_participating: number | null;
  returning_companies: number | null;
  ctc_average: number | null;
  ctc_median: number | null;
  eligible_students: number | null;
}

export interface YearComparison { years: YearRow[]; ongoing: string[]; note: string | null }

export interface PlacementStage { key: string; label: string; synonyms: string[] }

export interface PlacementConfig {
  stages: PlacementStage[];
  placement_denominator: 'eligible' | 'registered';
  placed_definition: 'offer_received' | 'offer_accepted';
  count_ppo_as_placement: boolean;
  ctc_unit: string;
  cycles: Record<string, { status: 'ongoing' | 'completed' | null; start_date: string | null }>;
}

export interface PlacementOverview {
  years: Cycle[];
  selected_year: string | null;
  sample_data: boolean;
  config: PlacementConfig;
  role: Role;
  can_see_students: boolean;
  counts: { students: number; records: number };
  metrics: YearMetrics | null;
  departments: DepartmentRow[];
  comparison: YearComparison | null;
}

export interface DepartmentTrend {
  department: string;
  rates: Record<string, number | null>;
  change: number | null;
  from_year: string | null;
  to_year: string | null;
}

export interface AsOfComparison {
  available: boolean;
  current?: string;
  days_into_cycle?: number;
  rows?: { academic_year: string; cutoff: string; offers_by_cutoff: number; students_placed_by_cutoff: number;
    dated_offers: number; undated_offers: number; is_current: boolean }[];
  note: string;
}

export interface FunnelStage {
  key: string;
  label: string;
  tracked: boolean;
  reached: number;
  progressed: number;
  rejected: number;
  withdrawn: number;
  pending: number;
  unknown: number;
  conversion_to_next: number | null;
  rejection_rate: number | null;
  drop_off: number;
}

export interface Funnel {
  academic_year: string | null;
  opportunity_type?: 'full_time' | 'internship';
  stages: FunnelStage[];
  applications: number;
  without_stage?: number;
  largest_drop_off?: string | null;
  highest_rejection_rate?: string | null;
  note?: string;
  stage_durations?: { available: boolean; note: string };
}

export interface PpoRow {
  company?: string;
  department?: string;
  year?: string;
  interns: number;
  started: number;
  completed: number;
  ppo_offered: number;
  ppo_accepted: number;
  ppo_declined: number;
  no_ppo: number;
  pending: number;
  unknown: number;
  known: number;
  conversion_rate: number | null;
}

export interface CompanyProfile {
  company: string;
  company_norm: string;
  industry: string | null;
  years: string[];
  returning: boolean;
  roles: string[];
  departments: string[];
  applications: number;
  full_time_applications: number;
  offers: number;
  offers_by_year: Record<string, number>;
  offers_change: number | null;
  internship_offers: number;
  interns: number;
  ppo_offered: number;
  ppo_known: number;
  ppo_conversion_rate: number | null;
  selection_rate: number | null;
  ctc_average: number | null;
  ctc_highest: number | null;
  status: string;
  open_processes: number;
}

export interface StudentRow {
  student_id: string;
  department: string | null;
  graduation_year: number | null;
  eligible: number | null;
  registered: number | null;
  in_roster: boolean;
  applications: number;
  offers: number;
  furthest_stage: string | null;
  internship_status: string | null;
  ppo_status: string | null;
  status: string;
  needs_attention: boolean;
}

export interface StudentPage {
  academic_year: string | null;
  total: number;
  page: number;
  page_size: number;
  rows: StudentRow[];
  departments: string[];
  statuses: string[];
}

export interface ImportSummary {
  total_rows?: number;
  valid?: number;
  invalid?: number;
  duplicates_in_file?: number;
  adjustments?: Record<string, number>;
  unknown_values?: Record<string, { value: string; rows: number }[]>;
  existing_matches?: number;
  new_records?: number;
  inserted?: number;
  updated?: number;
  skipped_existing?: number;
  errors?: ImportError[];
  error?: string;
}

export interface ImportError { row: number; field?: string; message: string; value?: unknown }

export interface ImportRecord {
  id: string;
  kind: 'students' | 'applications';
  filename: string;
  status: 'staged' | 'committed' | 'discarded' | 'failed';
  is_sample: boolean;
  duplicate_policy: 'skip' | 'update' | null;
  summary: ImportSummary;
  created_at: number;
  committed_at: number | null;
  uploaded_by: string | null;
  uploader?: string | null;
}

export interface StagedImport {
  import: ImportRecord;
  kind: 'students' | 'applications';
  filename: string;
  sheet: string | null;
  headers: string[];
  fields: { key: string; label: string; required: boolean; kind: string; help: string }[];
  mapping: Record<string, string | null>;
  defaults: Record<string, unknown>;
  sensitive_columns: string[];
  unmapped_columns: string[];
  summary: ImportSummary;
  errors: ImportError[];
  duplicates: { row: number; duplicate_of: number; message: string }[];
  sample_rows: Record<string, unknown>[];
  stages: string[];
}

export interface PlacementAnswer {
  intent: string;
  title: string;
  answer: string;
  year: string | null;
  table: { columns: string[]; rows: (string | number | null)[][] } | null;
  definitions: { term: string; definition: string }[];
  calculation: string | null;
  links: { label: string; tab: string }[];
  notes: string[];
  supported: string[] | null;
}

// ── analysis graphs share the knowledge-graph payload shape ─────────────────
export type AnalysisGraph = GraphPayload & {
  company_entity?: string | null;
  scope?: { academic_year: string | null; students: boolean; student_limit: number };
};
