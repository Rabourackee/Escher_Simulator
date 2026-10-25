// Hall boundary walls. Halls sit on a cubic lattice; the wall between two neighbouring
// halls is shared, so its existence and openings are a pure function of its lattice
// coordinates (or of the prefab). Both halls therefore always agree on it.
//
// Wall (axis a, hall i,j,k) lies on the low-`a` plane of hall (i,j,k). Its slab is two
// voxels thick (one voxel on each side of the plane) and overhangs its square by one
// voxel on every edge, so perpendicular walls meet without gaps.

import { HALL, AIR, SOLID, BARRIER, getSeed } from '../core/constants.js';
import { hash, Rng } from '../core/rng.js';
import { insideOpening, localExtent, openingBox, openingFits, boxesOverlap, fromLocal } from './openings.js';
import { prefabWall } from './prefab.js';

const P_WALL = 0.64;

// Small caches: every entry can be recomputed in microseconds, so they are kept to
// roughly the neighbourhood being generated and simply emptied when they fill up.
const SPEC_CAP = 4000;
const EXIST_CAP = 20000;
const existCache = new Map();
const specCache = new Map();
const wkey = (a, i, j, k) => `${a}|${i}|${j}|${k}`;

export function clearWallCaches() {
  existCache.clear();
  specCache.clear();
}

export function wallCacheSizes() {
  return { specs: specCache.size, exists: existCache.size };
}

function trimCaches() {
  if (specCache.size > SPEC_CAP) specCache.clear();
  if (existCache.size > EXIST_CAP) existCache.clear();
}

export function wallExists(a, i, j, k) {
  const key = wkey(a, i, j, k);
  let e = existCache.get(key);
  if (e !== undefined) return e;
  if (existCache.size > EXIST_CAP) existCache.clear();
  const pf = prefabWall(a, i, j, k);
  if (pf !== undefined) e = pf !== null;
  else e = new Rng(hash(a, i, j, k, getSeed() ^ 0x7a11)).next() < P_WALL;
  existCache.set(key, e);
  return e;
}

export function wallSpec(a, i, j, k) {
  const key = wkey(a, i, j, k);
  if (specCache.has(key)) return specCache.get(key);
  trimCaches();
  let spec;
  const pf = prefabWall(a, i, j, k);
  if (pf !== undefined) spec = pf;
  else if (!wallExists(a, i, j, k)) spec = null;
  else spec = makeSpec(a, [i, j, k]);
  if (spec && !spec.h) spec = { ...spec, axis: a, h: [i, j, k] };
  specCache.set(key, spec);
  return spec;
}

// How many floors meet each edge of a wall (0..2): an arch prefers to stand on an edge
// where the floor continues on both sides, so walking through it leads somewhere.
function edgeFloors(a, h) {
  const b = (a + 1) % 3, c = (a + 2) % 3;
  const other = h.slice(); other[a] -= 1;
  const ex = (axis, hh) => (wallExists(axis, hh[0], hh[1], hh[2]) ? 1 : 0);
  const plus = (hh, ax) => { const r = hh.slice(); r[ax] += 1; return r; };
  return {
    u0: ex(b, h) + ex(b, other),
    u1: ex(b, plus(h, b)) + ex(b, plus(other, b)),
    v0: ex(c, h) + ex(c, other),
    v1: ex(c, plus(h, c)) + ex(c, plus(other, c)),
  };
}

function makeSpec(a, h) {
  const rng = new Rng(hash(a, h[0], h[1], h[2], getSeed() ^ 0x5eed));
  const floors = edgeFloors(a, h);
  const spec = { axis: a, h, openings: [] };
  const edges = ['u0', 'u1', 'v0', 'v1'];
  const good = edges.filter((e) => floors[e] > 0);
  const best = edges.filter((e) => floors[e] === 2);
  const pickBase = () => {
    if (best.length && rng.chance(0.7)) return rng.pick(best);
    if (good.length) return rng.pick(good);
    return rng.pick(edges);
  };
  const tryAdd = (op) => {
    if (!openingFits(op)) return false;
    const box = openingBox(op);
    for (const o of spec.openings) if (boxesOverlap(box, openingBox(o), 2)) return false;
    spec.openings.push(op);
    return true;
  };
  const doors = (n, sizes = [4, 4, 6]) => {
    for (let k = 0, tries = 0; k < n && tries < 14; tries++) {
      const w = rng.pick(sizes);
      const op = { kind: 'arch', base: pickBase(), w, hs: rng.int(5, 9) };
      op.t = rng.int(3 + w / 2, HALL - 3 - w / 2);
      if (tryAdd(op)) k++;
    }
  };
  const oculus = (rMin, rMax) => {
    for (let t = 0; t < 6; t++) {
      const r = rng.range(rMin, rMax);
      const op = { kind: 'round', r, cu: rng.range(r + 5, HALL - r - 5), cv: rng.range(r + 5, HALL - r - 5) };
      if (tryAdd(op)) return;
    }
  };
  const windowRow = () => {
    const base = pickBase();
    const w = rng.pick([2, 2, 4]);
    const hs = w === 2 ? 3 : 4;
    const sill = rng.int(9, 17);
    const count = rng.int(2, 5);
    const gap = w + rng.int(3, 5);
    const start = rng.int(4 + w / 2, Math.max(4 + w / 2, HALL - 4 - w / 2 - gap * (count - 1)));
    for (let n = 0; n < count; n++) tryAdd({ kind: rng.chance(0.7) ? 'window' : 'arch', base, w, hs, sill, t: start + n * gap });
  };

  // Walls between halls are rarely plain: most are opened up so the halls run into each
  // other the way the spaces of the print do.
  const style = rng.weighted([['arcade', 30], ['grand', 18], ['frame', 14], ['pierced', 24], ['solid', 14]]);
  spec.style = style;
  if (style === 'arcade') {
    // a row of arches on piers, often with a second tier of smaller openings above
    const base = pickBase();
    const w = rng.pick([6, 6, 8]);
    const pier = rng.pick([2, 2, 3, 4]);
    const hs = rng.int(8, 15);
    const n = Math.floor((HALL - 6 + pier) / (w + pier));
    const total = n * w + (n - 1) * pier;
    const start = 3 + Math.floor((HALL - 6 - total) / 2) + w / 2;
    for (let i = 0; i < n; i++) tryAdd({ kind: 'arch', base, t: start + i * (w + pier), w, hs });
    if (rng.chance(0.6)) {
      const w2 = rng.pick([2, 4]);
      const sill = hs + w / 2 + rng.int(3, 5);
      for (let i = 0; i < n; i++) tryAdd({ kind: 'arch', base, t: start + i * (w + pier), w: w2, hs: w2 === 2 ? 3 : 4, sill });
    }
  } else if (style === 'grand') {
    const w = rng.pick([16, 18, 20, 24]);
    const hs = rng.int(10, Math.min(21, HALL - 7 - w / 2));
    tryAdd({ kind: 'arch', base: pickBase(), t: HALL / 2, w, hs });
    doors(rng.int(0, 2));
    if (rng.chance(0.4)) oculus(3, 5);
  } else if (style === 'frame') {
    // little more than a frame around one huge opening
    const w = rng.pick([26, 28, 30]);
    tryAdd({ kind: 'arch', base: pickBase(), t: HALL / 2, w, hs: HALL - 7 - w / 2 - rng.int(0, 3) });
  } else if (style === 'pierced') {
    doors(rng.int(2, 4), [4, 4, 6, 6, 8, 10]);
    if (rng.chance(0.55)) oculus(3, 7);
    if (rng.chance(0.6)) windowRow();
  } else {
    doors(rng.int(0, 2));
    if (rng.chance(0.5)) windowRow();
    if (rng.chance(0.3)) oculus(3, 5);
  }
  // Closed doors (to basements and to nowhere) wherever there is room
  const nClosed = rng.weighted([[0, 4], [1, 4], [2, 2]]);
  for (let n = 0; n < nClosed; n++) {
    const w = 4;
    const op = { kind: 'door', base: pickBase(), w, hs: rng.int(4, 5) };
    op.t = rng.int(3 + w / 2, HALL - 3 - w / 2);
    tryAdd(op);
  }
  return spec;
}

const PRIORITY = { [AIR]: 0, [BARRIER]: 1, [SOLID]: 2 };

// Write every wall that touches hall (hx,hy,hz) into its voxel grid (x fastest).
export function rasterizeWalls(hx, hy, hz, grid) {
  const H = [hx, hy, hz];
  const lo = [0, 0, 0], hi = [0, 0, 0];
  const p = [0, 0, 0];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    const w = [hx + dx, hy + dy, hz + dz];
    for (let a = 0; a < 3; a++) {
      const b = (a + 1) % 3, c = (a + 2) % 3;
      // Quick reject before computing the spec: does the slab box touch this hall?
      let touches = true;
      for (let ax = 0; ax < 3; ax++) {
        let l, h;
        if (ax === a) { l = HALL * w[a] - 1; h = HALL * w[a] + 1; }
        else { l = HALL * w[ax] - 1; h = HALL * w[ax] + HALL + 1; }
        lo[ax] = Math.max(l, HALL * H[ax]);
        hi[ax] = Math.min(h, HALL * H[ax] + HALL);
        if (lo[ax] >= hi[ax]) { touches = false; break; }
      }
      if (!touches) continue;
      const spec = wallSpec(a, w[0], w[1], w[2]);
      if (!spec) continue;
      const ops = spec.openings.filter((o) => o.kind !== 'door');
      for (p[0] = lo[0]; p[0] < hi[0]; p[0]++) for (p[1] = lo[1]; p[1] < hi[1]; p[1]++) for (p[2] = lo[2]; p[2] < hi[2]; p[2]++) {
        const u = p[b] + 0.5 - HALL * w[b];
        const v = p[c] + 0.5 - HALL * w[c];
        let t = SOLID;
        for (const op of ops) {
          if (insideOpening(op, u, v)) { t = op.kind === 'window' ? BARRIER : AIR; break; }
        }
        const idx = (p[0] - HALL * hx) + HALL * ((p[1] - HALL * hy) + HALL * (p[2] - HALL * hz));
        if (PRIORITY[t] > PRIORITY[grid[idx]]) grid[idx] = t;
      }
    }
  }
}

// The six walls bounding a hall, with the side of the hall interior they face.
export function boundingWalls(hx, hy, hz) {
  const out = [];
  for (let a = 0; a < 3; a++) {
    const lo = [hx, hy, hz];
    const hi = [hx, hy, hz]; hi[a] += 1;
    out.push({ a, side: 0, spec: wallSpec(a, lo[0], lo[1], lo[2]) });
    out.push({ a, side: 1, spec: wallSpec(a, hi[0], hi[1], hi[2]) });
  }
  return out;
}

// Keep the space in front of doorways, oculi and closed doors free of features.
export function reserveOpenings(hx, hy, hz, reserve) {
  for (const { a, side, spec } of boundingWalls(hx, hy, hz)) {
    if (!spec) continue;
    const b = (a + 1) % 3, c = (a + 2) % 3;
    for (const op of spec.openings) {
      if (op.kind === 'window') continue;
      if (op.kind === 'arch' && (op.sill || 0) > 0) continue;  // upper-tier openings are windows in effect
      // Box in front of the opening, one voxel wider along its base but never reaching
      // below its sill (so a balcony can sit right under a raised door).
      let u0, v0, u1, v1;
      if (op.kind === 'round') {
        [u0, v0, u1, v1] = openingBox(op);
        u0 -= 1; v0 -= 1; u1 += 1; v1 += 1;
      } else {
        let [a0, h0, a1, h1] = localExtent(op);
        // a wide arch is easy to pass through anywhere: keep only its middle clear
        if (a1 - a0 > 8) { const mid = (a0 + a1) / 2; a0 = mid - 3; a1 = mid + 3; }
        const top = op.kind === 'door' ? h1 : Math.min(h1, h0 + 6);
        const p = fromLocal(op.base, a0 - 1, h0), q = fromLocal(op.base, a1 + 1, top);
        u0 = Math.min(p[0], q[0]); u1 = Math.max(p[0], q[0]);
        v0 = Math.min(p[1], q[1]); v1 = Math.max(p[1], q[1]);
      }
      const depth = op.kind === 'door' ? 3 : (op.w > 8 ? 3 : 5);
      const d0 = side === 0 ? 1 : HALL - 1 - depth;
      const d1 = side === 0 ? 1 + depth : HALL - 1;
      const q = [0, 0, 0];
      for (let d = d0; d < d1; d++) {
        for (let u = Math.max(1, Math.floor(u0)); u < Math.min(HALL - 1, Math.ceil(u1)); u++) {
          for (let v = Math.max(1, Math.floor(v0)); v < Math.min(HALL - 1, Math.ceil(v1)); v++) {
            q[a] = d; q[b] = u; q[c] = v;
            reserve[q[0] + HALL * (q[1] + HALL * q[2])] = 1;
          }
        }
      }
    }
  }
}
