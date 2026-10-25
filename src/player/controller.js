// First-person walker whose gravity is defined by the surface under its feet.
//
// Gravity always points along one of the six axes. The ground is sampled under the
// centre of the feet, the body is an axis-aligned box in the walker's own frame.
//   * walk into a stone wall (taller than a step) and keep pushing -> the wall becomes
//     the floor (the view tips back 90 degrees)
//   * walk off an edge of stone -> you roll over the edge onto its side face
//   * a 45 degree stair is a ramp for both of the gravities it serves
// Railings, bars, columns and tree trunks are never floors, and edges you cannot roll
// over behave like invisible kerbs, so nobody ever falls into the void.

import * as THREE from '../../vendor/three/three.module.min.js';
import { AIR, SOLID, BARRIER, UNKNOWN, PLAYER, isWedge } from '../core/constants.js';
import { DIRS, axisOf, signOf, dirFrom, wedgeDirs, referenceForward } from '../core/cube.js';

const BLOCKED = 'blocked';
const EPS = 1e-6;

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _qi = new THREE.Quaternion();
const AX_X = new THREE.Vector3(1, 0, 0);
const AX_Y = new THREE.Vector3(0, 1, 0);

export function dirVec(d) { return new THREE.Vector3(...DIRS[d]); }

// Camera basis for a given up direction: local +Y -> up, local -Z -> reference forward.
export function basisQuaternion(up) {
  const U = dirVec(up);
  const F = dirVec(referenceForward(up));
  const R = new THREE.Vector3().crossVectors(F, U);
  _m.makeBasis(R, U, F.clone().negate());
  return new THREE.Quaternion().setFromRotationMatrix(_m);
}
const BASES = [0, 1, 2, 3, 4, 5].map(basisQuaternion);

export class Player {
  constructor(world) {
    this.world = world;
    this.pos = new THREE.Vector3();
    this.up = 2;
    this.yaw = 0;
    this.pitch = 0;
    this.offQ = new THREE.Quaternion();
    this.offP = new THREE.Vector3();
    this.push = 0;
    this.pushAxis = -1;
    this.ledge = 0;
    this.cool = 0;
    this.bobPhase = 0;
    this.bob = 0;
    this.moveAmt = 0;
    this.onTransition = null;
    this.onLand = null;
    this.onRespawn = null;
    this.camQ = new THREE.Quaternion();
    this.camP = new THREE.Vector3();
    // airborne state: vertical speed along `up`, time in the air, where the jump began
    this.air = false;
    this.vy = 0;
    this.airTime = 0;
    this.safe = null;
  }

  // ---- frame helpers ----
  height() { return signOf(this.up) * this.pos.getComponent(axisOf(this.up)); }

  setHeight(p, up, t) { p[axisOf(up)] = signOf(up) * t; }

  targetQuaternion(out = new THREE.Quaternion()) {
    out.copy(BASES[this.up]);
    out.multiply(_qi.setFromAxisAngle(AX_Y, this.yaw));
    out.multiply(_qi.setFromAxisAngle(AX_X, this.pitch));
    return out;
  }

  forward(out = new THREE.Vector3()) {
    out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).applyQuaternion(BASES[this.up]);
    return out;
  }

  right(out = new THREE.Vector3()) {
    out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).applyQuaternion(BASES[this.up]);
    return out;
  }

  yawFromForward(f, up) {
    _v.copy(f).applyQuaternion(_qi.copy(BASES[up]).invert());
    return Math.atan2(-_v.x, -_v.z);
  }

  eyeTarget(out = new THREE.Vector3()) {
    return out.copy(dirVec(this.up)).multiplyScalar(PLAYER.eye + this.bob).add(this.pos);
  }

  // Place the walker at feet position p with the given up and facing directions. Nothing
  // from an earlier walk carries over: no fall in progress, no half-made gravity change.
  spawn(p, up, faceVec) {
    this.pos.set(p[0], p[1], p[2]);
    this.up = up;
    this.yaw = this.yawFromForward(faceVec, up);
    this.pitch = 0;
    this.air = false;
    this.vy = 0;
    this.airTime = 0;
    this.safe = null;
    this.push = 0;
    this.pushAxis = -1;
    this.ledge = 0;
    this.cool = 0;
    this.bobPhase = 0;
    this.bob = 0;
    this.moveAmt = 0;
    this.offQ.identity();
    this.offP.set(0, 0, 0);
    const g = this.groundAt([p[0], p[1], p[2]], up, this.height() + 0.6, this.height() - 1.2);
    if (typeof g === 'number') this.setHeightOf(g);
    this.updateCamera(0);
  }

  setHeightOf(t) { this.pos.setComponent(axisOf(this.up), signOf(this.up) * t); }

  look(dx, dy) {
    this.yaw -= dx;
    this.pitch = Math.max(-1.52, Math.min(1.52, this.pitch - dy));
  }

  // ---- collision queries ----
  // Highest walkable surface in the column through p, between heights tBot and tTop.
  // Returns a height, null (nothing to stand on) or BLOCKED (something too tall).
  groundAt(p, up, tTop, tBot) {
    const ua = axisOf(up), us = signOf(up);
    const c = [Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2])];
    let k = Math.floor(us * (tTop - 1e-4));
    for (let i = 0; i < 5; i++, k -= us) {
      const cellTop = us > 0 ? k + 1 : -k;
      if (cellTop < tBot - EPS) return null;
      c[ua] = k;
      const t = this.world.voxel(c[0], c[1], c[2]);
      if (t === AIR || t === BARRIER) continue;
      let g = cellTop;
      if (isWedge(t)) {
        const [d1, d2] = wedgeDirs(t);
        if (d1 === up || d2 === up) {
          const D = d1 === up ? d2 : d1;
          const da = axisOf(D);
          const f = p[da] - Math.floor(p[da]);
          g = cellTop - (signOf(D) > 0 ? f : 1 - f);
        }
      }
      if (g > tTop + EPS) return BLOCKED;
      if (g < tBot - EPS) return null;
      return g;
    }
    return null;
  }

  // Does the body (footprint radius r, from `from` above the feet to the head) hit anything?
  bodyHits(p, up, t, from = PLAYER.stepUp, r = PLAYER.radius) {
    const ua = axisOf(up), us = signOf(up);
    const h1 = (ua + 1) % 3, h2 = (ua + 2) % 3;
    const hA = t + from, hB = t + PLAYER.height;
    const wLo = us > 0 ? hA : -hB, wHi = us > 0 ? hB : -hA;
    const a0 = Math.floor(p[h1] - r), a1 = Math.floor(p[h1] + r - EPS);
    const b0 = Math.floor(p[h2] - r), b1 = Math.floor(p[h2] + r - EPS);
    const k0 = Math.floor(wLo + EPS), k1 = Math.floor(wHi - EPS);
    const c = [0, 0, 0];
    for (let k = k0; k <= k1; k++) {
      for (let a = a0; a <= a1; a++) {
        for (let b = b0; b <= b1; b++) {
          c[ua] = k; c[h1] = a; c[h2] = b;
          const v = this.world.voxel(c[0], c[1], c[2]);
          if (v === AIR) continue;
          if (isWedge(v)) {
            const [d1, d2] = wedgeDirs(v);
            if (d1 === up || d2 === up) {
              const D = d1 === up ? d2 : d1;
              const da = axisOf(D);
              const lo = Math.max(c[da], p[da] - r), hi = Math.min(c[da] + 1, p[da] + r);
              const minCD = signOf(D) > 0 ? lo - c[da] : c[da] + 1 - hi;
              const cellTop = us > 0 ? k + 1 : -k;
              if (cellTop - minCD <= hA + EPS) continue;
            }
          }
          return true;
        }
      }
    }
    return false;
  }

  // ---- movement ----
  moveAxis(ax, d) {
    const up = this.up;
    const t = this.height();
    const p = [this.pos.x, this.pos.y, this.pos.z];
    const np = p.slice();
    np[ax] += d;
    if (this.bodyHits(np, up, t)) {
      let lo = 0, hi = 1;
      for (let i = 0; i < 7; i++) {
        const m = (lo + hi) / 2;
        const q = p.slice(); q[ax] += d * m;
        if (this.bodyHits(q, up, t)) hi = m; else lo = m;
      }
      if (lo > 0.001) {
        const q = p.slice(); q[ax] += d * lo;
        const g = this.groundAt(q, up, t + PLAYER.stepUp, t - PLAYER.stepDown);
        if (typeof g === 'number' && (Math.abs(g - t) < EPS || !this.bodyHits(q, up, g))) this.commitMove(q, g, t);
      }
      return 'wall';
    }
    const g = this.groundAt(np, up, t + PLAYER.stepUp, t - PLAYER.stepDown);
    if (g === BLOCKED) return 'wall';
    if (g === null) return 'ledge';
    // The body was checked at the old height; a step up or down moves it, so check again.
    if (Math.abs(g - t) > EPS && this.bodyHits(np, up, g)) return 'wall';
    this.commitMove(np, g, t);
    return 'ok';
  }

  commitMove(np, g, t) {
    this.pos.set(np[0], np[1], np[2]);
    this.setHeightOf(g);
    if (Math.abs(g - t) > 1e-4) {
      // keep the camera smooth over steps
      this.offP.addScaledVector(dirVec(this.up), (t - g) * 0.85);
    }
  }

  update(dt, input) {
    this.cool = Math.max(0, this.cool - dt);
    if (!this.air && input.jump) this.leaveGround(PLAYER.jump);
    if (this.air) {
      this.airUpdate(dt, input);
      this.bob = 0;
      this.updateCamera(dt);
      return;
    }
    const speed = input.run ? PLAYER.run : PLAYER.walk;
    const f = this.forward(new THREE.Vector3());
    const r = this.right(new THREE.Vector3());
    const wish = f.multiplyScalar(input.fwd).addScaledVector(r, input.strafe);
    let len = wish.length();
    if (len > 1) { wish.divideScalar(len); len = 1; }
    let pushing = null, ledge = null;
    if (len > 0.01) {
      const ua = axisOf(this.up);
      const axes = [(ua + 1) % 3, (ua + 2) % 3];
      const total = speed * dt;
      const steps = Math.max(1, Math.ceil((total * len) / 0.16));
      const frac = (ax) => Math.abs(wish.getComponent(ax)) / len;
      for (let s = 0; s < steps; s++) {
        const order = Math.abs(wish.getComponent(axes[0])) >= Math.abs(wish.getComponent(axes[1])) ? axes : [axes[1], axes[0]];
        for (const ax of order) {
          const d = (wish.getComponent(ax) * total) / steps;
          if (Math.abs(d) < 1e-7) continue;
          const res = this.moveAxis(ax, d);
          if (res === 'wall' && frac(ax) > 0.72) pushing = [ax, Math.sign(d)];
          if (res === 'ledge' && frac(ax) > 0.72) ledge = [ax, Math.sign(d)];
        }
      }
      this.moveAmt = Math.min(1, this.moveAmt + dt * 6);
      this.bobPhase += dt * speed * 1.25 * len;
    } else {
      this.moveAmt = Math.max(0, this.moveAmt - dt * 5);
    }

    if (pushing && this.cool <= 0) {
      if (this.pushAxis === pushing[0] * 2 + (pushing[1] < 0 ? 1 : 0)) this.push += dt;
      else { this.pushAxis = pushing[0] * 2 + (pushing[1] < 0 ? 1 : 0); this.push = dt; }
      if (this.push > 0.14) {
        this.tryConcave(pushing[0], pushing[1]);
        this.push = 0;
      }
    } else {
      this.push = 0;
      this.pushAxis = -1;
    }
    if (ledge && this.cool <= 0) {
      this.ledge += dt;
      if (this.ledge > 0.06) { this.tryConvex(ledge[0], ledge[1]); this.ledge = 0; }
    } else {
      this.ledge = 0;
    }
    // The ground can vanish (a hall that was still being drawn turns out to be open).
    if (!this.air) {
      const t = this.height();
      if (this.groundAt([this.pos.x, this.pos.y, this.pos.z], this.up, t + 0.05, t - 0.05) === null) this.leaveGround(0);
    }
    this.bob = Math.sin(this.bobPhase) * 0.06 * this.moveAmt;
    this.updateCamera(dt);
  }

  // ---- jumping and falling ----
  leaveGround(v) {
    if (!this.air) {
      this.safe = { pos: this.pos.clone(), up: this.up, yaw: this.yaw, pitch: this.pitch };
    }
    this.air = true;
    this.vy = v;
    this.airTime = 0;
    this.push = 0;
    this.ledge = 0;
  }

  airUpdate(dt, input) {
    const up = this.up, ua = axisOf(up), us = signOf(up);
    const speed = (input.run ? PLAYER.run : PLAYER.walk) * 0.85;
    const wish = this.forward(new THREE.Vector3()).multiplyScalar(input.fwd).addScaledVector(this.right(new THREE.Vector3()), input.strafe);
    const len = wish.length();
    if (len > 1) wish.divideScalar(len);
    if (len > 0.01) {
      const axes = [(ua + 1) % 3, (ua + 2) % 3];
      const total = speed * dt;
      const steps = Math.max(1, Math.ceil(total / 0.16));
      for (let s = 0; s < steps; s++) {
        for (const ax of axes) {
          const d = (wish.getComponent(ax) * total) / steps;
          if (Math.abs(d) < 1e-7) continue;
          const t = this.height();
          const np = [this.pos.x, this.pos.y, this.pos.z];
          np[ax] += d;
          if (!this.bodyHits(np, up, t, 0.05, PLAYER.airRadius)) { this.pos.setComponent(ax, np[ax]); continue; }
          // Mantle: a ledge whose top is within a step of the feet can be climbed onto.
          if (this.bodyHits(np, up, t, PLAYER.stepUp, PLAYER.airRadius)) continue;
          const probe = np.slice();
          probe[ax] += Math.sign(d) * (PLAYER.airRadius + 0.06);
          const g = this.groundAt(probe, up, t + PLAYER.stepUp, t);
          if (typeof g === 'number' && !this.bodyHits(probe, up, g)) {
            this.pos.set(probe[0], probe[1], probe[2]);
            this.land(g);
            return;
          }
        }
      }
    }
    this.vy = Math.max(this.vy - PLAYER.gravity * dt, -PLAYER.terminal);
    const dz = this.vy * dt;
    const n = Math.max(1, Math.ceil(Math.abs(dz) / 0.3));
    let waiting = false;
    for (let i = 0; i < n; i++) {
      const step = dz / n;
      const t = this.height();
      const p = [this.pos.x, this.pos.y, this.pos.z];
      if (step > 0) {
        if (this.bodyHits(p, up, t + step, 0.05, PLAYER.airRadius)) { this.vy = 0; break; }
        this.setHeightOf(t + step);
        continue;
      }
      // never fall into a hall that has not been drawn yet: wait for it
      const q = p.slice(); q[ua] = us * (t + step - 0.2);
      if (this.world.voxel(Math.floor(q[0]), Math.floor(q[1]), Math.floor(q[2])) === UNKNOWN) { this.vy = 0; waiting = true; break; }
      const g = this.groundAt(p, up, t + 1e-4, t + step);
      if (typeof g === 'number') { this.land(g); return; }
      this.setHeightOf(t + step);
    }
    if (!waiting) this.airTime += dt;
    if (this.airTime > PLAYER.maxFall && this.safe) this.respawn();
  }

  land(g) {
    const impact = -this.vy;
    this.air = false;
    this.vy = 0;
    this.setHeightOf(g);
    if (!this.depenetrate()) {
      // landed somewhere too narrow to stand: redraw the plate at the jump spot
      if (this.safe) this.respawn();
      return;
    }
    this.offP.addScaledVector(dirVec(this.up), -Math.min(0.45, impact * 0.018));
    this.cool = Math.max(this.cool, 0.15);
    if (this.onLand) this.onLand(impact);
  }

  // After a landing the slimmer airborne body may overlap a wall: nudge it free.
  // Returns false if there is no free place to stand nearby.
  depenetrate() {
    const up = this.up, t = this.height();
    const p0 = [this.pos.x, this.pos.y, this.pos.z];
    if (!this.bodyHits(p0, up, t)) return true;
    const ua = axisOf(up), h1 = (ua + 1) % 3, h2 = (ua + 2) % 3;
    for (let d = 0.1; d <= 1.25; d += 0.1) {
      for (let k = 0; k < 16; k++) {
        const ang = (k / 16) * Math.PI * 2;
        const q = p0.slice(); q[h1] += Math.cos(ang) * d; q[h2] += Math.sin(ang) * d;
        const g = this.groundAt(q, up, t + PLAYER.stepUp, t - PLAYER.stepDown);
        if (typeof g !== 'number' || this.bodyHits(q, up, g)) continue;
        this.pos.set(q[0], q[1], q[2]);
        this.setHeightOf(g);
        return true;
      }
    }
    return false;
  }

  respawn() {
    const s = this.safe;
    this.air = false;
    this.vy = 0;
    this.pos.copy(s.pos);
    this.up = s.up;
    this.yaw = s.yaw;
    this.pitch = s.pitch;
    this.offQ.identity();
    this.offP.set(0, 0, 0);
    if (this.onRespawn) this.onRespawn();
  }

  // Walked into a wall: the wall becomes the floor.
  tryConcave(ax, s) {
    const up = this.up, ua = axisOf(up), us = signOf(up);
    const t = this.height();
    const r = PLAYER.radius;
    const p = [this.pos.x, this.pos.y, this.pos.z];
    const wc = Math.floor(p[ax] + s * (r + 0.03));
    const c = [Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2])];
    c[ax] = wc;
    for (const hh of [0.5, 1.5, 2.5]) {
      c[ua] = Math.floor(us * (t + hh));
      if (this.world.voxel(c[0], c[1], c[2]) !== SOLID) return false;
    }
    const newUp = dirFrom(ax, -s);
    const plane = s > 0 ? wc : wc + 1;
    const np = p.slice();
    np[ax] = plane;
    np[ua] = us * (t + r + 0.06);
    const nt = -s * plane;
    const g = this.groundAt(np, newUp, nt + 0.3, nt - 0.3);
    if (typeof g !== 'number') return false;
    if (this.bodyHits(np, newUp, g)) return false;
    this.transition(newUp, np, g);
    return true;
  }

  // Walked off an edge of stone: roll over it onto the side face.
  tryConvex(ax, s) {
    const up = this.up, ua = axisOf(up), us = signOf(up);
    const t = this.height();
    const p = [this.pos.x, this.pos.y, this.pos.z];
    const c = [Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2])];
    c[ua] = Math.floor(us * (t - 0.02));
    if (this.world.voxel(c[0], c[1], c[2]) !== SOLID) return false;
    const top = us > 0 ? c[ua] + 1 : -c[ua];
    if (Math.abs(top - t) > 0.03) return false;
    const n = c.slice(); n[ax] += s;
    if (this.world.voxel(n[0], n[1], n[2]) !== AIR) return false;
    const newUp = dirFrom(ax, s);
    const plane = s > 0 ? c[ax] + 1 : c[ax];
    const np = p.slice();
    np[ax] = plane;
    np[ua] = us * (t - PLAYER.radius - 0.06);
    const nt = s * plane;
    const g = this.groundAt(np, newUp, nt + 0.3, nt - 0.3);
    if (typeof g !== 'number') return false;
    if (this.bodyHits(np, newUp, g)) return false;
    this.transition(newUp, np, g);
    return true;
  }

  transition(newUp, np, g) {
    const oldUp = this.up;
    const camQBefore = this.camQ.clone();
    const eyeBefore = this.camP.clone();
    const qRot = new THREE.Quaternion().setFromUnitVectors(dirVec(oldUp), dirVec(newUp));
    const fwd = this.forward(new THREE.Vector3()).applyQuaternion(qRot);
    this.up = newUp;
    this.yaw = this.yawFromForward(fwd, newUp);
    this.pos.set(np[0], np[1], np[2]);
    this.setHeightOf(g);
    const tq = this.targetQuaternion();
    this.offQ.copy(camQBefore).multiply(tq.invert());
    this.offP.set(0, 0, 0);
    this.offP.copy(eyeBefore).sub(this.eyeTarget());
    this.cool = 0.22;
    this.push = 0;
    this.ledge = 0;
    if (this.onTransition) this.onTransition(oldUp, newUp);
  }

  updateCamera(dt) {
    const k = dt > 0 ? 1 - Math.exp(-dt / 0.14) : 0;
    this.offQ.slerp(_qi.identity(), k);
    this.offP.multiplyScalar(dt > 0 ? Math.exp(-dt / 0.12) : 1);
    this.targetQuaternion(this.camQ);
    this.camQ.premultiply(this.offQ);
    this.eyeTarget(this.camP).add(this.offP);
  }
}
