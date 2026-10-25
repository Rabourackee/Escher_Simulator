// Shared constants for the generator, the renderer and the player.
// One voxel is roughly half a metre; a person is ~3.5 voxels tall.

export const HALL = 40;               // voxels per hall edge; one hall == one streamed chunk
export const HALL3 = HALL * HALL * HALL;
// Hall meshes are stored as 16-bit positions around the hall's centre, spanning this many
// voxels either way (a precision of about a thousandth of a voxel).
export const MESH_SCALE = 64;

// Voxel types
export const AIR = 0;
export const SOLID = 1;      // stone: every face of it is a floor for somebody
export const SOLID_NT = 2;   // solid, but you cannot step onto its faces (columns, tree trunks)
export const BARRIER = 3;    // railings and window bars: block the body, never a floor
export const UNKNOWN = 4;    // a hall that is still being generated: treated as stone
export const WEDGE0 = 16;    // 16..27: 45 degree stair wedges (see cube.js for orientation)
export const WEDGE1 = 28;

export const isWedge = (t) => t >= WEDGE0 && t < WEDGE1;
export const isSolidish = (t) => t === SOLID || t === SOLID_NT || t === BARRIER || isWedge(t);

// Material ids, stored per vertex and read by the etching shader.
export const MAT = {
  STONE: 0,
  STAIR: 1,
  TRIM: 2,
  WOOD: 3,
  SOIL: 4,
  LEAF: 5,
  BARK: 6,
  FIGURE: 7,
  IRON: 8,
  DARK: 9,
  PLASTER: 10,
};

export const PLAYER = {
  radius: 0.45,
  height: 3.5,
  eye: 3.15,
  stepUp: 1.05,
  stepDown: 1.1,
  walk: 7.0,
  run: 13.0,
  jump: 8.4,         // take-off speed, voxels per second (a hop of about 1.4 voxels)
  gravity: 25,       // voxels per second squared
  terminal: 46,
  airRadius: 0.28,   // a slimmer body while airborne, so falls slip past ledge corners
  maxFall: 3.2,      // seconds of falling before the plate is redrawn at the jump spot
};

let seed = 0x51a7e;
export function getSeed() { return seed; }
export function setSeed(s) { seed = s >>> 0; }
