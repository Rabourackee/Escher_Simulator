// Geometry helpers. Everything a hall contains is merged into one non-indexed buffer
// (position, normal, per-vertex material id), so a hall is a single draw call.
// These run inside the generation worker as well as on the main thread.

import * as THREE from '../../vendor/three/three.module.min.js';
import { HALL, MAT } from '../core/constants.js';
import { archOutline, archBand, circleOutline, fromLocal } from './openings.js';

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();

export class MeshSink {
  constructor() {
    this.cap = 1 << 14;
    this.pos = new Float32Array(this.cap * 3);
    this.nor = new Float32Array(this.cap * 3);
    this.mat = new Float32Array(this.cap);
    this.n = 0;
  }

  reserve(extra) {
    if (this.n + extra <= this.cap) return;
    let cap = this.cap;
    while (cap < this.n + extra) cap *= 2;
    const pos = new Float32Array(cap * 3); pos.set(this.pos);
    const nor = new Float32Array(cap * 3); nor.set(this.nor);
    const mat = new Float32Array(cap); mat.set(this.mat);
    this.pos = pos; this.nor = nor; this.mat = mat; this.cap = cap;
  }

  add(geometry, matrix, mat) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position.array;
    const nn = g.attributes.normal.array;
    const count = p.length / 3;
    this.reserve(count);
    _nm.getNormalMatrix(matrix);
    const flipWinding = matrix.determinant() < 0;
    for (let i = 0; i < count; i++) {
      // Mirror transforms reverse triangle winding; swap two corners to keep faces outward.
      let src = i;
      if (flipWinding) { const r = i % 3; if (r === 1) src = i + 1; else if (r === 2) src = i - 1; }
      _v.set(p[src * 3], p[src * 3 + 1], p[src * 3 + 2]).applyMatrix4(matrix);
      _n.set(nn[src * 3], nn[src * 3 + 1], nn[src * 3 + 2]).applyMatrix3(_nm).normalize();
      const o = this.n * 3;
      this.pos[o] = _v.x; this.pos[o + 1] = _v.y; this.pos[o + 2] = _v.z;
      this.nor[o] = _n.x; this.nor[o + 1] = _n.y; this.nor[o + 2] = _n.z;
      this.mat[this.n] = mat;
      this.n++;
    }
    if (g !== geometry) g.dispose();
  }

  finish() {
    return {
      position: this.pos.slice(0, this.n * 3),
      normal: this.nor.slice(0, this.n * 3),
      mat: this.mat.slice(0, this.n),
    };
  }
}

// ---------- primitive builders (all return non-indexed BufferGeometry) ----------

export function boxGeom(x0, y0, z0, x1, y1, z1) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

// Extrude a closed 2D polygon (list of [x, y]) along +z by `depth`.
export function prismGeom(points, depth, holes = []) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1, steps: 1 });
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

// A square-section beam between two points.
export function beamGeom(A, B, w, h = w) {
  _a.set(...A); _b.set(...B);
  _d.subVectors(_b, _a);
  const len = _d.length();
  const g = new THREE.BoxGeometry(w, len, h);
  _q.setFromUnitVectors(_up, _d.normalize());
  g.applyQuaternion(_q);
  g.translate((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2);
  return g;
}

export function cylinderGeom(A, B, r0, r1, segs = 8, caps = true) {
  _a.set(...A); _b.set(...B);
  _d.subVectors(_b, _a);
  const len = _d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, segs, 1, !caps);
  _q.setFromUnitVectors(_up, _d.normalize());
  g.applyQuaternion(_q);
  g.translate((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2);
  return g;
}

export function blobGeom(c, r, rng, detail = 1) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const s = 0.82 + 0.3 * rng.next();
    p.setXYZ(i, p.getX(i) * s, p.getY(i) * (0.8 + 0.25 * rng.next()), p.getZ(i) * s);
  }
  g.computeVertexNormals();
  g.translate(c[0], c[1], c[2]);
  return g;
}

// Matrix that maps a 2D profile (x = p, y = q) extruded along z onto three chosen axes:
// p runs along `pAxis`, q along `qAxis`, the extrusion along `wAxis`, starting at `origin`.
// Axes are given as signed unit vectors.
export function frameMatrix(pVec, qVec, wVec, origin) {
  return new THREE.Matrix4().set(
    pVec[0], qVec[0], wVec[0], origin[0],
    pVec[1], qVec[1], wVec[1], origin[1],
    pVec[2], qVec[2], wVec[2], origin[2],
    0, 0, 0, 1,
  );
}

export const IDM = new THREE.Matrix4();

// ---------- stairs ----------
// Zigzag stair profile in a (run, rise) plane: the 45 degree line run + rise = L runs
// from (L, 0) on the floor to (0, L) at the wall, with two steps per voxel centred on it.
// `shift` moves the line (used for the stepped underside of free-standing stairs).
export function zigzag(L, shift = 0, steps = 2) {
  const s = 1 / steps;
  const pts = [];
  const top = L + shift;
  for (let i = 0; ; i++) {
    const u = top - s / 2 - i * s;
    const v0 = i * s, v1 = (i + 1) * s;
    if (u <= 0) break;
    pts.push([u, v0]);
    pts.push([u, v1]);
    if (u - s <= 0) { pts.push([0, v1]); break; }
  }
  return pts;
}

// Solid corner stair profile: the triangle under the zigzag.
export function cornerStairProfile(L) {
  const z = zigzag(L);
  const end = z[z.length - 1];
  return [[0, 0], ...z, [0, end[1]]].filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
}

// A free-standing stair band two voxels thick (measured vertically), stepped on both sides.
export function bandStairProfile(L) {
  const top = zigzag(L);
  const bottom = zigzag(L, -2);
  const pts = [...top];
  const tEnd = top[top.length - 1];
  const bEnd = bottom[bottom.length - 1];
  if (tEnd[0] !== 0) pts.push([0, tEnd[1]]);
  if (bEnd[0] !== 0) pts.push([0, bEnd[1]]); else pts.push(bEnd);
  for (let i = bottom.length - 2; i >= 0; i--) pts.push(bottom[i]);
  return dedupe(pts);
}

function dedupe(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > 1e-6 || Math.abs(q[1] - p[1]) > 1e-6) out.push(p);
  }
  const f = out[0], l = out[out.length - 1];
  if (out.length > 1 && Math.abs(f[0] - l[0]) < 1e-6 && Math.abs(f[1] - l[1]) < 1e-6) out.pop();
  return out;
}

// Balustrade: posts at the given base points (along the local up vector) and a
// handrail joining their tops, like the plain railings in Relativity.
export function balustrade(sink, matrix, bases, up, height = 2.0) {
  const tops = bases.map((b) => [b[0] + up[0] * height, b[1] + up[1] * height, b[2] + up[2] * height]);
  for (let i = 0; i < bases.length; i++) {
    sink.add(beamGeom(bases[i], tops[i], 0.13), matrix, MAT.TRIM);
  }
  if (tops.length > 1) {
    // one straight rail over the whole run (railings here are always straight)
    sink.add(beamGeom(tops[0], tops[tops.length - 1], 0.2, 0.14), matrix, MAT.TRIM);
  }
}

// ---------- walls ----------
export function wallMatrix(spec) {
  const a = spec.axis, b = (a + 1) % 3, c = (a + 2) % 3;
  const e = (ax) => { const v = [0, 0, 0]; v[ax] = 1; return v; };
  const o = [0, 0, 0];
  o[a] = HALL * spec.h[a] - 1;
  o[b] = HALL * spec.h[b];
  o[c] = HALL * spec.h[c];
  return frameMatrix(e(b), e(c), e(a), o);
}

export function buildWall(spec, sink) {
  const M = wallMatrix(spec);
  const outer = [[-1, -1], [HALL + 1, -1], [HALL + 1, HALL + 1], [-1, HALL + 1]];
  const holes = [];
  for (const op of spec.openings) {
    if (op.kind === 'arch' || op.kind === 'window') holes.push(archOutline(op));
    else if (op.kind === 'round') holes.push(circleOutline(op));
  }
  sink.add(prismGeom(outer, 2, holes), M, spec.material ?? MAT.STONE);

  for (const op of spec.openings) {
    if (op.kind === 'arch') {
      const band = archBand(op, 0, op.w >= 10 ? 1.1 : 0.7);
      addBothFaces(sink, M, band, 0.16, MAT.TRIM);
    } else if (op.kind === 'round') {
      const ring = circleOutline(op, 0.8);
      const hole = circleOutline(op, 0).reverse();
      for (const [z0, d] of [[-0.16, 0.16], [2, 0.16]]) {
        const g = prismGeom(ring, d, [hole]);
        g.translate(0, 0, z0);
        sink.add(g, M, MAT.TRIM);
      }
    } else if (op.kind === 'window') {
      addBars(sink, M, op);
      addBothFaces(sink, M, archBand(op, 0, 0.45), 0.12, MAT.TRIM);
    } else if (op.kind === 'door') {
      addDoor(sink, M, op);
    }
  }
}

function addBothFaces(sink, M, poly, depth, mat) {
  const g1 = prismGeom(poly, depth); g1.translate(0, 0, -depth);
  sink.add(g1, M, mat);
  const g2 = prismGeom(poly, depth); g2.translate(0, 0, 2);
  sink.add(g2, M, mat);
}

function addBars(sink, M, op) {
  const s = op.sill || 0;
  const n = Math.max(1, Math.round(op.w / 0.7) - 1);
  for (let i = 1; i <= n; i++) {
    const a = op.t - op.w / 2 + (op.w * i) / (n + 1);
    const dx = a - op.t;
    const r = op.w / 2;
    const topH = s + op.hs + Math.sqrt(Math.max(0, r * r - dx * dx));
    const p0 = fromLocal(op.base, a, s);
    const p1 = fromLocal(op.base, a, topH);
    sink.add(cylinderGeom([p0[0], p0[1], 1], [p1[0], p1[1], 1], 0.07, 0.07, 5), M, MAT.IRON);
  }
  const hMid = s + op.hs * 0.55;
  const q0 = fromLocal(op.base, op.t - op.w / 2, hMid), q1 = fromLocal(op.base, op.t + op.w / 2, hMid);
  sink.add(cylinderGeom([q0[0], q0[1], 1], [q1[0], q1[1], 1], 0.06, 0.06, 5), M, MAT.IRON);
}

export function addDoor(sink, M, op) {
  const leaf = archOutline(op, 0);
  const band = archBand(op, 0, 0.6);
  for (const [z0, d] of [[-0.12, 0.12], [2, 0.12]]) {
    const g = prismGeom(leaf, d); g.translate(0, 0, z0);
    sink.add(g, M, MAT.WOOD);
  }
  addBothFaces(sink, M, band, 0.2, MAT.TRIM);
}

// A closed door drawn on a single face of some block (used under staircases).
// `M` maps (u, v, w) with w = 0 on the face and +w pointing out of it.
export function addFaceDoor(sink, M, op) {
  const leaf = archOutline(op, 0);
  const band = archBand(op, 0, 0.5);
  sink.add(prismGeom(leaf, 0.1), M, MAT.WOOD);
  sink.add(prismGeom(band, 0.18), M, MAT.TRIM);
}

// ---------- trees ----------
export function buildTree(sink, M, rng, height) {
  const trunkTop = height * (0.45 + 0.1 * rng.next());
  sink.add(cylinderGeom([0, 0, 0], [0, trunkTop, 0], 0.32, 0.2, 7), M, MAT.BARK);
  const nb = rng.int(3, 5);
  const ends = [[0, height * 0.92, 0]];
  sink.add(cylinderGeom([0, trunkTop * 0.9, 0], [0, height * 0.9, 0], 0.18, 0.08, 6), M, MAT.BARK);
  for (let i = 0; i < nb; i++) {
    const ang = (i / nb) * Math.PI * 2 + rng.range(-0.4, 0.4);
    const y0 = trunkTop * rng.range(0.75, 1.0);
    const reach = rng.range(1.6, 2.8);
    const y1 = y0 + rng.range(1.4, 3.0);
    const end = [Math.cos(ang) * reach, y1, Math.sin(ang) * reach];
    sink.add(cylinderGeom([0, y0, 0], end, 0.14, 0.06, 5), M, MAT.BARK);
    ends.push(end);
  }
  for (const e of ends) {
    const k = rng.int(1, 2);
    for (let j = 0; j < k; j++) {
      const c = [e[0] + rng.range(-0.6, 0.6), e[1] + rng.range(-0.2, 0.7), e[2] + rng.range(-0.6, 0.6)];
      sink.add(blobGeom(c, rng.range(1.2, 1.9), rng), M, MAT.LEAF);
    }
  }
}

export function buildBush(sink, M, rng, size) {
  const k = rng.int(2, 4);
  for (let i = 0; i < k; i++) {
    const c = [rng.range(-0.5, 0.5) * size, size * rng.range(0.35, 0.6), rng.range(-0.5, 0.5) * size];
    sink.add(blobGeom(c, size * rng.range(0.45, 0.7), rng, 1), M, MAT.LEAF);
  }
}
