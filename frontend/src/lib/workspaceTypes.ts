import { BookOpenText, Building2, GraduationCap, Scale, type LucideIcon } from 'lucide-react';
import type { Role, WorkspaceType } from '../types/platform';

export interface WorkspaceTypeInfo {
  type: WorkspaceType;
  label: string;
  short: string;
  icon: LucideIcon;
  tagline: string;
  audience: string;
  /** what the sample set contains — always fictional and labelled as such */
  sampleNote: string;
}

export const WORKSPACE_TYPES: WorkspaceTypeInfo[] = [
  {
    type: 'corporate', label: 'Corporate Intelligence', short: 'Corporate', icon: Building2,
    tagline: 'Understand company performance, financial trends, risks and disclosures.',
    audience: 'CFOs, finance teams, founders and analysts',
    sampleNote: 'A fictional company (Meridian Grid) with a financial review, annual report and a partner brief.',
  },
  {
    type: 'research', label: 'Research Intelligence', short: 'Research', icon: BookOpenText,
    tagline: 'Connect papers, concepts, findings and citations into an explorable knowledge graph.',
    audience: 'Students, researchers and academics',
    sampleNote: 'Two fictional research papers and a related health study.',
  },
  {
    type: 'legal', label: 'Legal & Policy Intelligence', short: 'Legal & Policy', icon: Scale,
    tagline: 'Explore applicable regulations, obligations and relationships between legal provisions.',
    audience: 'Compliance teams, legal researchers and businesses',
    sampleNote: 'A fictional data-protection act, a payments regulation and an energy policy brief for a fictional jurisdiction.',
  },
  {
    type: 'placement', label: 'Placement Intelligence', short: 'Placement', icon: GraduationCap,
    tagline: 'Understand recruitment trends, internship conversions, PPOs and placement outcomes.',
    audience: 'Placement coordinators, training & placement officers and department heads',
    sampleNote: 'A fictional institute with four academic years of generated roster and application records.',
  },
];

export const TYPE_INFO = Object.fromEntries(WORKSPACE_TYPES.map((t) => [t.type, t])) as Record<WorkspaceType, WorkspaceTypeInfo>;

export const isWorkspaceType = (v: string | undefined): v is WorkspaceType => !!v && v in TYPE_INFO;

export const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', analyst: 'Analyst', viewer: 'Viewer' };
export const ROLE_HELP: Record<Role, string> = {
  owner: 'Everything, including members, settings and deleting documents or records.',
  analyst: 'Upload and import data, run analyses and see student-level placement records.',
  viewer: 'Read documents, graphs, answers and aggregate metrics only.',
};

const RANK: Record<Role, number> = { viewer: 0, analyst: 1, owner: 2 };
export const roleAtLeast = (role: Role | null | undefined, minimum: Role) => !!role && RANK[role] >= RANK[minimum];

/** Where a grounded question about this knowledge base is answered (with the graph highlighted). */
export function qaLink(ws: { id: string; type: WorkspaceType } | null | undefined, question: string): string {
  const q = encodeURIComponent(question);
  if (!ws) return `/app/graph?q=${q}`;
  const tab = { corporate: 'assistant', research: 'graph', legal: 'qa', placement: 'assistant' }[ws.type];
  return `/app/w/${ws.id}?tab=${tab}&q=${q}`;
}
