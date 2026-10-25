// The hall of Relativity, rebuilt from the print.
//
// The print is a true three-point perspective. Fitting its vanishing points gives the
// camera: it looks up about 32 degrees from the floor people's horizon, into the corner
// where the left wall (the B people's floor), the right wall (the C people's floor) and
// the ceiling meet. Every piece below was placed by casting rays from the print through
// that camera onto the plane the piece lies on, and every inhabitant was lifted to 3D
// from the size it is drawn at.
//
//   A  up +Y   the floor people: the climber at the bottom, the leaner, the sitter
//   B  up +X   the left-wall people: the garden party on the right, the walker under the
//              right staircase, one of the two on the top stairway
//   C  up +Z   the right-wall people: the couple at the top left, the sack carrier,
//              the basket carrier, the other one on the top stairway
//
// Halls: (0,0,0) the print; (0,0,-1) the B garden, seen through the arch in the right
// wall; (0,1,0) the C gardens, seen through the openings in the ceiling.

import { SOLID, SOLID_NT, MAT } from '../core/constants.js';
import { PX, NX, PY, NY, PZ, NZ, rotationFor, IDENTITY } from '../core/cube.js';
import { tryCommit } from './placement.js';
import { stair, block, railing, archWall, faceDoor } from './pieces.js';
import * as F from './features.js';

export const PRINT_CAMERA = {
  pos: [33, 11, 27],
  forward: [-0.6132, 0.5257, -0.5896],
  up: [0.3679, 0.8506, 0.3757],
  fov: 52.3,              // vertical, for the drawn image
  aspect: 578 / 552,
};

// ---- the walls of the print's halls (hall boundary walls, with their openings) ----
const arch = (base, t, w, hs, sill = 0) => ({ kind: 'arch', base, t, w, hs, sill });
const door = (base, t, w, hs, sill = 0) => ({ kind: 'door', base, t, w, hs, sill });
const win = (base, t, w, hs, sill) => ({ kind: 'window', base, t, w, hs, sill });
const round = (cu, cv, r) => ({ kind: 'round', cu, cv, r });

export const PRINT_WALLS = {
  // left wall, plane x = 0, (u, v) = (y, z): the barred window and the cellar door
  '0|0|0|0': { openings: [{ ...win('u0', 16.3, 4.4, 6.4, 17), rect: true }, door('u0', 10.3, 7, 0.4, 13), arch('u0', 30, 6, 6)] },
  // right wall, plane z = 0, (u, v) = (x, y): the big arch onto the B garden
  '2|0|0|0': { openings: [arch('v0', 21, 9, 5, 16)] },
  // ceiling, plane y = 40, (u, v) = (z, x): the arches onto the C gardens, the beamed opening
  '1|0|1|0': { openings: [arch('u0', 9.6, 7.4, 2.6, 14.5), arch('u0', 3.2, 5, 1.6, 15), { ...arch('u0', 23, 13, 11, 2), rect: true }] },
  // floor and the walls behind the camera
  '1|0|0|0': { openings: [door('v0', 33, 4, 4)] },
  '0|1|0|0': { openings: [arch('u0', 20, 8, 8), arch('v0', 20, 8, 8)] },
  '2|0|0|1': { openings: [arch('v0', 20, 8, 8), arch('u0', 20, 8, 8)] },
  // the B garden hall beyond the right wall
  '2|0|0|-1': { openings: [arch('v0', 20, 8, 8)] },
  '1|0|0|-1': { openings: [] },
  '1|0|1|-1': null,
  '0|0|0|-1': { openings: [arch('u0', 22, 10, 10)] },
  '0|1|0|-1': { openings: [arch('u0', 20, 8, 8)] },
  // the C garden hall above the ceiling
  '1|0|2|0': null,
  '0|0|1|0': { openings: [arch('v0', 20, 8, 8)] },
  '0|1|1|0': { openings: [arch('v0', 20, 8, 8)] },
  '2|0|1|0': { openings: [arch('v0', 18, 6, 7), arch('v0', 26, 6, 7), arch('v0', 34, 4, 5)] },
  '2|0|1|1': { openings: [arch('u0', 20, 8, 8)] },
};

// ---- the inhabitants of the print (feet, up, facing, pose) ----
// Each was lifted from the print onto the surface it stands on.
const FIG = (label, pos, up, face, pose, extra = {}) => ({ label, pos, up, face, pose, ...extra });
export const PRINT_FIGURES = [
  // A
  FIG('the climber at the foot of the print', [18.6, 13.1, 11.9], PY, NZ, 'climb', { phase: 1.1 }),
  FIG('the leaner on the landing', [24.8, 27, 7.4], PY, PZ, 'lean'),
  FIG('a climber on the right staircase', [18.8, 24.8, 7.2], PY, PX, 'climb', { phase: 0.6 }),
  FIG('the sitter by the box', [16.6, 24.05, 18.3], PY, PZ, 'sit', { stand: [16.6, 25, 17.4] }),
  FIG('a climber at the top of the left staircase', [11.9, 25, 20.4], PY, PZ, 'walk', { phase: 2.0 }),
  FIG('a walker on the left staircase', [11.8, 23.3, 16.3], PY, PZ, 'climb', { phase: 0.2 }),
  // B
  FIG('the walker under the right staircase', [16.5, 20.5, 7.4], PX, NZ, 'walk', { phase: 1.7 }),
  FIG('the descender on the top stairway', [17.2, 32.7, 13.8], PX, PZ, 'walk', { phase: 2.6 }),
  FIG('a guest at the garden table', [13, 29, -17.7], PX, NY, 'sit'),
  FIG('another guest at the garden table', [13, 25.3, -16.2], PX, PY, 'sit'),
  // C
  FIG('the ascender on the top stairway', [16.9, 34.3, 14.1], PZ, NX, 'climb', { phase: 0.7 }),
  FIG('the sack carrier on the tower', [9.4, 30.7, 4], PZ, NY, 'carry', { prop: 'sack', phase: 0.4 }),
  FIG('the basket carrier under the stairs', [9.8, 16.9, 11.9], PZ, PY, 'carry', { prop: 'basket', phase: 1.5 }),
  FIG('one of the couple in the garden', [8.4, 41.5, 18], PZ, PX, 'walk', { phase: 0.3 }),
  FIG('the other of the couple', [10, 41.5, 18], PZ, PX, 'walk', { phase: 2.2 }),
  FIG('the sitter in the upper garden', [3, 41.5, 18], PZ, PX, 'sit'),
];

function must(ctx, P) {
  if (!P || !tryCommit(ctx, P)) {
    const msg = `print hall piece failed: ${P ? P.name : 'null'} in hall ${ctx.hx},${ctx.hy},${ctx.hz}: ${P && P.fail}`;
    if (typeof console !== 'undefined') console.warn(msg);
    ctx.failed = (ctx.failed || 0) + 1;
    return false;
  }
  return true;
}

export function buildPrintHall(ctx, rng) {
  // ---- the two towers standing against the right wall ----
  must(ctx, block([3, 22, 1, 13, 39, 4], { name: 'central tower' }));
  must(ctx, faceDoor([11.2, 33.6, 4], PZ, PY, 1.8, 1.6, { name: 'tower window' }));
  must(ctx, stair({ name: 'sack stair', foot: [10, 29, 4], run: NY, rise: PZ, wide: PX, L: 3, W: 2, solid: true, rails: [] }));
  must(ctx, block([25, 18, 1, 39, 39, 4], { name: 'right tower' }));

  // ---- the right staircase, the leaner's landing, the balcony ----
  must(ctx, block([9, 19, 4, 14, 20, 9], { name: 'stair foot landing' }));
  must(ctx, stair({ name: 'right staircase', foot: [14, 20, 4], run: PX, rise: PY, wide: PZ, L: 7, W: 5, rails: [4] }));
  must(ctx, block([21, 26, 4, 27, 27, 9], { name: 'landing' }));
  must(ctx, railing([21, 27, 8], [26, 27, 8], PY, { name: 'landing rail' }));
  must(ctx, block([27, 30, 4, 34, 31, 7], { name: 'balcony' }));
  must(ctx, railing([27, 31, 6], [33, 31, 6], PY, { name: 'balcony rail' }));
  must(ctx, railing([27, 31, 4], [27, 31, 5], PY, { name: 'balcony end' }));
  must(ctx, faceDoor([30.5, 31, 4], PZ, PY, 2.6, 2.8, { name: 'balcony door' }));

  // ---- the top stairway on its arch: B walk its +X faces, C its +Z faces ----
  must(ctx, stair({ name: 'top stairway', foot: [15, 31, 15], run: NZ, rise: PX, wide: PY, L: 9, W: 5, rails: [0] }));
  must(ctx, archWall([7, 20, 10, 25, 31, 12], 2, [{ base: 'v0', t: 9, w: 14, hs: 3, sill: 0 }], { name: 'great arch' }));

  // ---- the left staircase (A treads, C walk its underside) and its top landing ----
  must(ctx, stair({ name: 'left staircase', foot: [9, 15, 8], run: PZ, rise: PY, wide: PX, L: 10, W: 5, rails: [4] }));
  must(ctx, block([9, 24, 18, 14, 25, 22], { name: 'left landing' }));
  must(ctx, railing([13, 25, 18], [13, 25, 21], PY, { name: 'left landing rail' }));

  // ---- the sitter's ledge with its box ----
  must(ctx, block([15, 24, 15, 19, 25, 18], { name: 'sitter ledge' }));
  must(ctx, block([14, 25, 16, 15, 26, 17], { name: 'the box' }));

  // ---- the steps at the foot of the print, and the cellar door's ground ----
  must(ctx, stair({ name: 'bottom steps', foot: [15, 13, 11], run: NZ, rise: PY, wide: PX, L: 3, W: 5, solid: true, base: 1, rails: [] }));
  must(ctx, block([15, 15, 3, 20, 16, 9], { name: 'bottom landing' }));
  must(ctx, block([1, 13, 5, 6, 14, 17], { name: 'cellar ground' }));

  // ---- beams across the opening in the ceiling ----
  for (const z of [5, 9, 13]) must(ctx, block([15, 38, z, 31, 39, z + 1], { name: 'beam', mat: MAT.TRIM }));
}

// The B garden: a terrace whose +X face is their ground, with trees and a table.
export function buildParkB(ctx, rng) {
  must(ctx, block([1, 16, 8, 12, 39, 34], { name: 'B terrace' }));
  const R = rotationFor(PX, NY);   // canonical floor -> the terrace's +X face
  // canonical (x, y, z) -> world (y, x, 39 - z) in this hall
  must(ctx, F.garden(R, rng, { oy: 11, x: 17, z: 9, sx: 20, sz: 20, trees: 3, treeH: 11, bushes: 5, npc: false }));
}

// The C gardens above the ceiling: a terrace whose +Z face is their ground.
export function buildParkC(ctx, rng) {
  must(ctx, block([1, 1, 1, 16, 30, 18], { name: 'C terrace' }));
  const R = rotationFor(PZ, NY);
  must(ctx, F.garden(R, rng, { oy: 17, x: 2, z: 2, sx: 26, sz: 12, trees: 3, treeH: 10, bushes: 5, npc: false }));
}
