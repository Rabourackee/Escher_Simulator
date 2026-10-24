// Generation worker: builds halls off the main thread and ships back voxels + geometry.

import { setSeed } from '../core/constants.js';
import { clearWallCaches } from './walls.js';
import { generateHall } from './hall.js';

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'seed') {
    setSeed(msg.seed);
    clearWallCaches();
    return;
  }
  if (msg.type === 'gen') {
    try {
      const h = generateHall(msg.hx, msg.hy, msg.hz);
      self.postMessage(
        { type: 'hall', hx: h.hx, hy: h.hy, hz: h.hz, grid: h.grid, occ: h.occ, mesh: h.mesh, npcs: h.npcs, figures: h.figures, mood: h.mood },
        [h.grid.buffer, h.occ.buffer, h.mesh.position.buffer, h.mesh.normal.buffer, h.mesh.mat.buffer],
      );
    } catch (err) {
      self.postMessage({ type: 'error', hx: msg.hx, hy: msg.hy, hz: msg.hz, message: String(err && err.stack || err) });
    }
  }
};
