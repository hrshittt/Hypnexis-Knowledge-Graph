// Community palette (distinct hues, readable on white). Highlight accents are kept
// outside the palette so evidence paths never blend into a topic colour.
export const COMMUNITY_COLORS = [
  '#2563eb', '#059669', '#d97706', '#7c3aed', '#e11d48',
  '#0891b2', '#65a30d', '#ea580c', '#c026d3', '#0d9488',
];
export const NO_COMMUNITY = '#94a3b8';
export const PATH_COLOR = '#0f172a';
export const PATH_PARTICLE = '#facc15';
export const HL_EDGE = '#334155';

export function colorForIndex(i: number | undefined | null): string {
  if (i === undefined || i === null || i < 0) return NO_COMMUNITY;
  return COMMUNITY_COLORS[i % COMMUNITY_COLORS.length];
}

export function rgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export interface Pt { x: number; y: number }

/** Andrew's monotone chain convex hull. */
export function convexHull(points: Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length <= 2) return pts;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
