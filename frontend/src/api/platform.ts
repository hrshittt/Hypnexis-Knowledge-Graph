import { http } from '../lib/http';
import type { Job, UploadResult } from '../types/kb';
import type {
  Activity, AnalysisGraph, AsOfComparison, AuthConfig, CompanyProfile, CorporateAnalysis, DepartmentTrend, DocMeta,
  Funnel, ImportRecord, LegalAnalysis, LegalSource, Member, Overview, Paper, PaperComparison, PlacementAnswer,
  PlacementConfig, PlacementOverview, PlatformDocument, PpoRow, Provision, RelatedPaper, Role, SavedAnalysis,
  SavedAnalysisSummary, SearchResult, SessionPayload, StagedImport, StudentPage, User, Workspace, WorkspaceDocument,
  WorkspaceType, YearComparison,
} from '../types/platform';

// ── auth ─────────────────────────────────────────────────────────────────────
export const authApi = {
  config: () => http<AuthConfig>('/api/auth/config'),
  me: () => http<SessionPayload>('/api/auth/me'),
  /** never 401: lets public pages check for a session without logging an error */
  session: () => http<({ authenticated: true } & SessionPayload) | { authenticated: false; expired: boolean }>('/api/auth/session'),
  login: (email: string, password: string, remember: boolean) =>
    http<SessionPayload>('/api/auth/login', { body: { email, password, remember } }),
  register: (body: { name: string; email: string; password: string; workspace_type: WorkspaceType | null; accept_terms: boolean }) =>
    http<SessionPayload>('/api/auth/register', { body }),
  logout: () => http<{ signed_out: boolean }>('/api/auth/logout', { method: 'POST' }),
  updateProfile: (body: { name?: string; primary_workspace_type?: WorkspaceType }) =>
    http<{ user: User }>('/api/auth/me', { method: 'PATCH', body }),
  changePassword: (current_password: string, new_password: string) =>
    http<{ changed: boolean }>('/api/auth/password', { body: { current_password, new_password } }),
  revokeOtherSessions: () => http<{ revoked: number }>('/api/auth/sessions/revoke-others', { method: 'POST' }),
};

// ── workspaces ───────────────────────────────────────────────────────────────
const ws = (id: string) => `/api/workspaces/${id}`;

export const workspacesApi = {
  list: () => http<{ workspaces: Workspace[] }>('/api/workspaces').then((r) => r.workspaces),
  get: (id: string) => http<{ workspace: Workspace }>(ws(id)).then((r) => r.workspace),
  create: (body: { type: WorkspaceType; name?: string; description?: string }) =>
    http<{ workspace: Workspace }>('/api/workspaces', { body }).then((r) => r.workspace),
  update: (id: string, body: { name?: string; description?: string }) =>
    http<{ workspace: Workspace }>(ws(id), { method: 'PATCH', body }).then((r) => r.workspace),
  members: (id: string) => http<{ members: Member[]; my_role: Role }>(`${ws(id)}/members`),
  addMember: (id: string, email: string, role: Role) =>
    http<{ member: Member }>(`${ws(id)}/members`, { body: { email, role } }),
  setRole: (id: string, userId: string, role: Role) =>
    http<{ members: Member[] }>(`${ws(id)}/members/${userId}`, { method: 'PATCH', body: { role } }),
  removeMember: (id: string, userId: string) =>
    http<{ removed: string }>(`${ws(id)}/members/${userId}`, { method: 'DELETE' }),
  documents: (id: string) => http<{ documents: WorkspaceDocument[]; role: Role }>(`${ws(id)}/documents`),
  setMeta: (id: string, docId: string, body: Partial<DocMeta> & { verified?: boolean }) =>
    http<{ meta: Record<string, unknown> }>(`${ws(id)}/documents/${docId}/meta`, { method: 'PUT', body }),
};

// ── cross-workspace views ────────────────────────────────────────────────────
export const platformApi = {
  overview: () => http<Overview>('/api/overview'),
  documents: () => http<{ documents: PlatformDocument[]; shared_write: boolean }>('/api/documents'),
  search: (q: string, scope = 'all', limit = 5) => http<SearchResult>('/api/search', { query: { q, scope, limit } }),
  activity: (kind?: string, limit = 100) =>
    http<{ activity: Activity[] }>('/api/activity', { query: { kind, limit } }).then((r) => r.activity),
  recordView: (kind: 'topic_view' | 'graph_view', summary: string, workspaceId: string | null, detail: Record<string, unknown> = {}) =>
    http<{ recorded: boolean }>('/api/activity', { body: { kind, summary: summary.slice(0, 300), workspace_id: workspaceId, detail } }),
  saved: () => http<{ saved: SavedAnalysisSummary[] }>('/api/saved').then((r) => r.saved),
  getSaved: (id: string) => http<{ saved: SavedAnalysis }>(`/api/saved/${id}`).then((r) => r.saved),
  save: (body: { workspace_id: string | null; kind: string; title: string; payload: Record<string, unknown> }) =>
    http<{ saved: SavedAnalysis }>('/api/saved', { body }).then((r) => r.saved),
  deleteSaved: (id: string) => http<{ deleted: string }>(`/api/saved/${id}`, { method: 'DELETE' }),
};

// ── document intelligence ────────────────────────────────────────────────────
export const corporateApi = {
  analysis: (id: string, company?: string | null) =>
    http<CorporateAnalysis>(`${ws(id)}/corporate/analysis`, { query: { company: company ?? undefined } }),
  graph: (id: string, company?: string | null) =>
    http<AnalysisGraph>(`${ws(id)}/corporate/graph`, { query: { company: company ?? undefined } }),
};

export const researchApi = {
  papers: (id: string) => http<{ papers: Paper[]; processing: number }>(`${ws(id)}/research/papers`),
  paper: (id: string, docId: string) => http<Paper>(`${ws(id)}/research/papers/${docId}`),
  related: (id: string, docId: string) =>
    http<{ doc_id: string; related: RelatedPaper[]; note: string }>(`${ws(id)}/research/papers/${docId}/related`),
  compare: (id: string, a: string, b: string) =>
    http<PaperComparison>(`${ws(id)}/research/compare`, { body: { doc_ids: [a, b] } }),
};

export const legalApi = {
  sources: (id: string) =>
    http<{ sources: LegalSource[]; jurisdictions: string[]; untagged: number; disclaimer: string }>(`${ws(id)}/legal/sources`),
  provisions: (id: string, docId: string) =>
    http<{ doc_id: string; title: string; filename: string; authorities_mentioned: string[]; provisions: Provision[];
      meta: LegalSource['meta']; disclaimer: string }>(`${ws(id)}/legal/provisions`, { query: { doc_id: docId } }),
  analyze: (id: string, question: string, jurisdiction?: string | null, topic?: string | null) =>
    http<LegalAnalysis>(`${ws(id)}/legal/analyze`, { body: { question, jurisdiction: jurisdiction || null, topic: topic || null } }),
  graph: (id: string) => http<AnalysisGraph>(`${ws(id)}/legal/graph`),
};

// ── placement ────────────────────────────────────────────────────────────────
const pl = (id: string) => `${ws(id)}/placement`;

export const placementApi = {
  overview: (id: string, year?: string | null) => http<PlacementOverview>(`${pl(id)}/overview`, { query: { year: year ?? undefined } }),
  years: (id: string) => http<YearComparison & { department_trends: DepartmentTrend[] }>(`${pl(id)}/years`),
  asOf: (id: string) => http<AsOfComparison>(`${pl(id)}/as-of`),
  funnel: (id: string, year: string | null, type: 'full_time' | 'internship', company?: string | null) =>
    http<Funnel>(`${pl(id)}/funnel`, { query: { year: year ?? undefined, type, company: company ?? undefined } }),
  ppo: (id: string, by: 'company' | 'department' | 'year', year?: string | null) =>
    http<{ by: string; year: string | null; rows: PpoRow[]; definition: string; by_year: PpoRow[] }>(`${pl(id)}/ppo`,
      { query: { by, year: year ?? undefined } }),
  companies: (id: string) => http<{ companies: CompanyProfile[]; years: string[]; ongoing: string[] }>(`${pl(id)}/companies`),
  students: (id: string, q: { year?: string | null; q?: string; department?: string; status?: string; attention?: boolean; page?: number; page_size?: number }) =>
    http<StudentPage>(`${pl(id)}/students`, { query: { ...q, year: q.year ?? undefined, attention: q.attention || undefined } }),
  ask: (id: string, question: string) => http<PlacementAnswer>(`${pl(id)}/ask`, { body: { question } }),
  graph: (id: string, year?: string | null, students = false) =>
    http<AnalysisGraph>(`${pl(id)}/graph`, { query: { year: year ?? undefined, students: students || undefined } }),
  config: (id: string) => http<{ config: PlacementConfig; cycles: PlacementOverview['years'] }>(`${pl(id)}/config`),
  saveConfig: (id: string, patch: Partial<PlacementConfig>) =>
    http<{ config: PlacementConfig }>(`${pl(id)}/config`, { method: 'PUT', body: patch }),
  imports: (id: string) => http<{ imports: ImportRecord[] }>(`${pl(id)}/imports`).then((r) => r.imports),
  stage: (id: string, kind: 'students' | 'applications', file: File) => {
    const form = new FormData();
    form.append('kind', kind);
    form.append('file', file, file.name);
    return http<StagedImport>(`${pl(id)}/imports`, { method: 'POST', body: form });
  },
  preview: (id: string, importId: string, mapping: Record<string, string | null>, defaults: Record<string, unknown>) =>
    http<StagedImport>(`${pl(id)}/imports/${importId}/preview`, { body: { mapping, defaults } }),
  commit: (id: string, importId: string, mapping: Record<string, string | null>, defaults: Record<string, unknown>,
    duplicatePolicy: 'skip' | 'update') =>
    http<{ import: ImportRecord; summary: ImportRecord['summary'] }>(`${pl(id)}/imports/${importId}/commit`,
      { body: { mapping, defaults, duplicate_policy: duplicatePolicy } }),
  discard: (id: string, importId: string) => http<{ discarded: string }>(`${pl(id)}/imports/${importId}`, { method: 'DELETE' }),
  loadSamples: (id: string) => http<{ loaded: Record<string, unknown> }>(`${pl(id)}/samples/load`, { method: 'POST' }),
  deleteAll: (id: string) =>
    http<{ applications_removed: number; students_removed: number }>(`${pl(id)}/data`, { method: 'DELETE', query: { confirm: true } }),
};

export type { Job, UploadResult };
