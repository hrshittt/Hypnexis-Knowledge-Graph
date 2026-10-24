/**
 * Decorative knowledge-graph illustration (aria-hidden). Purely ornamental: no data, no labels that
 * could be read as claims. The live graph lives in the app and in the landing page preview.
 */
const NODES: [number, number, number, number][] = [
  // x, y, r, tone (0 brand, 1 blue, 2 orange, 3 violet, 4 neutral)
  [210, 150, 15, 0], [120, 90, 9, 1], [300, 85, 10, 0], [345, 190, 9, 2], [250, 255, 11, 3], [130, 225, 10, 0],
  [60, 160, 6, 4], [395, 110, 6, 4], [190, 330, 7, 1], [320, 300, 6, 4], [70, 300, 5, 4], [420, 250, 7, 0],
  [165, 40, 5, 4], [260, 30, 6, 1], [450, 175, 5, 4],
];
const EDGES: [number, number][] = [
  [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [1, 6], [2, 7], [3, 11], [4, 8], [4, 9], [5, 10], [5, 6], [2, 13], [1, 12],
  [3, 14], [7, 14], [4, 5], [2, 3], [8, 5],
];
const TONE = ['#238636', '#2a78d6', '#eb6834', '#6250d6', '#9AA59D'];

export function GraphIllustration({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 480 360" className={className} aria-hidden focusable="false">
      <defs>
        <radialGradient id="hx-glow" cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor="#238636" stopOpacity="0.10" />
          <stop offset="100%" stopColor="#238636" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="240" cy="175" rx="230" ry="170" fill="url(#hx-glow)" />
      {EDGES.map(([a, b], i) => {
        const [x1, y1] = NODES[a];
        const [x2, y2] = NODES[b];
        const hl = i < 3;
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={hl ? '#176B2C' : '#B9C4BB'} strokeWidth={hl ? 2 : 1.2} strokeOpacity={hl ? 0.8 : 1} />;
      })}
      {NODES.map(([x, y, r, t], i) => (
        <g key={i}>
          {i === 0 && <circle cx={x} cy={y} r={r + 8} fill="none" stroke="#238636" strokeOpacity="0.25" strokeWidth="2" />}
          <circle cx={x} cy={y} r={r} fill={TONE[t]} stroke="#fff" strokeWidth="2" />
        </g>
      ))}
    </svg>
  );
}
