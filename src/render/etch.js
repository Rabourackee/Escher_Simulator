// The lithograph look.
//
// Pass 1 renders the scene into a float target. Each pixel stores
//   r = paper brightness after hatching (1 = blank paper, 0 = solid ink)
//   g = view-space depth
//   b = a scalar code of the surface normal
//   a = material id
// Hatching is laid out in world space on each face, so the lines stay engraved into the
// stone as you move. Darker tones add line layers (hatch, cross-hatch, diagonal), and
// the line spacing doubles with distance so it never turns into moire.
// Light is a fixed direction; occlusion and short shadows come from a voxel volume
// around the viewer (see occlusion.js).
//
// Pass 2 draws ink outlines where depth, normal or material change, fades distant ink
// into the paper (so nobody sees far), and adds paper grain.

import * as THREE from '../../vendor/three/three.module.min.js';

export const LIGHT_DIR = new THREE.Vector3(0.45, 0.72, 0.53).normalize();

const ETCH_VERT = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
attribute float aMat;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vMat;
varying float vViewZ;
void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vec4 wp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  wp = instanceMatrix * wp;
  #endif
  wp = modelMatrix * wp;
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(inverseTransformDirection(transformedNormal, viewMatrix));
  #ifdef PACKED
  vMat = aMat * 32767.0;   // hall meshes store the id in a normalized 16-bit number
  #else
  vMat = aMat;
  #endif
  vViewZ = -mvPosition.z;
}
`;

const ETCH_FRAG = /* glsl */ `
precision highp sampler3D;
#include <common>
uniform vec3 uLightDir;
uniform float uAmbient;
uniform sampler3D uOcc;
uniform vec3 uOccOrigin;
uniform float uOccInv;
uniform float uOccOn;
uniform float uShadowAmt;
uniform float uFogFar;
uniform float uDensity;   // line periods per pixel the hatching aims for
uniform float uHatchOn;   // 0 draws outlines only (a debugging aid)
uniform float uHighlight;
uniform float uMatOverride;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vMat;
varying float vViewZ;

float occAt(vec3 p) {
  vec3 c = (p - uOccOrigin) * uOccInv;
  if (c.x < 0.0 || c.y < 0.0 || c.z < 0.0 || c.x > 1.0 || c.y > 1.0 || c.z > 1.0) return 0.0;
  return textureLod(uOcc, c, 0.0).r;
}

// Parallel lines at integer x covering a fraction w of each period; fw = periods per pixel.
float lineInk(float x, float w, float fw) {
  float d = abs(fract(x + 0.5) - 0.5);
  float ink = (1.0 - smoothstep(0.5 * w - fw, 0.5 * w + fw, d)) * smoothstep(0.0, 0.04, w);
  return mix(ink, w, smoothstep(0.3, 0.6, fw));
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + 1.0), f.x), f.y);
}

// One family of parallel lines. x is measured in base periods and fw is base periods per
// pixel. Like an engraving, the line density stays roughly constant on the paper: when
// lines crowd together the period doubles, when you walk up close it halves.
float family(float x, float w, float fw) {
  float lod = clamp(log2(max(fw, 1e-6) / uDensity), -6.0, 3.0);
  float l0 = floor(lod), t = lod - l0;
  float s = exp2(-l0);
  float i0 = lineInk(x * s, w, fw * s);
  if (t < 0.02) return i0;
  float i1 = lineInk(x * s * 0.5, w, fw * s * 0.5);
  return mix(i0, i1, smoothstep(0.0, 1.0, t));
}

float hatch(vec2 p, vec2 dx, vec2 dy, float dark, float ang, float sp, float wob) {
  vec2 d1 = vec2(cos(ang), sin(ang));
  vec2 d2 = vec2(-d1.y, d1.x);
  vec2 d3 = normalize(d1 + d2);
  float s3 = sp * 0.87;
  float a = dot(p, d2) / sp, b = dot(p, d1) / sp, c = dot(p, d3) / s3;
  float fa = (abs(dot(dx, d2)) + abs(dot(dy, d2))) / sp;
  float fb = (abs(dot(dx, d1)) + abs(dot(dy, d1))) / sp;
  float fc = (abs(dot(dx, d3)) + abs(dot(dy, d3))) / s3;
  // a slight tremor of the engraver's hand, measured in world units
  float al = dot(p, d1);
  float wv = wob * 0.007 * (sin(al * 2.1 + dot(p, d2) * 0.3) + 0.6 * sin(al * 5.3 + 1.7)) / sp;
  float w1 = clamp(dark * 1.2 - 0.04, 0.0, 0.6);
  float w2 = clamp((dark - 0.45) * 1.45, 0.0, 0.55);
  float w3 = clamp((dark - 0.72) * 2.0, 0.0, 0.5);
  float ink = family(a + wv, w1, fa);
  ink = max(ink, family(b + wv * 0.5, w2, fb));
  ink = max(ink, family(c, w3, fc));
  return ink;
}

// A thin engraved joint; never wider than about two pixels however close you stand.
float joint(float d, float hw, float fw) {
  hw = min(hw, fw * 0.9);
  return 1.0 - smoothstep(hw - fw, hw + fw, d);
}

// Ashlar courses: two voxels high, four long, staggered.
float masonry(vec2 p, vec2 dx, vec2 dy) {
  float row = floor(p.y * 0.5);
  float dyy = abs(p.y - 2.0 * floor(p.y * 0.5 + 0.5));
  float off = mod(row, 2.0) * 2.0;
  float dxx = abs(p.x - off - 4.0 * floor((p.x - off) * 0.25 + 0.5));
  float fy = abs(dx.y) + abs(dy.y), fx = abs(dx.x) + abs(dy.x);
  float k = 1.0 - smoothstep(0.04, 0.12, max(fx, fy));
  return max(joint(dyy, 0.028, fy), joint(dxx, 0.028, fx)) * k;
}

float planks(vec2 p, vec2 dx, vec2 dy) {
  float d = abs(p.x - 0.5 * floor(p.x * 2.0 + 0.5));
  return joint(d, 0.03, abs(dx.x) + abs(dy.x));
}

void main() {
  vec3 n = normalize(vWorldNormal);
  vec3 dpx = dFdx(vWorldPos), dpy = dFdy(vWorldPos);
  float m = uMatOverride >= 0.0 ? uMatOverride : floor(vMat + 0.5);
  float ncode = dot(n, vec3(0.61, 0.37, 0.83));
  if (vViewZ > uFogFar) {
    // lost in the paper anyway: skip the shading
    gl_FragColor = vec4(1.0, vViewZ, ncode, m / 16.0 + 0.01);
    return;
  }

  float albedo = 0.95;
  float sp = 0.13;
  float wob = 1.0;
  float angOff = 0.0;
  if (m == 1.0) { albedo = 0.96; sp = 0.12; }
  else if (m == 2.0) { albedo = 0.86; sp = 0.1; angOff = 0.5; }
  else if (m == 3.0) { albedo = 0.52; sp = 0.1; angOff = 1.57; }
  else if (m == 4.0) { albedo = 0.66; sp = 0.11; wob = 6.0; }
  else if (m == 5.0) { albedo = 0.74; sp = 0.1; wob = 14.0; }
  else if (m == 6.0) { albedo = 0.55; sp = 0.09; angOff = 1.57; wob = 4.0; }
  else if (m == 7.0) { albedo = 0.9; sp = 0.075; angOff = 0.9; }
  else if (m == 8.0) { albedo = 0.22; sp = 0.07; }
  else if (m == 9.0) { albedo = 0.08; sp = 0.09; }
  else if (m == 10.0) { albedo = 0.98; sp = 0.13; }

  float ndl = dot(n, uLightDir);
  float ao = 0.0, shadow = 0.0;
  if (uOccOn > 0.5) {
    vec3 t1 = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 t2 = cross(n, t1);
    vec3 b = vWorldPos + n * 0.7;
    float o = occAt(b) * 0.5;
    o += (occAt(b + t1) + occAt(b - t1) + occAt(b + t2) + occAt(b - t2)) * 0.2;
    vec3 b2 = vWorldPos + n * 1.7;
    o += (occAt(b2 + t1 * 1.6) + occAt(b2 - t1 * 1.6) + occAt(b2 + t2 * 1.6) + occAt(b2 - t2 * 1.6)) * 0.11;
    o += occAt(vWorldPos + n * 3.2) * 0.12 + occAt(vWorldPos + n * 5.5) * 0.05;
    ao = clamp(o, 0.0, 1.0);
    if (ndl > 0.0 && uShadowAmt > 0.0) {
      vec3 s0 = vWorldPos + n * 0.6;
      for (int i = 1; i <= 5; i++) {
        float d = float(i) * 1.3;
        shadow = max(shadow, occAt(s0 + uLightDir * d) * (1.0 - float(i) * 0.08));
      }
      shadow = smoothstep(0.34, 0.6, shadow) * uShadowAmt;
    }
    vec3 c = abs((vWorldPos - uOccOrigin) * uOccInv - 0.5) * 2.0;
    float fade = 1.0 - smoothstep(0.72, 0.92, max(c.x, max(c.y, c.z)));
    ao *= fade;
    shadow *= fade;
  }
  float lit = max(ndl, 0.0) * (1.0 - shadow);
  // a soft bounce from the opposite side keeps the upside-down worlds legible
  float bounce = 0.27 * max(-ndl, 0.0);
  float light = uAmbient * (1.0 - 0.65 * ao) + (1.0 - uAmbient) * (lit + bounce) * (1.0 - 0.35 * ao);
  float tone = clamp(light * albedo, 0.0, 1.0);
  if (m == 5.0) tone *= 0.8 + 0.3 * vnoise(vWorldPos.xz * 1.7 + vWorldPos.y * 1.3);
  float dark = clamp((0.9 - tone) * 1.45, 0.0, 1.0);
  dark = mix(dark, min(1.0, dark + 0.4), uHighlight);

  vec3 an = abs(n);
  vec3 w = pow(an, vec3(8.0));
  w /= (w.x + w.y + w.z);
  float ink = 0.0;
  float pat = 0.0;
  if (w.x > 0.01) {
    ink += w.x * hatch(vWorldPos.zy, dpx.zy, dpy.zy, dark, 1.5708 + angOff, sp, wob);
    if (m == 0.0) pat += w.x * masonry(vWorldPos.zy, dpx.zy, dpy.zy);
    else if (m == 3.0 || m == 6.0) pat += w.x * planks(vWorldPos.zy, dpx.zy, dpy.zy);
  }
  if (w.y > 0.01) {
    ink += w.y * hatch(vWorldPos.xz, dpx.xz, dpy.xz, dark, angOff, sp, wob);
    if (m == 0.0) pat += w.y * masonry(vWorldPos.xz, dpx.xz, dpy.xz);
    else if (m == 3.0 || m == 6.0) pat += w.y * planks(vWorldPos.xz, dpx.xz, dpy.xz);
  }
  if (w.z > 0.01) {
    ink += w.z * hatch(vWorldPos.xy, dpx.xy, dpy.xy, dark, 0.42 + angOff, sp, wob);
    if (m == 0.0) pat += w.z * masonry(vWorldPos.yx, dpx.yx, dpy.yx);
    else if (m == 3.0 || m == 6.0) pat += w.z * planks(vWorldPos.xy, dpx.xy, dpy.xy);
  }
  if (m == 4.0) {
    float st = step(0.86 - dark * 0.3, hash12(floor(vWorldPos.xz * 9.0 + vWorldPos.y * 5.0)));
    pat = max(pat, st * 0.8);
  }
  ink = max(ink, pat * (0.3 + 0.25 * dark));
  gl_FragColor = vec4(1.0 - clamp(ink, 0.0, 1.0) * uHatchOn, vViewZ, ncode, m / 16.0 + 0.01);
}
`;

// `packed`: for the hall meshes, which store positions, normals and material ids compactly.
export function createEtchMaterial(shared, { packed = false } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: ETCH_VERT,
    fragmentShader: ETCH_FRAG,
    defines: packed ? { PACKED: '' } : {},
    uniforms: {
      uLightDir: shared.uLightDir,
      uAmbient: shared.uAmbient,
      uOcc: shared.uOcc,
      uOccOrigin: shared.uOccOrigin,
      uOccInv: shared.uOccInv,
      uOccOn: shared.uOccOn,
      uShadowAmt: shared.uShadowAmt,
      uFogFar: shared.uFogFar,
      uDensity: shared.uDensity,
      uHatchOn: shared.uHatchOn,
      uHighlight: { value: 0 },
      uMatOverride: { value: -1 },
    },
  });
}

const POST_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const POST_FRAG = /* glsl */ `
uniform sampler2D tMain;
uniform vec2 uTexel;
uniform float uLine;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform float uFogNear;
uniform float uFogFar;
uniform float uVignette;
uniform float uFade;
uniform vec4 uRect;      // the image, in device pixels from the bottom left
uniform float uPlate;    // 1 while the image is shown as a print on the page
varying vec2 vUv;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + 1.0), f.x), f.y);
}

vec3 paperAt(vec2 fc) {
  float grain = vnoise(fc * 0.85) * 0.55 + vnoise(fc * 0.11) * 0.3 + vnoise(fc * 0.013) * 0.15;
  return uPaper * (0.955 + 0.06 * grain);
}

void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 rmin = uRect.xy, rmax = uRect.xy + uRect.zw;
  if (fc.x < rmin.x || fc.y < rmin.y || fc.x >= rmax.x || fc.y >= rmax.y) {
    // the page around the print: a faint plate mark pressed into the paper
    vec3 paper = paperAt(fc);
    float m = 16.0 * uLine;
    vec2 dOut = max(rmin - m - fc, fc - rmax - m);
    float inPlate = step(max(dOut.x, dOut.y), 0.0);
    float rim = 1.0 - smoothstep(0.0, 1.6 * uLine, abs(max(dOut.x, dOut.y)));
    paper *= 1.0 - uPlate * (0.018 * inPlate + 0.07 * rim);
    gl_FragColor = vec4(paper, 1.0);
    return;
  }
  vec2 lo = (rmin + 0.5) * uTexel, hi = (rmax - 0.5) * uTexel;
  vec2 o = uTexel * uLine;
  vec4 c = texture2D(tMain, vUv);
  vec4 l = texture2D(tMain, clamp(vUv - vec2(o.x, 0.0), lo, hi));
  vec4 r = texture2D(tMain, clamp(vUv + vec2(o.x, 0.0), lo, hi));
  vec4 d = texture2D(tMain, clamp(vUv - vec2(0.0, o.y), lo, hi));
  vec4 u = texture2D(tMain, clamp(vUv + vec2(0.0, o.y), lo, hi));

  float iz = 1.0 / max(c.g, 0.01);
  float lx = abs(1.0 / max(l.g, 0.01) + 1.0 / max(r.g, 0.01) - 2.0 * iz);
  float ly = abs(1.0 / max(u.g, 0.01) + 1.0 / max(d.g, 0.01) - 2.0 * iz);
  float eD = smoothstep(0.025, 0.07, max(lx, ly) / iz);
  float nd = max(max(abs(l.b - c.b), abs(r.b - c.b)), max(abs(u.b - c.b), abs(d.b - c.b)));
  float eN = smoothstep(0.09, 0.2, nd);
  float md = max(max(abs(l.a - c.a), abs(r.a - c.a)), max(abs(u.a - c.a), abs(d.a - c.a)));
  float eM = smoothstep(0.025, 0.05, md);
  float edge = max(eD, max(eN, eM));

  float zNear = min(min(min(l.g, r.g), min(u.g, d.g)), c.g);
  float fogC = smoothstep(uFogNear, uFogFar, c.g);
  float fogE = smoothstep(uFogNear, uFogFar, zNear);
  float ink = (1.0 - c.r) * (1.0 - fogC);
  ink = max(ink, edge * 0.95 * (1.0 - fogE));

  vec3 paper = paperAt(fc);
  float inkVar = 0.86 + 0.14 * vnoise(fc * 0.37 + 7.0);
  vec3 col = mix(paper, uInk, clamp(ink * inkVar, 0.0, 1.0));
  vec2 q = (fc - rmin) / uRect.zw - 0.5;
  col *= 1.0 - uVignette * dot(q, q);
  col = mix(paper, col, uFade);
  // the inked border of the image while it is still a print
  vec2 e = min(fc - rmin, rmax - fc);
  float border = 1.0 - smoothstep(0.6 * uLine, 1.8 * uLine, min(e.x, e.y));
  col = mix(col, uInk, border * uPlate * 0.85);
  gl_FragColor = vec4(col, 1.0);
}
`;

export class EtchRenderer {
  constructor(renderer) {
    this.renderer = renderer;
    const caps = renderer.capabilities;
    const samples = caps.isWebGL2 ? Math.min(4, caps.maxSamples || 0) : 0;
    this.rt = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      samples,
      depthBuffer: true,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    this.clearColor = new THREE.Color(1, 5000, 0);
    this.post = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tMain: { value: this.rt.texture },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uLine: { value: 1 },
        uPaper: { value: new THREE.Color(0.925, 0.89, 0.81) },
        uInk: { value: new THREE.Color(0.12, 0.095, 0.075) },
        uFogNear: { value: 30 },
        uFogFar: { value: 70 },
        uVignette: { value: 0.55 },
        uFade: { value: 1 },
        uRect: { value: new THREE.Vector4(0, 0, 1, 1) },
        uPlate: { value: 0 },
      },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post);
    this.quad = quad;
    quad.frustumCulled = false;
    this.postScene = new THREE.Scene();
    this.postScene.add(quad);
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(w, h, dpr) {
    const W = Math.max(1, Math.floor(w * dpr)), H = Math.max(1, Math.floor(h * dpr));
    this.rt.setSize(W, H);
    this.post.uniforms.uTexel.value.set(1 / W, 1 / H);
    this.post.uniforms.uLine.value = Math.max(1, dpr * 0.9);
  }

  dispose() {
    this.rt.dispose();
    this.post.dispose();
    this.quad.geometry.dispose();
  }

  setSamples(n) {
    if (this.rt.samples === n) return;
    this.rt.samples = n;
    this.rt.dispose();
  }

  setFog(near, far) {
    this.post.uniforms.uFogNear.value = near;
    this.post.uniforms.uFogFar.value = far;
  }

  // rect: the part of the canvas showing the image, in device pixels from the bottom left
  render(scene, camera, rect = { x: 0, y: 0, w: this.rt.width, h: this.rt.height }) {
    const r = this.renderer;
    const rt = this.rt;
    rt.viewport.set(rect.x, rect.y, rect.w, rect.h);
    rt.scissor.set(rect.x, rect.y, rect.w, rect.h);
    rt.scissorTest = true;
    this.post.uniforms.uRect.value.set(rect.x, rect.y, rect.w, rect.h);
    r.setRenderTarget(rt);
    r.setClearColor(this.clearColor, 1);
    r.clear(true, true, false);
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.postScene, this.postCam);
  }
}
