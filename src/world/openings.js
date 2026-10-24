// Openings cut into hall walls: arches (passable doorways), round oculi, barred windows
// and closed doors (decoration only).
//
// A wall is described in its own 2D frame (u, v), both running over [-1, HALL + 1).
// An arch-like opening "stands" on one of the four wall edges (its base). Its straight
// bottom lies on the floor that meets the wall along that edge, one voxel in from the
// edge, so a person whose floor that is can walk straight through it.

import { HALL } from '../core/constants.js';

export const BASES = ['u0', 'u1', 'v0', 'v1'];

// wall (u, v) -> opening frame (along, up)
export function toLocal(base, u, v) {
  switch (base) {
    case 'v0': return [u, v - 1];
    case 'v1': return [u, HALL - 1 - v];
    case 'u0': return [v, u - 1];
    default: return [v, HALL - 1 - u];
  }
}

// opening frame (along, up) -> wall (u, v)
export function fromLocal(base, a, h) {
  switch (base) {
    case 'v0': return [a, h + 1];
    case 'v1': return [a, HALL - 1 - h];
    case 'u0': return [h + 1, a];
    default: return [HALL - 1 - h, a];
  }
}

export function insideArch(a, h, w, hs) {
  const r = w / 2;
  if (h < 0 || Math.abs(a) > r) return false;
  if (h <= hs) return true;
  const dh = h - hs;
  return a * a + dh * dh <= r * r;
}

export function insideOpening(op, u, v) {
  if (op.kind === 'round') {
    const du = u - op.cu, dv = v - op.cv;
    return du * du + dv * dv <= op.r * op.r;
  }
  const [a, h] = toLocal(op.base, u, v);
  return insideArch(a - op.t, h - (op.sill || 0), op.w, op.hs);
}

// Opening-local extents: along [a0, a1], up [h0, h1]
export function localExtent(op) {
  const s = op.sill || 0;
  return [op.t - op.w / 2, s, op.t + op.w / 2, s + op.hs + op.w / 2];
}

// Axis-aligned box in wall coordinates [u0, v0, u1, v1]
export function openingBox(op) {
  if (op.kind === 'round') return [op.cu - op.r, op.cv - op.r, op.cu + op.r, op.cv + op.r];
  const [a0, h0, a1, h1] = localExtent(op);
  const p = fromLocal(op.base, a0, h0);
  const q = fromLocal(op.base, a1, h1);
  return [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[0], q[0]), Math.max(p[1], q[1])];
}

export function boxesOverlap(a, b, margin = 0) {
  return a[0] < b[2] + margin && b[0] < a[2] + margin && a[1] < b[3] + margin && b[1] < a[3] + margin;
}

// Does the opening fit inside a wall, away from the junction zones near its edges?
export function openingFits(op) {
  if (op.kind === 'round') {
    return op.cu - op.r >= 4 && op.cv - op.r >= 4 && op.cu + op.r <= HALL - 4 && op.cv + op.r <= HALL - 4;
  }
  const [a0, , a1, h1] = localExtent(op);
  return a0 >= 3 && a1 <= HALL - 3 && h1 <= HALL - 7;
}

// Outline of an arch-topped opening as a closed polygon in wall (u, v) coordinates.
// `grow` widens the outline (used for mouldings around doorways).
export function archOutline(op, grow = 0, segments = 14) {
  const s = op.sill || 0;
  const r = op.w / 2 + grow;
  const pts = [];
  pts.push([op.t - r, s]);
  pts.push([op.t + r, s]);
  pts.push([op.t + r, s + op.hs]);
  for (let i = 1; i < segments; i++) {
    const ang = (Math.PI * i) / segments;
    pts.push([op.t + Math.cos(ang) * r, s + op.hs + Math.sin(ang) * r]);
  }
  pts.push([op.t - r, s + op.hs]);
  return pts.map(([a, h]) => fromLocal(op.base, a, h));
}

export function circleOutline(op, grow = 0, segments = 28) {
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const ang = (2 * Math.PI * i) / segments;
    pts.push([op.cu + Math.cos(ang) * (op.r + grow), op.cv + Math.sin(ang) * (op.r + grow)]);
  }
  return pts;
}

// An inverted-U band hugging an arch: the moulding drawn around doorways.
export function archBand(op, inner, outer, segments = 14) {
  const s = op.sill || 0;
  const ri = op.w / 2 + inner, ro = op.w / 2 + outer;
  const pts = [];
  pts.push([op.t - ro, s]);
  pts.push([op.t - ri, s]);
  pts.push([op.t - ri, s + op.hs]);
  for (let i = segments - 1; i > 0; i--) {
    const ang = (Math.PI * i) / segments;
    pts.push([op.t + Math.cos(ang) * ri, s + op.hs + Math.sin(ang) * ri]);
  }
  pts.push([op.t + ri, s + op.hs]);
  pts.push([op.t + ri, s]);
  pts.push([op.t + ro, s]);
  pts.push([op.t + ro, s + op.hs]);
  for (let i = 1; i < segments; i++) {
    const ang = (Math.PI * i) / segments;
    pts.push([op.t + Math.cos(ang) * ro, s + op.hs + Math.sin(ang) * ro]);
  }
  pts.push([op.t - ro, s + op.hs]);
  return pts.map(([a, h]) => fromLocal(op.base, a, h));
}
