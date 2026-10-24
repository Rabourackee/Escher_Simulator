// App: the title "print", the step into a figure, walking, pausing.

import * as THREE from '../vendor/three/three.module.min.js';
import { HALL, setSeed } from './core/constants.js';
import { DIRS, DIR_NAMES } from './core/cube.js';
import { EtchRenderer, createEtchMaterial, LIGHT_DIR } from './render/etch.js';
import { Figure, Walkers, frameQuaternion } from './render/figures.js';
import { World } from './world/world.js';
import { OccVolume } from './render/occlusion.js';
import { Player } from './player/controller.js';
import { Input } from './player/input.js';
import { START } from './world/prefab.js';

const params = new URLSearchParams(location.search);
if (params.has('seed')) setSeed(Number(params.get('seed')) >>> 0);
if (params.has('shot')) document.body.classList.add('shot');
const vec3Param = (name) => (params.has(name) ? params.get(name).split(',').map(Number) : null);
if (vec3Param('cam')) START.camera.pos = vec3Param('cam');
if (vec3Param('look')) START.camera.target = vec3Param('look');
if (params.has('fov')) START.camera.fov = Number(params.get('fov'));

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
};
const material = createEtchMaterial(shared);

const walkers = new Walkers(scene, material);
let occ = null;
const world = new World(scene, material, {
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

// ---------------------------------------------------------------- state
let mode = 'loading';
let entering = null;
let hovered = null;
let introParallax = new THREE.Vector2();
let mouseNdc = new THREE.Vector2(0, 0);
const focus = new THREE.Vector3(...START.focus);
let radius = INTRO_RADIUS;
let fade = 0;
const fog = [INTRO_FOG[0], INTRO_FOG[1]];
const introPos = new THREE.Vector3(...START.camera.pos);
const introTarget = new THREE.Vector3(...START.camera.target);
let current = null;

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
  const p = introPos.clone();
  const t = introTarget.clone();
  const dir = t.clone().sub(p);
  const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
  p.addScaledVector(right, introParallax.x * 1.6).add(new THREE.Vector3(0, introParallax.y * 1.2, 0));
  out.position.copy(p);
  out.up.set(0, 1, 0);
  out.lookAt(t);
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

canvas.addEventListener('mousemove', (e) => {
  mouseNdc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  if (mode === 'intro') {
    introParallax.set(mouseNdc.x, mouseNdc.y);
    setHover(pick());
  }
});

canvas.addEventListener('click', () => {
  if (mode === 'intro') {
    const f = pick();
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

function beginEnter(f) {
  current = f;
  input.lock();
  const face = new THREE.Vector3(...DIRS[f.def.face]);
  player.spawn(f.def.pos, f.def.up, face);
  setGravityLabel(f.def.up, false);
  entering = {
    f, t: 0, dur: 2.8,
    fromP: camera.position.clone(), fromQ: camera.quaternion.clone(),
    toP: player.camP.clone(), toQ: player.camQ.clone(),
    fromFog: fog.slice(),
  };
  setMode('enter');
}

function returnToPrint() {
  input.unlock();
  entering = {
    back: true, t: 0, dur: 2.4,
    fromP: camera.position.clone(), fromQ: camera.quaternion.clone(),
    fromFog: fog.slice(),
  };
  if (current) current.fig.mesh.visible = true;
  setMode('enter');
}

function tickEnter(dt) {
  const E = entering;
  E.t = Math.min(1, E.t + dt / E.dur);
  const e = smoother(E.t);
  if (E.back) {
    const tmp = new THREE.PerspectiveCamera();
    introCamera(tmp);
    camera.position.lerpVectors(E.fromP, tmp.position, e);
    camera.quaternion.slerpQuaternions(E.fromQ, tmp.quaternion, e);
    fog[0] = THREE.MathUtils.lerp(E.fromFog[0], INTRO_FOG[0], e);
    fog[1] = THREE.MathUtils.lerp(E.fromFog[1], INTRO_FOG[1], e);
    focus.lerp(new THREE.Vector3(...START.focus), e);
    radius = THREE.MathUtils.lerp(WALK_RADIUS, INTRO_RADIUS, e);
    if (E.t >= 1) { entering = null; current = null; setMode('intro'); }
    return;
  }
  // A slight arc so the camera dives into the figure rather than sliding sideways.
  const lift = Math.sin(Math.PI * e) * 2.5;
  camera.position.lerpVectors(E.fromP, E.toP, e).addScaledVector(E.f.U, lift);
  camera.quaternion.slerpQuaternions(E.fromQ, E.toQ, e);
  fog[0] = THREE.MathUtils.lerp(E.fromFog[0], WALK_FOG[0], e);
  fog[1] = THREE.MathUtils.lerp(E.fromFog[1], WALK_FOG[1], e);
  focus.lerpVectors(new THREE.Vector3(...START.focus), player.pos, e);
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
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// Halls lying wholly beyond the fog are not drawn at all.
function cullHalls() {
  const c = camera.position;
  const lim = fog[1] + 2;
  for (const h of world.halls.values()) {
    if (!h.mesh) continue;
    let d2 = 0;
    const b = [h.hx * HALL, h.hy * HALL, h.hz * HALL];
    const p = [c.x, c.y, c.z];
    for (let i = 0; i < 3; i++) {
      if (p[i] < b[i]) d2 += (b[i] - p[i]) ** 2;
      else if (p[i] > b[i] + HALL) d2 += (p[i] - b[i] - HALL) ** 2;
    }
    h.mesh.visible = d2 < lim * lim;
  }
}

let last = performance.now();
const occCenter = new THREE.Vector3();

function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;

  if (mode === 'loading') {
    introCamera();
    if (world.pendingWithin(focus, START.readyRadius) === 0 && world.generated > 0) {
      setMode('intro');
      ui.loading.classList.add('hidden');
    }
  } else if (mode === 'intro') {
    introCamera();
    if (hovered) {
      const head = new THREE.Vector3(...hovered.def.pos).addScaledVector(hovered.U, 3.9).project(camera);
      ui.label.style.left = `${(head.x * 0.5 + 0.5) * innerWidth}px`;
      ui.label.style.top = `${(-head.y * 0.5 + 0.5) * innerHeight}px`;
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
    player.updateCamera(dt);
    camera.position.copy(player.camP);
    camera.quaternion.copy(player.camQ);
  }

  fade = Math.min(1, fade + dt * (mode === 'loading' ? 0 : 0.7));
  etch.post.uniforms.uFade.value = smoother(fade);
  etch.setFog(fog[0], fog[1]);
  shared.uFogFar.value = fog[1] + 1;
  world.update([focus.x, focus.y, focus.z], radius);
  world.tickSync();
  walkers.update(dt, camera.position, fog[1] + 12);
  occCenter.copy(mode === 'walk' || mode === 'pause' ? player.pos : focus);
  occ.update(occCenter, now);
  shared.uOccOrigin.value.copy(occ.origin);
  cullHalls();
  etch.render(scene, camera);
  adaptQuality(dt, now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug / automation hooks (used by the screenshot scripts).
window.__escher = {
  THREE, scene, camera, world, player, figures, walkers, etch, shared, input,
  get mode() { return mode; },
  setMode,
  enter: (i) => beginEnter(figures[i]),
  spawn(p, up, face) {
    player.spawn(p, up, new THREE.Vector3(...DIRS[face]));
    focus.copy(player.pos);
    radius = WALK_RADIUS;
    fog[0] = WALK_FOG[0]; fog[1] = WALK_FOG[1];
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
