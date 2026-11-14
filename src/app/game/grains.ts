import * as THREE from 'three';

/**
 * Sand grains on the GPU. Each grain is launched once with a start point, a start velocity, a launch time and a
 * lifetime; the vertex shader moves it under gravity from the clock alone. So the CPU only writes grains when a
 * pour starts, never per frame, which is what lets thousands of grains run at 60 fps on a phone.
 *
 * Grains live in a ring buffer the size of the tier's grain budget. If a pour asks for more than fits, the oldest
 * grains are reused first (they've usually landed by then).
 */
export const GRAVITY = 38; // cells per second², a little floaty, like fine sand

export interface GrainLaunch {
  /** Start position (world). */
  x: number;
  y: number;
  z: number;
  /** End position: the grain lands exactly here at t0 + dur. */
  ex: number;
  ey: number;
  ez: number;
  /** Launch time (seconds, scene clock) and flight time. */
  t0: number;
  dur: number;
  color: THREE.Color;
  /** World-space diameter. */
  size: number;
  /** Gravity scale: 1 for falling sand, 0 for grains that drift in a straight line. */
  g?: number;
}

const VERT = /* glsl */ `
attribute vec3 aStart;
attribute vec3 aVel;
attribute vec4 aTime; // t0, dur, size, gravity scale
attribute vec3 aColor;
uniform float uTime;
uniform float uScale;
varying vec3 vColor;
varying float vShade;
void main() {
  float t = uTime - aTime.x;
  if (t < 0.0 || t > aTime.y) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  vec3 p = aStart + aVel * t + vec3(0.0, -0.5 * ${GRAVITY.toFixed(1)} * aTime.w * t * t, 0.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float fade = smoothstep(aTime.y, aTime.y * 0.82, t);
  gl_PointSize = max(1.0, aTime.z * uScale / -mv.z * (0.55 + 0.45 * fade));
  vColor = aColor;
  vShade = 0.9 + 0.1 * fade;
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vShade;
void main() {
  vec2 d = gl_PointCoord - vec2(0.5);
  float r2 = dot(d, d);
  if (r2 > 0.25) discard;
  // a little highlight on the upper left of each grain
  float lit = 1.0 + 0.25 * (0.5 - gl_PointCoord.y) - 0.6 * r2;
  gl_FragColor = vec4(vColor * lit * vShade, 1.0);
  #include <colorspace_fragment>
}
`;

export class Grains {
  readonly points: THREE.Points;
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private readonly start: THREE.BufferAttribute;
  private readonly vel: THREE.BufferAttribute;
  private readonly time: THREE.BufferAttribute;
  private readonly color: THREE.BufferAttribute;
  private next = 0;
  private dirtyFrom = Infinity;
  private dirtyTo = -1;
  private wrapped = false;
  /** Latest landing time of any grain, so callers know when the sky is clear. */
  busyUntil = 0;

  constructor(readonly capacity: number) {
    const geo = new THREE.BufferGeometry();
    this.start = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    this.vel = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    const t = new Float32Array(capacity * 4);
    for (let i = 0; i < capacity; i++) t[i * 4] = -1e6; // long dead
    this.time = new THREE.BufferAttribute(t, 4);
    this.color = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    for (const a of [this.start, this.vel, this.time, this.color]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.start); // three needs a position attribute; aStart doubles as it
    geo.setAttribute('aStart', this.start);
    geo.setAttribute('aVel', this.vel);
    geo.setAttribute('aTime', this.time);
    geo.setAttribute('aColor', this.color);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 }, uScale: { value: 400 } },
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  /** Pixels per world unit at distance 1, so grain size follows the camera. Call on resize. */
  setScale(viewportHeightPx: number, fovDeg: number): void {
    this.mat.uniforms.uScale.value = viewportHeightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  launch(g: GrainLaunch): void {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    if (this.next === 0) this.wrapped = true;
    const gs = g.g ?? 1;
    // v = (end − start − ½·a·dur²) / dur, with a = (0, −G·gs, 0)
    const d = Math.max(1e-3, g.dur);
    const vx = (g.ex - g.x) / d;
    const vy = (g.ey - g.y + 0.5 * GRAVITY * gs * d * d) / d;
    const vz = (g.ez - g.z) / d;
    this.start.setXYZ(i, g.x, g.y, g.z);
    this.vel.setXYZ(i, vx, vy, vz);
    this.time.setXYZW(i, g.t0, d, g.size, gs);
    this.color.setXYZ(i, g.color.r, g.color.g, g.color.b);
    this.dirtyFrom = Math.min(this.dirtyFrom, i);
    this.dirtyTo = Math.max(this.dirtyTo, i);
    this.busyUntil = Math.max(this.busyUntil, g.t0 + d);
  }

  /** Upload what was launched since the last frame. */
  update(now: number): void {
    this.mat.uniforms.uTime.value = now;
    if (this.dirtyTo < 0) return;
    for (const a of [this.start, this.vel, this.time, this.color]) {
      a.clearUpdateRanges();
      if (this.wrapped) {
        // the ring wrapped this frame: upload everything (rare, only on huge pours)
      } else {
        a.addUpdateRange(this.dirtyFrom * a.itemSize, (this.dirtyTo - this.dirtyFrom + 1) * a.itemSize);
      }
      a.needsUpdate = true;
    }
    this.dirtyFrom = Infinity;
    this.dirtyTo = -1;
    this.wrapped = false;
  }

  /** Kill every grain (fast-forward, undo, restart). */
  clear(): void {
    const t = this.time.array as Float32Array;
    for (let i = 0; i < this.capacity; i++) t[i * 4] = -1e6;
    this.time.clearUpdateRanges();
    this.time.needsUpdate = true;
    this.busyUntil = 0;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
