// Stress test: several walkers wander through the real generated world with random
// steering. After every simulated frame the body must be free, the feet must be on
// something, and the position must stay finite.
// Run: node tests/wander.test.mjs [seconds-per-walker]

import * as THREE from '../vendor/three/three.module.min.js';
import { generateHall } from '../src/world/hall.js';
import { START } from '../src/world/prefab.js';
import { Player } from '../src/player/controller.js';
import { HALL, PLAYER } from '../src/core/constants.js';
import { DIRS, DIR_NAMES, axisOf, signOf } from '../src/core/cube.js';

const SECONDS = Number(process.argv[2] || 120);
const cache = new Map();
const world = {
  voxel(x, y, z) {
    const hx = Math.floor(x / HALL), hy = Math.floor(y / HALL), hz = Math.floor(z / HALL);
    const k = `${hx},${hy},${hz}`;
    let h = cache.get(k);
    if (!h) {
      if (cache.size > 400) cache.clear();
      h = generateHall(hx, hy, hz, { geometry: false });
      cache.set(k, h);
    }
    return h.grid[(x - hx * HALL) + HALL * ((y - hy * HALL) + HALL * (z - hz * HALL))];
  },
};

let seed = 12345;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

let failures = 0;
const stats = { transitions: 0, halls: new Set(), ups: new Set(), distance: 0, jumps: 0, landings: 0, redraws: 0 };

function invariant(p, frame, label) {
  const pos = [p.pos.x, p.pos.y, p.pos.z];
  if (!pos.every(Number.isFinite)) return `non-finite position at frame ${frame}`;
  const t = p.height();
  if (p.bodyHits(pos, p.up, t)) return `body inside stone at ${pos.map((v) => v.toFixed(2))} up ${DIR_NAMES[p.up]} (frame ${frame})`;
  const g = p.groundAt(pos, p.up, t + 0.05, t - 0.05);
  if (typeof g !== 'number') return `nothing underfoot at ${pos.map((v) => v.toFixed(2))} up ${DIR_NAMES[p.up]} (frame ${frame}, ground ${g})`;
  return null;
}

const starts = START.figures.slice(0, 16);
const t0 = Date.now();
for (let i = 0; i < starts.length; i++) {
  const f = starts[i];
  const p = new Player(world);
  p.spawn(f.stand ?? f.pos, f.up, new THREE.Vector3(...DIRS[f.face]));
  p.onTransition = () => stats.transitions++;
  p.onLand = () => stats.landings++;
  p.onRespawn = () => stats.redraws++;
  let steer = 0, run = false, problem = invariant(p, 0, f.label);
  const frames = SECONDS * 60;
  const last = p.pos.clone();
  for (let fr = 1; fr <= frames && !problem; fr++) {
    if (fr % 45 === 0) { steer = (rand() - 0.5) * 3.2; run = rand() < 0.3; }
    if (fr % 600 === 0 && rand() < 0.5) p.look(Math.PI * (rand() - 0.5) * 2, 0);
    p.look(steer / 60, 0);
    const jump = !p.air && rand() < 0.012;
    if (jump) stats.jumps++;
    p.update(1 / 60, { fwd: rand() < 0.97 ? 1 : 0, strafe: rand() < 0.1 ? (rand() < 0.5 ? -1 : 1) : 0, run, jump });
    stats.distance += p.pos.distanceTo(last);
    last.copy(p.pos);
    stats.ups.add(p.up);
    stats.halls.add([0, 1, 2].map((k) => Math.floor(p.pos.getComponent(k) / HALL)).join(','));
    if (!p.air) problem = invariant(p, fr, f.label);
    else if (![p.pos.x, p.pos.y, p.pos.z].every(Number.isFinite)) problem = `non-finite position in the air at frame ${fr}`;
  }
  if (problem) { failures++; console.log(`  FAIL walker ${i} (${f.label}): ${problem}`); }
  else console.log(`  ok   walker ${i} (${f.label}) ended in hall ${[0, 1, 2].map((k) => Math.floor(p.pos.getComponent(k) / HALL)).join(',')} with gravity ${DIR_NAMES[p.up ^ 1]}`);
}
console.log(`\n${starts.length} walkers x ${SECONDS}s: ${stats.transitions} gravity changes, ${stats.jumps} jumps, ${stats.landings} landings, ` +
  `${stats.redraws} falls into the void redrawn, ${stats.halls.size} halls visited, ` +
  `${[...stats.ups].length} of 6 gravities used, ${(stats.distance / 2000).toFixed(1)} km walked (1 voxel = 0.5 m), ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(failures ? `${failures} walker(s) broke an invariant` : 'no walker ever entered stone or lost its footing');
process.exit(failures ? 1 : 0);
