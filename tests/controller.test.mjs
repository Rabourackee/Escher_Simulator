// Tests for the magnetic-boots walker against small synthetic voxel worlds.
// Run: node tests/controller.test.mjs

import * as THREE from '../vendor/three/three.module.min.js';
import { Player } from '../src/player/controller.js';
import { AIR, SOLID, BARRIER } from '../src/core/constants.js';
import { PX, NX, PY, NY, PZ, NZ, DIR_NAMES, wedgeType } from '../src/core/cube.js';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name} ${detail}`); }
}

function makePlayer(voxel, pos, up, face) {
  const p = new Player({ voxel });
  const f = new THREE.Vector3(...[[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][face]);
  p.spawn(pos, up, f);
  return p;
}

function walk(p, seconds, fwd = 1, strafe = 0) {
  const ups = [p.up];
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    p.update(1 / 60, { fwd, strafe, run: false });
    if (ups[ups.length - 1] !== p.up) ups.push(p.up);
  }
  return ups;
}

const fmt = (ups) => ups.map((u) => DIR_NAMES[u]).join(' -> ');
const finite = (p) => [p.pos.x, p.pos.y, p.pos.z].every(Number.isFinite);

console.log('inner corner: floor meets wall');
{
  const voxel = (x, y, z) => (y < 0 || x < 0 ? SOLID : AIR);
  const p = makePlayer(voxel, [6, 0, 0.5], PY, NX);
  const ups = walk(p, 2.5);
  check('becomes a wall walker', ups.join() === [PY, PX].join(), fmt(ups));
  check('feet on the wall plane', Math.abs(p.pos.x) < 1e-6, `x=${p.pos.x}`);
  check('kept walking up the wall', p.pos.y > 3, `y=${p.pos.y}`);
}

console.log('outer edge: rolling over the edge of a platform');
{
  const voxel = (x, y, z) => (y < 0 && y >= -3 && x < 10 ? SOLID : AIR);
  const p = makePlayer(voxel, [5, 0, 0.5], PY, PX);
  let steps = 0;
  while (p.up === PY && steps++ < 120) p.update(1 / 60, { fwd: 1, strafe: 0, run: false });
  check('rolls onto the side face', p.up === PX, `up=${DIR_NAMES[p.up]}`);
  check('feet on the side plane', Math.abs(p.pos.x - 10) < 1e-6, `x=${p.pos.x}`);
  walk(p, 1.2);
  check('rolls again under the platform', p.up === NY, `up=${DIR_NAMES[p.up]}`);
  check('feet on the underside', Math.abs(p.pos.y + 3) < 1e-6, `y=${p.pos.y}`);
  check('position stays finite', finite(p));
}

console.log('railing: no roll-over, no fall');
{
  const voxel = (x, y, z) => {
    if (y < 0 && y >= -2 && x < 10) return SOLID;
    if (x === 9 && (y === 0 || y === 1)) return BARRIER;
    return AIR;
  };
  const p = makePlayer(voxel, [5, 0, 0.5], PY, PX);
  const ups = walk(p, 2.0);
  check('still on the floor', ups.length === 1 && p.up === PY, fmt(ups));
  check('stopped at the railing', p.pos.x < 9 && p.pos.x > 8, `x=${p.pos.x}`);
  check('did not sink', Math.abs(p.pos.y) < 1e-6, `y=${p.pos.y}`);
}

console.log('45 degree stair from the floor up to a wall');
{
  // Floor at y < 0, wall at x < 0, stair of length L in the corner (solid below the slope).
  const L = 8;
  const WT = wedgeType(PX, PY);
  const voxel = (x, y, z) => {
    if (y < 0 || x < 0) return SOLID;
    if (x < L && y < L) {
      const s = x + y;
      if (s === L - 1) return WT;
      if (s < L - 1) return SOLID;
    }
    return AIR;
  };
  const p = makePlayer(voxel, [L + 4, 0, 0.5], PY, NX);
  let maxY = 0;
  const ups = [p.up];
  for (let i = 0; i < 60 * 4; i++) {
    p.update(1 / 60, { fwd: 1, strafe: 0, run: false });
    if (p.up === PY) maxY = Math.max(maxY, p.pos.y);
    if (ups[ups.length - 1] !== p.up) ups.push(p.up);
  }
  check('climbed the stair', maxY > L - 1.2, `maxY=${maxY.toFixed(2)}`);
  check('stepped from the top onto the wall', ups.join() === [PY, PX].join(), fmt(ups));
  check('ended above the stair on the wall', p.up === PX && p.pos.y > L, `y=${p.pos.y.toFixed(2)}`);

  // and back down: the wall walker descends the same stair on its risers
  const q = makePlayer(voxel, [0, L + 3, 0.5], PX, NY);
  const ups2 = walk(q, 4);
  check('wall walker uses the risers and steps onto the floor', ups2.join() === [PX, PY].join(), fmt(ups2));
}

console.log('pushing gently along a wall does not flip gravity');
{
  const voxel = (x, y, z) => (y < 0 || x < 0 ? SOLID : AIR);
  const p = makePlayer(voxel, [0.6, 0, 0.5], PY, PZ);
  p.yaw += 0.35; // walking mostly along the wall, slightly into it
  const ups = walk(p, 2.0);
  check('no transition when sliding along', ups.length === 1, fmt(ups));
  check('slid along the wall', p.pos.z > 5, `z=${p.pos.z.toFixed(2)}`);
}

console.log('a slab two voxels thick can be walked all the way around');
{
  const voxel = (x, y, z) => (y < 0 && y >= -2 && x >= 0 && x < 12 ? SOLID : AIR);
  const p = makePlayer(voxel, [3, 0, 0.5], PY, PX);
  const ups = walk(p, 6.0);
  check('top -> end -> bottom -> other end -> top', ups.slice(0, 5).join() === [PY, PX, NY, NX, PY].join(), fmt(ups));
  check('position stays finite', finite(p));
}

console.log('jumping off a ledge lands on the ground below, keeping gravity');
{
  // a raised platform (top at y = 6) for x < 10 above a floor at y = 0
  const voxel = (x, y, z) => ((y < 0) || (y >= 4 && y < 6 && x < 10) ? SOLID : AIR);
  const p = makePlayer(voxel, [8.5, 6, 0.5], PY, PX);
  p.update(1 / 60, { fwd: 1, strafe: 0, run: false, jump: true });
  check('leaves the ground', p.air === true);
  let frames = 0;
  while (p.air && frames++ < 300) p.update(1 / 60, { fwd: 1, strafe: 0, run: false });
  check('lands', !p.air, `frames=${frames}`);
  check('on the floor below with the same gravity', p.up === PY && Math.abs(p.pos.y) < 1e-6 && p.pos.x > 10, `pos=${p.pos.toArray().map((v) => v.toFixed(2))}`);
}

console.log('a running jump up onto a ledge two voxels high');
{
  const voxel = (x, y, z) => (y < 0 || (x >= 6 && y < 2) ? SOLID : AIR);
  const p = makePlayer(voxel, [3, 0, 0.5], PY, PX);
  let jumped = false;
  for (let i = 0; i < 120; i++) {
    const jump = !jumped && p.pos.x > 4.6;
    if (jump) jumped = true;
    p.update(1 / 60, { fwd: 1, strafe: 0, run: false, jump });
  }
  check('stands on the ledge', !p.air && Math.abs(p.pos.y - 2) < 1e-6 && p.pos.x > 6, `pos=${p.pos.toArray().map((v) => v.toFixed(2))}`);
}

console.log('a low ceiling stops the jump');
{
  const voxel = (x, y, z) => (y < 0 || y >= 4 ? SOLID : AIR);
  const p = makePlayer(voxel, [3, 0, 0.5], PY, PX);
  let maxY = 0;
  p.update(1 / 60, { fwd: 0, strafe: 0, run: false, jump: true });
  for (let i = 0; i < 90; i++) { p.update(1 / 60, { fwd: 0, strafe: 0, run: false }); maxY = Math.max(maxY, p.pos.y); }
  check('head never enters the ceiling', maxY + 3.5 <= 4 + 1e-6, `max feet ${maxY.toFixed(3)}`);
  check('back on the floor', !p.air && Math.abs(p.pos.y) < 1e-6);
}

console.log('falling waits for a hall that is still being drawn');
{
  const UNKNOWN = 4;
  let loaded = false;
  const voxel = (x, y, z) => {
    if (y >= 10 && y < 12 && x < 5) return SOLID;   // the platform we jump from
    if (y < -20) return loaded ? (y < -30 ? SOLID : AIR) : UNKNOWN;
    return AIR;
  };
  const p = makePlayer(voxel, [4.5, 12, 0.5], PY, PX);
  p.update(1 / 60, { fwd: 1, strafe: 0, run: false, jump: true });
  for (let i = 0; i < 150; i++) p.update(1 / 60, { fwd: i < 40 ? 1 : 0, strafe: 0, run: false });
  check('hovers above the unknown hall', p.air && p.pos.y > -21, `y=${p.pos.y.toFixed(2)}`);
  loaded = true;
  for (let i = 0; i < 200 && p.air; i++) p.update(1 / 60, { fwd: 0, strafe: 0, run: false });
  check('then lands once it exists', !p.air && Math.abs(p.pos.y + 30) < 1e-6, `y=${p.pos.y.toFixed(2)}`);
}

console.log('jumping into the void: the plate is redrawn at the jump spot');
{
  const voxel = (x, y, z) => (y < 0 && y >= -2 && x < 6 ? SOLID : AIR);
  const p = makePlayer(voxel, [5, 0, 0.5], PY, PX);
  let respawned = false;
  p.onRespawn = () => { respawned = true; };
  p.update(1 / 60, { fwd: 1, strafe: 0, run: false, jump: true });
  for (let i = 0; i < 60 * 5 && !respawned; i++) p.update(1 / 60, { fwd: 1, strafe: 0, run: false });
  check('redrawn after the fall', respawned && !p.air);
  check('back where the jump began', Math.abs(p.pos.x - 5) < 1e-6 && Math.abs(p.pos.y) < 1e-6, `pos=${p.pos.toArray().map((v) => v.toFixed(2))}`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall controller checks passed');
process.exit(failures ? 1 : 0);
