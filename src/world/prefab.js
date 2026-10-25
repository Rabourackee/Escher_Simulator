// The hand-built halls at the origin of the endless world: the hall of Relativity (see
// printhall.js) and the two gardens seen from it. Everything else is generated.

import { PRINT_CAMERA, PRINT_WALLS, PRINT_FIGURES, buildPrintHall, buildParkB, buildParkC } from './printhall.js';

export const START = {
  camera: PRINT_CAMERA,
  focus: [18, 30, 10],
  fog: [95, 175],
  radius: 70,     // loads only what the print's camera can actually see
  readyRadius: 52,
  figures: PRINT_FIGURES,
};

const PREFAB = new Map([
  ['0,0,0', buildPrintHall],
  ['0,0,-1', buildParkB],
  ['0,1,0', buildParkC],
]);

export function isPrefabHall(hx, hy, hz) { return PREFAB.has(`${hx},${hy},${hz}`); }

export function prefabWall(a, i, j, k) {
  const key = `${a}|${i}|${j}|${k}`;
  if (!(key in PRINT_WALLS)) return undefined;
  const w = PRINT_WALLS[key];
  return w ? { axis: a, h: [i, j, k], openings: w.openings } : null;
}

export function buildPrefabHall(ctx, rng) {
  const build = PREFAB.get(`${ctx.hx},${ctx.hy},${ctx.hz}`);
  if (build) build(ctx, rng);
}
