// The architectural vocabulary of the generator. Each builder works in the canonical
// frame of a hall (floor = layer y=0 with its surface at y=1, back wall = layer x=0 with
// its surface at x=1, interior = [1,39)^3) and returns a Placement, which the hall
// generator rotates into one of 24 orientations and validates before committing.
//
// Every staircase is a run of 45 degree wedges, so it can be climbed by two gravities:
// the people for whom its treads are horizontal, and the people for whom its risers are.

import { HALL, SOLID, SOLID_NT, BARRIER, MAT } from '../core/constants.js';
import { PX, NX, PY, NY, NZ, wedgeType } from '../core/cube.js';
import { Placement } from './placement.js';
import {
  IDM, boxGeom, prismGeom, frameMatrix, cornerStairProfile, bandStairProfile, balustrade,
  cylinderGeom, addFaceDoor, buildTree, buildBush,
} from './geometry.js';
import { archOutline, archBand, insideArch } from './openings.js';

export const W_TOP = wedgeType(PX, PY);    // stair rising toward the back wall (-X)
export const W_BOT = wedgeType(NX, NY);    // stepped underside of a free stair
export const W_FLIGHT = wedgeType(PY, NZ); // stair rising toward +Z along the back wall

const LAST = HALL - 1;

// Headroom above a stair that rises toward -X, for both gravities that use it.
export function stairHeadroom(P, x0, L, z0, z1, yBase = 1) {
  for (let u = 0; u < L; u++) {
    const v = L - 1 - u;
    P.clearBox(x0 + u, yBase + 1 + v, z0, x0 + u + 1, yBase + 5 + v, z1);
    P.clearBox(x0 + u + 1, yBase + v, z0, x0 + u + 5, yBase + 1 + v, z1);
  }
}

// Railing cells (two voxels tall) above one edge column of a -X rising stair.
export function stairRailCells(P, x0, L, z, yBase = 1) {
  for (let u = 0; u < L; u++) {
    const v = L - 1 - u;
    P.put(x0 + u, yBase + 1 + v, z, BARRIER);
    P.put(x0 + u, yBase + 2 + v, z, BARRIER);
  }
}

export function stairRailGeom(s, x0, L, zc, yBase = 1) {
  const bases = [];
  for (let u = L - 1; u >= 0; u--) {
    const U = u + 0.5;
    bases.push([x0 + U, yBase + (L - U), zc]);
  }
  balustrade(s, IDM, bases, [0, 1, 0], 2.0);
}

// Free band of a -X rising stair: wedge on top, solid core, stepped underside.
export function bandCells(P, x0, L, z, yBase = 1) {
  for (let u = 0; u < L; u++) {
    const v = L - 1 - u;
    P.put(x0 + u, yBase + v, z, W_TOP);
    if (v >= 1) P.put(x0 + u, yBase + v - 1, z, SOLID);
    if (v >= 2) P.put(x0 + u, yBase + v - 2, z, W_BOT);
  }
}

// ---------------------------------------------------------------------------------
// Solid stair filling the corner between the floor and the back wall.
export function cornerStair(rot, rng, o = {}) {
  const L = o.L ?? rng.int(5, 12);
  const W = o.W ?? rng.int(4, 6);
  const z0 = o.z0 ?? rng.int(2, LAST - 1 - W);
  const P = new Placement(rot, 'cornerStair');
  for (let z = z0; z < z0 + W; z++) {
    for (let u = 0; u < L; u++) {
      const v = L - 1 - u;
      P.put(1 + u, 1 + v, z, W_TOP);
      for (let vv = 0; vv < v; vv++) P.put(1 + u, 1 + vv, z, SOLID);
    }
  }
  stairRailCells(P, 1, L, z0);
  stairRailCells(P, 1, L, z0 + W - 1);
  stairHeadroom(P, 1, L, z0 + 1, z0 + W - 1);
  P.clearBox(1 + L, 1, z0 + 1, 5 + L, 5, z0 + W - 1);
  P.clearBox(1, 1 + L, z0 + 1, 5, 5 + L, z0 + W - 1);
  P.needBox(1, 0, z0, 5 + L, 1, z0 + W);
  P.needBox(0, 1, z0, 1, 5 + L, z0 + W);
  P.geom = (s) => {
    s.add(prismGeom(cornerStairProfile(L), W), frameMatrix([1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, z0]), MAT.STAIR);
    stairRailGeom(s, 1, L, z0 + 0.5);
    stairRailGeom(s, 1, L, z0 + W - 0.5);
  };
  const zc = z0 + W / 2;
  if (o.npc !== false && rng.chance(0.35)) P.npc([[4 + L, 1, zc], [1 + L, 1, zc], [1.9, L + 0.1, zc]], PY);
  return P;
}

// ---------------------------------------------------------------------------------
// Thin double-sided stair flying from the floor up to the back wall, open beneath.
export function flyingStair(rot, rng, o = {}) {
  const L = o.L ?? rng.int(8, 24);
  const W = o.W ?? rng.int(4, 5);
  const z0 = o.z0 ?? rng.int(2, LAST - 1 - W);
  if (L + 6 > LAST || L < 5) return null;
  const P = new Placement(rot, 'flyingStair');
  for (let z = z0; z < z0 + W; z++) bandCells(P, 1, L, z);
  stairRailCells(P, 1, L, z0);
  stairRailCells(P, 1, L, z0 + W - 1);
  stairHeadroom(P, 1, L, z0 + 1, z0 + W - 1);
  P.clearBox(1 + L, 1, z0 + 1, 5 + L, 5, z0 + W - 1);
  P.clearBox(1, 1 + L, z0 + 1, 5, 5 + L, z0 + W - 1);
  P.needBox(L - 2, 0, z0, 5 + L, 1, z0 + W);
  P.needBox(0, L - 2, z0, 1, 5 + L, z0 + W);
  P.geom = (s) => {
    s.add(prismGeom(bandStairProfile(L), W), frameMatrix([1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, z0]), MAT.STAIR);
    stairRailGeom(s, 1, L, z0 + 0.5);
    stairRailGeom(s, 1, L, z0 + W - 0.5);
  };
  const zc = z0 + W / 2;
  if (o.npc !== false && rng.chance(0.45)) P.npc([[4 + L, 1, zc], [1 + L, 1, zc], [1.9, L + 0.1, zc]], PY);
  return P;
}

// ---------------------------------------------------------------------------------
// A balcony on the back wall reached by a flight running along the wall, built on a
// masonry base with a little door into the "basement" beneath the stairs.
export function balconyFlight(rot, rng, o = {}) {
  const h = o.h ?? rng.int(6, 14);
  const d = o.d ?? rng.int(4, 6);
  const w = o.w ?? rng.int(5, 9);
  const Ws = o.Ws ?? rng.int(3, 4);
  const lo = 1 + h + 4;
  const hi = LAST - w;
  if (hi < lo) return null;
  const z1 = o.z1 ?? rng.int(lo, hi);
  const P = new Placement(rot, 'balconyFlight');
  P.fill(1, h, z1, 1 + d, h + 1, z1 + w, SOLID);             // landing, top surface y = h + 1
  for (let t = 0; t < h; t++) {
    const z = z1 - h + t;
    for (let x = 1; x <= Ws; x++) {
      P.put(x, 1 + t, z, W_FLIGHT);
      for (let y = 1; y < 1 + t; y++) P.put(x, y, z, SOLID);
    }
    P.put(Ws, 2 + t, z, BARRIER);
    P.put(Ws, 3 + t, z, BARRIER);
  }
  for (let z = z1; z < z1 + w; z++) { P.put(d, h + 1, z, BARRIER); P.put(d, h + 2, z, BARRIER); }
  for (let x = 1; x < d; x++) { P.put(x, h + 1, z1 + w - 1, BARRIER); P.put(x, h + 2, z1 + w - 1, BARRIER); }
  for (let x = Ws + 1; x < d; x++) { P.put(x, h + 1, z1, BARRIER); P.put(x, h + 2, z1, BARRIER); }

  P.clearBox(1, h + 1, z1, d, h + 5, z1 + w - 1);
  for (let t = 0; t < h; t++) P.clearBox(1, 2 + t, z1 - h + t, Ws, 6 + t, z1 - h + t + 1);
  P.clearBox(1, 1, z1 - h - 4, Ws, 5, z1 - h);
  const door = h >= 7;
  const zd = z1 - 2;
  if (door) P.clearBox(1 + Ws, 1, zd - 2, 4 + Ws, 5, zd + 2);
  P.needBox(0, 1, z1 - h, 1, h + 3, z1 + w);
  P.needBox(1, 0, z1 - h - 4, 1 + Ws, 1, z1);

  P.geom = (s) => {
    s.add(boxGeom(1, h, z1, 1 + d, h + 1, z1 + w), IDM, MAT.STONE);
    for (const zc of [z1 + 1, z1 + w - 1]) {
      const g = prismGeom([[0, 0], [0, 2.2], [Math.min(d - 0.5, 2.6), 2.2]], 0.6);
      s.add(g, frameMatrix([1, 0, 0], [0, 1, 0], [0, 0, 1], [1, h - 2.2, zc - 0.3]), MAT.TRIM);
    }
    s.add(prismGeom(cornerStairProfile(h), Ws), frameMatrix([0, 0, -1], [0, 1, 0], [1, 0, 0], [1, 1, z1]), MAT.STAIR);
    const front = [];
    for (let z = z1; z < z1 + w; z++) front.push([d + 0.5, h + 1, z + 0.5]);
    balustrade(s, IDM, front, [0, 1, 0]);
    const far = [];
    for (let x = d; x >= 1; x--) far.push([x + 0.5, h + 1, z1 + w - 0.5]);
    balustrade(s, IDM, far, [0, 1, 0]);
    const near = [];
    for (let x = d; x >= Ws + 1; x--) near.push([x + 0.5, h + 1, z1 + 0.5]);
    if (near.length > 1) balustrade(s, IDM, near, [0, 1, 0]);
    const st = [];
    for (let t = 0; t < h; t++) st.push([Ws + 0.5, 1.5 + t, z1 - h + t + 0.5]);
    balustrade(s, IDM, st, [0, 1, 0]);
    if (door) {
      const op = { kind: 'door', base: 'v0', t: zd, w: 2, hs: 2.5 };
      addFaceDoor(s, frameMatrix([0, 0, 1], [0, 1, 0], [1, 0, 0], [1 + Ws, 0, 0]), op);
    }
  };
  if (o.npc !== false && rng.chance(0.5)) {
    const x = 1 + (Ws - 1) / 2;
    P.npc([[x, 1, z1 - h - 3], [x, 1, z1 - h], [x, h + 1, z1], [x, h + 1, z1 + 1.5]], PY);
  } else if (o.npc !== false && rng.chance(0.4)) {
    P.npc([[2, h + 1, z1 + 1.5], [d - 0.7, h + 1, z1 + w - 2]], PY);
  }
  return P;
}

// ---------------------------------------------------------------------------------
// A landing on the back wall, reached by a free double-sided stair from the floor.
export function landingBridge(rot, rng, o = {}) {
  const h = o.h ?? rng.int(7, 18);
  const d = o.d ?? rng.int(4, 6);
  const w = o.w ?? rng.int(6, 10);
  const Ws = o.Ws ?? rng.int(4, 5);
  if (1 + d + h + 5 > LAST || w < Ws) return null;
  const z1 = o.z1 ?? rng.int(2, LAST - 1 - w);
  const zs = o.zs ?? z1 + rng.int(0, w - Ws);
  const P = new Placement(rot, 'landingBridge');
  P.fill(1, h, z1, 1 + d, h + 1, z1 + w, SOLID);
  const x0 = 1 + d;
  for (let z = zs; z < zs + Ws; z++) bandCells(P, x0, h, z);
  stairRailCells(P, x0, h, zs);
  stairRailCells(P, x0, h, zs + Ws - 1);
  for (let z = z1; z < z1 + w; z++) {
    if (z > zs && z < zs + Ws - 1) continue;
    P.put(d, h + 1, z, BARRIER); P.put(d, h + 2, z, BARRIER);
  }
  for (let x = 1; x < d; x++) {
    P.put(x, h + 1, z1, BARRIER); P.put(x, h + 2, z1, BARRIER);
    P.put(x, h + 1, z1 + w - 1, BARRIER); P.put(x, h + 2, z1 + w - 1, BARRIER);
  }
  P.clearBox(1, h + 1, z1 + 1, d, h + 5, z1 + w - 1);
  stairHeadroom(P, x0, h, zs + 1, zs + Ws - 1);
  P.clearBox(x0 + h, 1, zs + 1, x0 + h + 4, 5, zs + Ws - 1);
  P.needBox(0, h - 2, z1, 1, h + 4, z1 + w);
  P.needBox(x0 + h - 3, 0, zs, x0 + h + 4, 1, zs + Ws);

  P.geom = (s) => {
    s.add(boxGeom(1, h, z1, 1 + d, h + 1, z1 + w), IDM, MAT.STONE);
    for (const zc of [z1 + 1, z1 + w - 1]) {
      const g = prismGeom([[0, 0], [0, 2.4], [Math.min(d - 0.5, 2.8), 2.4]], 0.6);
      s.add(g, frameMatrix([1, 0, 0], [0, 1, 0], [0, 0, 1], [1, h - 2.4, zc - 0.3]), MAT.TRIM);
    }
    s.add(prismGeom(bandStairProfile(h), Ws), frameMatrix([1, 0, 0], [0, 1, 0], [0, 0, 1], [x0, 1, zs]), MAT.STAIR);
    stairRailGeom(s, x0, h, zs + 0.5);
    stairRailGeom(s, x0, h, zs + Ws - 0.5);
    for (const [a, b] of [[z1, zs + 1], [zs + Ws - 1, z1 + w]]) {
      const pts = [];
      for (let z = a; z < b; z++) pts.push([d + 0.5, h + 1, z + 0.5]);
      if (pts.length > 1) balustrade(s, IDM, pts, [0, 1, 0]);
    }
    for (const zc of [z1 + 0.5, z1 + w - 0.5]) {
      const pts = [];
      for (let x = d; x >= 1; x--) pts.push([x + 0.5, h + 1, zc]);
      balustrade(s, IDM, pts, [0, 1, 0]);
    }
  };
  const zc = zs + Ws / 2;
  if (o.npc !== false && rng.chance(0.45)) {
    P.npc([[x0 + h + 3, 1, zc], [x0 + h, 1, zc], [x0 + 0.1, h + 0.9, zc], [x0 - 1.5, h + 1, zc]], PY);
  }
  return P;
}

// ---------------------------------------------------------------------------------
// A round column from floor to ceiling.
export function column(rot, rng, o = {}) {
  const x0 = o.x ?? rng.int(3, LAST - 4);
  const z0 = o.z ?? rng.int(3, LAST - 4);
  const P = new Placement(rot, 'column');
  P.fill(x0, 1, z0, x0 + 2, LAST, z0 + 2, SOLID_NT);
  P.needBox(x0, 0, z0, x0 + 2, 1, z0 + 2);
  P.needBox(x0, LAST, z0, x0 + 2, HALL, z0 + 2);
  P.geom = (s) => {
    s.add(cylinderGeom([x0 + 1, 1.6, z0 + 1], [x0 + 1, LAST - 1.2, z0 + 1], 0.86, 0.8, 16, false), IDM, MAT.STONE);
    s.add(boxGeom(x0 - 0.15, 1, z0 - 0.15, x0 + 2.15, 1.6, z0 + 2.15), IDM, MAT.TRIM);
    s.add(cylinderGeom([x0 + 1, 1.6, z0 + 1], [x0 + 1, 2.0, z0 + 1], 1.0, 0.9, 16), IDM, MAT.TRIM);
    s.add(cylinderGeom([x0 + 1, LAST - 1.7, z0 + 1], [x0 + 1, LAST - 1.2, z0 + 1], 0.85, 1.0, 16), IDM, MAT.TRIM);
    s.add(boxGeom(x0 - 0.2, LAST - 1.2, z0 - 0.2, x0 + 2.2, LAST, z0 + 2.2), IDM, MAT.TRIM);
  };
  return P;
}

// ---------------------------------------------------------------------------------
// An internal wall standing on the floor, running out from the side wall (z = 0),
// floor to ceiling, pierced by arches. Both of its faces are floors for somebody.
export function arcadeWall(rot, rng, o = {}) {
  const xp = o.x ?? rng.int(8, LAST - 10);
  const zEnd = o.zEnd ?? (rng.chance(0.3) ? LAST : rng.int(16, 30));
  const wA = o.archW ?? rng.pick([4, 6]);
  const hs = o.archH ?? rng.int(6, 10);
  const gap = wA + rng.int(2, 4);
  const arches = [];
  for (let t = 4 + wA / 2; t + wA / 2 <= zEnd - 3; t += gap) arches.push({ kind: 'arch', base: 'v0', t, w: wA, hs });
  if (!arches.length) return null;
  const P = new Placement(rot, 'arcadeWall');
  const open = (z, y) => arches.some((a) => insideArch(z + 0.5 - a.t, y + 0.5 - 1, a.w, a.hs));
  for (let x = xp; x < xp + 2; x++) {
    for (let y = 1; y < LAST; y++) for (let z = 1; z < zEnd; z++) if (!open(z, y)) P.put(x, y, z, SOLID);
  }
  for (const a of arches) {
    P.clearBox(xp - 4, 1, a.t - a.w / 2, xp, 6, a.t + a.w / 2);
    P.clearBox(xp + 2, 1, a.t - a.w / 2, xp + 6, 6, a.t + a.w / 2);
  }
  P.needBox(xp, 0, 1, xp + 2, 1, zEnd);
  P.needBox(xp, LAST, 1, xp + 2, HALL, zEnd);
  P.needBox(xp, 1, 0, xp + 2, LAST, 1);
  if (zEnd === LAST) P.needBox(xp, 1, LAST, xp + 2, LAST, HALL);
  P.geom = (s) => {
    // The outline lives in (z, y); archOutline's 'v0' base already stands at y = 1.
    const outer = [[1, 1], [zEnd, 1], [zEnd, LAST], [1, LAST]];
    const M = frameMatrix([0, 0, 1], [0, 1, 0], [-1, 0, 0], [xp + 2, 0, 0]);
    s.add(prismGeom(outer, 2, arches.map((a) => archOutline(a))), M, MAT.STONE);
    for (const a of arches) {
      const band = archBand(a, 0, 0.7);
      const g1 = prismGeom(band, 0.16); g1.translate(0, 0, -0.16);
      s.add(g1, M, MAT.TRIM);
      const g2 = prismGeom(band, 0.16); g2.translate(0, 0, 2);
      s.add(g2, M, MAT.TRIM);
    }
  };
  return P;
}

// ---------------------------------------------------------------------------------
// A raised garden bed with trees and shrubs. Every gravity gets its own park.
export function garden(rot, rng, o = {}) {
  const sx = o.sx ?? rng.int(6, 14);
  const sz = o.sz ?? rng.int(6, 14);
  const x0 = o.x ?? rng.int(2, LAST - 1 - sx);
  const z0 = o.z ?? rng.int(2, LAST - 1 - sz);
  const P = new Placement(rot, 'garden');
  P.fill(x0, 1, z0, x0 + sx, 2, z0 + sz, SOLID);
  P.needBox(x0, 0, z0, x0 + sx, 1, z0 + sz);
  const trees = [];
  const nt = o.trees ?? rng.int(1, 3);
  for (let i = 0; i < nt; i++) {
    const tx = rng.int(x0 + 1, x0 + sx - 2), tz = rng.int(z0 + 1, z0 + sz - 2);
    const H = o.treeH ?? rng.range(9, 15);
    const trunk = Math.floor(H * 0.45);
    trees.push({ tx, tz, H, seed: rng.int(1, 1e9) });
    for (let y = 2; y < 2 + trunk; y++) P.put(tx, y, tz, SOLID_NT);
    P.clearBox(tx - 3, 2 + trunk - 1, tz - 3, tx + 4, Math.ceil(2 + H + 2), tz + 4);
  }
  const bushes = [];
  const nb = o.bushes ?? rng.int(2, 5);
  for (let i = 0; i < nb; i++) {
    bushes.push({ x: rng.range(x0 + 1, x0 + sx - 1), z: rng.range(z0 + 1, z0 + sz - 1), r: rng.range(0.9, 1.6), seed: rng.int(1, 1e9) });
  }
  P.geom = (s) => {
    s.add(boxGeom(x0, 1, z0, x0 + sx, 1.85, z0 + sz), IDM, MAT.TRIM);
    s.add(boxGeom(x0 + 0.25, 1.85, z0 + 0.25, x0 + sx - 0.25, 2, z0 + sz - 0.25), IDM, MAT.SOIL);
    for (const t of trees) {
      buildTree(s, frameMatrix([1, 0, 0], [0, 1, 0], [0, 0, 1], [t.tx + 0.5, 2, t.tz + 0.5]), new DetailRng(t.seed), t.H);
    }
    for (const b of bushes) {
      buildBush(s, frameMatrix([1, 0, 0], [0, 1, 0], [0, 0, 1], [b.x, 2, b.z]), new DetailRng(b.seed), b.r * 2);
    }
  };
  if (o.npc !== false && rng.chance(0.5) && z0 - 1.5 > 2) {
    P.npc([[x0 + 0.5, 1, z0 - 1.5], [x0 + sx - 0.5, 1, z0 - 1.5]], PY);
  }
  return P;
}

// Small xorshift RNG for geometry details.
export class DetailRng {
  constructor(seed) { this.s = (seed >>> 0) || 1; }
  next() {
    let s = this.s;
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    this.s = s;
    return s / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
}
