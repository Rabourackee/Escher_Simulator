// Streams halls around a focus point, like Minecraft chunks: the closest missing halls are
// generated first (in a worker), far halls are dropped and their memory handed back. Also
// answers voxel queries for the walker's collision.
//
// Memory: a hall's mesh lives only on the graphics card (the copy in main memory is let
// go as soon as it has been uploaded), and the voxels kept for collision and lighting are
// 128 KB a hall. Nothing is ever written to disk.

import * as THREE from '../../vendor/three/three.module.min.js';
import { HALL, UNKNOWN, MESH_SCALE, getSeed } from '../core/constants.js';

const hkey = (hx, hy, hz) => ((hx + 1024) * 2048 + (hy + 1024)) * 2048 + (hz + 1024);

function freeArray() { this.array = null; }

export class World {
  constructor(scene, material, hooks = {}, { worker = true } = {}) {
    this.scene = scene;
    this.material = material;
    this.hooks = hooks;
    this.halls = new Map();
    this.inflight = 0;
    this.maxInflight = 3;
    this.req = 0;                 // every request is numbered; stale answers are dropped
    this.lastKey = -1;
    this.lastHall = null;
    this.generated = 0;
    this.worker = null;
    this.sync = null;
    this.syncQueue = null;
    this.last = { focus: [NaN, NaN, NaN], radius: -1, unload: true, time: -Infinity };
    if (worker) this.startWorker();
  }

  startWorker() {
    try {
      this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => this.receive(e.data);
      this.worker.onerror = (e) => {
        console.warn('generation worker failed, generating on the main thread', e.message);
        this.worker.terminate();
        this.worker = null;
        this.inflight = 0;
        for (const h of this.halls.values()) if (h.state === 'requested') h.state = 'queued';
      };
      this.worker.postMessage({ type: 'seed', seed: getSeed() });
    } catch (err) {
      console.warn('module workers unavailable, generating on the main thread', err);
      this.worker = null;
    }
  }

  voxel(x, y, z) {
    const hx = Math.floor(x / HALL), hy = Math.floor(y / HALL), hz = Math.floor(z / HALL);
    const k = hkey(hx, hy, hz);
    let h;
    if (k === this.lastKey) h = this.lastHall;
    else { h = this.halls.get(k); this.lastKey = k; this.lastHall = h; }
    if (!h || !h.grid) return UNKNOWN;
    return h.grid[(x - hx * HALL) + HALL * ((y - hy * HALL) + HALL * (z - hz * HALL))];
  }

  isReady(hx, hy, hz) {
    const h = this.halls.get(hkey(hx, hy, hz));
    return !!(h && h.state === 'ready');
  }

  // Load every hall whose box lies within `radius` of `focus`; drop those well beyond
  // (unless `unload` is false). Cheap to call every frame: it only plans again once the
  // focus has moved a little, the radius has changed, or a quarter of a second has passed.
  update(focus, radius, { unload = true, now = performance.now() } = {}) {
    const L = this.last;
    const moved = Math.abs(focus[0] - L.focus[0]) + Math.abs(focus[1] - L.focus[1]) + Math.abs(focus[2] - L.focus[2]);
    if (moved < 2 && radius === L.radius && unload === L.unload && now - L.time < 250) return;
    L.focus[0] = focus[0]; L.focus[1] = focus[1]; L.focus[2] = focus[2];
    L.radius = radius; L.unload = unload; L.time = now;

    const r = Math.ceil(radius / HALL) + 1;
    const cx = Math.floor(focus[0] / HALL), cy = Math.floor(focus[1] / HALL), cz = Math.floor(focus[2] / HALL);
    for (let hx = cx - r; hx <= cx + r; hx++) for (let hy = cy - r; hy <= cy + r; hy++) for (let hz = cz - r; hz <= cz + r; hz++) {
      const d = boxDist(focus, hx, hy, hz);
      if (d > radius) continue;
      const k = hkey(hx, hy, hz);
      let h = this.halls.get(k);
      if (!h) {
        h = { key: k, hx, hy, hz, state: 'queued', grid: null, occ: null, mesh: null, d, req: 0 };
        this.halls.set(k, h);
        this.lastKey = -1;
      }
      h.d = d;
    }
    for (const h of this.halls.values()) {
      h.d = boxDist(focus, h.hx, h.hy, h.hz);
      if (unload && h.d > radius + HALL * 0.75) this.unload(h);
    }
    this.pump();
  }

  pump() {
    let queued = null;
    for (const h of this.halls.values()) if (h.state === 'queued') (queued ||= []).push(h);
    if (!queued) { this.syncQueue = null; return; }
    queued.sort((a, b) => a.d - b.d);
    if (this.worker) {
      for (const h of queued) {
        if (this.inflight >= this.maxInflight) break;
        h.state = 'requested';
        h.req = ++this.req;
        this.inflight++;
        this.worker.postMessage({ type: 'gen', req: h.req, hx: h.hx, hy: h.hy, hz: h.hz });
      }
    } else {
      this.syncQueue = queued;
    }
  }

  // Main-thread fallback: generate a little every frame.
  async tickSync(budgetMs = 8) {
    if (this.worker || !this.syncQueue || !this.syncQueue.length) return;
    if (!this.sync) this.sync = await import('./hall.js');
    const t0 = performance.now();
    while (this.syncQueue && this.syncQueue.length && performance.now() - t0 < budgetMs) {
      const h = this.syncQueue.shift();
      if (h.state !== 'queued' || this.halls.get(h.key) !== h) continue;
      h.state = 'requested';
      h.req = ++this.req;
      const res = this.sync.generateHall(h.hx, h.hy, h.hz);
      this.receive({ type: 'hall', req: h.req, ...res }, false);
    }
  }

  receive(msg, fromWorker = true) {
    if (fromWorker) this.inflight = Math.max(0, this.inflight - 1);
    const h = this.halls.get(hkey(msg.hx, msg.hy, msg.hz));
    const current = h && h.state === 'requested' && h.req === msg.req;
    if (msg.type === 'error') {
      console.error('hall generation failed', msg.hx, msg.hy, msg.hz, msg.message);
      if (current) h.state = 'failed';
      this.pump();
      return;
    }
    if (!current) { this.pump(); return; }   // dropped while it was being drawn
    h.grid = msg.grid;
    h.occ = msg.occ;
    h.state = 'ready';
    h.mood = msg.mood;
    const g = new THREE.BufferGeometry();
    // 16-bit position and material id, interleaved; 8-bit normals (see packMesh in hall.js)
    const pm = new THREE.InterleavedBuffer(msg.mesh.position, 4);
    const nm = new THREE.BufferAttribute(msg.mesh.normal, 4, true);
    g.setAttribute('position', new THREE.InterleavedBufferAttribute(pm, 4, 0, true));
    g.setAttribute('aMat', new THREE.InterleavedBufferAttribute(pm, 1, 3, true));
    g.setAttribute('normal', nm);
    g.computeBoundingSphere();
    // The graphics card keeps its own copy; ours is let go once it has been uploaded.
    pm.onUpload(freeArray);
    nm.onUpload(freeArray);
    h.meshBytes = msg.mesh.position.byteLength + msg.mesh.normal.byteLength;
    const mesh = new THREE.Mesh(g, this.material);
    mesh.position.set((h.hx + 0.5) * HALL, (h.hy + 0.5) * HALL, (h.hz + 0.5) * HALL);
    mesh.scale.setScalar(MESH_SCALE);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.scene.add(mesh);
    h.mesh = mesh;
    h.npcs = msg.npcs;
    this.lastKey = -1;
    this.generated++;
    if (this.hooks.onLoad) this.hooks.onLoad(h);
    this.pump();
  }

  unload(h) {
    if (h.mesh) {
      this.scene.remove(h.mesh);
      h.mesh.geometry.dispose();
      h.mesh = null;
    }
    if (h.state === 'ready' && this.hooks.onUnload) this.hooks.onUnload(h);
    h.state = 'dead';
    h.grid = h.occ = h.npcs = null;
    this.halls.delete(h.key);
    this.lastKey = -1;
    this.lastHall = null;
  }

  // Drop every hall except those `keep` returns true for, forget work still pending for
  // them, and empty the generator's caches. Used when a walk ends, so nothing it loaded
  // stays behind, and when the graphics context has to be rebuilt.
  release(keep = () => false) {
    for (const h of [...this.halls.values()]) if (!keep(h)) this.unload(h);
    this.syncQueue = null;
    this.last.radius = -1;   // plan again on the next update
    if (this.worker) this.worker.postMessage({ type: 'flush' });
    else if (this.sync) this.sync.clearCaches();
  }

  // The end of a visit: stop the worker and hand back every hall.
  dispose() {
    if (this.worker) { this.worker.terminate(); this.worker = null; }
    for (const h of [...this.halls.values()]) this.unload(h);
    this.syncQueue = null;
    if (this.sync) this.sync.clearCaches();
  }

  pendingWithin(focus, radius) {
    let n = 0;
    for (const h of this.halls.values()) if (h.state !== 'ready' && h.state !== 'failed' && h.d <= radius) n++;
    return n;
  }
}

export function boxDist(p, hx, hy, hz) {
  let d2 = 0;
  for (let i = 0; i < 3; i++) {
    const lo = (i === 0 ? hx : i === 1 ? hy : hz) * HALL;
    const v = p[i];
    if (v < lo) d2 += (lo - v) ** 2;
    else if (v > lo + HALL) d2 += (v - lo - HALL) ** 2;
  }
  return Math.sqrt(d2);
}

export { hkey };
