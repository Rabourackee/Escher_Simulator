// Escher's faceless inhabitants: a small mannequin with a handful of poses and a walk
// cycle. Walking ones are skinned meshes (one draw call each); standing, sitting and
// leaning ones, and statues, are posed once and baked into their hall's mesh.

import * as THREE from '../../vendor/three/three.module.min.js';
import { MAT } from '../core/constants.js';
import { DIRS } from '../core/cube.js';

// hips, chest, head, upper/lower arm L, upper/lower arm R, thigh/shin L, thigh/shin R
const PARENT = [-1, 0, 1, 1, 3, 1, 5, 0, 7, 0, 9];
const REST = [
  [0, 1.72, 0], [0, 0.6, 0], [0, 0.62, 0],
  [0.36, 0.44, 0], [0, -0.58, 0], [-0.36, 0.44, 0], [0, -0.58, 0],
  [0.17, -0.08, 0], [0, -0.8, 0], [-0.17, -0.08, 0], [0, -0.8, 0],
];
export const B = { hips: 0, chest: 1, head: 2, armL: 3, foreL: 4, armR: 5, foreR: 6, thighL: 7, shinL: 8, thighR: 9, shinR: 10 };

// World position of every bone in the rest pose.
const REST_WORLD = REST.map(() => [0, 0, 0]);
REST.forEach((r, i) => {
  const p = PARENT[i] >= 0 ? REST_WORLD[PARENT[i]] : [0, 0, 0];
  REST_WORLD[i] = [p[0] + r[0], p[1] + r[1], p[2] + r[2]];
});

// Body parts in the rest pose, each bound to one bone. `lod` 0 is the detailed version.
function partList(lod = 0) {
  const seg = lod ? 6 : 9;
  const cap = (r, l) => new THREE.CapsuleGeometry(r, l, lod ? 2 : 3, seg);
  const sph = (r) => new THREE.SphereGeometry(r, lod ? 8 : 12, lod ? 6 : 9);
  const P = (geo, bone, pos, scale = [1, 1, 1]) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.scale(...scale);
    g.translate(...pos);
    return [g, bone];
  };
  return [
    P(sph(1), B.hips, [0, 1.68, 0], [0.27, 0.2, 0.19]),
    P(new THREE.CylinderGeometry(0.24, 0.33, 0.55, seg + 3, 1), B.hips, [0, 1.5, 0], [1, 1, 0.78]),
    P(cap(0.25, 0.5), B.chest, [0, 2.3, 0], [1, 1, 0.7]),
    P(sph(1), B.chest, [0, 2.74, 0], [0.42, 0.13, 0.17]),
    P(new THREE.CylinderGeometry(0.075, 0.09, 0.22, 8), B.head, [0, 2.98, 0]),
    P(sph(0.215), B.head, [0, 3.22, 0.01], [0.92, 1.12, 1.0]),
    P(cap(0.085, 0.4), B.armL, [0.37, 2.47, 0]),
    P(cap(0.072, 0.36), B.foreL, [0.37, 1.93, 0]),
    P(sph(0.085), B.foreL, [0.37, 1.6, 0.01], [0.8, 1.15, 1]),
    P(cap(0.085, 0.4), B.armR, [-0.37, 2.47, 0]),
    P(cap(0.072, 0.36), B.foreR, [-0.37, 1.93, 0]),
    P(sph(0.085), B.foreR, [-0.37, 1.6, 0.01], [0.8, 1.15, 1]),
    P(cap(0.12, 0.52), B.thighL, [0.17, 1.24, 0]),
    P(cap(0.092, 0.54), B.shinL, [0.17, 0.45, 0]),
    P(new THREE.BoxGeometry(0.17, 0.11, 0.36), B.shinL, [0.17, 0.055, 0.08]),
    P(cap(0.12, 0.52), B.thighR, [-0.17, 1.24, 0]),
    P(cap(0.092, 0.54), B.shinR, [-0.17, 0.45, 0]),
    P(new THREE.BoxGeometry(0.17, 0.11, 0.36), B.shinR, [-0.17, 0.055, 0.08]),
  ];
}

function buildSkinnedGeometry() {
  const parts = partList(0);
  let n = 0;
  for (const [g] of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  let o = 0;
  for (const [g, bone] of parts) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    for (let i = 0; i < c; i++) { si[(o + i) * 4] = bone; sw[(o + i) * 4] = 1; }
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  out.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  out.setAttribute('aMat', new THREE.BufferAttribute(new Float32Array(n).fill(MAT.FIGURE), 1));
  out.computeBoundingSphere();
  return out;
}

function makeBones(Ctor = THREE.Bone) {
  const bones = REST.map(() => new Ctor());
  bones.forEach((b, i) => {
    b.position.set(...REST[i]);
    if (PARENT[i] >= 0) bones[PARENT[i]].add(b);
  });
  return bones;
}

// Set a pose on any bone hierarchy built by makeBones.
export function poseBones(b, name, phase = 0) {
  for (let i = 0; i < b.length; i++) {
    b[i].rotation.set(0, 0, 0);
    b[i].position.set(...REST[i]);
  }
  const s = Math.sin(phase), c = Math.cos(phase);
  const walk = (amp = 1) => {
    b[B.thighL].rotation.x = -0.46 * s * amp;
    b[B.thighR].rotation.x = 0.46 * s * amp;
    b[B.shinL].rotation.x = 0.08 + 0.72 * Math.max(0, c) * amp;
    b[B.shinR].rotation.x = 0.08 + 0.72 * Math.max(0, -c) * amp;
    b[B.armL].rotation.x = 0.36 * s * amp;
    b[B.armR].rotation.x = -0.36 * s * amp;
    b[B.foreL].rotation.x = -0.28;
    b[B.foreR].rotation.x = -0.28;
    b[B.chest].rotation.y = 0.07 * s * amp;
    b[B.hips].position.y = REST[0][1] - 0.045 * Math.abs(s) * amp;
  };
  const seated = () => {
    b[B.hips].position.y = 0.98;
    b[B.thighL].rotation.x = -1.48; b[B.thighR].rotation.x = -1.48;
    b[B.shinL].rotation.x = 1.42; b[B.shinR].rotation.x = 1.42;
  };
  switch (name) {
    case 'walk': walk(); break;
    case 'climb':
      walk(1.25);
      b[B.chest].rotation.x = 0.1;
      break;
    case 'carry':
      walk(0.8);
      b[B.armR].rotation.x = -2.6;
      b[B.armR].rotation.z = 0.25;
      b[B.foreR].rotation.x = -1.3;
      b[B.chest].rotation.x = 0.12;
      break;
    case 'sit':
      seated();
      b[B.thighL].rotation.z = 0.06; b[B.thighR].rotation.z = -0.06;
      b[B.chest].rotation.x = 0.18;
      b[B.armL].rotation.x = -0.55; b[B.armR].rotation.x = -0.55;
      b[B.foreL].rotation.x = -0.5; b[B.foreR].rotation.x = -0.5;
      break;
    case 'read':
      seated();
      b[B.chest].rotation.x = 0.24;
      b[B.head].rotation.x = 0.42;
      b[B.armL].rotation.x = -0.4; b[B.armR].rotation.x = -0.4;
      b[B.armL].rotation.z = -0.15; b[B.armR].rotation.z = 0.15;
      b[B.foreL].rotation.x = -1.35; b[B.foreR].rotation.x = -1.35;
      break;
    case 'lean':
      b[B.chest].rotation.x = 0.42;
      b[B.head].rotation.x = 0.15;
      b[B.armL].rotation.x = -1.0; b[B.armR].rotation.x = -1.0;
      b[B.foreL].rotation.x = -0.55; b[B.foreR].rotation.x = -0.55;
      b[B.thighR].rotation.x = 0.12;
      b[B.shinR].rotation.x = 0.25;
      break;
    case 'stand':
    default:
      b[B.armL].rotation.z = 0.07; b[B.armR].rotation.z = -0.07;
      b[B.foreL].rotation.x = -0.12; b[B.foreR].rotation.x = -0.12;
      b[B.shinL].rotation.x = 0.04; b[B.shinR].rotation.x = 0.04;
      break;
  }
}

// A posed figure as plain geometry (position + normal), for baking into a hall.
const posedCache = new Map();
export function posedFigureGeometry(name, phase = 0) {
  const key = `${name}|${Math.round(phase * 4)}`;
  if (posedCache.has(key)) return posedCache.get(key);
  const bones = makeBones(THREE.Object3D);
  poseBones(bones, name, Math.round(phase * 4) / 4);
  bones[0].updateMatrixWorld(true);
  const parts = partList(1);
  let n = 0;
  for (const [g] of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  const m = new THREE.Matrix4(), nm = new THREE.Matrix3(), v = new THREE.Vector3();
  let o = 0;
  for (const [g, bone] of parts) {
    const rw = REST_WORLD[bone];
    m.copy(bones[bone].matrixWorld).multiply(new THREE.Matrix4().makeTranslation(-rw[0], -rw[1], -rw[2]));
    nm.getNormalMatrix(m);
    const p = g.attributes.position.array, nn = g.attributes.normal.array;
    for (let i = 0; i < p.length; i += 3) {
      v.set(p[i], p[i + 1], p[i + 2]).applyMatrix4(m);
      pos[o] = v.x; pos[o + 1] = v.y; pos[o + 2] = v.z;
      v.set(nn[i], nn[i + 1], nn[i + 2]).applyMatrix3(nm).normalize();
      nor[o] = v.x; nor[o + 1] = v.y; nor[o + 2] = v.z;
      o += 3;
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  posedCache.set(key, out);
  return out;
}

export function clearPosedCache() {
  for (const g of posedCache.values()) g.dispose();
  posedCache.clear();
}

let sharedGeometry = null;

// Orientation of a figure standing with `up` (a direction index or [x,y,z]) and facing
// `face` (an index, [x,y,z] or a Vector3).
const _fu = new THREE.Vector3(), _ff = new THREE.Vector3(), _fx = new THREE.Vector3(), _fm = new THREE.Matrix4();
export function frameQuaternion(up, face, out = new THREE.Quaternion()) {
  const U = _fu.fromArray(Array.isArray(up) ? up : DIRS[up]);
  const F = face.isVector3 ? _ff.copy(face) : _ff.fromArray(Array.isArray(face) ? face : DIRS[face]);
  F.addScaledVector(U, -F.dot(U)).normalize();
  _fx.crossVectors(U, F);
  return out.setFromRotationMatrix(_fm.makeBasis(_fx, U, F));
}

export class Figure {
  constructor(material) {
    if (!sharedGeometry) sharedGeometry = buildSkinnedGeometry();
    const bones = makeBones();
    this.mesh = new THREE.SkinnedMesh(sharedGeometry, material);
    this.mesh.add(bones[0]);
    this.mesh.bind(new THREE.Skeleton(bones));
    this.mesh.frustumCulled = false;
    this.bones = bones;
    this.props = [];
  }

  place(pos, up, face) {
    this.mesh.position.set(pos[0], pos[1], pos[2]);
    frameQuaternion(up, face, this.mesh.quaternion);
  }

  addProp(geometry, bone, material, offset) {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(...offset);
    this.bones[bone].add(m);
    this.props.push(m);
    return m;
  }

  pose(name, phase = 0) {
    poseBones(this.bones, name, phase);
  }

  dispose() {
    this.mesh.skeleton.dispose();
    for (const m of this.props) m.geometry.dispose();
    this.props.length = 0;
  }
}

// Inhabitants that pace back and forth along a validated path. Every hall's walkers are
// kept as plain data (where they are along their path); only the nearest few borrow a
// figure from a small pool, so the number of figures never grows with the world.
const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _u = new THREE.Vector3();

export class Walkers {
  constructor(scene, material, max = 40) {
    this.scene = scene;
    this.material = material;
    this.max = max;
    this.byHall = new Map();
    this.all = new Set();
    this.figures = [];     // every figure ever made (at most `max`)
    this.free = [];        // the ones not lent to a walker right now
    this.near = [];
  }

  addHall(key, npcs) {
    const list = [];
    for (const n of npcs) {
      const segs = [];
      let total = 0;
      for (let i = 0; i + 1 < n.path.length; i++) {
        const a = new THREE.Vector3(...n.path[i]), b = new THREE.Vector3(...n.path[i + 1]);
        const len = a.distanceTo(b);
        segs.push({ a, b, len, start: total });
        total += len;
      }
      if (total < 0.5) continue;
      const mid = new THREE.Vector3();
      for (const sg of segs) mid.add(sg.a).add(sg.b);
      mid.multiplyScalar(1 / (2 * segs.length));
      const w = {
        fig: null, segs, total, up: n.up, mid,
        s: (n.path.length * 7.31 + total * 3.7) % total,
        dir: 1,
        speed: 2.6 + ((total * 13.7) % 1) * 0.8,
        phase: (total * 5.1) % 6.28,
        pause: 0,
        face: new THREE.Vector3(),
        dist: 0,
      };
      list.push(w);
      this.all.add(w);
    }
    this.byHall.set(key, list);
  }

  removeHall(key) {
    const list = this.byHall.get(key);
    if (!list) return;
    for (const w of list) {
      this.giveBack(w);
      this.all.delete(w);
    }
    this.byHall.delete(key);
  }

  giveBack(w) {
    if (!w.fig) return;
    w.fig.mesh.visible = false;
    this.free.push(w.fig);
    w.fig = null;
  }

  borrow() {
    if (this.free.length) return this.free.pop();
    if (this.figures.length >= this.max) return null;
    const fig = new Figure(this.material);
    fig.mesh.visible = false;
    this.scene.add(fig.mesh);
    this.figures.push(fig);
    return fig;
  }

  advance(w, dt) {
    if (w.pause > 0) { w.pause -= dt; return; }
    w.s += w.dir * w.speed * dt;
    if (w.s >= w.total) { w.s = w.total; w.dir = -1; w.pause = 0.6 + (w.total % 1.3); }
    if (w.s <= 0) { w.s = 0; w.dir = 1; w.pause = 0.6 + (w.total % 0.9); }
    w.phase += dt * w.speed * 1.9;
  }

  place(w, dt) {
    let seg = w.segs[w.segs.length - 1];
    for (const sg of w.segs) if (w.s <= sg.start + sg.len) { seg = sg; break; }
    const f = Math.min(1, Math.max(0, (w.s - seg.start) / seg.len));
    _p.copy(seg.a).lerp(seg.b, f);
    _u.fromArray(DIRS[w.up]);
    _d.copy(seg.b).sub(seg.a).multiplyScalar(w.dir);
    _d.addScaledVector(_u, -_d.dot(_u));
    if (_d.lengthSq() > 1e-6) {
      _d.normalize();
      if (w.face.lengthSq() < 1e-6 || dt === 0) w.face.copy(_d);
      else w.face.lerp(_d, 1 - Math.exp(-dt * 7)).normalize();
    }
    w.fig.mesh.position.copy(_p);
    frameQuaternion(w.up, w.face, w.fig.mesh.quaternion);
    if (w.pause > 0) w.fig.pose('stand');
    else w.fig.pose('walk', w.phase);
  }

  update(dt, focus, range) {
    // everybody keeps walking (it is just a number along a path); the nearest are drawn
    const near = this.near;
    near.length = 0;
    for (const w of this.all) {
      this.advance(w, dt);
      w.dist = w.mid.distanceTo(focus) - w.total / 2;
      if (w.dist < range) near.push(w);
      else this.giveBack(w);
    }
    near.sort((a, b) => a.dist - b.dist);
    for (let i = this.max; i < near.length; i++) this.giveBack(near[i]);
    for (let i = 0; i < near.length && i < this.max; i++) {
      const w = near[i];
      const fresh = !w.fig;
      if (fresh) w.fig = this.borrow();
      if (!w.fig) continue;
      w.fig.mesh.visible = true;
      this.place(w, fresh ? 0 : dt);
    }
  }

  get shown() {
    let n = 0;
    for (const fig of this.figures) if (fig.mesh.visible) n++;
    return n;
  }

  dispose() {
    for (const key of [...this.byHall.keys()]) this.removeHall(key);
    for (const fig of this.figures) {
      this.scene.remove(fig.mesh);
      fig.dispose();
    }
    this.figures.length = 0;
    this.free.length = 0;
  }
}

// Free the shared figure geometry and the baked poses (at the end of a visit).
export function disposeFigureAssets() {
  if (sharedGeometry) sharedGeometry.dispose();
  sharedGeometry = null;
  clearPosedCache();
}
