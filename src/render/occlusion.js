// A 3D texture of "how solid is this voxel" around the viewer. The etching shader reads
// it (with trilinear filtering) to darken corners and recesses and to cast short local
// shadows by marching toward the light. Only stone near the viewer counts, which is what
// lets a lattice of closed halls still be lit from "outside".

import * as THREE from '../../vendor/three/three.module.min.js';
import { HALL } from '../core/constants.js';
import { hkey } from '../world/world.js';

export class OccVolume {
  constructor(world, size = 112) {
    this.world = world;
    this.S = size;
    this.data = new Uint8Array(size * size * size);
    const tex = new THREE.Data3DTexture(this.data, size, size, size);
    tex.format = THREE.RedFormat;
    tex.type = THREE.UnsignedByteType;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;
    this.texture = tex;
    this.origin = new THREE.Vector3(1e9, 1e9, 1e9);
    this.dirty = true;
    this.lastBuild = -1e9;
  }

  dispose() {
    this.texture.dispose();
  }

  markDirty(h) {
    const o = this.origin, S = this.S;
    const x = h.hx * HALL, y = h.hy * HALL, z = h.hz * HALL;
    if (x < o.x + S && x + HALL > o.x && y < o.y + S && y + HALL > o.y && z < o.z + S && z + HALL > o.z) this.dirty = true;
  }

  update(center, now) {
    const snap = 8;
    const half = this.S / 2;
    const ox = Math.floor(center.x / snap) * snap - half;
    const oy = Math.floor(center.y / snap) * snap - half;
    const oz = Math.floor(center.z / snap) * snap - half;
    if (ox !== this.origin.x || oy !== this.origin.y || oz !== this.origin.z) {
      this.origin.set(ox, oy, oz);
      this.dirty = true;
      this.lastBuild = -1e9;
    }
    if (this.dirty && now - this.lastBuild > 180) this.rebuild(now);
  }

  rebuild(now) {
    const S = this.S, d = this.data;
    const o = this.origin;
    d.fill(0);
    const h0 = [Math.floor(o.x / HALL), Math.floor(o.y / HALL), Math.floor(o.z / HALL)];
    const h1 = [Math.floor((o.x + S - 1) / HALL), Math.floor((o.y + S - 1) / HALL), Math.floor((o.z + S - 1) / HALL)];
    for (let hx = h0[0]; hx <= h1[0]; hx++) for (let hy = h0[1]; hy <= h1[1]; hy++) for (let hz = h0[2]; hz <= h1[2]; hz++) {
      const h = this.world.halls.get(hkey(hx, hy, hz));
      if (!h || !h.occ) continue;
      const bx = hx * HALL, by = hy * HALL, bz = hz * HALL;
      const x0 = Math.max(bx, o.x), x1 = Math.min(bx + HALL, o.x + S);
      const y0 = Math.max(by, o.y), y1 = Math.min(by + HALL, o.y + S);
      const z0 = Math.max(bz, o.z), z1 = Math.min(bz + HALL, o.z + S);
      const len = x1 - x0;
      if (len <= 0 || y1 <= y0 || z1 <= z0) continue;
      const src = h.occ;
      for (let z = z0; z < z1; z++) {
        for (let y = y0; y < y1; y++) {
          const s = (x0 - bx) + HALL * ((y - by) + HALL * (z - bz));
          const t = (x0 - o.x) + S * ((y - o.y) + S * (z - o.z));
          d.set(src.subarray(s, s + len), t);
        }
      }
    }
    this.texture.needsUpdate = true;
    this.dirty = false;
    this.lastBuild = now;
  }
}
