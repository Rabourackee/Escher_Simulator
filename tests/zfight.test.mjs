// Coplanar stone and trim with the same facing redraw one surface twice.
// Stone and trim hatch differently, so that reads as z-fighting.
// Run: node tests/zfight.test.mjs

import { generateHall } from '../src/world/hall.js';
import { HALL, MESH_SCALE, AIR } from '../src/core/constants.js';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok   ${name}${detail ? ` (${detail})` : ''}`);
  else { failures++; console.log(`  FAIL ${name} ${detail}`); }
}

const CELL = 0.5;
const MAT_STONE = 0;
const MAT_TRIM = 2;

function triangles(h) {
  const { position, normal } = h.mesh;
  const n = position.length / 4;
  const c = [(h.hx + 0.5) * HALL, (h.hy + 0.5) * HALL, (h.hz + 0.5) * HALL];
  const inv = MESH_SCALE / 32767;
  const tris = [];
  for (let i = 0; i < n; i += 3) {
    const p = [];
    let mat = 0;
    const nm = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const o = (i + k) * 4;
      p.push([
        c[0] + position[o] * inv,
        c[1] + position[o + 1] * inv,
        c[2] + position[o + 2] * inv,
      ]);
      mat = position[o + 3];
      nm[0] += normal[o]; nm[1] += normal[o + 1]; nm[2] += normal[o + 2];
    }
    tris.push({ p, mat, n: nm });
  }
  return tris;
}

function inside(px, py, tri) {
  const [a, b, c] = tri;
  const v0x = c[0] - a[0], v0y = c[1] - a[1];
  const v1x = b[0] - a[0], v1y = b[1] - a[1];
  const v2x = px - a[0], v2y = py - a[1];
  const dot00 = v0x * v0x + v0y * v0y;
  const dot01 = v0x * v1x + v0y * v1y;
  const dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y;
  const dot12 = v1x * v2x + v1y * v2y;
  const den = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(den) < 1e-8) return false;
  const u = (dot11 * dot02 - dot01 * dot12) / den;
  const v = (dot00 * dot12 - dot01 * dot02) / den;
  return u > 0.04 && v > 0.04 && u + v < 0.96;
}

// A face pressed into solid on the side it points toward is buried. The flicker
// is the faces you can see: open air in front of them.
function facingAir(grid, hx, hy, hz, point, ax, sg) {
  const q = point.slice();
  q[ax] += sg * 0.25;
  const H = [hx, hy, hz];
  const local = [0, 1, 2].map((a) => q[a] - HALL * H[a]);
  if (local.some((v) => v < 0 || v >= HALL)) return true;
  const i = local[0] | 0, j = local[1] | 0, k = local[2] | 0;
  return grid[i + HALL * (j + HALL * k)] === AIR;
}

function visibleStoneTrimOverlap(h) {
  const grid = new Map();
  let worst = 0;
  let where = '';
  for (const t of triangles(h)) {
    const len = Math.hypot(t.n[0], t.n[1], t.n[2]) || 1;
    let ax = -1;
    let sg = 0;
    for (let a = 0; a < 3; a++) {
      const c = t.n[a] / len;
      if (Math.abs(c) > 0.85) { ax = a; sg = Math.sign(c); }
    }
    if (ax < 0) continue;
    if (t.mat !== MAT_STONE && t.mat !== MAT_TRIM) continue;
    const d = (t.p[0][ax] + t.p[1][ax] + t.p[2][ax]) / 3;
    const dq = Math.round(d * 64);
    const u = (ax + 1) % 3, v = (ax + 2) % 3;
    const uv = t.p.map((p) => [p[u], p[v]]);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const q of uv) {
      u0 = Math.min(u0, q[0]); u1 = Math.max(u1, q[0]);
      v0 = Math.min(v0, q[1]); v1 = Math.max(v1, q[1]);
    }
    for (let iu = Math.floor(u0 / CELL); iu <= Math.floor((u1 - 1e-6) / CELL); iu++) {
      for (let iv = Math.floor(v0 / CELL); iv <= Math.floor((v1 - 1e-6) / CELL); iv++) {
        const cu = (iu + 0.5) * CELL, cv = (iv + 0.5) * CELL;
        if (!inside(cu, cv, uv)) continue;
        const key = `${ax}|${sg}|${dq}|${iu}|${iv}`;
        const prev = grid.get(key);
        if (prev === undefined) { grid.set(key, t.mat); continue; }
        if (prev === t.mat || (prev !== MAT_STONE && prev !== MAT_TRIM)) continue;
        const point = [0, 0, 0];
        point[ax] = dq / 64; point[u] = cu; point[v] = cv;
        if (!facingAir(h.grid, h.hx, h.hy, h.hz, point, ax, sg)) continue;
        grid.set(key, 'hit');
        const plane = `${ax}${sg > 0 ? '+' : '-'}@${(dq / 64).toFixed(2)}`;
        const countKey = `c:${plane}`;
        const n = (grid.get(countKey) || 0) + 1;
        grid.set(countKey, n);
        if (n > worst) { worst = n; where = plane; }
      }
    }
  }
  return { worst, where };
}

console.log('open stone/trim faces do not share a plane');
{
  let worst = 0;
  let where = '';
  for (let hx = -1; hx <= 1; hx++) for (let hz = -1; hz <= 1; hz++) {
    const h = generateHall(hx, 0, hz);
    const hit = visibleStoneTrimOverlap(h);
    if (hit.worst > worst) { worst = hit.worst; where = `${hx},0,${hz} ${hit.where}`; }
  }
  // A few cells can graze at a door moulding. A roof reprint covers tens of cells.
  check('no roof-sized overlap', worst < 12, worst ? `${worst} cells at ${where}` : 'none');
}

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
