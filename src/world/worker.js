// Generation worker: builds halls off the main thread and ships back voxels + geometry.

import { setSeed } from '../core/constants.js';
import { generateHall, clearCaches } from './hall.js';

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'seed') {
    setSeed(msg.seed);
    clearCaches();
    return;
  }
  if (msg.type === 'flush') {
    // a walk ended: forget everything remembered about the halls it passed through
    clearCaches();
    return;
  }
  if (msg.type === 'gen') {
    try {
      const h = generateHall(msg.hx, msg.hy, msg.hz);
      self.postMessage(
        { type: 'hall', req: msg.req, hx: h.hx, hy: h.hy, hz: h.hz, grid: h.grid, occ: h.occ, mesh: h.mesh, npcs: h.npcs, mood: h.mood },
        [h.grid.buffer, h.occ.buffer, h.mesh.position.buffer, h.mesh.normal.buffer],
      );
    } catch (err) {
      self.postMessage({ type: 'error', req: msg.req, hx: msg.hx, hy: msg.hy, hz: msg.hz, message: String(err && err.stack || err) });
    }
  }
};
