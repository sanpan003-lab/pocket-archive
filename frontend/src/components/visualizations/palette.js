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
// color = stroke + glow source; g0/g1 = gradient top/bottom (light tint → mid tint)
export const MMD_PALETTE = {
  rect:    { color: '#3B82F6', g0: '#EFF6FF', g1: '#BFDBFE' }, // blue
  polygon: { color: '#22C55E', g0: '#F0FDF4', g1: '#BBF7D0' }, // green
  circle:  { color: '#F97316', g0: '#FFF7ED', g1: '#FED7AA' }, // orange
  path:    { color: '#06B6D4', g0: '#ECFEFF', g1: '#A5F3FC' }, // cyan
  ellipse: { color: '#8B5CF6', g0: '#F5F3FF', g1: '#DDD6FE' }, // violet
};
