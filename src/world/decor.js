// Ornament on the hall walls: pilasters, string courses, blind niches with urns,
// lanterns beside doorways and medallions. Every piece hugs the stone and is checked
// against the hall's voxels first, so none of it sits inside a staircase or across an
// opening. Each wall is a floor for somebody else, so the ornament is oriented to one of
// the floors that meet the wall.
//
// All positions are drawn from the hall's RNG whether or not geometry is being built,
// so the voxel world is the same with and without rendering.

import * as THREE from '../../vendor/three/three.module.min.js';
import { HALL, AIR, SOLID, MAT } from '../core/constants.js';
import { boundingWalls } from './walls.js';
import { boxGeom, prismGeom, cylinderGeom, latheGeom } from './geometry.js';
import { archOutline, archBand, fromLocal } from './openings.js';
import { idx } from './placement.js';
import { URN } from './features.js';

const EDGES = ['u0', 'u1', 'v0', 'v1'];

export function decorateWalls(ctx, rng, density = 1, { pilasters = true, courses = true } = {}) {
  const { grid, hx, hy, hz } = ctx;
  const origin = [HALL * hx, HALL * hy, HALL * hz];
  const walls = boundingWalls(hx, hy, hz);
  const has = {};
  for (const w of walls) has[`${w.a}${w.side}`] = !!w.spec;

  for (const { a, side, spec } of walls) {
    if (!spec) continue;
    const b = (a + 1) % 3, c = (a + 2) % 3;
    const wl = side === 0 ? 0 : HALL - 1;
    const il = side === 0 ? 1 : HALL - 2;
    const out = side === 0 ? 1 : -1;
    const used = new Uint8Array(HALL * HALL);
    const p = [0, 0, 0];
    const free = (u, v) => {
      if (u < 1 || v < 1 || u >= HALL - 1 || v >= HALL - 1) return false;
      p[a] = wl; p[b] = u; p[c] = v;
      if (grid[idx(p[0], p[1], p[2])] !== SOLID) return false;
      p[a] = il;
      return grid[idx(p[0], p[1], p[2])] === AIR && !used[u + HALL * v];
    };
    // (along, height) on this wall, measured from the floor that meets it along `edge`
    const cell = (edge, al, ht) => fromLocal(edge, al + 0.5, ht + 0.5).map(Math.floor);
    const okLocal = (edge, al, ht) => { const [u, v] = cell(edge, al, ht); return free(u, v); };
    const mark = (edge, al, ht) => { const [u, v] = cell(edge, al, ht); used[u + HALL * v] = 1; };
    const floors = EDGES.filter((e) => has[`${e[0] === 'u' ? b : c}${e[1]}`]);
    if (!floors.length) continue;

    // Wall frame: (u, v) in the wall plane, w measured out of the stone into the hall.
    const M = new THREE.Matrix4();
    const eb = [0, 0, 0]; eb[b] = 1;
    const ec = [0, 0, 0]; ec[c] = 1;
    const ea = [0, 0, 0]; ea[a] = out;
    const t = origin.slice(); t[a] += side === 0 ? 1 : HALL - 1;
    M.set(eb[0], ec[0], ea[0], t[0], eb[1], ec[1], ea[1], t[1], eb[2], ec[2], ea[2], t[2], 0, 0, 0, 1);
    const pieces = [];
    // a box given in (along, height, w) for a floor edge
    const lbox = (edge, a0, a1, h0, h1, w0, w1, mat) => {
      const p0 = fromLocal(edge, a0, h0), p1 = fromLocal(edge, a1, h1);
      pieces.push(['box', Math.min(p0[0], p1[0]), Math.min(p0[1], p1[1]), w0, Math.max(p0[0], p1[0]), Math.max(p0[1], p1[1]), w1, mat]);
    };

    // -- pilasters, from a floor up the wall
    if (rng.chance(0.55 * density) && pilasters) {
      const edge = rng.pick(floors);
      const gap = rng.int(7, 10);
      for (let al = 3 + rng.int(0, 3); al + 2 < HALL - 2; al += gap) {
        let len = 0;
        while (len < HALL - 2 && [al - 1, al, al + 1, al + 2].every((x) => okLocal(edge, x, len))) len++;
        if (len < 10) continue;
        for (let h = 0; h < len; h++) { mark(edge, al, h); mark(edge, al + 1, h); }
        lbox(edge, al + 0.2, al + 1.8, 0.6, len - 0.6, 0, 0.2, MAT.STONE);
        lbox(edge, al - 0.05, al + 2.05, 0, 0.6, 0, 0.34, MAT.TRIM);
        lbox(edge, al - 0.1, al + 2.1, len - 0.6, len, 0, 0.38, MAT.TRIM);
      }
    }
    // -- string courses at two heights
    if (rng.chance(0.6 * density) && courses) {
      const edge = rng.pick(floors);
      for (const ht of [12, 25]) {
        let start = -1;
        for (let al = 1; al <= HALL - 1; al++) {
          const ok = al < HALL - 1 && okLocal(edge, al, ht);
          if (ok && start < 0) start = al;
          if (!ok && start >= 0) {
            if (al - start >= 3) lbox(edge, start, al, ht + 0.2, ht + 0.65, 0, 0.22, MAT.TRIM);
            start = -1;
          }
        }
      }
    }
    // -- blind niches, some holding an urn
    const nNiche = rng.int(0, Math.round(3 * density));
    for (let k = 0; k < nNiche; k++) {
      const edge = rng.pick(floors);
      const al = rng.int(3, HALL - 8);
      const h0 = rng.chance(0.4) ? 0 : rng.int(6, 22);
      let ok = true;
      for (let x = al - 1; x < al + 5 && ok; x++) for (let h = h0; h < h0 + 7 && ok; h++) ok = okLocal(edge, x, h);
      if (!ok) continue;
      for (let x = al; x < al + 4; x++) for (let h = h0; h < h0 + 6; h++) mark(edge, x, h);
      const op = { kind: 'arch', base: edge, t: al + 2, w: 3, hs: 3.4, sill: h0 + 0.6 };
      pieces.push(['prism', archOutline(op), 0, 0.05, MAT.DARK]);
      pieces.push(['prism', archBand(op, 0, 0.45), 0, 0.16, MAT.TRIM]);
      lbox(edge, al + 0.3, al + 3.7, h0 + 0.3, h0 + 0.6, 0, 0.55, MAT.TRIM);
      if (rng.chance(0.7)) pieces.push(['urn', edge, al + 2, h0 + 0.6, 0.3]);
    }
    // -- lanterns either side of doorways
    for (const op of spec.openings) {
      if (op.kind !== 'arch' || (op.sill || 0) > 0 || !rng.chance(0.65 * density)) continue;
      const ht = Math.min(op.hs, 6.5) - 1;
      for (const al of [op.t - op.w / 2 - 1.5, op.t + op.w / 2 + 0.5]) {
        const A = Math.floor(al);
        if (!okLocal(op.base, A, Math.floor(ht)) || !okLocal(op.base, A, Math.floor(ht) + 1)) continue;
        mark(op.base, A, Math.floor(ht));
        pieces.push(['lantern', op.base, A + 0.5, ht]);
      }
    }
    // -- medallions
    if (rng.chance(0.35 * density)) {
      const edge = rng.pick(floors);
      for (let k = 0; k < 2; k++) {
        const al = rng.int(4, HALL - 6), ht = rng.int(8, 28);
        let ok = true;
        for (let x = al - 1; x <= al + 2 && ok; x++) for (let h = ht - 1; h <= ht + 2 && ok; h++) ok = okLocal(edge, x, h);
        if (!ok) continue;
        for (let x = al - 1; x <= al + 2; x++) for (let h = ht - 1; h <= ht + 2; h++) mark(edge, x, h);
        pieces.push(['medal', edge, al + 1, ht + 1]);
      }
    }

    if (!ctx.sink) continue;
    for (const pc of pieces) buildPiece(ctx.sink, M, pc);
  }
}

// Unit vector (in wall frame u, v) pointing "up" from a floor edge, and "along" it.
function edgeAxes(edge) {
  const up = { u0: [1, 0], u1: [-1, 0], v0: [0, 1], v1: [0, -1] }[edge];
  const along = edge[0] === 'u' ? [0, 1] : [1, 0];
  return { up, along };
}

const _m = new THREE.Matrix4();
function localFrame(M, edge, al, ht, w) {
  // Matrix taking a piece built with +Y up, +X along and +Z out of the wall to its place.
  const { up, along } = edgeAxes(edge);
  const [u, v] = fromLocal(edge, al, ht);
  const L = new THREE.Matrix4().set(
    along[0], up[0], 0, u,
    along[1], up[1], 0, v,
    0, 0, 1, w,
    0, 0, 0, 1,
  );
  return _m.multiplyMatrices(M, L).clone();
}

function buildPiece(sink, M, pc) {
  const kind = pc[0];
  if (kind === 'box') {
    const [, u0, v0, w0, u1, v1, w1, mat] = pc;
    sink.add(boxGeom(u0, v0, w0, u1, v1, w1), M, mat);
  } else if (kind === 'prism') {
    const [, pts, w0, w1, mat] = pc;
    const g = prismGeom(pts, w1 - w0);
    g.translate(0, 0, w0);
    sink.add(g, M, mat);
  } else if (kind === 'urn') {
    const [, edge, al, ht, w] = pc;
    sink.add(latheGeom(URN, 10).scale(0.85, 0.85, 0.85), localFrame(M, edge, al, ht, w), MAT.TRIM);
  } else if (kind === 'lantern') {
    const [, edge, al, ht] = pc;
    const F = localFrame(M, edge, al, ht, 0);
    sink.add(boxGeom(-0.08, 0.35, 0, 0.08, 0.5, 0.75), F, MAT.IRON);
    sink.add(boxGeom(-0.24, -0.35, 0.55, 0.24, 0.3, 1.03), F, MAT.DARK);
    sink.add(cylinderGeom([0, 0.3, 0.79], [0, 0.62, 0.79], 0.36, 0.02, 4), F, MAT.IRON);
    sink.add(boxGeom(-0.28, -0.42, 0.51, 0.28, -0.35, 1.07), F, MAT.IRON);
  } else if (kind === 'medal') {
    const [, edge, al, ht] = pc;
    const F = localFrame(M, edge, al, ht, 0);
    sink.add(cylinderGeom([0, 0, 0], [0, 0, 0.14], 1.25, 1.25, 20), F, MAT.TRIM);
    sink.add(cylinderGeom([0, 0, 0.14], [0, 0, 0.24], 0.85, 0.85, 20), F, MAT.STONE);
  }
}
