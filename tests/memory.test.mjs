// Memory hygiene: halls are freed when you move away, the end of a walk leaves exactly
// what a fresh start would have, nothing accumulates over repeated walks, answers for
// halls that were dropped meanwhile are ignored, and shutting down frees everything.
// Run: node tests/memory.test.mjs

import * as THREE from '../vendor/three/three.module.min.js';
import { World, boxDist } from '../src/world/world.js';
import { Walkers } from '../src/render/figures.js';
import { wallCacheSizes } from '../src/world/walls.js';
import { generateHall } from '../src/world/hall.js';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok   ${name}${detail ? ` (${detail})` : ''}`);
  else { failures++; console.log(`  FAIL ${name} ${detail}`); }
}

const PRINT = [18, 30, 10];
const R = 50;

const scene = new THREE.Scene();
const material = new THREE.MeshBasicMaterial();
const walkers = new Walkers(scene, material, 12);
let liveGeometries = 0;
const world = new World(scene, material, {
  onLoad: (h) => {
    liveGeometries++;
    h.mesh.geometry.addEventListener('dispose', () => { liveGeometries--; });
    if (h.npcs && h.npcs.length) walkers.addHall(h.key, h.npcs);
  },
  onUnload: (h) => walkers.removeHall(h.key),
}, { worker: false });

let clock = 0;
async function settle(focus, radius) {
  for (let i = 0; i < 2000; i++) {
    clock += 300;
    world.update(focus, radius, { now: clock });
    await world.tickSync(1e9);
    walkers.update(1 / 60, new THREE.Vector3(...focus), 60);
    if (world.pendingWithin(focus, radius) === 0 && !(world.syncQueue && world.syncQueue.length)) return;
  }
  throw new Error('world never settled');
}

const state = () => ({
  halls: world.halls.size,
  meshes: scene.children.filter((o) => o.isMesh && !o.isSkinnedMesh).length,
  geometries: liveGeometries,
  walkerData: walkers.all.size,
  figures: walkers.figures.length,
});
const same = (a, b) => a.halls === b.halls && a.meshes === b.meshes && a.geometries === b.geometries && a.walkerData === b.walkerData;
const fmt = (s) => `${s.halls} halls, ${s.meshes} meshes, ${s.geometries} live geometries, ${s.walkerData} walkers, ${s.figures} figures`;

console.log('a fresh start');
await settle(PRINT, R);
const fresh = state();
check('only the halls near the print are loaded', [...world.halls.values()].every((h) => boxDist(PRINT, h.hx, h.hy, h.hz) <= R), fmt(fresh));
check('every loaded hall has exactly one mesh', fresh.meshes === fresh.halls && fresh.geometries === fresh.halls);

console.log('three long walks, each ending back at the print');
const caches = [];
for (let c = 0; c < 3; c++) {
  const far = [PRINT[0] + 400 * (c + 1), PRINT[1] - 80 * c, PRINT[2] - 300 * (c + 1)];
  await settle(far, R);
  const away = state();
  check(`walk ${c + 1}: nothing near the print is still held while far away`,
    [...world.halls.values()].every((h) => boxDist(far, h.hx, h.hy, h.hz) <= R + 30), fmt(away));
  // the end of a walk, exactly as the app does it
  world.release((h) => boxDist(PRINT, h.hx, h.hy, h.hz) <= R);
  await settle(PRINT, R);
  const back = state();
  check(`walk ${c + 1}: back at the print, the world is exactly as at a fresh start`, same(back, fresh), fmt(back));
  caches.push(wallCacheSizes());
}
check('figures for walkers stay within their pool', walkers.figures.length <= walkers.max, `${walkers.figures.length} of at most ${walkers.max}`);
const c = wallCacheSizes();
check('the generator\'s caches stay small', c.specs <= 4001 && c.exists <= 20001, JSON.stringify(c));

console.log('answers for halls dropped while they were being drawn are ignored');
{
  const posted = [];
  const s2 = new THREE.Scene();
  const w2 = new World(s2, material, {}, { worker: false });
  w2.worker = { postMessage: (m) => posted.push(m), terminate() {} };   // a stand-in worker
  w2.update(PRINT, R, { now: 0 });
  const gens = posted.filter((m) => m.type === 'gen');
  check('requests go out a few at a time', gens.length === w2.maxInflight, `${gens.length} in flight`);
  w2.release();
  check('the end of a walk tells the worker to empty its caches', posted.some((m) => m.type === 'flush'));
  for (const m of gens) {
    const h = generateHall(m.hx, m.hy, m.hz);
    w2.receive({ type: 'hall', req: m.req, ...h });
  }
  check('their answers do not come back as meshes', s2.children.length === 0 && w2.halls.size === 0, `${s2.children.length} meshes`);
  check('and the request count is settled', w2.inflight === 0);
  w2.dispose();
}

console.log('the end of a visit');
world.dispose();
walkers.dispose();
const end = state();
check('every hall and mesh is freed', end.halls === 0 && end.meshes === 0 && end.geometries === 0, fmt(end));
check('every walker and figure is gone', end.walkerData === 0 && end.figures === 0 && scene.children.length === 0, `${scene.children.length} objects left in the scene`);

console.log(failures ? `\n${failures} check(s) failed` : '\nall memory checks passed');
process.exit(failures ? 1 : 0);
