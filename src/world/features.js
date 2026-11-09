// The architectural vocabulary of the generator. Each builder works in the canonical
// frame of a hall and returns a Placement, which the hall generator rotates into one of
// 24 orientations and validates before committing.
//
// Canonical frame: the floor is the layer y = oy (default 0) with its walking surface at
// y = oy + 1, the "back wall" is the layer x = ox (default 0) with its surface at x = ox + 1,
// and everything must stay inside the hall interior [1, 39)^3. The offsets let the same
// stair or balcony hang off a hall wall or off a tower standing in the middle of a hall.
//
// Every staircase is a run of 45 degree wedges, so it can be climbed by two gravities:
// the people for whom its treads are horizontal, and the people for whom its risers are.

import { HALL, SOLID, SOLID_NT, BARRIER, MAT } from '../core/constants.js';
import { PX, NX, PY, NY, PZ, NZ, wedgeType } from '../core/cube.js';
import { Placement } from './placement.js';
import {
  IDM, boxGeom, prismGeom, frameMatrix, cornerStairProfile, bandStairProfile, balustrade,
  cylinderGeom, addFaceDoor, buildTree, buildBush, latheGeom, blobGeom,
} from './geometry.js';
import { archOutline, archBand, insideArch } from './openings.js';

export const W_TOP = wedgeType(PX, PY);    // stair rising toward the back wall (-X)
export const W_BOT = wedgeType(NX, NY);    // stepped underside of a free stair
export const W_FLIGHT = wedgeType(PY, NZ); // stair rising toward +Z along the back wall

const LAST = HALL - 1;
const HORIZ = [PX, NX, PZ, NZ];

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
  // a stone ball on the newel post at the foot of the stair
  const b = bases[0];
  s.add(blobGeom([b[0], b[1] + 2.25, b[2]], 0.24, null, 1), IDM, MAT.TRIM);
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

const frameAt = (o) => frameMatrix([1, 0, 0], [0, 1, 0], [0, 0, 1], o);

// ---------------------------------------------------------------------------------
// Solid stair filling the corner between the floor and the back wall. With toTop the
// wall is a tower exactly L high and the stair arrives on its roof.
export function cornerStair(rot, rng, o = {}) {
  const ox = o.ox ?? 0, oy = o.oy ?? 0, X = ox + 1, Y = oy + 1;
  const L = o.L ?? rng.int(5, 12);
  const W = o.W ?? rng.int(4, 6);
  const z0 = o.z0 ?? rng.int(2, LAST - 1 - W);
  const toTop = !!o.toTop;
  if (L < 3 || X + L + 4 > LAST || Y + L + (toTop ? 1 : 4) > LAST || z0 < 1 || z0 + W > LAST) return null;
  const P = new Placement(rot, 'cornerStair');
  for (let z = z0; z < z0 + W; z++) {
    for (let u = 0; u < L; u++) {
      const v = L - 1 - u;
      P.put(X + u, Y + v, z, W_TOP);
      for (let vv = 0; vv < v; vv++) P.put(X + u, Y + vv, z, SOLID);
    }
  }
  stairRailCells(P, X, L, z0, Y);
  stairRailCells(P, X, L, z0 + W - 1, Y);
  stairHeadroom(P, X, L, z0 + 1, z0 + W - 1, Y);
  P.clearBox(X + L, Y, z0 + 1, X + L + 4, Y + 4, z0 + W - 1);
  if (toTop) {
    P.clearBox(ox - 3, Y + L, z0 + 1, X, Y + L + 4, z0 + W - 1);
    P.needBox(ox - 2, Y + L - 1, z0, X, Y + L, z0 + W);
  } else {
    P.clearBox(X, Y + L, z0 + 1, X + 4, Y + L + 4, z0 + W - 1);
  }
  P.needBox(X, oy, z0, X + L + 4, oy + 1, z0 + W);
  P.needBox(ox, Y, z0, ox + 1, Y + L + (toTop ? 0 : 4), z0 + W);
  P.geom = (s) => {
    s.add(prismGeom(cornerStairProfile(L), W), frameAt([X, Y, z0]), MAT.STAIR);
    stairRailGeom(s, X, L, z0 + 0.5, Y);
    stairRailGeom(s, X, L, z0 + W - 0.5, Y);
  };
  const zc = z0 + W / 2;
  if (o.npc !== false && rng.chance(0.35)) P.npc([[X + L + 3, Y, zc], [X + L, Y, zc], [X + 0.9, Y + L - 0.9, zc]], PY);
  else if (o.npc !== false && rng.chance(0.25)) {
    // somebody resting on the lower steps: hips over the second step, feet on the first
    P.figures.push({ pos: [X + L - 1.8, Y + 1.0, zc], up: PY, face: PX, pose: 'sit' });
  }
  return P;
}

// ---------------------------------------------------------------------------------
// Thin double-sided stair flying from the floor up to the back wall, open beneath.
export function flyingStair(rot, rng, o = {}) {
  const ox = o.ox ?? 0, oy = o.oy ?? 0, X = ox + 1, Y = oy + 1;
  const L = o.L ?? rng.int(8, 24);
  const W = o.W ?? rng.int(4, 5);
  const z0 = o.z0 ?? rng.int(2, LAST - 1 - W);
  const toTop = !!o.toTop;
  if (L < 5 || X + L + 4 > LAST || Y + L + (toTop ? 1 : 4) > LAST || z0 < 1 || z0 + W > LAST) return null;
  const P = new Placement(rot, 'flyingStair');
  for (let z = z0; z < z0 + W; z++) bandCells(P, X, L, z, Y);
  stairRailCells(P, X, L, z0, Y);
  stairRailCells(P, X, L, z0 + W - 1, Y);
  stairHeadroom(P, X, L, z0 + 1, z0 + W - 1, Y);
  P.clearBox(X + L, Y, z0 + 1, X + L + 4, Y + 4, z0 + W - 1);
  if (toTop) {
    P.clearBox(ox - 3, Y + L, z0 + 1, X, Y + L + 4, z0 + W - 1);
    P.needBox(ox - 2, Y + L - 1, z0, X, Y + L, z0 + W);
    P.needBox(ox, Y + L - 3, z0, ox + 1, Y + L, z0 + W);
  } else {
    P.clearBox(X, Y + L, z0 + 1, X + 4, Y + L + 4, z0 + W - 1);
    P.needBox(ox, Y + L - 3, z0, ox + 1, Y + L + 4, z0 + W);
  }
  P.needBox(X + L - 3, oy, z0, X + L + 4, oy + 1, z0 + W);
  P.geom = (s) => {
    s.add(prismGeom(bandStairProfile(L), W), frameAt([X, Y, z0]), MAT.STAIR);
    stairRailGeom(s, X, L, z0 + 0.5, Y);
    stairRailGeom(s, X, L, z0 + W - 0.5, Y);
  };
  const zc = z0 + W / 2;
  if (o.npc !== false && rng.chance(0.45)) P.npc([[X + L + 3, Y, zc], [X + L, Y, zc], [X + 0.9, Y + L - 0.9, zc]], PY);
  return P;
}

// ---------------------------------------------------------------------------------
// A balcony on the back wall reached by a flight running along the wall, built on a
// masonry base with a little door into the "basement" beneath the stairs.
export function balconyFlight(rot, rng, o = {}) {
  const ox = o.ox ?? 0, oy = o.oy ?? 0, X = ox + 1, Y = oy + 1;
  const h = o.h ?? rng.int(6, 14);
  const d = o.d ?? rng.int(4, 6);
  const w = o.w ?? rng.int(5, 9);
  const Ws = o.Ws ?? rng.int(3, 4);
  const lo = 1 + h + 4;
  const hi = LAST - w;
  if (hi < lo || X + d + 3 > LAST || Y + h + 4 > LAST) return null;
  const z1 = o.z1 ?? rng.int(lo, hi);
  const P = new Placement(rot, 'balconyFlight');
  const top = Y + h;   // walking surface of the landing
  P.fill(X, top - 1, z1, X + d, top, z1 + w, SOLID);
  for (let t = 0; t < h; t++) {
    const z = z1 - h + t;
    for (let x = X; x < X + Ws; x++) {
      P.put(x, Y + t, z, W_FLIGHT);
      for (let y = Y; y < Y + t; y++) P.put(x, y, z, SOLID);
    }
    P.put(X + Ws - 1, Y + 1 + t, z, BARRIER);
    P.put(X + Ws - 1, Y + 2 + t, z, BARRIER);
  }
  const fx = X + d - 1;
  for (let z = z1; z < z1 + w; z++) { P.put(fx, top, z, BARRIER); P.put(fx, top + 1, z, BARRIER); }
  for (let x = X; x < fx; x++) { P.put(x, top, z1 + w - 1, BARRIER); P.put(x, top + 1, z1 + w - 1, BARRIER); }
  for (let x = X + Ws; x < fx; x++) { P.put(x, top, z1, BARRIER); P.put(x, top + 1, z1, BARRIER); }

  P.clearBox(X, top, z1, fx, top + 4, z1 + w - 1);
  for (let t = 0; t < h; t++) P.clearBox(X, Y + 1 + t, z1 - h + t, X + Ws - 1, Y + 5 + t, z1 - h + t + 1);
  P.clearBox(X, Y, z1 - h - 4, X + Ws - 1, Y + 4, z1 - h);
  const door = h >= 7;
  const zd = z1 - 2;
  if (door) P.clearBox(X + Ws, Y, zd - 2, X + Ws + 3, Y + 4, zd + 2);
  P.needBox(ox, Y, z1 - h, ox + 1, top + 2, z1 + w);
  P.needBox(X, oy, z1 - h - 4, X + Ws, oy + 1, z1);

  P.geom = (s) => {
    s.add(boxGeom(X, top - 1, z1, X + d, top, z1 + w), IDM, MAT.STONE);
    for (const zc of [z1 + 1, z1 + w - 1]) {
      const g = prismGeom([[0, 0], [0, 2.2], [Math.min(d - 0.5, 2.6), 2.2]], 0.6);
      s.add(g, frameAt([X, top - 1 - 2.2, zc - 0.3]), MAT.TRIM);
    }
    s.add(prismGeom(cornerStairProfile(h), Ws), frameMatrix([0, 0, -1], [0, 1, 0], [1, 0, 0], [X, Y, z1]), MAT.STAIR);
    const front = [];
    for (let z = z1; z < z1 + w; z++) front.push([fx + 0.5, top, z + 0.5]);
    balustrade(s, IDM, front, [0, 1, 0]);
    const far = [];
    for (let x = fx; x >= X; x--) far.push([x + 0.5, top, z1 + w - 0.5]);
    balustrade(s, IDM, far, [0, 1, 0]);
    const near = [];
    for (let x = fx; x >= X + Ws; x--) near.push([x + 0.5, top, z1 + 0.5]);
    if (near.length > 1) balustrade(s, IDM, near, [0, 1, 0]);
    const st = [];
    for (let t = 0; t < h; t++) st.push([X + Ws - 0.5, Y + 0.5 + t, z1 - h + t + 0.5]);
    balustrade(s, IDM, st, [0, 1, 0]);
    if (door) {
      const op = { kind: 'door', base: 'v0', t: zd, w: 2, hs: 2.5 };
      addFaceDoor(s, frameMatrix([0, 0, 1], [0, 1, 0], [1, 0, 0], [X + Ws, oy, 0]), op);
    }
  };
  if (o.npc !== false && rng.chance(0.5)) {
    const x = X + (Ws - 1) / 2;
    P.npc([[x, Y, z1 - h - 3], [x, Y, z1 - h], [x, top, z1], [x, top, z1 + 1.5]], PY);
  }
  if (o.npc !== false && rng.chance(0.55)) {
    P.figures.push({ pos: [fx - 0.75, top, z1 + w / 2], up: PY, face: PX, pose: 'lean' });
  }
  return P;
}

// ---------------------------------------------------------------------------------
// A landing on the back wall, reached by a free double-sided stair from the floor.
export function landingBridge(rot, rng, o = {}) {
  const ox = o.ox ?? 0, oy = o.oy ?? 0, X = ox + 1, Y = oy + 1;
  const h = o.h ?? rng.int(7, 18);
  const d = o.d ?? rng.int(4, 6);
  const w = o.w ?? rng.int(6, 10);
  const Ws = o.Ws ?? rng.int(4, 5);
  if (X + d + h + 4 > LAST || Y + h + 4 > LAST || w < Ws) return null;
  const z1 = o.z1 ?? rng.int(2, LAST - 1 - w);
  const zs = o.zs ?? z1 + rng.int(0, w - Ws);
  if (z1 < 1 || z1 + w > LAST) return null;
  const P = new Placement(rot, 'landingBridge');
  const top = Y + h;
  P.fill(X, top - 1, z1, X + d, top, z1 + w, SOLID);
  const x0 = X + d;
  for (let z = zs; z < zs + Ws; z++) bandCells(P, x0, h, z, Y);
  stairRailCells(P, x0, h, zs, Y);
  stairRailCells(P, x0, h, zs + Ws - 1, Y);
  const fx = X + d - 1;
  for (let z = z1; z < z1 + w; z++) {
    if (z > zs && z < zs + Ws - 1) continue;
    P.put(fx, top, z, BARRIER); P.put(fx, top + 1, z, BARRIER);
  }
  for (let x = X; x < fx; x++) {
    P.put(x, top, z1, BARRIER); P.put(x, top + 1, z1, BARRIER);
    P.put(x, top, z1 + w - 1, BARRIER); P.put(x, top + 1, z1 + w - 1, BARRIER);
  }
  P.clearBox(X, top, z1 + 1, fx, top + 4, z1 + w - 1);
  stairHeadroom(P, x0, h, zs + 1, zs + Ws - 1, Y);
  P.clearBox(x0 + h, Y, zs + 1, x0 + h + 4, Y + 4, zs + Ws - 1);
  P.needBox(ox, top - 3, z1, ox + 1, top + 3, z1 + w);
  P.needBox(x0 + h - 3, oy, zs, x0 + h + 4, oy + 1, zs + Ws);

  P.geom = (s) => {
    s.add(boxGeom(X, top - 1, z1, X + d, top, z1 + w), IDM, MAT.STONE);
    for (const zc of [z1 + 1, z1 + w - 1]) {
      const g = prismGeom([[0, 0], [0, 2.4], [Math.min(d - 0.5, 2.8), 2.4]], 0.6);
      s.add(g, frameAt([X, top - 1 - 2.4, zc - 0.3]), MAT.TRIM);
    }
    s.add(prismGeom(bandStairProfile(h), Ws), frameAt([x0, Y, zs]), MAT.STAIR);
    stairRailGeom(s, x0, h, zs + 0.5, Y);
    stairRailGeom(s, x0, h, zs + Ws - 0.5, Y);
    for (const [a, b] of [[z1, zs + 1], [zs + Ws - 1, z1 + w]]) {
      const pts = [];
      for (let z = a; z < b; z++) pts.push([fx + 0.5, top, z + 0.5]);
      if (pts.length > 1) balustrade(s, IDM, pts, [0, 1, 0]);
    }
    for (const zc of [z1 + 0.5, z1 + w - 0.5]) {
      const pts = [];
      for (let x = fx; x >= X; x--) pts.push([x + 0.5, top, zc]);
      balustrade(s, IDM, pts, [0, 1, 0]);
    }
  };
  const zc = zs + Ws / 2;
  if (o.npc !== false && rng.chance(0.45)) {
    P.npc([[x0 + h + 3, Y, zc], [x0 + h, Y, zc], [x0 + 0.1, top - 0.1, zc], [x0 - 1.5, top, zc]], PY);
  }
  if (o.npc !== false && rng.chance(0.4)) {
    const zl = zs > z1 + 1 ? z1 + 1.5 : z1 + w - 1.5;
    P.figures.push({ pos: [fx - 0.75, top, zl], up: PY, face: PX, pose: 'lean' });
  }
  return P;
}

// ---------------------------------------------------------------------------------
// A balcony on the back wall: a slab with railings on its three free sides.
export function balcony(rot, rng, o = {}) {
  const ox = o.ox ?? 0, oy = o.oy ?? 0, X = ox + 1, Y = oy + 1;
  const h = o.h ?? rng.int(6, 26);
  const d = o.d ?? rng.int(3, 5);
  const w = o.w ?? rng.int(4, 9);
  const z1 = o.z1 ?? rng.int(2, LAST - 1 - w);
  const top = Y + h;
  if (top + 4 > LAST || X + d + 1 > LAST || z1 < 1 || z1 + w > LAST) return null;
  const P = new Placement(rot, 'balcony');
  P.fill(X, top - 1, z1, X + d, top, z1 + w, SOLID);
  const fx = X + d - 1;
  for (let z = z1; z < z1 + w; z++) { P.put(fx, top, z, BARRIER); P.put(fx, top + 1, z, BARRIER); }
  for (let x = X; x < fx; x++) {
    for (const z of [z1, z1 + w - 1]) {
      if (o.gapX && z === z1 && x >= o.gapX[0] && x < o.gapX[1]) continue;
      P.put(x, top, z, BARRIER); P.put(x, top + 1, z, BARRIER);
    }
  }
  P.clearBox(X, top, z1 + 1, fx, top + 4, z1 + w - 1);
  P.needBox(ox, top - 3, z1, ox + 1, top + 3, z1 + w);
  const plantSeed = rng.int(1, 1e9);
  P.geom = (s) => {
    s.add(boxGeom(X, top - 1, z1, X + d, top, z1 + w), IDM, MAT.STONE);
    for (const zc of [z1 + 1, z1 + w - 1]) {
      const g = prismGeom([[0, 0], [0, 2.4], [d - 0.6, 2.4]], 0.6);
      s.add(g, frameAt([X, top - 1 - 2.4, zc - 0.3]), MAT.TRIM);
    }
    const front = [];
    for (let z = z1; z < z1 + w; z++) front.push([fx + 0.5, top, z + 0.5]);
    balustrade(s, IDM, front, [0, 1, 0]);
    for (const zc of [z1 + 0.5, z1 + w - 0.5]) {
      const pts = [];
      for (let x = fx; x >= X; x--) pts.push([x + 0.5, top, zc]);
      balustrade(s, IDM, pts, [0, 1, 0]);
    }
    if (o.plant !== false && w >= 5) {
      s.add(latheGeom(POT, 10), frameAt([X + 0.6, top, z1 + 1.6]), MAT.TRIM);
      buildBush(s, frameAt([X + 0.6, top + 0.85, z1 + 1.6]), new DetailRng(plantSeed), 1.3);
    }
  };
  if (o.lean !== false && rng.chance(0.6)) P.figures.push({ pos: [fx - 0.75, top, z1 + w / 2 + 0.3], up: PY, face: PX, pose: 'lean' });
  return P;
}

// ---------------------------------------------------------------------------------
// A tower of masonry standing on the floor, full height or with a roof one can walk on,
// sometimes pierced by an arched passage. Its faces become new ground for other features.
export function pier(rot, rng, o = {}) {
  const sx = o.sx ?? rng.int(4, 9), sz = o.sz ?? rng.int(4, 9);
  const full = o.full ?? rng.chance(0.4);
  const H = o.H ?? (full ? LAST - 1 : rng.int(8, 24));
  const px = o.x ?? rng.int(5, LAST - 5 - sx), pz = o.z ?? rng.int(5, LAST - 5 - sz);
  if (px < 1 || pz < 1 || px + sx > LAST || pz + sz > LAST || 1 + H > LAST) return null;
  let tunnel = null;
  if ((o.passage ?? rng.chance(0.55)) && H >= 9 && Math.max(sx, sz) >= 5) {
    const alongX = sz >= 5 && (sx < 5 || rng.chance(0.5));
    const span = alongX ? sz : sx;
    const tw = Math.min(4, (span - 2) & ~1);
    if (tw >= 2) {
      const hs = Math.min(H - 2, 7) - tw / 2;
      tunnel = { alongX, t: (alongX ? pz : px) + span / 2, w: tw, hs, len: alongX ? sx : sz };
    }
  }
  const open = (x, y, z) => tunnel && insideArch((tunnel.alongX ? z : x) + 0.5 - tunnel.t, y + 0.5 - 1, tunnel.w, tunnel.hs);
  const P = new Placement(rot, 'pier');
  for (let x = px; x < px + sx; x++) for (let y = 1; y < 1 + H; y++) for (let z = pz; z < pz + sz; z++) {
    if (!open(x, y, z)) P.put(x, y, z, SOLID);
  }
  if (tunnel) {
    const a0 = tunnel.t - tunnel.w / 2, a1 = tunnel.t + tunnel.w / 2;
    if (tunnel.alongX) P.clearBox(px - 4, 1, a0, px + sx + 4, 5, a1);
    else P.clearBox(a0, 1, pz - 4, a1, 5, pz + sz + 4);
  }
  P.needBox(px, 0, pz, px + sx, 1, pz + sz);
  P.meta = { box: [px, 1, pz, px + sx, 1 + H, pz + sz], H, full };
  P.geom = (s) => {
    if (tunnel) {
      // cross-section with the arch, extruded along the passage
      if (tunnel.alongX) {
        const outer = [[pz, 1], [pz + sz, 1], [pz + sz, 1 + H], [pz, 1 + H]];
        const hole = archOutline({ kind: 'arch', base: 'v0', t: tunnel.t, w: tunnel.w, hs: tunnel.hs });
        s.add(prismGeom(outer, sx, [hole]), frameMatrix([0, 0, 1], [0, 1, 0], [-1, 0, 0], [px + sx, 0, 0]), MAT.STONE);
        const band = archBand({ kind: 'arch', base: 'v0', t: tunnel.t, w: tunnel.w, hs: tunnel.hs }, 0, 0.6);
        for (const [x, dir] of [[px, 1], [px + sx, -1]]) {
          const g = prismGeom(band, 0.15);
          s.add(g, frameMatrix([0, 0, 1], [0, 1, 0], [-dir, 0, 0], [x, 0, 0]), MAT.TRIM);
        }
      } else {
        const outer = [[px, 1], [px + sx, 1], [px + sx, 1 + H], [px, 1 + H]];
        const hole = archOutline({ kind: 'arch', base: 'v0', t: tunnel.t, w: tunnel.w, hs: tunnel.hs });
        s.add(prismGeom(outer, sz, [hole]), frameAt([0, 0, pz]), MAT.STONE);
        const band = archBand({ kind: 'arch', base: 'v0', t: tunnel.t, w: tunnel.w, hs: tunnel.hs }, 0, 0.6);
        for (const [z, dir] of [[pz, -1], [pz + sz, 1]]) {
          const g = prismGeom(band, 0.15);
          if (dir < 0) g.translate(0, 0, -0.15);
          s.add(g, frameAt([0, 0, z]), MAT.TRIM);
        }
      }
    } else {
      s.add(boxGeom(px, 1, pz, px + sx, 1 + H, pz + sz), IDM, MAT.STONE);
      s.add(boxGeom(px - 0.22, 1, pz - 0.22, px + sx + 0.22, 1.8, pz + sz + 0.22), IDM, MAT.TRIM);
    }
    if (!full) {
      // Stop short of the roof. Flush with the stone, this coping redraws the whole
      // top, and stone and trim hatch differently, so the surface flickers.
      const roof = 1 + H;
      s.add(boxGeom(px - 0.3, roof - 0.45, pz - 0.3, px + sx + 0.3, roof - 0.08, pz + sz + 0.3), IDM, MAT.TRIM);
    }
    // string courses on the tall ones
    for (let y = 13; y < H - 2; y += 13) {
      s.add(boxGeom(px - 0.16, y, pz - 0.16, px + sx + 0.16, y + 0.45, pz + sz + 0.16), IDM, MAT.TRIM);
    }
  };
  return P;
}

// ---------------------------------------------------------------------------------
// A bridge spanning the hall from the back wall to the front wall.
export function gallery(rot, rng, o = {}) {
  const h = o.h ?? rng.int(8, 30);
  const w = o.w ?? rng.int(4, 6);
  const z0 = o.z0 ?? rng.int(2, LAST - 1 - w);
  if (h + 5 > LAST || z0 < 1 || z0 + w > LAST) return null;
  const P = new Placement(rot, 'gallery');
  P.fill(1, h - 1, z0, LAST, h + 1, z0 + w, SOLID);
  for (let x = 1; x < LAST; x++) {
    for (const z of [z0, z0 + w - 1]) { P.put(x, h + 1, z, BARRIER); P.put(x, h + 2, z, BARRIER); }
  }
  P.clearBox(1, h + 1, z0 + 1, LAST, h + 5, z0 + w - 1);
  P.needBox(0, h - 1, z0, 1, h + 1, z0 + w);
  P.needBox(LAST, h - 1, z0, HALL, h + 1, z0 + w);
  P.geom = (s) => {
    s.add(boxGeom(1, h - 1, z0, LAST, h + 1, z0 + w), IDM, MAT.STONE);
    // corbels where the span meets the walls
    for (const zc of [z0 + 1, z0 + w - 1]) {
      s.add(prismGeom([[0, 0], [0, 2.2], [2.2, 2.2]], 0.6), frameAt([1, h - 1 - 2.2, zc - 0.3]), MAT.TRIM);
      s.add(prismGeom([[0, 0], [0, 2.2], [-2.2, 2.2]], 0.6), frameAt([LAST, h - 1 - 2.2, zc - 0.3]), MAT.TRIM);
    }
    for (const zc of [z0 + 0.5, z0 + w - 0.5]) {
      const pts = [];
      for (let x = 1; x < LAST; x += 1) pts.push([x + 0.5, h + 1, zc]);
      balustrade(s, IDM, pts, [0, 1, 0]);
    }
  };
  if (o.npc !== false && rng.chance(0.6)) P.npc([[4, h + 1, z0 + w / 2], [LAST - 4, h + 1, z0 + w / 2]], PY);
  if (o.npc !== false && rng.chance(0.5)) {
    P.figures.push({ pos: [rng.int(6, LAST - 6) + 0.5, h + 1, z0 + 1.75], up: PY, face: NZ, pose: 'lean' });
  }
  return P;
}

// ---------------------------------------------------------------------------------
// A round column from floor to ceiling.
export function column(rot, rng, o = {}) {
  const oy = o.oy ?? 0, Y = oy + 1;
  const x0 = o.x ?? rng.int(3, LAST - 4);
  const z0 = o.z ?? rng.int(3, LAST - 4);
  const P = new Placement(rot, 'column');
  P.fill(x0, Y, z0, x0 + 2, LAST, z0 + 2, SOLID_NT);
  P.needBox(x0, oy, z0, x0 + 2, oy + 1, z0 + 2);
  P.needBox(x0, LAST, z0, x0 + 2, HALL, z0 + 2);
  P.geom = (s) => {
    s.add(cylinderGeom([x0 + 1, Y + 0.6, z0 + 1], [x0 + 1, LAST - 1.2, z0 + 1], 0.86, 0.8, 16, false), IDM, MAT.STONE);
    s.add(boxGeom(x0 - 0.15, Y, z0 - 0.15, x0 + 2.15, Y + 0.6, z0 + 2.15), IDM, MAT.TRIM);
    s.add(cylinderGeom([x0 + 1, Y + 0.6, z0 + 1], [x0 + 1, Y + 1.0, z0 + 1], 1.0, 0.9, 16), IDM, MAT.TRIM);
    s.add(cylinderGeom([x0 + 1, LAST - 1.7, z0 + 1], [x0 + 1, LAST - 1.2, z0 + 1], 0.85, 1.0, 16), IDM, MAT.TRIM);
    s.add(boxGeom(x0 - 0.2, LAST - 1.2, z0 - 0.2, x0 + 2.2, LAST, z0 + 2.2), IDM, MAT.TRIM);
  };
  return P;
}

// ---------------------------------------------------------------------------------
// A free-standing arcade on the floor: a wall two voxels thick, pierced by a row of
// arches, sometimes reaching the ceiling. Both of its faces are floors for somebody.
export function arcadeWall(rot, rng, o = {}) {
  const xp = o.x ?? rng.int(8, LAST - 10);
  const z0 = o.z0 ?? rng.int(2, 10);
  const zEnd = o.zEnd ?? Math.min(LAST - 1, z0 + rng.int(14, 30));
  const H = o.H ?? (rng.chance(0.35) ? LAST - 1 : rng.int(14, 26));   // cells y in [1, 1 + H)
  const wA = o.archW ?? rng.pick([4, 6]);
  const hs = o.archH ?? Math.min(rng.int(6, 10), H - wA / 2 - 3);
  const gap = wA + rng.int(2, 4);
  const arches = [];
  for (let t = z0 + 2 + wA / 2; t + wA / 2 <= zEnd - 2; t += gap) arches.push({ kind: 'arch', base: 'v0', t, w: wA, hs });
  if (!arches.length || hs < 4) return null;
  const P = new Placement(rot, 'arcadeWall');
  const open = (z, y) => arches.some((a) => insideArch(z + 0.5 - a.t, y + 0.5 - 1, a.w, a.hs));
  for (let x = xp; x < xp + 2; x++) {
    for (let y = 1; y < 1 + H; y++) for (let z = z0; z < zEnd; z++) if (!open(z, y)) P.put(x, y, z, SOLID);
  }
  for (const a of arches) {
    P.clearBox(xp - 4, 1, a.t - a.w / 2, xp, 6, a.t + a.w / 2);
    P.clearBox(xp + 2, 1, a.t - a.w / 2, xp + 6, 6, a.t + a.w / 2);
  }
  P.needBox(xp, 0, z0, xp + 2, 1, zEnd);
  P.meta = { box: [xp, 1, z0, xp + 2, 1 + H, zEnd], H, full: H >= LAST - 1 };
  P.geom = (s) => {
    const outer = [[z0, 1], [zEnd, 1], [zEnd, 1 + H], [z0, 1 + H]];
    const M = frameMatrix([0, 0, 1], [0, 1, 0], [-1, 0, 0], [xp + 2, 0, 0]);
    s.add(prismGeom(outer, 2, arches.map((a) => archOutline(a))), M, MAT.STONE);
    for (const a of arches) {
      const band = archBand(a, 0, 0.7);
      const g1 = prismGeom(band, 0.16); g1.translate(0, 0, -0.16);
      s.add(g1, M, MAT.TRIM);
      const g2 = prismGeom(band, 0.16); g2.translate(0, 0, 2);
      s.add(g2, M, MAT.TRIM);
    }
    if (H < LAST - 1) {
      // Below the walking surface, same as a pier coping. Flush trim reprints the top.
      const roof = 1 + H;
      s.add(boxGeom(xp - 0.25, roof - 0.4, z0 - 0.25, xp + 2.25, roof - 0.08, zEnd + 0.25), IDM, MAT.TRIM);
    }
  };
  return P;
}

// ---------------------------------------------------------------------------------
// A raised garden bed with trees and shrubs. Every gravity gets its own park.
export function garden(rot, rng, o = {}) {
  const oy = o.oy ?? 0, Y = oy + 1;
  const sx = o.sx ?? rng.int(6, 14);
  const sz = o.sz ?? rng.int(6, 14);
  const x0 = o.x ?? rng.int(2, LAST - 1 - sx);
  const z0 = o.z ?? rng.int(2, LAST - 1 - sz);
  if (x0 < 1 || z0 < 1 || x0 + sx > LAST || z0 + sz > LAST || Y + 6 > LAST) return null;
  const P = new Placement(rot, 'garden');
  P.fill(x0, Y, z0, x0 + sx, Y + 1, z0 + sz, SOLID);
  P.needBox(x0, oy, z0, x0 + sx, oy + 1, z0 + sz);
  const trees = [];
  const nt = o.trees ?? rng.int(1, 3);
  for (let i = 0; i < nt; i++) {
    const tx = rng.int(x0 + 1, x0 + sx - 2), tz = rng.int(z0 + 1, z0 + sz - 2);
    const H = Math.min(o.treeH ?? rng.range(9, 15), LAST - Y - 4);
    const trunk = Math.floor(H * 0.45);
    trees.push({ tx, tz, H, seed: rng.int(1, 1e9) });
    for (let y = Y + 1; y < Y + 1 + trunk; y++) P.put(tx, y, tz, SOLID_NT);
    P.clearBox(tx - 3, Y + trunk, tz - 3, tx + 4, Math.ceil(Y + 1 + H + 2), tz + 4);
  }
  const bushes = [];
  const nb = o.bushes ?? rng.int(2, 5);
  for (let i = 0; i < nb; i++) {
    bushes.push({ x: rng.range(x0 + 1, x0 + sx - 1), z: rng.range(z0 + 1, z0 + sz - 1), r: rng.range(0.9, 1.6), seed: rng.int(1, 1e9) });
  }
  P.geom = (s) => {
    s.add(boxGeom(x0, Y, z0, x0 + sx, Y + 0.85, z0 + sz), IDM, MAT.TRIM);
    s.add(boxGeom(x0 + 0.25, Y + 0.85, z0 + 0.25, x0 + sx - 0.25, Y + 1, z0 + sz - 0.25), IDM, MAT.SOIL);
    for (const t of trees) buildTree(s, frameAt([t.tx + 0.5, Y + 1, t.tz + 0.5]), new DetailRng(t.seed), t.H);
    for (const b of bushes) buildBush(s, frameAt([b.x, Y + 1, b.z]), new DetailRng(b.seed), b.r * 2);
  };
  if (o.npc !== false && rng.chance(0.5) && z0 - 1.5 > 2) {
    P.npc([[x0 + 0.5, Y, z0 - 1.5], [x0 + sx - 0.5, Y, z0 - 1.5]], PY);
  }
  if (o.npc !== false && rng.chance(0.45)) {
    P.figures.push({ pos: [x0 + rng.int(1, sx - 2) + 0.5, Y + 1, z0 + sz - 1.5], up: PY, face: rng.pick(HORIZ), pose: 'stand' });
  }
  return P;
}

// ---------------------------------------------------------------------------------
// Small things on a floor: urns, potted plants, stone balls, statues, benches.
const URN = [[0, 0], [0.34, 0], [0.34, 0.1], [0.2, 0.2], [0.24, 0.32], [0.46, 0.62], [0.5, 0.82], [0.42, 1.02], [0.24, 1.16], [0.2, 1.26], [0.31, 1.36], [0.31, 1.44], [0, 1.44]];
const POT = [[0, 0], [0.28, 0], [0.4, 0.7], [0.46, 0.74], [0.46, 0.86], [0, 0.86]];

export function ornament(rot, rng, o = {}) {
  const kind = o.kind ?? rng.weighted([['urn', 3], ['plant', 3], ['ball', 2], ['statue', 1.5], ['bench', 2.5]]);
  const ox = o.ox ?? 0, oy = o.oy ?? 0, X = ox + 1, Y = oy + 1;
  const P = new Placement(rot, kind);
  if (kind === 'bench') {
    const len = o.len ?? rng.int(3, 5);
    const z = o.z ?? rng.int(2, LAST - 1 - len);
    if (z < 1 || z + len > LAST) return null;
    P.fill(X, Y, z, X + 1, Y + 1, z + len, SOLID);
    P.needBox(ox, Y, z, ox + 1, Y + 2, z + len);
    P.needBox(X, oy, z, X + 1, oy + 1, z + len);
    P.clearBox(X + 1, Y, z, X + 4, Y + 4, z + len);
    P.geom = (s) => {
      s.add(boxGeom(X, Y + 0.6, z + 0.05, X + 1.05, Y + 1, z + len - 0.05), IDM, MAT.TRIM);
      for (const zz of [z + 0.35, z + len - 0.85]) s.add(boxGeom(X + 0.15, Y, zz, X + 0.85, Y + 0.6, zz + 0.5), IDM, MAT.TRIM);
    };
    if (rng.chance(0.65) && o.sitter !== false) P.figures.push({ pos: [X + 0.6, Y, z + len / 2], up: PY, face: PX, pose: rng.chance(0.5) ? 'read' : 'sit' });
    return P;
  }
  const x = o.x ?? rng.int(2, LAST - 3), z = o.z ?? rng.int(2, LAST - 3);
  if (kind === 'statue') {
    if (x + 2 > LAST || z + 2 > LAST || Y + 8 > LAST) return null;
    P.fill(x, Y, z, x + 2, Y + 2, z + 2, SOLID_NT);
    P.needBox(x, oy, z, x + 2, oy + 1, z + 2);
    P.clearBox(x - 1, Y + 2, z - 1, x + 3, Y + 6, z + 3);
    P.geom = (s) => {
      s.add(boxGeom(x - 0.1, Y, z - 0.1, x + 2.1, Y + 0.4, z + 2.1), IDM, MAT.TRIM);
      s.add(boxGeom(x + 0.1, Y + 0.4, z + 0.1, x + 1.9, Y + 1.7, z + 1.9), IDM, MAT.STONE);
      s.add(boxGeom(x - 0.05, Y + 1.7, z - 0.05, x + 2.05, Y + 2, z + 2.05), IDM, MAT.TRIM);
    };
    P.figures.push({ pos: [x + 1, Y + 2, z + 1], up: PY, face: rng.pick(HORIZ), pose: rng.pick(['stand', 'walk', 'carry']), phase: rng.range(0, 6), mat: MAT.TRIM });
    return P;
  }
  // urn, plant and ball stand on one voxel
  const tall = kind === 'plant' ? 1 : 2;
  P.fill(x, Y, z, x + 1, Y + tall, z + 1, SOLID_NT);
  P.needBox(x, oy, z, x + 1, oy + 1, z + 1);
  P.clearBox(x - 1, Y, z - 1, x + 2, Y + tall + 2, z + 2);
  const seed = rng.int(1, 1e9);
  P.geom = (s) => {
    if (kind === 'plant') {
      s.add(latheGeom(POT, 10), frameAt([x + 0.5, Y, z + 0.5]), MAT.TRIM);
      buildBush(s, frameAt([x + 0.5, Y + 0.86, z + 0.5]), new DetailRng(seed), 1.5);
      return;
    }
    s.add(boxGeom(x + 0.12, Y, z + 0.12, x + 0.88, Y + 0.25, z + 0.88), IDM, MAT.TRIM);
    s.add(boxGeom(x + 0.2, Y + 0.25, z + 0.2, x + 0.8, Y + 1.65, z + 0.8), IDM, MAT.STONE);
    s.add(boxGeom(x + 0.1, Y + 1.65, z + 0.1, x + 0.9, Y + 1.85, z + 0.9), IDM, MAT.TRIM);
    if (kind === 'urn') s.add(latheGeom(URN, 12), frameAt([x + 0.5, Y + 1.85, z + 0.5]), MAT.TRIM);
    else s.add(blobGeom([x + 0.5, Y + 2.4, z + 0.5], 0.55, null, 2), IDM, MAT.STONE);
  };
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

export { POT, URN };
