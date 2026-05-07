// Shared color palette — used by both Mermaid flowchart nodes and pie chart slices.
// Single source of truth: update here and both visuals stay in sync.

// 5 base colors, one per node/slice role
export const VIZ_COLORS = [
  '#3B82F6', // blue   — process steps  / rect
  '#22C55E', // green  — decisions      / polygon
  '#F97316', // orange — terminals      / circle
  '#06B6D4', // cyan   — start/end      / path (pill)
  '#8B5CF6', // violet — subroutines    / ellipse
];

// Per-shape config for Mermaid post-processor
// color = stroke + glow source; g0/g1 = gradient top/bottom (medium → saturated tint)
export const MMD_PALETTE = {
  rect:    { color: '#3B82F6', g0: '#DBEAFE', g1: '#93C5FD' }, // blue
  polygon: { color: '#22C55E', g0: '#DCFCE7', g1: '#86EFAC' }, // green
  circle:  { color: '#F97316', g0: '#FFEDD5', g1: '#FDBA74' }, // orange
  path:    { color: '#06B6D4', g0: '#CFFAFE', g1: '#67E8F9' }, // cyan
  ellipse: { color: '#8B5CF6', g0: '#EDE9FE', g1: '#C4B5FD' }, // violet
};
