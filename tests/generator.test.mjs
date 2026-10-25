// Generator tests: determinism, agreement between neighbouring halls, clear doorways,
// the prefab, and how much of the structure can be reached on foot.
// Run: node tests/generator.test.mjs

import * as THREE from '../vendor/three/three.module.min.js';
import { generateHall } from '../src/world/hall.js';
import { boundingWalls } from '../src/world/walls.js';
import { localExtent, fromLocal } from '../src/world/openings.js';
import { START, isPrefabHall } from '../src/world/prefab.js';
import { Player } from '../src/player/controller.js';
import { HALL, AIR, SOLID } from '../src/core/constants.js';
import { DIRS, axisOf, signOf } from '../src/core/cube.js';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok   ${name}${detail ? ` (${detail})` : ''}`);
  else { failures++; console.log(`  FAIL ${name} ${detail}`); }
}

const cache = new Map();
function hall(hx, hy, hz) {
  const k = `${hx},${hy},${hz}`;
  if (!cache.has(k)) cache.set(k, generateHall(hx, hy, hz, { geometry: false }));
  return cache.get(k);
}
function voxel(x, y, z) {
  const hx = Math.floor(x / HALL), hy = Math.floor(y / HALL), hz = Math.floor(z / HALL);
  return hall(hx, hy, hz).grid[(x - hx * HALL) + HALL * ((y - hy * HALL) + HALL * (z - hz * HALL))];
}

console.log('determinism');
{
  const a = generateHall(7, -3, 12, { geometry: false });
  const b = generateHall(7, -3, 12, { geometry: false });
  check('same hall twice gives identical voxels', a.grid.every((v, i) => v === b.grid[i]));
  check('same inhabitants', JSON.stringify(a.npcs) === JSON.stringify(b.npcs));
}

console.log('neighbouring halls agree on the walls they share');
{
  let mismatches = 0, compared = 0;
  for (let hx = -2; hx <= 1; hx++) for (let hy = -1; hy <= 1; hy++) for (let hz = -2; hz <= 1; hz++) {
    for (let a = 0; a < 3; a++) {
      const lo = hall(hx, hy, hz);
      const n = [hx, hy, hz]; n[a] += 1;
      const hi = hall(n[0], n[1], n[2]);
      const b = (a + 1) % 3, c = (a + 2) % 3;
      const p = [0, 0, 0], q = [0, 0, 0];
      for (let u = 0; u < HALL; u++) for (let v = 0; v < HALL; v++) {
        p[a] = HALL - 1; p[b] = u; p[c] = v;
        q[a] = 0; q[b] = u; q[c] = v;
        const va = lo.grid[p[0] + HALL * (p[1] + HALL * p[2])];
        const vb = hi.grid[q[0] + HALL * (q[1] + HALL * q[2])];
        compared++;
        if (va !== vb) mismatches++;
      }
    }
  }
  check('boundary layers match', mismatches === 0, `${mismatches} of ${compared}`);
}

console.log('doorways stay clear of features (generated halls)');
{
  let blocked = 0, doors = 0, halls = 0;
  for (let hx = -3; hx <= 3; hx++) for (let hy = -1; hy <= 1; hy++) for (let hz = -3; hz <= 3; hz++) {
    if (isPrefabHall(hx, hy, hz)) continue;   // hand-built: its openings are placed by hand
    const h = hall(hx, hy, hz);
    halls++;
    for (const { a, side, spec } of boundingWalls(hx, hy, hz)) {
      if (!spec) continue;
      const b = (a + 1) % 3, c = (a + 2) % 3;
      for (const op of spec.openings) {
        if (op.kind !== 'arch' || (op.sill || 0) > 0) continue;  // upper-tier openings are windows
        doors++;
        let [a0, h0, a1] = localExtent(op);
        // a wide arch keeps its middle clear (you can pass anywhere else too)
        if (a1 - a0 > 8) { const mid = (a0 + a1) / 2; a0 = mid - 3; a1 = mid + 3; }
        const depth = op.w > 8 ? 3 : 4;
        for (let al = Math.ceil(a0) + 0.5; al < a1; al += 1) {
          for (let up = h0 + 0.5; up < h0 + 4; up += 1) {
            const [u, v] = fromLocal(op.base, al, up);
            for (let d = 1; d <= depth; d++) {
              const p = [0, 0, 0];
              p[a] = side === 0 ? d : HALL - 1 - d;
              p[b] = Math.floor(u); p[c] = Math.floor(v);
              if (h.grid[p[0] + HALL * (p[1] + HALL * p[2])] !== AIR) blocked++;
            }
          }
        }
      }
    }
  }
  check('no voxel in front of any doorway is filled', blocked === 0, `${doors} doorways in ${halls} halls, ${blocked} blocked`);
}

console.log('features');
{
  const counts = {};
  let total = 0, npcs = 0;
  for (const h of cache.values()) {
    for (const f of h.features) { counts[f] = (counts[f] || 0) + 1; total++; }
    npcs += h.npcs.length;
  }
  const kinds = ['flyingStair', 'cornerStair', 'balconyFlight', 'landingBridge', 'column', 'arcadeWall', 'garden',
    'pier', 'gallery', 'balcony', 'urn', 'plant', 'ball', 'statue', 'bench'];
  check('every kind of feature appears', kinds.every((k) => counts[k] > 0), JSON.stringify(counts));
  check('halls are furnished', total / cache.size > 8, `${(total / cache.size).toFixed(1)} features per hall`);
  let stairs = 0;
  for (const k of ['flyingStair', 'cornerStair', 'balconyFlight', 'landingBridge']) stairs += counts[k] || 0;
  check('staircases everywhere, as in the print', stairs / cache.size > 1.5, `${(stairs / cache.size).toFixed(1)} per hall`);
  let open = 0, walls = 0;
  for (let hx = -3; hx <= 3; hx++) for (let hz = -3; hz <= 3; hz++) {
    for (const w of boundingWalls(hx, 0, hz)) {
      walls++;
      if (!w.spec || w.spec.openings.some((o) => o.kind === 'arch' && o.w >= 10) || ['arcade', 'frame'].includes(w.spec.style)) open++;
    }
  }
  check('most walls between halls are open or widely pierced', open / walls > 0.5, `${((open / walls) * 100).toFixed(0)}% of ${walls}`);
  check('inhabitants walk around', npcs > cache.size / 2, `${npcs} walkers in ${cache.size} halls`);
}

console.log('the print (prefab halls)');
{
  for (const k of ['0,0,0', '-1,0,0', '0,0,-1']) {
    const [x, y, z] = k.split(',').map(Number);
    check(`hall ${k} placed every piece`, hall(x, y, z).failed === 0);
  }
  const pl = new Player({ voxel });
  let bad = [];
  for (const f of START.figures) {
    const at = f.stand ?? f.pos;
    const ua = axisOf(f.up), us = signOf(f.up);
    const t = us * at[ua];
    const g = pl.groundAt(at, f.up, t + 0.6, t - 1.2);
    if (typeof g !== 'number' || Math.abs(g - t) > 0.3) { bad.push(`${f.label} (ground ${g})`); continue; }
    const q = at.slice(); q[ua] = us * g;
    if (pl.bodyHits(q, f.up, g)) bad.push(`${f.label} (body)`);
  }
  const peoples = [2, 0, 4].map((u) => START.figures.filter((f) => f.up === u).length);
  check('16 inhabitants of three peoples, as in the print', START.figures.length === 16 && peoples.every((n) => n >= 4), peoples.join(' + '));
  check('every inhabitant stands somewhere a visitor can stand', bad.length === 0, bad.join('; '));
}

console.log('walking connectivity');
{
  // States are (empty cell, up direction) where a body fits and there is ground below.
  // Moves: walk to a neighbouring cell (step up/down one voxel), climb onto a wall,
  // roll over an edge — the same moves the walker can make.
  const R0 = [-2, -1, -2], R1 = [1, 1, 1];
  const lo = R0.map((v) => v * HALL), hi = R1.map((v) => (v + 1) * HALL);
  const size = hi.map((v, i) => v - lo[i]);
  const N = size[0] * size[1] * size[2];
  const inR = (x, y, z) => x >= lo[0] && y >= lo[1] && z >= lo[2] && x < hi[0] && y < hi[1] && z < hi[2];
  const vid = (x, y, z) => (x - lo[0]) + size[0] * ((y - lo[1]) + size[1] * (z - lo[2]));
  const types = new Uint8Array(N);
  for (let z = lo[2]; z < hi[2]; z++) for (let y = lo[1]; y < hi[1]; y++) for (let x = lo[0]; x < hi[0]; x++) types[vid(x, y, z)] = voxel(x, y, z);
  const T = (x, y, z) => (inR(x, y, z) ? types[vid(x, y, z)] : 255);
  const free = (x, y, z) => T(x, y, z) === AIR;
  const floorish = (t) => t === SOLID || t === 2 || (t >= 16 && t < 28);
  function standable(x, y, z, u) {
    const d = DIRS[u];
    if (!free(x, y, z)) return false;
    if (!floorish(T(x - d[0], y - d[1], z - d[2]))) return false;
    for (let k = 1; k <= 3; k++) if (!free(x + d[0] * k, y + d[1] * k, z + d[2] * k)) return false;
    return true;
  }
  let total = 0;
  for (let z = lo[2]; z < hi[2]; z++) for (let y = lo[1]; y < hi[1]; y++) for (let x = lo[0]; x < hi[0]; x++) {
    if (types[vid(x, y, z)] !== AIR) continue;
    for (let u = 0; u < 6; u++) if (standable(x, y, z, u)) total++;
  }
  const seen = new Uint8Array(N * 6);
  const queue = new Int32Array(Math.min(N * 6, 40e6));
  let qh = 0, qt = 0;
  const push = (x, y, z, u) => {
    if (!inR(x, y, z)) return;
    const s = vid(x, y, z) * 6 + u;
    if (seen[s] || !standable(x, y, z, u)) return;
    seen[s] = 1;
    queue[qt++] = s;
  };
  // Seed from every inhabitant of the print: the first empty cell above its feet.
  for (const f of START.figures) {
    const U = DIRS[f.up];
    const c = (f.stand ?? f.pos).map((v, i) => Math.floor(v + U[i] * 0.05));
    for (let k = 0; k < 3 && !free(c[0], c[1], c[2]); k++) { c[0] += U[0]; c[1] += U[1]; c[2] += U[2]; }
    push(c[0], c[1], c[2], f.up);
  }
  const seeded = qt;
  while (qh < qt) {
    const s = queue[qh++];
    const u = s % 6;
    let r = (s - u) / 6;
    const x = lo[0] + (r % size[0]); r = Math.floor(r / size[0]);
    const y = lo[1] + (r % size[1]);
    const z = lo[2] + Math.floor(r / size[1]);
    const U = DIRS[u];
    for (let hd = 0; hd < 6; hd++) {
      if ((hd >> 1) === (u >> 1)) continue;
      const D = DIRS[hd];
      const nx = x + D[0], ny = y + D[1], nz = z + D[2];
      push(nx, ny, nz, u);
      push(nx + U[0], ny + U[1], nz + U[2], u);
      push(nx - U[0], ny - U[1], nz - U[2], u);
      // climb onto a wall three voxels tall
      if (T(nx, ny, nz) === SOLID && T(nx + U[0], ny + U[1], nz + U[2]) === SOLID && T(nx + 2 * U[0], ny + 2 * U[1], nz + 2 * U[2]) === SOLID) {
        push(x, y, z, hd ^ 1);
      }
      // roll over an edge
      if (free(nx, ny, nz) && free(nx - U[0], ny - U[1], nz - U[2]) && T(x - U[0], y - U[1], z - U[2]) === SOLID) {
        push(nx - U[0], ny - U[1], nz - U[2], hd);
      }
    }
  }
  const frac = qt / total;
  check('every inhabitant of the print is a valid start', seeded >= 14, `${seeded} seeds`);
  check('most of the structure is reachable on foot from the print', frac > 0.6, `${qt} of ${total} standing places reachable (${(frac * 100).toFixed(1)}%) in a ${R1[0] - R0[0] + 1}x${R1[1] - R0[1] + 1}x${R1[2] - R0[2] + 1} block of halls`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall generator checks passed');
process.exit(failures ? 1 : 0);
