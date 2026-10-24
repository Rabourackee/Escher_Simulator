// A Placement collects everything one feature wants to add to a hall, expressed in the
// canonical frame (floor at y = 0 facing +Y, back wall at x = 0 facing +X):
//   cells    voxels it fills (solid, wedge, barrier)
//   clear    voxels that must stay empty (walkway headroom, stair landings)
//   need     voxels that must already be solid stone (what it is attached to)
//   geom     a callback that emits render geometry, only run once the feature is accepted
// tryCommit rotates it into the hall and accepts it only if nothing overlaps.

import * as THREE from '../../vendor/three/three.module.min.js';
import { HALL, AIR, SOLID, isWedge } from '../core/constants.js';
import { rotWedge, rotDir } from '../core/cube.js';

const C = HALL / 2 - 0.5;

export function xfVoxel(m, x, y, z) {
  const a = x - C, b = y - C, c = z - C;
  return [
    m[0] * a + m[1] * b + m[2] * c + C,
    m[3] * a + m[4] * b + m[5] * c + C,
    m[6] * a + m[7] * b + m[8] * c + C,
  ];
}

export function xfPoint(m, p) {
  const h = HALL / 2;
  const a = p[0] - h, b = p[1] - h, c = p[2] - h;
  return [
    m[0] * a + m[1] * b + m[2] * c + h,
    m[3] * a + m[4] * b + m[5] * c + h,
    m[6] * a + m[7] * b + m[8] * c + h,
  ];
}

export function hallMatrix(hx, hy, hz, m) {
  const h = HALL / 2;
  const R = new THREE.Matrix4().set(
    m[0], m[1], m[2], 0,
    m[3], m[4], m[5], 0,
    m[6], m[7], m[8], 0,
    0, 0, 0, 1,
  );
  return new THREE.Matrix4()
    .makeTranslation(h + HALL * hx, h + HALL * hy, h + HALL * hz)
    .multiply(R)
    .multiply(new THREE.Matrix4().makeTranslation(-h, -h, -h));
}

export const idx = (x, y, z) => x + HALL * (y + HALL * z);

const clampLo = (v) => Math.max(1, v);
const clampHi = (v) => Math.min(HALL - 1, v);
const IDM = new THREE.Matrix4();

export class Placement {
  constructor(rot, name = 'feature') {
    this.rot = rot;
    this.name = name;
    this.cells = [];
    this.clear = [];
    this.need = [];
    this.geom = null;
    this.npcs = [];
    this.figures = [];
  }

  put(x, y, z, t) { this.cells.push(x, y, z, t); }

  fill(x0, y0, z0, x1, y1, z1, t) {
    for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) this.put(x, y, z, t);
  }

  clearBox(x0, y0, z0, x1, y1, z1) {
    x0 = clampLo(x0); y0 = clampLo(y0); z0 = clampLo(z0);
    x1 = clampHi(x1); y1 = clampHi(y1); z1 = clampHi(z1);
    for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) this.clear.push(x, y, z);
  }

  needBox(x0, y0, z0, x1, y1, z1) {
    for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) this.need.push(x, y, z);
  }

  // A walking inhabitant: a polyline of feet positions (canonical, continuous) that it
  // paces back and forth along, and its up direction.
  npc(path, up, opts = {}) { this.npcs.push({ path, up, ...opts }); }
}

// Validate a placement against the hall (ctx.grid / ctx.reserve) and commit it.
// Returns false, leaving the hall untouched, if anything collides.
export function tryCommit(ctx, P) {
  const { grid, reserve } = ctx;
  const m = P.rot;
  const n = P.cells.length;
  const tcells = new Int32Array(n / 2);
  const fail = (why, x, y, z) => { P.fail = `${why} at ${x},${y},${z}`; return false; };
  for (let i = 0, j = 0; i < n; i += 4, j += 2) {
    const [x, y, z] = xfVoxel(m, P.cells[i], P.cells[i + 1], P.cells[i + 2]);
    if (x < 1 || y < 1 || z < 1 || x >= HALL - 1 || y >= HALL - 1 || z >= HALL - 1) return fail('outside interior', x, y, z);
    const k = idx(x, y, z);
    if (grid[k] !== AIR) return fail(`cell occupied (${grid[k]})`, x, y, z);
    if (reserve[k]) return fail('cell reserved', x, y, z);
    tcells[j] = k;
    const t = P.cells[i + 3];
    tcells[j + 1] = isWedge(t) ? rotWedge(m, t) : t;
  }
  const own = new Set();
  for (let j = 0; j < tcells.length; j += 2) own.add(tcells[j]);
  const tclear = [];
  for (let i = 0; i < P.clear.length; i += 3) {
    const [x, y, z] = xfVoxel(m, P.clear[i], P.clear[i + 1], P.clear[i + 2]);
    const k = idx(x, y, z);
    if (own.has(k)) continue;
    if (grid[k] !== AIR) return fail(`clearance blocked (${grid[k]})`, x, y, z);
    tclear.push(k);
  }
  for (let i = 0; i < P.need.length; i += 3) {
    const [x, y, z] = xfVoxel(m, P.need[i], P.need[i + 1], P.need[i + 2]);
    if (x < 0 || y < 0 || z < 0 || x >= HALL || y >= HALL || z >= HALL) return fail('support outside hall', x, y, z);
    if (grid[idx(x, y, z)] !== SOLID) return fail(`no support (${grid[idx(x, y, z)]})`, x, y, z);
  }

  for (let j = 0; j < tcells.length; j += 2) grid[tcells[j]] = tcells[j + 1];
  for (const k of tclear) reserve[k] = 1;

  if (P.geom && ctx.sink) {
    const H = hallMatrix(ctx.hx, ctx.hy, ctx.hz, m);
    const tmp = new THREE.Matrix4();
    P.geom({
      add(g, mm, mat) {
        tmp.multiplyMatrices(H, mm || IDM);
        ctx.sink.add(g, tmp, mat);
        g.dispose();
      },
    });
  }
  const origin = [HALL * ctx.hx, HALL * ctx.hy, HALL * ctx.hz];
  const toWorld = (p) => {
    const q = xfPoint(m, p);
    return [q[0] + origin[0], q[1] + origin[1], q[2] + origin[2]];
  };
  for (const npc of P.npcs) {
    ctx.npcs.push({ ...npc, path: npc.path.map(toWorld), up: rotDir(m, npc.up) });
  }
  for (const f of P.figures) {
    ctx.figures.push({ ...f, pos: toWorld(f.pos), up: rotDir(m, f.up), face: rotDir(m, f.face) });
  }
  ctx.features.push(P.name);
  return true;
}
