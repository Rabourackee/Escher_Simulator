// Escher's faceless inhabitants: a small skinned mannequin with a handful of poses and a
// walk cycle. One shared geometry, one skeleton per figure, one draw call each.

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

function part(geo, bone, { pos = [0, 0, 0], scale = [1, 1, 1], rot = null } = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot)));
  g.scale(...scale);
  g.translate(...pos);
  const n = g.attributes.position.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { si[i * 4] = bone; sw[i * 4] = 1; }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  return g;
}

function merge(geos) {
  let n = 0;
  for (const g of geos) n += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  const names = ['position', 'normal', 'skinIndex', 'skinWeight'];
  const sizes = [3, 3, 4, 4];
  names.forEach((name, i) => {
    const Arr = name === 'skinIndex' ? Uint16Array : Float32Array;
    const arr = new Arr(n * sizes[i]);
    let o = 0;
    for (const g of geos) { arr.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, sizes[i]));
  });
  const mat = new Float32Array(n).fill(MAT.FIGURE);
  out.setAttribute('aMat', new THREE.BufferAttribute(mat, 1));
  out.computeBoundingSphere();
  return out;
}

function buildGeometry() {
  const cap = (r, l) => new THREE.CapsuleGeometry(r, l, 3, 9);
  const sph = (r) => new THREE.SphereGeometry(r, 12, 9);
  const parts = [
    part(sph(1), B.hips, { pos: [0, 1.68, 0], scale: [0.27, 0.2, 0.19] }),
    part(new THREE.CylinderGeometry(0.24, 0.33, 0.55, 12, 1), B.hips, { pos: [0, 1.5, 0], scale: [1, 1, 0.78] }),
    part(cap(0.25, 0.5), B.chest, { pos: [0, 2.3, 0], scale: [1, 1, 0.7] }),
    part(sph(1), B.chest, { pos: [0, 2.74, 0], scale: [0.42, 0.13, 0.17] }),
    part(new THREE.CylinderGeometry(0.075, 0.09, 0.22, 8), B.head, { pos: [0, 2.98, 0] }),
    part(sph(0.215), B.head, { pos: [0, 3.22, 0.01], scale: [0.92, 1.12, 1.0] }),
    part(cap(0.085, 0.4), B.armL, { pos: [0.37, 2.47, 0] }),
    part(cap(0.072, 0.36), B.foreL, { pos: [0.37, 1.93, 0] }),
    part(sph(0.085), B.foreL, { pos: [0.37, 1.6, 0.01], scale: [0.8, 1.15, 1] }),
    part(cap(0.085, 0.4), B.armR, { pos: [-0.37, 2.47, 0] }),
    part(cap(0.072, 0.36), B.foreR, { pos: [-0.37, 1.93, 0] }),
    part(sph(0.085), B.foreR, { pos: [-0.37, 1.6, 0.01], scale: [0.8, 1.15, 1] }),
    part(cap(0.12, 0.52), B.thighL, { pos: [0.17, 1.24, 0] }),
    part(cap(0.092, 0.54), B.shinL, { pos: [0.17, 0.45, 0] }),
    part(new THREE.BoxGeometry(0.17, 0.11, 0.36), B.shinL, { pos: [0.17, 0.055, 0.08] }),
    part(cap(0.12, 0.52), B.thighR, { pos: [-0.17, 1.24, 0] }),
    part(cap(0.092, 0.54), B.shinR, { pos: [-0.17, 0.45, 0] }),
    part(new THREE.BoxGeometry(0.17, 0.11, 0.36), B.shinR, { pos: [-0.17, 0.055, 0.08] }),
  ];
  return merge(parts);
}

let sharedGeometry = null;

export function frameQuaternion(up, face, out = new THREE.Quaternion()) {
  const U = new THREE.Vector3(...(Array.isArray(up) ? up : DIRS[up]));
  const F = new THREE.Vector3(...(Array.isArray(face) ? face : DIRS[face]));
  F.addScaledVector(U, -F.dot(U)).normalize();
  const X = new THREE.Vector3().crossVectors(U, F);
  const m = new THREE.Matrix4().makeBasis(X, U, F);
  return out.setFromRotationMatrix(m);
}

export class Figure {
  constructor(material) {
    if (!sharedGeometry) sharedGeometry = buildGeometry();
    const bones = REST.map(() => new THREE.Bone());
    bones.forEach((b, i) => {
      b.position.set(...REST[i]);
      if (PARENT[i] >= 0) bones[PARENT[i]].add(b);
    });
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
    const b = this.bones;
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
        b[B.hips].position.y = 0.98;
        b[B.thighL].rotation.x = -1.48; b[B.thighR].rotation.x = -1.48;
        b[B.shinL].rotation.x = 1.42; b[B.shinR].rotation.x = 1.42;
        b[B.thighL].rotation.z = 0.06; b[B.thighR].rotation.z = -0.06;
        b[B.chest].rotation.x = 0.18;
        b[B.armL].rotation.x = -0.55; b[B.armR].rotation.x = -0.55;
        b[B.foreL].rotation.x = -0.5; b[B.foreR].rotation.x = -0.5;
        break;
      case 'read':
        b[B.hips].position.y = 0.98;
        b[B.thighL].rotation.x = -1.48; b[B.thighR].rotation.x = -1.48;
        b[B.shinL].rotation.x = 1.42; b[B.shinR].rotation.x = 1.42;
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
}

// Inhabitants that pace back and forth along a validated path.
export class Walkers {
  constructor(scene, material) {
    this.scene = scene;
    this.material = material;
    this.byHall = new Map();
    this.all = new Set();
  }

  addHall(key, npcs) {
    const list = [];
    for (const n of npcs) {
      const fig = new Figure(this.material);
      const segs = [];
      let total = 0;
      for (let i = 0; i + 1 < n.path.length; i++) {
        const a = new THREE.Vector3(...n.path[i]), b = new THREE.Vector3(...n.path[i + 1]);
        const len = a.distanceTo(b);
        segs.push({ a, b, len, start: total });
        total += len;
      }
      if (total < 0.5) continue;
      const w = {
        fig, segs, total, up: n.up,
        s: (n.path.length * 7.31 + total * 3.7) % total,
        dir: 1,
        speed: 2.6 + ((total * 13.7) % 1) * 0.8,
        phase: (total * 5.1) % 6.28,
        pause: 0,
        turn: 0,
        face: new THREE.Vector3(),
      };
      this.scene.add(fig.mesh);
      list.push(w);
      this.all.add(w);
      this.placeWalker(w, 0);
    }
    this.byHall.set(key, list);
  }

  removeHall(key) {
    const list = this.byHall.get(key);
    if (!list) return;
    for (const w of list) {
      this.scene.remove(w.fig.mesh);
      w.fig.mesh.skeleton.dispose();
      this.all.delete(w);
    }
    this.byHall.delete(key);
  }

  placeWalker(w, dt) {
    let seg = w.segs[w.segs.length - 1];
    for (const sg of w.segs) if (w.s <= sg.start + sg.len) { seg = sg; break; }
    const f = Math.min(1, Math.max(0, (w.s - seg.start) / seg.len));
    const p = seg.a.clone().lerp(seg.b, f);
    const U = new THREE.Vector3(...DIRS[w.up]);
    const dir = seg.b.clone().sub(seg.a).multiplyScalar(w.dir);
    dir.addScaledVector(U, -dir.dot(U));
    if (dir.lengthSq() > 1e-6) {
      dir.normalize();
      if (w.face.lengthSq() < 1e-6) w.face.copy(dir);
      else w.face.lerp(dir, 1 - Math.exp(-dt * 7)).normalize();
    }
    w.fig.mesh.position.copy(p);
    frameQuaternion(DIRS[w.up], [w.face.x, w.face.y, w.face.z], w.fig.mesh.quaternion);
  }

  update(dt, focus, range) {
    for (const w of this.all) {
      const d = w.fig.mesh.position.distanceTo(focus);
      const vis = d < range;
      w.fig.mesh.visible = vis;
      if (!vis) continue;
      if (w.pause > 0) {
        w.pause -= dt;
        w.fig.pose('stand');
        this.placeWalker(w, dt);
        continue;
      }
      w.s += w.dir * w.speed * dt;
      if (w.s >= w.total) { w.s = w.total; w.dir = -1; w.pause = 0.6 + (w.total % 1.3); }
      if (w.s <= 0) { w.s = 0; w.dir = 1; w.pause = 0.6 + (w.total % 0.9); }
      w.phase += dt * w.speed * 1.9;
      w.fig.pose('walk', w.phase);
      this.placeWalker(w, dt);
    }
  }
}
