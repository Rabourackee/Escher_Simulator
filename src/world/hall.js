// Generation of one hall (= one streamed chunk of 40^3 voxels).
//
//  1. rasterize the shared boundary walls (deterministic per wall, so neighbours agree)
//  2. reserve the space in front of every doorway so nothing can block it
//  3. place features (towers, stairs, balconies, bridges, gardens...) in random
//     orientations; each one is validated against everything already placed
//  4. hang more stairs and balconies on the towers, put things on their roofs
//  5. ornament: urns, plants, statues, benches, then pilasters, cornices and niches
//  6. inhabitants: walkers on checked paths, and standing, sitting and leaning figures
//     that are baked straight into the hall's mesh
//
// Generation only depends on the hall coordinates and the world seed, never on the
// order in which halls are generated, and never on whether geometry is being built.

import * as THREE from '../../vendor/three/three.module.min.js';
import { HALL, HALL3, AIR, SOLID, BARRIER, MAT, MESH_SCALE, getSeed } from '../core/constants.js';
import { hash, Rng } from '../core/rng.js';
import { ROTS, DIRS, axisOf, signOf, flip, rotationFor } from '../core/cube.js';
import { MeshSink, buildWall } from './geometry.js';
import { rasterizeWalls, reserveOpenings, wallSpec, clearWallCaches } from './walls.js';
import { tryCommit, idx, xfVoxel } from './placement.js';
import * as F from './features.js';
import { decorateWalls } from './decor.js';
import { isPrefabHall, buildPrefabHall } from './prefab.js';
import { posedFigureGeometry, clearPosedCache } from '../render/figures.js';

const MOODS = [['grand', 5], ['towers', 3], ['garden', 2], ['cloister', 2], ['sparse', 1]];

// [builder, how many to place, attempts per placement]
const PLANS = {
  grand: [
    [F.flyingStair, 3, 18], [F.landingBridge, 2, 16], [F.balconyFlight, 2, 14], [F.cornerStair, 2, 14],
    [F.pier, 2, 8], [F.gallery, 1, 8], [F.balcony, 2, 8], [F.column, 1, 5], [F.garden, 1, 4],
  ],
  towers: [
    [F.pier, 3, 12], [F.flyingStair, 2, 16], [F.cornerStair, 1, 12], [F.gallery, 1, 10],
    [F.landingBridge, 1, 12], [F.balcony, 2, 8], [F.garden, 1, 5],
  ],
  garden: [
    [F.garden, 3, 10], [F.flyingStair, 2, 16], [F.cornerStair, 1, 12], [F.pier, 1, 8],
    [F.balconyFlight, 1, 12], [F.balcony, 2, 6],
  ],
  cloister: [
    [F.arcadeWall, 2, 10], [F.cornerStair, 2, 14], [F.flyingStair, 2, 14], [F.column, 4, 6],
    [F.landingBridge, 1, 12], [F.balcony, 2, 6],
  ],
  sparse: [[F.flyingStair, 2, 14], [F.pier, 2, 8], [F.cornerStair, 1, 10], [F.gallery, 1, 8]],
};

export function placeFeature(ctx, rng, builder, opts = {}, rot = null) {
  const P = builder(rot || rng.pick(ROTS), rng, opts);
  return P ? tryCommit(ctx, P) : false;
}

const transpose = (m) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

// A hall-local box seen in the canonical frame of rotation R.
function canonicalBox(R, box) {
  const Rt = transpose(R);
  const a = xfVoxel(Rt, box[0], box[1], box[2]);
  const b = xfVoxel(Rt, box[3] - 1, box[4] - 1, box[5] - 1);
  return [0, 1, 2].map((k) => Math.min(a[k], b[k])).concat([0, 1, 2].map((k) => Math.max(a[k], b[k]) + 1));
}

// Hang stairs and balconies on the faces of the towers, and put something on their roofs.
function furnishTowers(ctx, rng) {
  for (const pier of ctx.placed.filter((p) => p.name === 'pier')) {
    const U = pier.up;
    const sides = rng.shuffle([0, 1, 2, 3, 4, 5].filter((d) => axisOf(d) !== axisOf(U)));
    let added = 0;
    for (const N of sides) {
      if (added >= 3) break;
      const R = rotationFor(U, flip(N));
      const cb = canonicalBox(R, pier.box);
      const ox = cb[3] - 1;
      const H = cb[4] - 1;
      const zA = cb[2], width = cb[5] - cb[2];
      const what = rng.weighted([['toTop', pier.full ? 0 : 4], ['flying', H >= 14 ? 3 : 0], ['balcony', H >= 9 ? 3 : 0], ['landing', H >= 11 ? 2 : 0]]);
      let P = null;
      const W = Math.min(5, width);
      if (what === 'toTop' && H >= 4 && H <= 20 && W >= 4) {
        const build = H <= 9 && rng.chance(0.5) ? F.cornerStair : F.flyingStair;
        P = build(R, rng, { ox, L: H, W, z0: zA + rng.int(0, width - W), toTop: true });
      } else if (what === 'flying' && W >= 4) {
        P = F.flyingStair(R, rng, { ox, L: rng.int(8, Math.min(24, H - 4)), W, z0: zA + rng.int(0, width - W) });
      } else if (what === 'balcony') {
        const w = Math.min(width, rng.int(4, 8));
        P = F.balcony(R, rng, { ox, h: rng.int(5, H - 4), w, z1: zA + rng.int(0, width - w) });
      } else if (what === 'landing' && width >= 5) {
        const w = Math.min(width, rng.int(5, 8));
        const z1 = zA + rng.int(0, width - w);
        P = F.landingBridge(R, rng, { ox, h: rng.int(6, Math.min(H - 3, 16)), w, Ws: 4, z1, zs: z1 + rng.int(0, w - 4) });
      }
      if (P && tryCommit(ctx, P)) added++;
    }
    if (!pier.full && rng.chance(0.65)) {
      const R = rotationFor(U, rng.pick(sides));
      const cb = canonicalBox(R, pier.box);
      const oy = cb[4] - 1;
      const sx = cb[3] - cb[0], sz = cb[5] - cb[2];
      const P = rng.chance(0.45) && sx >= 4 && sz >= 4
        ? F.garden(R, rng, { oy, x: cb[0], z: cb[2], sx, sz, trees: 1, treeH: rng.range(7, 10), bushes: rng.int(1, 3), npc: false })
        : F.ornament(R, rng, { oy, kind: rng.pick(['urn', 'statue', 'plant', 'ball']), x: cb[0] + rng.int(0, Math.max(0, sx - 2)), z: cb[2] + rng.int(0, Math.max(0, sz - 2)) });
      if (P) tryCommit(ctx, P);
    }
  }
}

function proceduralHall(ctx, rng) {
  const mood = rng.weighted(MOODS);
  ctx.mood = mood;
  for (const [builder, count, attempts] of PLANS[mood]) {
    let placed = 0;
    for (let t = 0; t < count * attempts && placed < count; t++) {
      if (placeFeature(ctx, rng, builder)) placed++;
    }
  }
  furnishTowers(ctx, rng);
  const nOrn = rng.int(5, 11);
  for (let t = 0, placed = 0; t < nOrn * 6 && placed < nOrn; t++) {
    if (placeFeature(ctx, rng, F.ornament)) placed++;
  }
}

const inHall = (p) => p[0] >= 0 && p[1] >= 0 && p[2] >= 0 && p[0] < HALL && p[1] < HALL && p[2] < HALL;

function cellAt(ctx, p) {
  const x = Math.floor(p[0] - HALL * ctx.hx), y = Math.floor(p[1] - HALL * ctx.hy), z = Math.floor(p[2] - HALL * ctx.hz);
  if (x < 0 || y < 0 || z < 0 || x >= HALL || y >= HALL || z >= HALL) return -1;
  return ctx.grid[idx(x, y, z)];
}

// Walk the path in half-voxel steps: feet must rest on something, the body must be free.
export function npcPathOk(ctx, npc) {
  const up = DIRS[npc.up];
  const at = (p, h) => cellAt(ctx, [p[0] + up[0] * h, p[1] + up[1] * h, p[2] + up[2] * h]);
  const pts = npc.path;
  for (let s = 0; s < Math.max(1, pts.length - 1); s++) {
    const A = pts[s], B = pts[Math.min(s + 1, pts.length - 1)];
    const len = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
    const n = Math.max(1, Math.ceil(len / 0.5));
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      const p = [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f];
      const g = at(p, -0.25);
      if (g <= 0) return false;
      for (const h of [1.05, 2.0, 3.0, 3.4]) if (at(p, h) !== AIR) return false;
    }
  }
  return true;
}

// Find standing places: [feet cell above ground, up, horizontal run along `dir`].
function findStandable(ctx, rng, wantRun) {
  const { grid } = ctx;
  for (let tries = 0; tries < 30; tries++) {
    const up = rng.int(0, 5);
    const ax = axisOf(up), sg = signOf(up);
    const p = [rng.int(2, HALL - 3), rng.int(2, HALL - 3), rng.int(2, HALL - 3)];
    while (inHall(p) && grid[idx(p[0], p[1], p[2])] === AIR) p[ax] -= sg;
    if (!inHall(p) || grid[idx(p[0], p[1], p[2])] !== SOLID) continue;
    const st = p.slice(); st[ax] += sg;
    const ok = (c) => {
      const g = c.slice(); g[ax] -= sg;
      if (!inHall(g) || grid[idx(g[0], g[1], g[2])] !== SOLID) return false;
      for (let k = 0; k < 4; k++) {
        const q = c.slice(); q[ax] += sg * k;
        if (!inHall(q) || grid[idx(q[0], q[1], q[2])] !== AIR) return false;
      }
      return true;
    };
    if (!ok(st)) continue;
    const dirs = [0, 1, 2, 3, 4, 5].filter((d) => axisOf(d) !== ax);
    const dir = rng.pick(dirs);
    let len = 0;
    const D = DIRS[dir];
    while (len < 12) {
      const n = [st[0] + D[0] * (len + 1), st[1] + D[1] * (len + 1), st[2] + D[2] * (len + 1)];
      if (!ok(n)) break;
      len++;
    }
    if (len < wantRun) continue;
    return { st, up, dir, len, ax, sg };
  }
  return null;
}

function feetOf(ctx, c, ax, sg) {
  return [0, 1, 2].map((k) => HALL * [ctx.hx, ctx.hy, ctx.hz][k] + c[k] + 0.5 - (k === ax ? sg * 0.5 : 0));
}

function addWanderers(ctx, rng, count) {
  for (let i = 0; i < count; i++) {
    const s = findStandable(ctx, rng, 4);
    if (!s) continue;
    const D = DIRS[s.dir];
    const end = [s.st[0] + D[0] * s.len, s.st[1] + D[1] * s.len, s.st[2] + D[2] * s.len];
    ctx.npcs.push({ path: [feetOf(ctx, s.st, s.ax, s.sg), feetOf(ctx, end, s.ax, s.sg)], up: s.up });
  }
}

function addStanders(ctx, rng, count) {
  for (let i = 0; i < count; i++) {
    const s = findStandable(ctx, rng, 0);
    if (!s) continue;
    // lean on a railing if there is one at chest height in front
    const D = DIRS[s.dir], U = DIRS[s.up];
    const front = [0, 1, 2].map((k) => s.st[k] + D[k] + U[k]);
    const lean = inHall(front) && ctx.grid[idx(front[0], front[1], front[2])] === BARRIER;
    const feet = feetOf(ctx, s.st, s.ax, s.sg);
    if (lean) for (let k = 0; k < 3; k++) feet[k] += D[k] * 0.25;
    ctx.figures.push({ pos: feet, up: s.up, face: s.dir, pose: lean ? 'lean' : rng.pick(['stand', 'stand', 'walk']), phase: rng.range(0, 6) });
  }
}

const _fm = new THREE.Matrix4();
function bakeFigures(ctx) {
  for (const f of ctx.figures) {
    const U = new THREE.Vector3(...DIRS[f.up]);
    const Fv = new THREE.Vector3(...DIRS[f.face]);
    const X = new THREE.Vector3().crossVectors(U, Fv);
    _fm.makeBasis(X, U, Fv).setPosition(f.pos[0], f.pos[1], f.pos[2]);
    ctx.sink.add(posedFigureGeometry(f.pose, f.phase || 0), _fm, f.mat ?? MAT.FIGURE);
  }
}

// How much each voxel blocks light, for the renderer's occlusion volume.
const OCC = new Uint8Array(256);
OCC[SOLID] = 255; OCC[2] = 255; OCC[3] = 70;
for (let t = 16; t < 28; t++) OCC[t] = 140;

function occupancy(grid) {
  const out = new Uint8Array(grid.length);
  for (let i = 0; i < grid.length; i++) out[i] = OCC[grid[i]];
  return out;
}

// Pack a hall's mesh compactly: per vertex, four 16-bit numbers (the position around the
// hall's centre, and the material id) and four bytes (the normal). Twelve bytes instead of
// twenty-eight, all in formats graphics cards read natively.
function packMesh(m, hx, hy, hz) {
  const n = m.mat.length;
  const pos = new Int16Array(n * 4), nor = new Int8Array(n * 4);
  const c = [(hx + 0.5) * HALL, (hy + 0.5) * HALL, (hz + 0.5) * HALL];
  const k = 32767 / MESH_SCALE;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 3; j++) {
      const v = Math.round((m.position[i * 3 + j] - c[j]) * k);
      pos[i * 4 + j] = v > 32767 ? 32767 : v < -32767 ? -32767 : v;
      nor[i * 4 + j] = Math.round(Math.max(-1, Math.min(1, m.normal[i * 3 + j])) * 127);
    }
    pos[i * 4 + 3] = m.mat[i];
  }
  return { position: pos, normal: nor };
}

// Forget everything remembered between halls (wall layouts, baked poses).
export function clearCaches() {
  clearWallCaches();
  clearPosedCache();
}

export function generateHall(hx, hy, hz, opts = {}) {
  const geometry = opts.geometry ?? true;
  const grid = new Uint8Array(HALL3);
  const reserve = new Uint8Array(HALL3);
  rasterizeWalls(hx, hy, hz, grid);
  // the hand-built halls keep their own doorways clear
  if (!isPrefabHall(hx, hy, hz)) reserveOpenings(hx, hy, hz, reserve);
  const sink = geometry ? new MeshSink() : null;
  if (sink) {
    for (let a = 0; a < 3; a++) {
      const spec = wallSpec(a, hx, hy, hz);
      if (spec) buildWall(spec, sink);
    }
  }
  const ctx = { hx, hy, hz, grid, reserve, sink, npcs: [], figures: [], features: [], placed: [], mood: 'prefab', debugBoxes: opts.debugBoxes };
  const rng = new Rng(hash(hx, hy, hz, 0x4a11, getSeed()));
  const prefab = isPrefabHall(hx, hy, hz);
  if (prefab) buildPrefabHall(ctx, rng);
  else proceduralHall(ctx, rng);
  decorateWalls(ctx, rng, prefab ? 0.8 : 1, prefab ? { pilasters: false, courses: false } : {});
  ctx.npcs = ctx.npcs.filter((n) => npcPathOk(ctx, n));
  if (!prefab) {
    addWanderers(ctx, rng, rng.int(0, 2));
    addStanders(ctx, rng, rng.int(2, 5));
  }
  ctx.figures = ctx.figures.filter((f) => npcPathOk(ctx, { path: [f.pos], up: f.up }));
  if (sink) bakeFigures(ctx);
  return {
    hx, hy, hz,
    grid,
    occ: occupancy(grid),
    mesh: sink ? packMesh(sink.finish(), hx, hy, hz) : null,
    npcs: ctx.npcs,
    figures: ctx.figures.length,
    features: ctx.features,
    mood: ctx.mood,
    failed: ctx.failed || 0,
  };
}
