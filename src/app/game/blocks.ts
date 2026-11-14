import * as THREE from 'three';
import { EMPTY } from '../../core';
import { BLOCK, BLOCK_DEPTH, type Terrarium } from './scene';
import { sandColor } from './palette';
import { patternFor, type PatternMode } from './prefs';
import { sandTileTexture } from './textures';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { LOOK, mergedDepthMaterial, mergedGeometry, neighborMask, patchMerged } from './merged';

/**
 * Sand blocks as instanced meshes: one draw call for every block on screen, and one for the translucent ghost
 * shown while holding to preview.
 *
 * Touching blocks of one color are drawn as one continuous rounded piece, with a soft score line where the blocks
 * meet: the vertex shader wraps each block around its group's shape (merged.ts).
 *
 * Each frame the caller describes what to draw with `begin`, `block`, `joinSettled` and `ghost`, then `end`.
 */
const MAX_BLOCKS = 300;

/**
 * Color-blind patterns (prefs.ts): a fine surface pattern pressed into the sand, picked per instance by `aPat`
 * (0 plain, 1 dots, 2 waves, 3 crosshatch, 4 stripes). Drawn in world units around each instance's center, with
 * periods that divide the half-cell spacing of blocks, so a piece's pattern runs unbroken across its joins and moves with the sand as it falls.
 */
const PATTERN_GLSL = /* glsl */ `
float patLine(float v, float w) {
  float d = abs(fract(v) - 0.5);
  float aa = fwidth(v) * 0.75;
  return 1.0 - smoothstep(w - aa, w + aa, d);
}
float patMask(vec2 p, float k) {
  if (k < 0.5) return 0.0;
  vec2 q = p * 4.0; // period 0.25 world units: four repeats per cell
  if (k < 1.5) {
    vec2 f = fract(q) - 0.5;
    float r = length(f);
    float aa = fwidth(q.x) * 0.75;
    return 1.0 - smoothstep(0.2 - aa, 0.2 + aa, r);
  }
  if (k < 2.5) return 1.0 - patLine(q.y + 0.16 * sin(q.x * 3.14159265), 0.38);
  if (k < 3.5) return max(1.0 - patLine(q.x + q.y, 0.42), 1.0 - patLine(q.x - q.y, 0.42));
  return 1.0 - patLine((q.x + q.y) * 0.5, 0.26);
}
`;

/**
 * Adds a per-instance glow (0..1) for highlights, and the color-blind pattern, to a standard material.
 */
function withGlow(mat: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aGlow;\nattribute float aPat;\nvarying float vGlow;\nvarying float vPat;\nvarying vec2 vPatUv;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vGlow = aGlow;
vPat = aPat;
#ifdef USE_INSTANCING
vPatUv = (modelMatrix * (instanceMatrix * vec4(transformed, 1.0) - instanceMatrix[3])).xy;
#else
vPatUv = (modelMatrix * vec4(transformed, 0.0)).xy;
#endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;\nvarying float vPat;\nvarying vec2 vPatUv;\n' + PATTERN_GLSL)
      .replace('#include <map_fragment>', '#include <map_fragment>\n' +
          // pressed patterns darken the sand; on a dark sand (the daily's indigo) they lighten it instead, to stay visible
          'float patM = patMask(vPatUv, vPat);\n' +
          'diffuseColor.rgb = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)) < 0.2 ? mix(diffuseColor.rgb, vec3(1.0), 0.32 * patM) : diffuseColor.rgb * (1.0 - 0.3 * patM);')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.94, 0.84) * vGlow * 0.55;',
      );
  };
  mat.customProgramCacheKey = () => 'glow-pattern';
  return mat;
}

export interface BlockDraw {
  x: number;
  /** Bottom edge of the block (world y). */
  y0: number;
  /** Height as a fraction of a whole block (less while it drains or fills). */
  h: number;
  z?: number;
  /** Uniform scale around the block's center (squish, shrink in flight). */
  sx?: number;
  sy?: number;
  sz?: number;
  rotY?: number;
  color: number;
  glow?: number;
  /** The neighbors this block joins, when the caller knows (a piece in flight; see merged.ts). */
  join?: number;
}

export class Blocks {
  readonly mesh: THREE.InstancedMesh;
  readonly ghostMesh: THREE.InstancedMesh;
  private readonly glow: THREE.InstancedBufferAttribute;
  private readonly pat: THREE.InstancedBufferAttribute;
  private readonly mask: THREE.InstancedBufferAttribute;
  /** Which sands carry their color-blind pattern. */
  patterns: PatternMode = 'fifth';
  private readonly ghostMat: THREE.MeshBasicMaterial;
  /** Per drawn block: where it is, and whether it sits square in a cell (so it can join its neighbors). */
  private readonly bx = new Float32Array(MAX_BLOCKS);
  private readonly by = new Float32Array(MAX_BLOCKS);
  private readonly bColor = new Int16Array(MAX_BLOCKS);
  private readonly bSquare = new Uint8Array(MAX_BLOCKS);
  private segments: number;
  private n = 0;
  private ng = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  /** Hides sand above a height (the tray's top rail) while a new level pours in; far away the rest of the time. */
  private readonly clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6);

  constructor(
    private readonly t: Terrarium,
    segments: number,
  ) {
    this.segments = segments;
    this.glow = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BLOCKS), 1);
    this.glow.setUsage(THREE.DynamicDrawUsage);
    this.pat = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BLOCKS), 1);
    this.pat.setUsage(THREE.DynamicDrawUsage);
    this.mask = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BLOCKS), 1);
    this.mask.setUsage(THREE.DynamicDrawUsage);

    const mat = withGlow(new THREE.MeshStandardMaterial({ map: sandTileTexture(), roughness: 0.93, metalness: 0, envMapIntensity: 0.6 }));
    const glowPatch = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader, renderer) => {
      glowPatch.call(mat, shader, renderer);
      patchMerged(shader, LOOK);
    };
    mat.customProgramCacheKey = () => 'merged-sand';
    mat.clippingPlanes = [this.clip];
    this.mesh = new THREE.InstancedMesh(this.makeGeometry(), mat, MAX_BLOCKS);
    this.mesh.customDepthMaterial = mergedDepthMaterial(LOOK);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.frustumCulled = false;

    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
    this.ghostMesh = new THREE.InstancedMesh(this.ghostGeometry(), this.ghostMat, 120);
    this.ghostMesh.setColorAt(0, new THREE.Color());
    this.ghostMesh.frustumCulled = false;
    this.ghostMesh.renderOrder = 10;
  }

  /** Clip blocks above height y (null: no clipping). The plane stays on the materials, so no shader recompile. */
  setClipTop(y: number | null): void {
    this.clip.constant = y ?? 1e6;
  }

  get ghostMaterial(): THREE.Material {
    return this.ghostMat;
  }

  setShadows(on: boolean): void {
    this.mesh.castShadow = on;
    this.mesh.receiveShadow = on;
  }

  private ghostGeometry(): THREE.BufferGeometry {
    return new RoundedBoxGeometry(BLOCK, BLOCK, BLOCK_DEPTH, this.segments, LOOK.radius);
  }

  private makeGeometry(): THREE.BufferGeometry {
    const geo = mergedGeometry(LOOK.radius, this.segments);
    geo.setAttribute('aGlow', this.glow);
    geo.setAttribute('aPat', this.pat);
    geo.setAttribute('aMask', this.mask);
    return geo;
  }

  /** Rounded-edge detail for the quality tier. */
  setSegments(segments: number): void {
    this.segments = segments;
    for (const [mesh, geo] of [
      [this.mesh, this.makeGeometry()],
      [this.ghostMesh, this.ghostGeometry()],
    ] as const) {
      const old = mesh.geometry;
      mesh.geometry = geo;
      old.dispose();
    }
  }

  begin(): void {
    this.n = 0;
    this.ng = 0;
  }

  block(d: BlockDraw): void {
    if (this.n >= MAX_BLOCKS || d.h <= 0.001) return;
    const i = this.n++;
    const sx = d.sx ?? 1;
    const sy = d.sy ?? 1;
    const sz = d.sz ?? 1;
    // scale the block's height to d.h, anchored at its bottom edge y0, then apply the extra squish around center
    this.p.set(d.x, d.y0 + (BLOCK * d.h * sy) / 2, d.z ?? 0);
    this.e.set(0, d.rotY ?? 0, 0);
    this.q.setFromEuler(this.e);
    this.s.set(sx, d.h * sy, sz);
    this.m.compose(this.p, this.q, this.s);
    this.mesh.setMatrixAt(i, this.m);
    this.mesh.setColorAt(i, sandColor(d.color));
    this.glow.setX(i, d.glow ?? 0);
    this.pat.setX(i, patternFor(d.color, this.patterns));
    this.mask.setX(i, d.join ?? 0);
    this.bx[i] = d.x;
    this.by[i] = d.y0;
    this.bColor[i] = d.color;
    this.bSquare[i] =
      d.join === undefined &&
      d.h === 1 &&
      !d.rotY &&
      !d.z &&
      Math.abs(sx - 1) < 0.01 &&
      Math.abs(sy - 1) < 0.01 &&
      Math.abs(sz - 1) < 0.01
        ? 1
        : 0;
  }

  /**
   * Join the blocks drawn so far that sit square in a settled cell to their same-color neighbors. `colorAt` gives
   * the settled color in each cell of the grid, or EMPTY.
   */
  joinSettled(cols: number, rows: number, colorAt: (i: number) => number): void {
    const T = this.t;
    const x0 = T.cellX(0);
    const top = T.cellY(0);
    for (let k = 0; k < this.n; k++) {
      if (!this.bSquare[k]) continue;
      const c = Math.round(this.bx[k] - x0);
      const yc = this.by[k] + BLOCK / 2;
      const r = Math.round(top - yc);
      if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
      if (Math.abs(T.cellX(c) - this.bx[k]) > 1e-3 || Math.abs(T.cellY(r) - yc) > 1e-3) continue;
      const i = r * cols + c;
      const v = colorAt(i);
      if (v === EMPTY || v !== this.bColor[k]) continue;
      this.mask.setX(k, neighborMask(i, cols, rows, (j) => colorAt(j) === v));
    }
  }

  ghost(x: number, y: number, z: number, scale: number, color: number): void {
    if (this.ng >= 120) return;
    const i = this.ng++;
    this.p.set(x, y, z);
    this.q.identity();
    this.s.setScalar(scale);
    this.m.compose(this.p, this.q, this.s);
    this.ghostMesh.setMatrixAt(i, this.m);
    this.c.copy(sandColor(color)).lerp(new THREE.Color(1, 1, 1), 0.3);
    this.ghostMesh.setColorAt(i, this.c);
  }

  end(ghostOpacity = 0.5): void {
    for (const [mesh, count] of [
      [this.mesh, this.n],
      [this.ghostMesh, this.ng],
    ] as const) {
      mesh.count = count;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, Math.max(1, count) * 16);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.clearUpdateRanges();
        mesh.instanceColor.addUpdateRange(0, Math.max(1, count) * 3);
        mesh.instanceColor.needsUpdate = true;
      }
    }
    for (const a of [this.glow, this.pat, this.mask]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, Math.max(1, this.n));
      a.needsUpdate = true;
    }
    this.ghostMat.opacity = ghostOpacity;
  }
}
