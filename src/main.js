// App: the title "print", the step into a figure, walking, pausing.

import * as THREE from '../vendor/three/three.module.min.js';
import { HALL, setSeed } from './core/constants.js';
import { DIRS, DIR_NAMES } from './core/cube.js';
import { EtchRenderer, createEtchMaterial, LIGHT_DIR } from './render/etch.js';
import { Figure, Walkers, frameQuaternion, disposeFigureAssets } from './render/figures.js';
import { World, boxDist } from './world/world.js';
import { OccVolume } from './render/occlusion.js';
import { Player } from './player/controller.js';
import { Input } from './player/input.js';
import { START } from './world/prefab.js';

const params = new URLSearchParams(location.search);
if (params.has('seed')) setSeed(Number(params.get('seed')) >>> 0);
if (params.has('shot')) document.body.classList.add('shot');
const vec3Param = (name) => (params.has(name) ? params.get(name).split(',').map(Number) : null);
if (vec3Param('cam')) START.camera.pos = vec3Param('cam');
// ?frame: the print fills the window exactly (for comparing renders with the print)
const FRAME_ONLY = params.has('frame');
if (FRAME_ONLY) document.body.classList.add('frame');

const WALK_FOG = [22, 64];
const INTRO_FOG = START.fog;
const WALK_RADIUS = 70;
const INTRO_RADIUS = START.radius;
const SENS = 0.0021;

// ---------------------------------------------------------------- renderer & scene
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
if (!renderer.capabilities.isWebGL2) document.getElementById('loading').textContent = 'This piece needs WebGL 2.';
const etch = new EtchRenderer(renderer);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(START.camera.fov, 1, 0.05, 700);
scene.add(camera);

const shared = {
  uLightDir: { value: LIGHT_DIR },
  uAmbient: { value: 0.52 },
  uOcc: { value: null },
  uOccOrigin: { value: new THREE.Vector3() },
  uOccInv: { value: 1 },
  uOccOn: { value: params.has('noao') ? 0 : 1 },
  uShadowAmt: { value: params.has('shadows') ? 1 : 0 },
  uFogFar: { value: 1000 },
  uDensity: { value: 0.18 },
  uHatchOn: { value: params.has('outline') ? 0 : 1 },
};
const hallMaterial = createEtchMaterial(shared, { packed: true });
const walkerMaterial = createEtchMaterial(shared);

const walkers = new Walkers(scene, walkerMaterial);
let occ = null;
const world = new World(scene, hallMaterial, {
  onLoad: (h) => {
    if (h.npcs && h.npcs.length) walkers.addHall(h.key, h.npcs);
    if (occ) occ.markDirty(h);
  },
  onUnload: (h) => walkers.removeHall(h.key),
});
occ = new OccVolume(world);
shared.uOcc.value = occ.texture;
shared.uOccInv.value = 1 / occ.S;
const player = new Player(world);
const input = new Input(canvas);

// ---------------------------------------------------------------- the print's inhabitants
const withMat = (geo, id) => {
  geo.setAttribute('aMat', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count).fill(id), 1));
  return geo;
};
const figures = START.figures.map((def) => {
  const mat = createEtchMaterial(shared);
  const fig = new Figure(mat);
  fig.pose(def.pose, def.phase || 0);
  fig.place(def.pos, def.up, def.face);
  scene.add(fig.mesh);
  if (def.prop === 'sack') {
    fig.addProp(withMat(new THREE.SphereGeometry(0.34, 10, 8).scale(1, 0.8, 0.9), 7), 1, mat, [0.05, 0.55, -0.32]);
  } else if (def.prop === 'book') {
    fig.addProp(withMat(new THREE.BoxGeometry(0.42, 0.05, 0.3), 3), 4, mat, [-0.18, -0.52, 0.12]);
  } else if (def.prop === 'basket') {
    fig.addProp(withMat(new THREE.CylinderGeometry(0.3, 0.22, 0.34, 10), 3), 6, mat, [0, -0.62, 0.1]);
  }
  const U = new THREE.Vector3(...DIRS[def.up]);
  const proxy = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 4.6, 8));
  proxy.position.set(...def.pos).addScaledVector(U, 1.9);
  frameQuaternion(def.up, def.face, proxy.quaternion);
  proxy.updateMatrixWorld();
  const f = { def, fig, mat, proxy, U };
  proxy.userData.f = f;
  return f;
});

// ---------------------------------------------------------------- UI
const ui = {
  intro: document.getElementById('intro'),
  label: document.getElementById('label'),
  hud: document.getElementById('hud'),
  gname: document.getElementById('gname'),
  gravity: document.getElementById('gravity'),
  keys: document.getElementById('keys'),
  pause: document.getElementById('pause'),
  loading: document.getElementById('loading'),
};
document.getElementById('resume').addEventListener('click', () => {
  if (dragLook) setMode('walk');
  else input.lock();
});
document.getElementById('toPrint').addEventListener('click', () => returnToPrint());

function setGravityLabel(up, flash) {
  ui.gname.textContent = `down ${DIR_NAMES[up ^ 1]}`;
  if (flash) {
    ui.gravity.classList.add('flash');
    setTimeout(() => ui.gravity.classList.remove('flash'), 350);
  }
}
player.onTransition = (_, up) => setGravityLabel(up, true);
// a fall that finds no ground: the plate is redrawn at the spot of the jump
player.onRespawn = () => { fade = 0.15; setGravityLabel(player.up, true); };

// ---------------------------------------------------------------- state
let mode = 'loading';
let entering = null;
let hovered = null;
let mouseNdc = new THREE.Vector2(0, 0);
const PRINT_FOCUS = new THREE.Vector3(...START.focus);
const focus = PRINT_FOCUS.clone();
const focusArr = [0, 0, 0];
let radius = INTRO_RADIUS;
let keepHalls = false;   // true while flying back to the print: nothing is dropped mid-flight
let fade = 0;
const fog = [INTRO_FOG[0], INTRO_FOG[1]];
let current = null;

// The print's own camera, recovered from its vanishing points: fixed, it never moves.
const PRINT_POS = new THREE.Vector3(...START.camera.pos);
const PRINT_QUAT = (() => {
  const f = new THREE.Vector3(...START.camera.forward).normalize();
  const u = new THREE.Vector3(...START.camera.up).normalize();
  const r = new THREE.Vector3().crossVectors(f, u).normalize();
  u.crossVectors(r, f);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, u, f.clone().negate()));
})();

// The title shows the scene as a print on a page, at the print's own proportions;
// walking fills the screen. viewK runs from 0 (print) to 1 (full screen) while the
// camera dives into a figure.
const INTRO_FOV = START.camera.fov;
const PRINT_ASPECT = START.camera.aspect;
const WALK_FOV = 68;
let viewK = 0;
const printRect = { x: 0, y: 0, w: 1, h: 1 };
const viewRect = { x: 0, y: 0, w: 1, h: 1 };
const plateEl = document.getElementById('plate');

function layoutPrint() {
  const W = innerWidth, H = innerHeight;
  if (FRAME_ONLY) { Object.assign(printRect, { x: 0, y: 0, w: W, h: H }); return; }
  const cap = W < 640 ? 96 : 118;
  const h = Math.max(150, Math.floor(Math.min((W - 32) / PRINT_ASPECT, (H - cap - 24) * 0.98, 1050)));
  printRect.h = h;
  printRect.w = Math.round(h * PRINT_ASPECT);
  printRect.x = Math.floor((W - printRect.w) / 2);
  printRect.y = Math.max(12, Math.floor((H - h - cap) / 2));
}

function updateViewRect() {
  const k = viewK;
  viewRect.x = printRect.x * (1 - k);
  viewRect.y = printRect.y * (1 - k);
  viewRect.w = printRect.w + (innerWidth - printRect.w) * k;
  viewRect.h = printRect.h + (innerHeight - printRect.h) * k;
  const m = 18;
  plateEl.style.left = `${printRect.x - m}px`;
  plateEl.style.top = `${printRect.y - m}px`;
  plateEl.style.width = `${printRect.w + 2 * m}px`;
  plateEl.style.height = `${printRect.h + 2 * m}px`;
  ui.intro.style.top = `${printRect.y + printRect.h + 14}px`;
  ui.intro.style.width = `${Math.min(printRect.w, 720)}px`;
}

function setMode(m) {
  mode = m;
  document.body.classList.toggle('intro', m === 'intro' || m === 'loading');
  document.body.classList.toggle('walking', m === 'walk');
  ui.intro.classList.toggle('hidden', !(m === 'intro'));
  ui.hud.classList.toggle('hidden', !(m === 'walk' || m === 'pause'));
  ui.pause.classList.toggle('hidden', m !== 'pause');
  if (m !== 'intro') { setHover(null); }
}
setMode('loading');

function introCamera(out = camera) {
  out.position.copy(PRINT_POS);
  out.quaternion.copy(PRINT_QUAT);
}

function setHover(f) {
  if (hovered === f) return;
  if (hovered) hovered.mat.uniforms.uHighlight.value = 0;
  hovered = f;
  if (f) f.mat.uniforms.uHighlight.value = 1;
  document.body.classList.toggle('hovering', !!f);
  ui.label.classList.toggle('show', !!f);
  if (f) ui.label.textContent = f.def.label;
}

const raycaster = new THREE.Raycaster();
function pick() {
  raycaster.setFromCamera(mouseNdc, camera);
  const hits = raycaster.intersectObjects(figures.filter((f) => f.fig.mesh.visible).map((f) => f.proxy), false);
  return hits.length ? hits[0].object.userData.f : null;
}

const insideView = (e) => e.clientX >= viewRect.x && e.clientY >= viewRect.y &&
  e.clientX < viewRect.x + viewRect.w && e.clientY < viewRect.y + viewRect.h;

canvas.addEventListener('mousemove', (e) => {
  mouseNdc.set(((e.clientX - viewRect.x) / viewRect.w) * 2 - 1, -((e.clientY - viewRect.y) / viewRect.h) * 2 + 1);
  if (mode === 'intro') setHover(insideView(e) ? pick() : null);
});

canvas.addEventListener('click', (e) => {
  if (mode === 'intro') {
    const f = insideView(e) ? pick() : null;
    if (f) beginEnter(f);
  } else if ((mode === 'walk' || mode === 'pause') && !input.locked && !dragLook) {
    input.lock();
  }
});

input.onLockChange = (locked) => {
  if (locked && mode === 'pause') setMode('walk');
  else if (!locked && mode === 'walk' && !dragLook) setMode('pause');
};

// Where pointer lock is refused (some embeds and browsers), look around by dragging.
let dragLook = false;
let dragging = null;
document.addEventListener('pointerlockerror', () => {
  dragLook = true;
  if (mode === 'pause') setMode('walk');
});
canvas.addEventListener('mousedown', (e) => { if (dragLook) dragging = [e.clientX, e.clientY]; });
window.addEventListener('mouseup', () => { dragging = null; });
window.addEventListener('mousemove', (e) => {
  if (!dragging || mode !== 'walk') return;
  player.look((e.clientX - dragging[0]) * SENS * 1.6, (e.clientY - dragging[1]) * SENS * 1.6);
  dragging = [e.clientX, e.clientY];
});
window.addEventListener('keydown', (e) => {
  if (dragLook && e.code === 'Escape' && (mode === 'walk' || mode === 'pause')) setMode(mode === 'walk' ? 'pause' : 'walk');
});

input.onKey = (code) => {
  if (mode === 'pause' && code === 'KeyR') returnToPrint();
};

function smoother(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

// The start of a walk: the walker starts from rest, with no keys or mouse movement left
// over from before.
function beginEnter(f) {
  current = f;
  input.reset();
  input.lock();
  const face = new THREE.Vector3(...DIRS[f.def.face]);
  player.spawn(f.def.stand ?? f.def.pos, f.def.up, face);
  setGravityLabel(f.def.up, false);
  entering = {
    f, t: 0, dur: 2.8,
    fromP: camera.position.clone(), fromQ: camera.quaternion.clone(),
    toP: player.camP.clone(), toQ: player.camQ.clone(),
    fromFog: fog.slice(),
  };
  setMode('enter');
}

// The end of a walk. The print's halls are requested at once (none are generated along
// the flight back), and on arrival everything else the walk loaded is dropped and the
// generator's caches are emptied.
function returnToPrint() {
  input.unlock();
  input.reset();
  entering = {
    back: true, t: 0, dur: 2.4,
    fromP: camera.position.clone(), fromQ: camera.quaternion.clone(),
    fromFog: fog.slice(),
  };
  focus.copy(PRINT_FOCUS);
  radius = INTRO_RADIUS;
  keepHalls = true;
  if (current) current.fig.mesh.visible = true;
  setMode('enter');
}

// Keep exactly the halls a fresh start would load for the print, nothing more.
function releaseWalk() {
  keepHalls = false;
  const p = [PRINT_FOCUS.x, PRINT_FOCUS.y, PRINT_FOCUS.z];
  world.release((h) => boxDist(p, h.hx, h.hy, h.hz) <= INTRO_RADIUS);
}

function tickEnter(dt) {
  const E = entering;
  E.t = Math.min(1, E.t + dt / E.dur);
  const e = smoother(E.t);
  if (E.back) {
    viewK = 1 - e;
    camera.position.lerpVectors(E.fromP, PRINT_POS, e);
    camera.quaternion.slerpQuaternions(E.fromQ, PRINT_QUAT, e);
    fog[0] = THREE.MathUtils.lerp(E.fromFog[0], INTRO_FOG[0], e);
    fog[1] = THREE.MathUtils.lerp(E.fromFog[1], INTRO_FOG[1], e);
    if (E.t >= 1) {
      entering = null;
      current = null;
      releaseWalk();
      setMode('intro');
    }
    return;
  }
  // The print grows to fill the screen a little ahead of the camera, which arcs slightly so
  // it dives into the figure rather than sliding sideways.
  viewK = smoother(Math.min(1, E.t * 1.35));
  const lift = Math.sin(Math.PI * e) * 2.5;
  camera.position.lerpVectors(E.fromP, E.toP, e).addScaledVector(E.f.U, lift);
  camera.quaternion.slerpQuaternions(E.fromQ, E.toQ, e);
  fog[0] = THREE.MathUtils.lerp(E.fromFog[0], WALK_FOG[0], e);
  fog[1] = THREE.MathUtils.lerp(E.fromFog[1], WALK_FOG[1], e);
  focus.lerpVectors(PRINT_FOCUS, player.pos, e);
  radius = THREE.MathUtils.lerp(INTRO_RADIUS, WALK_RADIUS, e);
  if (E.t > 0.9) E.f.fig.mesh.visible = false;
  if (E.t >= 1) {
    entering = null;
    player.updateCamera(0);
    setMode(input.locked || dragLook ? 'walk' : 'pause');
    ui.keys.classList.remove('faded');
    setTimeout(() => ui.keys.classList.add('faded'), 9000);
  }
}

// ---------------------------------------------------------------- adaptive resolution
// The hatching is per-pixel work, so on slow GPUs we render fewer pixels (and finally
// drop multisampling) until the frame rate holds; on fast ones we creep back up.
const quality = {
  max: Math.min(window.devicePixelRatio || 1, 1.75),
  scale: Math.min(window.devicePixelRatio || 1, 1.5),
  min: 0.6,
  acc: 0,
  frames: 0,
  holdUntil: 0,
};
if (params.has('scale')) { quality.scale = quality.max = quality.min = Number(params.get('scale')); }

function adaptQuality(dt, now) {
  if (document.hidden || mode === 'loading') return;
  quality.acc += dt;
  quality.frames++;
  if (quality.acc < 1.5) return;
  const avg = quality.acc / quality.frames;
  quality.acc = 0;
  quality.frames = 0;
  if (avg > 0.025) {
    if (quality.scale > quality.min + 0.01) {
      quality.scale = Math.max(quality.min, quality.scale - 0.15);
      resize();
    } else {
      etch.setSamples(0);
    }
    quality.holdUntil = now + 12000;
  } else if (avg < 0.0185 && now > quality.holdUntil && quality.scale < quality.max - 0.01) {
    quality.scale = Math.min(quality.max, quality.scale + 0.1);
    resize();
  }
}

// ---------------------------------------------------------------- loop
function resize() {
  renderer.setPixelRatio(quality.scale);
  renderer.setSize(innerWidth, innerHeight, false);
  etch.setSize(innerWidth, innerHeight, quality.scale);
  layoutPrint();
  updateViewRect();
}
window.addEventListener('resize', resize);
resize();

// Point the camera's projection at the current image rectangle and hand the renderer
// that rectangle in device pixels.
const deviceRect = { x: 0, y: 0, w: 1, h: 1 };
function applyView() {
  updateViewRect();
  camera.aspect = viewRect.w / viewRect.h;
  camera.fov = INTRO_FOV + (WALK_FOV - INTRO_FOV) * viewK;
  camera.updateProjectionMatrix();
  const s = renderer.getPixelRatio();
  const W = Math.floor(innerWidth * s), H = Math.floor(innerHeight * s);
  deviceRect.x = Math.round(viewRect.x * s);
  deviceRect.w = Math.min(W - deviceRect.x, Math.round(viewRect.w * s));
  deviceRect.h = Math.min(H, Math.round(viewRect.h * s));
  deviceRect.y = Math.max(0, H - Math.round(viewRect.y * s) - deviceRect.h);
  etch.post.uniforms.uPlate.value = FRAME_ONLY ? 0 : 1 - viewK;
  plateEl.style.opacity = String(FRAME_ONLY ? 0 : Math.max(0, 1 - viewK * 3));
  // the print is engraved finer than the world you walk in
  shared.uDensity.value = 0.3 + (0.18 - 0.3) * viewK;
}

// Halls lying wholly beyond the fog are not drawn at all.
const camArr = [0, 0, 0];
function cullHalls() {
  camArr[0] = camera.position.x; camArr[1] = camera.position.y; camArr[2] = camera.position.z;
  const lim = fog[1] + 2;
  for (const h of world.halls.values()) {
    if (h.mesh) h.mesh.visible = boxDist(camArr, h.hx, h.hy, h.hz) < lim;
  }
}

let last = performance.now();
const occCenter = new THREE.Vector3();
const labelAt = new THREE.Vector3();
let rafId = 0;
let stopped = false;
let contextLost = false;

function frame(now) {
  rafId = requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  if (contextLost) return;

  if (mode === 'loading') {
    introCamera();
    if (world.pendingWithin(focus, START.readyRadius) === 0 && world.generated > 0) {
      setMode('intro');
      ui.loading.classList.add('hidden');
    }
  } else if (mode === 'intro') {
    introCamera();
    if (hovered) {
      const head = labelAt.set(...hovered.def.pos).addScaledVector(hovered.U, 3.9).project(camera);
      ui.label.style.left = `${viewRect.x + (head.x * 0.5 + 0.5) * viewRect.w}px`;
      ui.label.style.top = `${viewRect.y + (-head.y * 0.5 + 0.5) * viewRect.h}px`;
    }
  } else if (mode === 'enter') {
    tickEnter(dt);
  } else if (mode === 'walk') {
    const [mx, my] = input.takeMouse();
    player.look(mx * SENS, my * SENS);
    player.update(dt, input.axes());
    camera.position.copy(player.camP);
    camera.quaternion.copy(player.camQ);
    focus.copy(player.pos);
  } else if (mode === 'pause') {
    input.takeMouse();
    input.axes();
    player.updateCamera(dt);
    camera.position.copy(player.camP);
    camera.quaternion.copy(player.camQ);
  }
  applyView();

  fade = Math.min(1, fade + dt * (mode === 'loading' ? 0 : 0.7));
  etch.post.uniforms.uFade.value = smoother(fade);
  etch.setFog(fog[0], fog[1]);
  shared.uFogFar.value = fog[1] + 1;
  focusArr[0] = focus.x; focusArr[1] = focus.y; focusArr[2] = focus.z;
  world.update(focusArr, radius, { unload: !keepHalls, now });
  world.tickSync();
  walkers.update(dt, camera.position, fog[1] + 12);
  occCenter.copy(mode === 'walk' || mode === 'pause' ? player.pos : focus);
  occ.update(occCenter, now);
  shared.uOccOrigin.value.copy(occ.origin);
  cullHalls();
  etch.render(scene, camera, deviceRect);
  adaptQuality(dt, now);
}
rafId = requestAnimationFrame(frame);

// ---------------------------------------------------------------- the end of a visit
// When the page goes away everything is handed back at once: the generation worker
// stops, every hall, figure, texture and buffer is freed and the graphics context is
// released, so nothing lingers, not even if the browser keeps the page in its
// back/forward cache. A page brought back from that cache starts over from scratch.
function shutdown() {
  if (stopped) return;
  stopped = true;
  cancelAnimationFrame(rafId);
  input.unlock();
  world.dispose();
  walkers.dispose();
  for (const f of figures) {
    scene.remove(f.fig.mesh);
    f.fig.dispose();
    f.mat.dispose();
    f.proxy.geometry.dispose();
  }
  disposeFigureAssets();
  hallMaterial.dispose();
  walkerMaterial.dispose();
  occ.dispose();
  etch.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  delete window.__escher;
}
window.addEventListener('pagehide', shutdown);
window.addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });

// If the graphics card resets, the halls (whose meshes live only on the card) are
// generated again once the context is back.
canvas.addEventListener('webglcontextlost', (e) => {
  if (stopped) return;
  e.preventDefault();
  contextLost = true;
});
canvas.addEventListener('webglcontextrestored', () => {
  contextLost = false;
  world.release();
  occ.dirty = true;
});

// Debug / automation hooks (used by the screenshot scripts).
window.__escher = {
  THREE, scene, camera, world, player, figures, walkers, etch, shared, input,
  get mode() { return mode; },
  setMode,
  enter: (i) => beginEnter(figures[i]),
  back: () => returnToPrint(),
  shutdown,
  spawn(p, up, face) {
    player.spawn(p, up, new THREE.Vector3(...DIRS[face]));
    focus.copy(player.pos);
    radius = WALK_RADIUS;
    fog[0] = WALK_FOG[0]; fog[1] = WALK_FOG[1];
    viewK = 1;
    setGravityLabel(up, false);
    setMode('walk');
  },
  simulate(seconds, axes, look = [0, 0]) {
    const steps = Math.round(seconds * 60);
    for (let i = 0; i < steps; i++) {
      player.look(look[0], look[1]);
      player.update(1 / 60, axes);
    }
    camera.position.copy(player.camP);
    camera.quaternion.copy(player.camQ);
    focus.copy(player.pos);
  },
};
