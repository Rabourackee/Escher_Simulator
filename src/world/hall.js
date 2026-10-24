// Generation of one hall (= one streamed chunk of 40^3 voxels).
//
//  1. rasterize the shared boundary walls (deterministic per wall, so neighbours agree)
//  2. reserve the space in front of every doorway so nothing can block it
//  3. place features (stairs, balconies, columns, gardens...) in random orientations;
//     each one is validated against everything already placed before it is committed
//  4. place inhabitants on paths that are checked voxel by voxel
//
// Generation only depends on the hall coordinates and the world seed, never on the
// order in which halls are generated.

import { HALL, HALL3, AIR, SOLID, getSeed } from '../core/constants.js';
import { hash, Rng } from '../core/rng.js';
import { ROTS, DIRS, axisOf, signOf } from '../core/cube.js';
import { MeshSink, buildWall } from './geometry.js';
import { rasterizeWalls, reserveOpenings, wallSpec } from './walls.js';
import { tryCommit, idx } from './placement.js';
import * as F from './features.js';
import { isPrefabHall, buildPrefabHall } from './prefab.js';

const MOODS = [['grand', 6], ['garden', 2], ['cloister', 2], ['sparse', 1]];

// [builder, how many to place, attempts per placement]
const PLANS = {
  grand: [
    [F.flyingStair, 3, 10], [F.landingBridge, 2, 10], [F.balconyFlight, 2, 10],
    [F.cornerStair, 2, 8], [F.column, 1, 5], [F.garden, 1, 4],
  ],
  garden: [
    [F.garden, 3, 10], [F.cornerStair, 1, 8], [F.flyingStair, 2, 8], [F.balconyFlight, 1, 8],
  ],
  cloister: [
    [F.arcadeWall, 2, 10], [F.column, 3, 6], [F.cornerStair, 2, 8], [F.flyingStair, 1, 8], [F.landingBridge, 1, 8],
  ],
  sparse: [[F.flyingStair, 2, 10], [F.cornerStair, 1, 6]],
};

export function placeFeature(ctx, rng, builder, opts = {}, rot = null) {
  const P = builder(rot || rng.pick(ROTS), rng, opts);
  return P ? tryCommit(ctx, P) : false;
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
  for (let s = 0; s + 1 < npc.path.length; s++) {
    const A = npc.path[s], B = npc.path[s + 1];
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

function addWanderers(ctx, rng, count) {
  const { grid } = ctx;
  const origin = [HALL * ctx.hx, HALL * ctx.hy, HALL * ctx.hz];
  let placed = 0;
  for (let tries = 0; tries < 50 && placed < count; tries++) {
    const up = rng.int(0, 5);
    const ax = axisOf(up), sg = signOf(up);
    const p = [rng.int(2, HALL - 3), rng.int(2, HALL - 3), rng.int(2, HALL - 3)];
    while (inHall(p) && grid[idx(p[0], p[1], p[2])] === AIR) p[ax] -= sg;
    if (!inHall(p) || grid[idx(p[0], p[1], p[2])] !== SOLID) continue;
    const st = p.slice(); st[ax] += sg;
    const horiz = [0, 1, 2, 3, 4, 5].filter((d) => axisOf(d) !== ax);
    const dir = DIRS[rng.pick(horiz)];
    const ok = (c) => {
      const g = c.slice(); g[ax] -= sg;
      if (!inHall(g) || grid[idx(g[0], g[1], g[2])] !== SOLID) return false;
      for (let k = 0; k < 4; k++) {
        const b = c.slice(); b[ax] += sg * k;
        if (!inHall(b) || grid[idx(b[0], b[1], b[2])] !== AIR) return false;
      }
      return true;
    };
    if (!ok(st)) continue;
    let len = 0;
    while (len < 12) {
      const n = [st[0] + dir[0] * (len + 1), st[1] + dir[1] * (len + 1), st[2] + dir[2] * (len + 1)];
      if (!ok(n)) break;
      len++;
    }
    if (len < 4) continue;
    const feet = (c) => [0, 1, 2].map((k) => origin[k] + c[k] + 0.5 - (k === ax ? sg * 0.5 : 0));
    const end = [st[0] + dir[0] * len, st[1] + dir[1] * len, st[2] + dir[2] * len];
    ctx.npcs.push({ path: [feet(st), feet(end)], up });
    placed++;
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

export function generateHall(hx, hy, hz, { geometry = true } = {}) {
  const grid = new Uint8Array(HALL3);
  const reserve = new Uint8Array(HALL3);
  rasterizeWalls(hx, hy, hz, grid);
  reserveOpenings(hx, hy, hz, reserve);
  const sink = geometry ? new MeshSink() : null;
  if (sink) {
    for (let a = 0; a < 3; a++) {
      const spec = wallSpec(a, hx, hy, hz);
      if (spec) buildWall(spec, sink);
    }
  }
  const ctx = { hx, hy, hz, grid, reserve, sink, npcs: [], figures: [], features: [], mood: 'prefab' };
  const rng = new Rng(hash(hx, hy, hz, 0x4a11, getSeed()));
  const prefab = isPrefabHall(hx, hy, hz);
  if (prefab) buildPrefabHall(ctx, rng);
  else proceduralHall(ctx, rng);
  ctx.npcs = ctx.npcs.filter((n) => npcPathOk(ctx, n));
  if (!prefab) addWanderers(ctx, rng, rng.int(0, 2));
  return {
    hx, hy, hz,
    grid,
    occ: occupancy(grid),
    mesh: sink ? sink.finish() : null,
    npcs: ctx.npcs,
    figures: ctx.figures,
    features: ctx.features,
    mood: ctx.mood,
    failed: ctx.failed || 0,
  };
}
