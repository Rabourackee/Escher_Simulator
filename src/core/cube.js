// Axis directions, the 24 rotations of the cube, and stair-wedge orientation codes.
//
// A direction index d in 0..5 is +X,-X,+Y,-Y,+Z,-Z.
// A wedge is a voxel cut along a 45 degree diagonal. It is described by the two
// perpendicular "up" directions it can be walked from: a stair whose treads face +Y and
// whose risers face +X is walkable by people whose gravity points -Y *and* by people
// whose gravity points -X, exactly like the staircases in Escher's Relativity.
// Inside the cell, the solid half is where (coord along d1) + (coord along d2) <= 1.

import { WEDGE0 } from './constants.js';

export const PX = 0, NX = 1, PY = 2, NY = 3, PZ = 4, NZ = 5;
export const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export const DIR_NAMES = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];

export const axisOf = (d) => d >> 1;
export const signOf = (d) => ((d & 1) ? -1 : 1);
export const dirFrom = (axis, sign) => axis * 2 + (sign < 0 ? 1 : 0);
export const flip = (d) => d ^ 1;

export function dirFromVec(v) {
  for (let i = 0; i < 3; i++) if (v[i] !== 0) return dirFrom(i, v[i]);
  return -1;
}

function det3(m) {
  return m[0] * (m[4] * m[8] - m[5] * m[7])
       - m[1] * (m[3] * m[8] - m[5] * m[6])
       + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

// Row-major 3x3 signed permutation matrices with determinant +1.
export const ROTS = (() => {
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const out = [];
  for (const p of perms) {
    for (let s = 0; s < 8; s++) {
      const m = new Array(9).fill(0);
      for (let r = 0; r < 3; r++) m[r * 3 + p[r]] = ((s >> r) & 1) ? -1 : 1;
      if (det3(m) === 1) out.push(m);
    }
  }
  return out;
})();

export const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function rotVec(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function rotDir(m, d) { return dirFromVec(rotVec(m, DIRS[d])); }

// Canonical feature frame: the floor faces +Y and the back wall sits at -X.
// Returns the rotation that maps canonical +Y to `up` and canonical -X to `back`.
export function rotationFor(up, back) {
  for (const m of ROTS) if (rotDir(m, PY) === up && rotDir(m, NX) === back) return m;
  throw new Error(`no rotation for up=${up} back=${back}`);
}

// ---- wedges ----
export const WEDGE_DIRS = [];
for (const [a1, a2] of [[0, 1], [0, 2], [1, 2]]) {
  for (let s1 = 0; s1 < 2; s1++) for (let s2 = 0; s2 < 2; s2++) WEDGE_DIRS.push([a1 * 2 + s1, a2 * 2 + s2]);
}

export function wedgeType(d1, d2) {
  let a1 = d1 >> 1, a2 = d2 >> 1;
  if (a1 === a2) throw new Error('wedge directions must be perpendicular');
  if (a1 > a2) { const t = d1; d1 = d2; d2 = t; const ta = a1; a1 = a2; a2 = ta; }
  const p = a1 === 0 ? (a2 === 1 ? 0 : 1) : 2;
  return WEDGE0 + p * 4 + (d1 & 1) * 2 + (d2 & 1);
}

export function wedgeDirs(type) { return WEDGE_DIRS[type - WEDGE0]; }

export function rotWedge(m, type) {
  const [d1, d2] = wedgeDirs(type);
  return wedgeType(rotDir(m, d1), rotDir(m, d2));
}

// Basis for a person standing with the given up direction: a reference forward
// direction perpendicular to up, used as yaw = 0.
export function referenceForward(up) {
  switch (up) {
    case PY: return NZ;
    case NY: return PZ;
    case PX: return NZ;
    case NX: return NZ;
    case PZ: return PY;
    case NZ: return PY;
  }
  return NZ;
}
