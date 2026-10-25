// Building blocks placed directly in hall coordinates (no rotation): used for the
// hand-built halls of the print, where every piece sits at a measured position.
// Directions are cube direction indices (PX, NX, PY, NY, PZ, NZ).

import { SOLID, SOLID_NT, BARRIER, MAT } from '../core/constants.js';
import { DIRS, IDENTITY, wedgeType, axisOf, signOf, flip } from '../core/cube.js';
import { Placement } from './placement.js';
import {
  IDM, boxGeom, prismGeom, frameMatrix, bandStairProfile, cornerStairProfile, balustrade, blobGeom, addFaceDoor,
} from './geometry.js';
import { archOutline, archBand, insideArch } from './openings.js';

const add = (a, d, k = 1) => [a[0] + d[0] * k, a[1] + d[1] * k, a[2] + d[2] * k];

// Frame for a stair profile: p runs against the climb (away from the top), q along the
// rise, w across the stair. The origin is where the profile's (0, 0) corner sits.
function stairFrame(foot, run, rise, wide, L) {
  const dirs = [flip(run), rise, wide];
  const s0 = dirs.map((d, i) => {
    const k = axisOf(d), c = foot[k];
    const lo = signOf(d) > 0 ? c : -c - 1;
    return i === 0 ? lo - (L - 1) : lo;
  });
  const O = [0, 0, 0];
  dirs.forEach((d, i) => { O[axisOf(d)] = signOf(d) * s0[i]; });
  return frameMatrix(DIRS[dirs[0]], DIRS[dirs[1]], DIRS[wide], O);
}

// A 45 degree stair. `foot` is the cell of the lowest step, `run` the direction you walk
// going up, `rise` the up of the people on its treads, `wide` the direction across it.
// A band is open beneath (its underside is a stair for the people whose up is `run`);
// a solid stair is filled down to the foot level.
export function stair(o) {
  const { foot, L, W, run, rise, wide } = o;
  const R = DIRS[run], U = DIRS[rise], S = DIRS[wide], B = DIRS[flip(run)];
  const top = wedgeType(rise, flip(run));
  const under = wedgeType(run, flip(rise));
  const rails = o.rails ?? [0, W - 1];
  const P = new Placement(IDENTITY, o.name || 'stair');
  const clear = (c) => { if (c.every((v) => v >= 1 && v < 39)) P.clear.push(...c); };
  for (let w = 0; w < W; w++) {
    for (let i = 0; i < L; i++) {
      const c = add(add(add(foot, R, i), U, i), S, w);
      P.put(...c, top);
      if (o.solid) {
        for (let k = 1; k <= i + (o.base ?? 0); k++) P.put(...add(c, U, -k), SOLID);
      } else {
        if (i >= 1) P.put(...add(c, U, -1), SOLID);
        if (i >= 2) P.put(...add(c, U, -2), under);
      }
      if (rails.includes(w)) { P.put(...add(c, U, 1), BARRIER); P.put(...add(c, U, 2), BARRIER); }
      else if (o.clear !== false) {
        // headroom over the treads, and along the underside for the people who walk it
        for (let k = 1; k <= 3; k++) clear(add(c, U, k));
        if (!o.solid && i >= 2) for (let k = 1; k <= 3; k++) clear(add(add(c, U, -2), R, k));
      }
    }
  }
  const M = stairFrame(foot, run, rise, wide, L);
  P.geom = (s) => {
    s.add(prismGeom(o.solid ? cornerStairProfile(L) : bandStairProfile(L), W), M, o.mat ?? MAT.STAIR);
    if (o.solid && o.base) s.add(boxGeom(0, -o.base, 0, L, 0, W), M, MAT.STONE);
    for (const w of rails) {
      const bases = [];
      for (let u = L - 1; u >= 0; u--) bases.push([u + 0.5, L - u - 0.5, w + 0.5]);
      balustrade(s, M, bases, [0, 1, 0], 2.0);
      const b = bases[0];
      s.add(blobGeom([b[0], b[1] + 2.25, b[2]], 0.24, null, 1), M, MAT.TRIM);
    }
  };
  return P;
}

// A block of masonry.
export function block(box, o = {}) {
  const [x0, y0, z0, x1, y1, z1] = box;
  const P = new Placement(IDENTITY, o.name || 'block');
  P.fill(x0, y0, z0, x1, y1, z1, o.type ?? SOLID);
  P.geom = (s) => {
    s.add(boxGeom(x0, y0, z0, x1, y1, z1), IDM, o.mat ?? MAT.STONE);
    if (o.cornice) {
      // a moulding along the edges facing `cornice` (an up direction)
      const u = o.cornice, k = axisOf(u), sg = signOf(u);
      const lo = [x0, y0, z0], hi = [x1, y1, z1];
      const a = lo.slice(), b = hi.slice();
      for (let i = 0; i < 3; i++) if (i !== k) { a[i] -= 0.22; b[i] += 0.22; }
      if (sg > 0) { a[k] = hi[k] - 0.45; b[k] = hi[k]; } else { a[k] = lo[k]; b[k] = lo[k] + 0.45; }
      s.add(boxGeom(...a, ...b), IDM, MAT.TRIM);
    }
  };
  return P;
}

// A railing standing on a line of cells (`from` to `to`, inclusive, along one axis) for
// people whose up is `up`: two cells of barrier, posts and a handrail.
export function railing(from, to, up, o = {}) {
  const P = new Placement(IDENTITY, o.name || 'railing');
  const k = [0, 1, 2].find((i) => from[i] !== to[i]) ?? 0;
  const n = Math.abs(to[k] - from[k]);
  const step = Math.sign(to[k] - from[k]) || 1;
  const U = DIRS[up];
  const cells = [];
  for (let i = 0; i <= n; i++) { const c = from.slice(); c[k] += i * step; cells.push(c); }
  for (const c of cells) { P.put(...c, BARRIER); P.put(...add(c, U), BARRIER); }
  P.geom = (s) => {
    // posts rise from the face the railing stands on
    const bases = cells.map((c) => [0, 1, 2].map((i) => c[i] + 0.5 - U[i] * 0.5));
    if (bases.length > 1) {
      const ext = (b, dir) => b.map((v, i) => v + (i === k ? dir * 0.4 : 0));
      bases[0] = ext(bases[0], -step);
      bases[bases.length - 1] = ext(bases[bases.length - 1], step);
    }
    balustrade(s, IDM, bases, U, 2.0);
  };
  return P;
}

// A wall slab with arched openings. The slab is `box`; its thin axis is `axis`. Openings
// are given in the wall's own (u, v) frame, u along the next axis and v along the one
// after (as for the hall walls): { t, w, hs, sill, base: 'v0'|'v1'|'u0'|'u1' }.
export function archWall(box, axis, openings, o = {}) {
  const [x0, y0, z0, x1, y1, z1] = box;
  const lo = [x0, y0, z0], hi = [x1, y1, z1];
  const b = (axis + 1) % 3, c = (axis + 2) % 3;
  const P = new Placement(IDENTITY, o.name || 'archWall');
  const local = (op) => ({ ...op, kind: 'arch' });
  const inside = (u, v) => openings.some((op) => {
    const ul = u - lo[b], vl = v - lo[c];
    const along = op.base[0] === 'v' ? ul : vl;
    const up = op.base === 'v0' ? vl : op.base === 'v1' ? hi[c] - lo[c] - vl : op.base === 'u0' ? ul : hi[b] - lo[b] - ul;
    return insideArch(along - op.t, up - (op.sill || 0), op.w, op.hs);
  });
  const p = [0, 0, 0];
  for (p[0] = x0; p[0] < x1; p[0]++) for (p[1] = y0; p[1] < y1; p[1]++) for (p[2] = z0; p[2] < z1; p[2]++) {
    if (!inside(p[b] + 0.5, p[c] + 0.5)) P.put(p[0], p[1], p[2], SOLID);
  }
  P.geom = (s) => {
    const W = hi[b] - lo[b], H = hi[c] - lo[c], T = hi[axis] - lo[axis];
    const eb = [0, 0, 0]; eb[b] = 1;
    const ec = [0, 0, 0]; ec[c] = 1;
    const ea = [0, 0, 0]; ea[axis] = 1;
    const M = frameMatrix(eb, ec, ea, lo);
    // Openings standing on the bottom edge are cut into the outline as notches (a hole
    // touching the outline does not triangulate); the others become holes.
    const notched = openings.filter((op) => op.base === 'v0' && !(op.sill > 0)).sort((a, b) => a.t - b.t);
    const outline = [[0, 0]];
    for (const op of notched) {
      const r = op.w / 2;
      outline.push([op.t - r, 0], [op.t - r, op.hs]);
      for (let i = 13; i > 0; i--) { const a = (Math.PI * i) / 14; outline.push([op.t + Math.cos(a) * r, op.hs + Math.sin(a) * r]); }
      outline.push([op.t + r, op.hs], [op.t + r, 0]);
    }
    outline.push([W, 0], [W, H], [0, H]);
    const holes = openings.filter((op) => !notched.includes(op)).map((op) => outlineIn(op, W, H));
    s.add(prismGeom(outline, T, holes), M, o.mat ?? MAT.STONE);
    for (const op of openings) {
      const band = bandIn(op, W, H, 0.7);
      for (const [z, d] of [[-0.16, 0.16], [T, 0.16]]) {
        const g = prismGeom(band, d); g.translate(0, 0, z);
        s.add(g, M, MAT.TRIM);
      }
    }
  };
  return P;
}

// Arch outlines in a W x H frame (u along W, v along H).
function toFrame(op, W, H, pts) {
  return pts.map(([a, h]) => {
    switch (op.base) {
      case 'v0': return [a, h];
      case 'v1': return [a, H - h];
      case 'u0': return [h, a];
      default: return [W - h, a];
    }
  });
}
function archPts(op, grow, segs = 14) {
  const s = op.sill || 0, r = op.w / 2 + grow;
  const pts = [[op.t - r, s], [op.t + r, s], [op.t + r, s + op.hs]];
  for (let i = 1; i < segs; i++) { const a = (Math.PI * i) / segs; pts.push([op.t + Math.cos(a) * r, s + op.hs + Math.sin(a) * r]); }
  pts.push([op.t - r, s + op.hs]);
  return pts;
}
function outlineIn(op, W, H) { return toFrame(op, W, H, archPts(op, 0)); }
function bandIn(op, W, H, width, segs = 14) {
  const s = op.sill || 0, ri = op.w / 2, ro = op.w / 2 + width;
  const pts = [[op.t - ro, s], [op.t - ri, s], [op.t - ri, s + op.hs]];
  for (let i = segs - 1; i > 0; i--) { const a = (Math.PI * i) / segs; pts.push([op.t + Math.cos(a) * ri, s + op.hs + Math.sin(a) * ri]); }
  pts.push([op.t + ri, s + op.hs], [op.t + ri, s], [op.t + ro, s], [op.t + ro, s + op.hs]);
  for (let i = 1; i < segs; i++) { const a = (Math.PI * i) / segs; pts.push([op.t + Math.cos(a) * ro, s + op.hs + Math.sin(a) * ro]); }
  pts.push([op.t - ro, s + op.hs]);
  return toFrame(op, W, H, pts);
}

// A closed door or a blind window drawn on one face of the stone, for people whose up is
// `up`. `at` is the centre of the door's sill on the face; `normal` points out of the face.
export function faceDoor(at, normal, up, w = 2.4, hs = 2.6, o = {}) {
  const P = new Placement(IDENTITY, o.name || 'door');
  const N = DIRS[normal], U = DIRS[up];
  const A = [N[1] * U[2] - N[2] * U[1], N[2] * U[0] - N[0] * U[2], N[0] * U[1] - N[1] * U[0]];
  P.geom = (s) => {
    // addFaceDoor's outline stands on v = 1, so start the frame one unit lower
    const M = frameMatrix(A, U, N, add(at, U, -1));
    addFaceDoor(s, M, { kind: 'door', base: 'v0', t: 0, w, hs, sill: 0 });
  };
  return P;
}

export { add };
