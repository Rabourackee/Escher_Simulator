// Streams halls around a focus point, like Minecraft chunks: the closest missing halls are
// generated first (in a worker), far halls are dropped. Also answers voxel queries for
// the walker's collision.

import * as THREE from '../../vendor/three/three.module.min.js';
import { HALL, SOLID, getSeed } from '../core/constants.js';

const hkey = (hx, hy, hz) => ((hx + 1024) * 2048 + (hy + 1024)) * 2048 + (hz + 1024);

export class World {
  constructor(scene, material, hooks = {}) {
    this.scene = scene;
    this.material = material;
    this.hooks = hooks;
    this.halls = new Map();
    this.queue = [];
    this.inflight = 0;
    this.maxInflight = 3;
    this.lastKey = -1;
    this.lastHall = null;
    this.generated = 0;
    this.worker = null;
    this.sync = null;
    try {
      this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => this.receive(e.data);
      this.worker.onerror = (e) => {
        console.warn('generation worker failed, generating on the main thread', e.message);
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
    if (!h || !h.grid) return SOLID;
    return h.grid[(x - hx * HALL) + HALL * ((y - hy * HALL) + HALL * (z - hz * HALL))];
  }

  isReady(hx, hy, hz) {
    const h = this.halls.get(hkey(hx, hy, hz));
    return !!(h && h.state === 'ready');
  }

  // Load every hall whose box lies within `radius` of `focus`; drop those beyond.
  update(focus, radius) {
    const lo = [0, 1, 2].map((i) => Math.floor((focus[i] - radius) / HALL));
    const hi = [0, 1, 2].map((i) => Math.floor((focus[i] + radius) / HALL));
    const want = [];
    for (let hx = lo[0]; hx <= hi[0]; hx++) for (let hy = lo[1]; hy <= hi[1]; hy++) for (let hz = lo[2]; hz <= hi[2]; hz++) {
      const d = boxDist(focus, hx, hy, hz);
      if (d <= radius) want.push([d, hx, hy, hz]);
    }
    want.sort((a, b) => a[0] - b[0]);
    for (const [d, hx, hy, hz] of want) {
      const k = hkey(hx, hy, hz);
      let h = this.halls.get(k);
      if (!h) {
        h = { key: k, hx, hy, hz, state: 'queued', grid: null, mesh: null, d };
        this.halls.set(k, h);
        this.lastKey = -1;
      }
      h.d = d;
    }
    for (const h of this.halls.values()) {
      if (h.state === 'requested') continue;
      const d = boxDist(focus, h.hx, h.hy, h.hz);
      h.d = d;
      if (d > radius + HALL * 0.75) this.unload(h);
    }
    this.pump();
  }

  pump() {
    const queued = [];
    for (const h of this.halls.values()) if (h.state === 'queued') queued.push(h);
    if (!queued.length) return;
    queued.sort((a, b) => a.d - b.d);
    if (this.worker) {
      for (const h of queued) {
        if (this.inflight >= this.maxInflight) break;
        h.state = 'requested';
        this.inflight++;
        this.worker.postMessage({ type: 'gen', hx: h.hx, hy: h.hy, hz: h.hz });
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
    while (this.syncQueue.length && performance.now() - t0 < budgetMs) {
      const h = this.syncQueue.shift();
      if (h.state !== 'queued') continue;
      const res = this.sync.generateHall(h.hx, h.hy, h.hz);
      h.state = 'requested';
      this.receive({ type: 'hall', ...res }, false);
    }
  }

  receive(msg, fromWorker = true) {
    if (fromWorker) this.inflight = Math.max(0, this.inflight - 1);
    if (msg.type === 'error') {
      console.error('hall generation failed', msg.hx, msg.hy, msg.hz, msg.message);
      const h = this.halls.get(hkey(msg.hx, msg.hy, msg.hz));
      if (h) h.state = 'failed';
      this.pump();
      return;
    }
    const k = hkey(msg.hx, msg.hy, msg.hz);
    const h = this.halls.get(k);
    if (!h || h.state !== 'requested') { this.pump(); return; }
    h.grid = msg.grid;
    h.occ = msg.occ;
    h.state = 'ready';
    h.mood = msg.mood;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(msg.mesh.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(msg.mesh.normal, 3));
    g.setAttribute('aMat', new THREE.BufferAttribute(msg.mesh.mat, 1));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.material);
    mesh.matrixAutoUpdate = false;
    this.scene.add(mesh);
    h.mesh = mesh;
    h.npcs = msg.npcs;
    h.figures = msg.figures;
    this.lastKey = -1;
    this.generated++;
    if (this.hooks.onLoad) this.hooks.onLoad(h);
    this.pump();
  }

  unload(h) {
    if (h.mesh) {
      this.scene.remove(h.mesh);
      h.mesh.geometry.dispose();
    }
    if (h.state === 'ready' && this.hooks.onUnload) this.hooks.onUnload(h);
    h.state = 'dead';
    this.halls.delete(h.key);
    this.lastKey = -1;
  }

  pendingWithin(focus, radius) {
    let n = 0;
    for (const h of this.halls.values()) if (h.state !== 'ready' && h.state !== 'failed' && h.d <= radius) n++;
    return n;
  }
}

function boxDist(p, hx, hy, hz) {
  let d2 = 0;
  const b = [hx * HALL, hy * HALL, hz * HALL];
  for (let i = 0; i < 3; i++) {
    const v = p[i];
    if (v < b[i]) d2 += (b[i] - v) ** 2;
    else if (v > b[i] + HALL) d2 += (v - b[i] - HALL) ** 2;
  }
  return Math.sqrt(d2);
}

export { hkey };
