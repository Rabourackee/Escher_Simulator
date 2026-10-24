// The hand-built hall of Relativity, at the origin of the endless world.
//
// Three gravities, as in the print:
//   A  floor        (y = 1, up +Y)  people stand upright
//   B  left wall    (x = 1, up +X)  seen from the title camera their heads point right
//   C  right wall   (z = 1, up +Z)  their heads point left
// The camera looks into the corner where the three grounds meet. Every staircase is
// shared by two of the three peoples; the high "top stairway" is used side by side by a
// B and a C inhabitant, one ascending while the other descends. Each people has a park,
// seen through the arches in the neighbouring halls (-1,0,0) and (0,0,-1).
// Everything outside these three halls is generated as you approach it.

import { HALL, SOLID, BARRIER, MAT } from '../core/constants.js';
import { PX, NX, PY, NY, PZ, NZ, rotationFor, IDENTITY } from '../core/cube.js';
import { Placement, tryCommit } from './placement.js';
import { IDM, boxGeom, prismGeom, frameMatrix, balustrade, cylinderGeom, bandStairProfile } from './geometry.js';
import * as F from './features.js';

const LAST = HALL - 1;

export const START = {
  camera: { pos: [37.4, 21.5, 37.4], target: [6, 13, 6], fov: 68 },
  focus: [8, 20, 8],
  fog: [95, 175],
  radius: 90,
  readyRadius: 50,
  figures: [],
};

const PREFAB = new Set(['0,0,0', '-1,0,0', '0,0,-1']);
export function isPrefabHall(hx, hy, hz) { return PREFAB.has(`${hx},${hy},${hz}`); }

// ---- walls of the three prefab halls ----
const arch = (base, t, w, hs, sill = 0) => ({ kind: 'arch', base, t, w, hs, sill });
const door = (base, t, w, hs, sill = 0) => ({ kind: 'door', base, t, w, hs, sill });
const win = (base, t, w, hs, sill) => ({ kind: 'window', base, t, w, hs, sill });
const round = (cu, cv, r) => ({ kind: 'round', cu, cv, r });

const WALLS = {
  // main hall -----------------------------------------------------------
  // left wall, x = 0: (u, v) = (y, z). B's ground.
  '0|0|0|0': { openings: [round(31, 25, 5.2), arch('u0', 31, 10, 9), door('v0', 9, 4, 4)] },
  // floor, y = 0: (u, v) = (z, x). A's ground.
  '1|0|0|0': { openings: [door('v0', 33, 4, 4), door('u0', 33, 4, 4)] },
  // right wall, z = 0: (u, v) = (x, y). C's ground.
  '2|0|0|0': { openings: [arch('v0', 32, 10, 9), door('v0', 23.5, 3, 3), door('v0', 31, 4, 4, 24), win('u0', 9, 2, 3, 24), win('u0', 13, 2, 3, 24)] },
  // ceiling, y = 40: (u, v) = (z, x)
  '1|0|1|0': { openings: [round(20, 20, 7), arch('v0', 32, 6, 7), arch('u0', 32, 6, 7)] },
  // behind the title camera
  '0|1|0|0': { openings: [arch('u0', 20, 6, 8), arch('v0', 20, 6, 8)] },
  '2|0|0|1': { openings: [arch('v0', 20, 6, 8), arch('u0', 20, 6, 8)] },
  // the park hall beyond the left wall ------------------------------------
  '0|-1|0|0': { openings: [arch('u0', 30, 6, 8)] },
  '1|-1|0|0': { openings: [] },
  '1|-1|1|0': null,
  '2|-1|0|0': { openings: [arch('v0', 22, 14, 13)] },
  '2|-1|0|1': { openings: [arch('v0', 20, 6, 8), round(20, 26, 5)] },
  // the park hall beyond the right wall -----------------------------------
  '2|0|0|-1': { openings: [arch('v0', 8, 6, 8)] },
  '1|0|0|-1': { openings: [] },
  '1|0|1|-1': null,
  '0|0|0|-1': { openings: [arch('u0', 20, 14, 13)] },
  '0|1|0|-1': { openings: [arch('u0', 20, 6, 8), round(26, 20, 5)] },
};

export function prefabWall(a, i, j, k) {
  const key = `${a}|${i}|${j}|${k}`;
  if (!(key in WALLS)) return undefined;
  const w = WALLS[key];
  return w ? { axis: a, h: [i, j, k], openings: w.openings } : null;
}

// ---- prefab-only pieces ----
// A balcony on the back wall: a slab with railings on its three free sides.
function balcony(rot, { h, d, w, z1, gapX = null }) {
  const P = new Placement(rot, 'balcony');
  P.fill(1, h, z1, 1 + d, h + 1, z1 + w, SOLID);
  for (let z = z1; z < z1 + w; z++) { P.put(d, h + 1, z, BARRIER); P.put(d, h + 2, z, BARRIER); }
  for (let x = 1; x < d; x++) {
    for (const z of [z1, z1 + w - 1]) {
      if (gapX !== null && z === z1 && x >= gapX[0] && x < gapX[1]) continue;
      P.put(x, h + 1, z, BARRIER); P.put(x, h + 2, z, BARRIER);
    }
  }
  P.clearBox(1, h + 1, z1 + 1, d, h + 5, z1 + w - 1);
  P.needBox(0, h - 2, z1, 1, h + 4, z1 + w);
  P.geom = (s) => {
    s.add(boxGeom(1, h, z1, 1 + d, h + 1, z1 + w), IDM, MAT.STONE);
    for (const zc of [z1 + 1, z1 + w - 1]) {
      const g = prismGeom([[0, 0], [0, 2.4], [d - 0.6, 2.4]], 0.6);
      s.add(g, frameMatrix([1, 0, 0], [0, 1, 0], [0, 0, 1], [1, h - 2.4, zc - 0.3]), MAT.TRIM);
    }
    const front = [];
    for (let z = z1; z < z1 + w; z++) front.push([d + 0.5, h + 1, z + 0.5]);
    balustrade(s, IDM, front, [0, 1, 0]);
    for (const zc of [z1 + 0.5, z1 + w - 0.5]) {
      const pts = [];
      for (let x = d; x >= 1; x--) pts.push([x + 0.5, h + 1, zc]);
      balustrade(s, IDM, pts, [0, 1, 0]);
    }
  };
  return P;
}

// The print's top stairway: a ledge on the side wall (canonical z = 39) with a free stair
// climbing from it to the back wall. Floor people climb its treads while back-wall
// people walk its risers in the same direction, going down.
function ledgeStair(rot, { h = 23, x0 = 8, x1 = 18, zEdge = 32, L = 10, z0 = 33, W = 5 }) {
  const P = new Placement(rot, 'ledgeStair');
  const yb = h + 1;
  P.fill(x0, h, zEdge, x1, h + 1, LAST, SOLID);
  for (let x = x0; x < x1; x++) { P.put(x, h + 1, zEdge, BARRIER); P.put(x, h + 2, zEdge, BARRIER); }
  for (let z = zEdge + 1; z < LAST; z++) { P.put(x1 - 1, h + 1, z, BARRIER); P.put(x1 - 1, h + 2, z, BARRIER); }
  for (let z = z0; z < z0 + W; z++) F.bandCells(P, 1, L, z, yb);
  F.stairRailCells(P, 1, L, z0, yb);
  F.stairRailCells(P, 1, L, z0 + W - 1, yb);
  P.clearBox(x0, yb, zEdge + 1, x1 - 1, yb + 4, LAST);
  F.stairHeadroom(P, 1, L, z0 + 1, z0 + W - 1, yb);
  P.clearBox(1, yb + L, z0 + 1, 5, yb + L + 4, z0 + W - 1);
  P.needBox(x0, h - 2, LAST, x1, h + 4, HALL);
  P.needBox(0, yb + L - 3, z0, 1, yb + L + 4, z0 + W);
  P.geom = (s) => {
    s.add(boxGeom(x0, h, zEdge, x1, h + 1, LAST), IDM, MAT.STONE);
    for (const xc of [x0 + 1.5, x1 - 1.5]) {
      const g = prismGeom([[0, 0], [0, 2.4], [LAST - zEdge - 0.6, 2.4]], 0.6);
      s.add(g, frameMatrix([0, 0, -1], [0, 1, 0], [1, 0, 0], [xc - 0.3, h - 2.4, LAST]), MAT.TRIM);
    }
    const front = [];
    for (let x = x0; x < x1; x++) front.push([x + 0.5, h + 1, zEdge + 0.5]);
    balustrade(s, IDM, front, [0, 1, 0]);
    const far = [];
    for (let z = zEdge; z < LAST; z++) far.push([x1 - 0.5, h + 1, z + 0.5]);
    balustrade(s, IDM, far, [0, 1, 0]);
    s.add(prismGeom(bandStairProfile(L), W), frameMatrix([1, 0, 0], [0, 1, 0], [0, 0, 1], [1, yb, z0]), MAT.STAIR);
    F.stairRailGeom(s, 1, L, z0 + 0.5, yb);
    F.stairRailGeom(s, 1, L, z0 + W - 0.5, yb);
  };
  return P;
}

// A small table with two stools (decoration standing on a canonical floor).
function tableSet(rot, x, z, y = 2) {
  const P = new Placement(rot, 'table');
  P.put(x, y, z, BARRIER);
  P.geom = (s) => {
    s.add(cylinderGeom([x + 0.5, y, z + 0.5], [x + 0.5, y + 1.3, z + 0.5], 0.09, 0.09, 6), IDM, MAT.WOOD);
    s.add(cylinderGeom([x + 0.5, y + 1.3, z + 0.5], [x + 0.5, y + 1.42, z + 0.5], 0.75, 0.75, 14), IDM, MAT.WOOD);
    s.add(boxGeom(x + 1.4, y, z + 0.1, x + 2.1, y + 0.95, z + 0.9), IDM, MAT.WOOD);
  };
  return P;
}

// ---- the inhabitants of the print (feet position, up, facing, pose) ----
// Feet positions are in world voxel units; every one of them is a valid place to stand.
const FIG = (label, pos, up, face, pose, extra = {}) => ({ label, pos, up, face, pose, ...extra });
START.figures.push(
  // A — the floor people (6)
  FIG('a climber on the shared stair', [23.5, 4.2, 13.8], PY, NZ, 'climb', { phase: 1.1 }),
  FIG('a reader on the low steps', [4.6, 1.4, 11.2], PY, PX, 'read', { prop: 'book' }),
  FIG('a porter with a sack', [30.5, 1, 27.5], PY, NX, 'carry', { prop: 'sack', phase: 0.4 }),
  FIG('a watcher on the balcony', [31.5, 25, 3.9], PY, PZ, 'lean'),
  FIG('an ascender on the top stairway', [3.7, 29, 6], PY, NZ, 'climb', { phase: 0.7 }),
  FIG('a stroller in the floor-people’s park', [-14.5, 1, 17.5], PY, PX, 'walk', { phase: 0.9 }),
  // B — the left-wall people (5)
  FIG('one of a couple in the wall-people’s park', [-38, 29.5, 14.5], PX, PZ, 'walk', { phase: 0.3 }),
  FIG('the other of the couple', [-38, 31.2, 14.7], PX, PZ, 'walk', { phase: 2.2 }),
  FIG('a climber on the low stairway', [7, 14.5, 5], PX, NZ, 'climb', { phase: 1.4 }),
  FIG('a walker on the left wall', [1, 8.5, 25.5], PX, PY, 'walk', { phase: 1.9 }),
  FIG('a climber on the long stair’s risers', [5.5, 16.5, 31.5], PX, NY, 'climb', { phase: 2.9 }),
  // C — the right-wall people (5)
  FIG('a sitter at a table in the far park', [24.5, 8.95, -38], PZ, NY, 'sit'),
  FIG('a basket carrier on the right wall', [12.5, 7.5, 1], PZ, PX, 'carry', { prop: 'basket', phase: 1.5 }),
  FIG('a descender on the top stairway', [5.3, 30.5, 4.5], PZ, PY, 'walk', { phase: 2.6 }),
  FIG('a walker on the climber’s stair', [22.5, 11.5, 6.5], PZ, NY, 'walk', { phase: 0.2 }),
  FIG('a passer-by at the basement door', [27.5, 18.5, 1], PZ, NY, 'walk', { phase: 3.3 }),
);

// ---- features of each prefab hall ----
function must(ctx, P) {
  if (!P || !tryCommit(ctx, P)) {
    const msg = `prefab piece failed: ${P ? P.name : 'null'} in hall ${ctx.hx},${ctx.hy},${ctx.hz}: ${P && P.fail}`;
    if (typeof console !== 'undefined') console.warn(msg);
    ctx.failed = (ctx.failed || 0) + 1;
    return false;
  }
  return true;
}

const ROT_AC = rotationFor(PY, NZ);   // floor people, right wall as back wall
const ROT_BC = rotationFor(PX, NZ);   // left-wall people, right wall as back wall
const ROT_CA = rotationFor(PZ, NY);   // right-wall people, floor as back wall
const ROT_BA = rotationFor(PX, NY);   // left-wall people, floor as back wall (their park)

export function buildPrefabHall(ctx, rng) {
  const key = `${ctx.hx},${ctx.hy},${ctx.hz}`;
  const off = { npc: false };
  if (key === '0,0,0') {
    // The climber's stair: from the floor up to the right wall (shared by A and C).
    must(ctx, F.flyingStair(ROT_AC, rng, { L: 16, W: 5, z0: 14, ...off }));
    // The long stair: from the floor up to the left wall (shared by A and B).
    must(ctx, F.flyingStair(IDENTITY, rng, { L: 20, W: 5, z0: 28, ...off }));
    // The top stairway: from a ledge on the left wall up to the right wall (A and C).
    must(ctx, ledgeStair(ROT_AC, {}));
    // A stairway across the far corner for the two wall peoples (B and C).
    must(ctx, F.flyingStair(ROT_BC, rng, { L: 10, W: 5, z0: 12, ...off }));
    // Low steps in the A/B corner where the reader sits.
    must(ctx, F.cornerStair(IDENTITY, rng, { L: 4, W: 6, z0: 8, ...off }));
    // A balcony for the watcher, high on the right wall, before a closed door.
    must(ctx, balcony(ROT_AC, { h: 24, d: 5, w: 9, z1: 4 }));
  } else if (key === '-1,0,0') {
    // The floor people's park, seen through the low arch in the left wall.
    must(ctx, F.garden(IDENTITY, rng, { x: 19, z: 20, sx: 13, sz: 12, trees: 3, treeH: 13, bushes: 4, ...off }));
    // The left-wall people's park high on the far wall, seen through the round window.
    must(ctx, F.garden(ROT_BA, rng, { x: 24, z: 15, sx: 13, sz: 15, trees: 2, treeH: 11, bushes: 4, ...off }));
  } else if (key === '0,0,-1') {
    // The right-wall people's park on the far wall, through the big arch.
    must(ctx, F.garden(ROT_CA, rng, { x: 2, z: 18, sx: 12, sz: 17, trees: 3, treeH: 13, bushes: 4, ...off }));
    must(ctx, tableSet(ROT_CA, 8, 24));
  }
}
