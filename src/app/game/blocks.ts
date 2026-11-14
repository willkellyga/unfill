import * as THREE from 'three';
import { EMPTY } from '../../core';
import { BLOCK, BLOCK_DEPTH, type Terrarium } from './scene';
import { sandColor } from './palette';
import { patternFor, type PatternMode } from './prefs';
import { sandTexture, sandTileTexture } from './textures';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergedDepthMaterial, mergedGeometry, mergedLook, neighborMask, patchMerged, type BlockStyle } from './merged';

/**
 * Sand blocks as instanced meshes: one draw call for every block on screen, and one for the translucent ghost
 * shown while holding to preview.
 *
 * How a group of touching same-color blocks looks depends on the style. The merged styles (merged.ts) wrap each
 * block around its group's shape in the vertex shader, so a group is one continuous rounded piece. The classic
 * style draws separate rounded cubes plus "bridges", flat strips that fill the seams between them.
 *
 * Each frame the caller describes what to draw with `begin`, `block`, `bridgesFor` and `ghost`, then `end`.
 */
const MAX_BLOCKS = 300;
const MAX_BRIDGES = 400;

/**
 * Color-blind patterns (prefs.ts): a fine surface pattern pressed into the sand, picked per instance by `aPat`
 * (0 plain, 1 dots, 2 waves, 3 crosshatch, 4 stripes). Drawn in world units around each instance's center, with
 * periods that divide the half-cell spacing of blocks and the bridges between them, so a group's pattern runs
 * unbroken across its seams and moves with the sand as it falls.
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
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= 1.0 - 0.3 * patMask(vPatUv, vPat);')
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
  /** Merged styles: the neighbors this block joins, when the caller knows (a piece in flight). See merged.ts. */
  join?: number;
}

export class Blocks {
  readonly mesh: THREE.InstancedMesh;
  readonly bridges: THREE.InstancedMesh;
  readonly ghostMesh: THREE.InstancedMesh;
  private readonly glow: THREE.InstancedBufferAttribute;
  private readonly bridgeGlow: THREE.InstancedBufferAttribute;
  private readonly pat: THREE.InstancedBufferAttribute;
  private readonly bridgePat: THREE.InstancedBufferAttribute;
  /** Which sands carry their color-blind pattern. */
  patterns: PatternMode = 'fifth';
  private readonly ghostMat: THREE.MeshBasicMaterial;
  private readonly mask: THREE.InstancedBufferAttribute;
  /** Per drawn block: where it is, and whether it sits square in a cell (so it can join its neighbors). */
  private readonly bx = new Float32Array(MAX_BLOCKS);
  private readonly by = new Float32Array(MAX_BLOCKS);
  private readonly bColor = new Int16Array(MAX_BLOCKS);
  private readonly bSquare = new Uint8Array(MAX_BLOCKS);
  private style: BlockStyle = 'classic';
  private segments: number;
  private readonly classicMat: THREE.MeshStandardMaterial;
  private mergedMat: THREE.MeshStandardMaterial | null = null;
  private n = 0;
  private nb = 0;
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
    style: BlockStyle = 'classic',
  ) {
    this.segments = segments;
    this.style = style;
    const mat = withGlow(new THREE.MeshStandardMaterial({ map: sandTexture(true), roughness: 0.93, metalness: 0, envMapIntensity: 0.6 }));
    mat.clippingPlanes = [this.clip];
    this.classicMat = mat;
    this.glow = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BLOCKS), 1);
    this.glow.setUsage(THREE.DynamicDrawUsage);
    this.pat = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BLOCKS), 1);
    this.pat.setUsage(THREE.DynamicDrawUsage);
    this.mask = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BLOCKS), 1);
    this.mask.setUsage(THREE.DynamicDrawUsage);
    const geo = this.makeGeometry();
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_BLOCKS);
    this.applyStyleMaterial();
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.frustumCulled = false;

    const bgeo = new THREE.BoxGeometry(1, 1, 1);
    this.bridgeGlow = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BRIDGES), 1);
    this.bridgeGlow.setUsage(THREE.DynamicDrawUsage);
    bgeo.setAttribute('aGlow', this.bridgeGlow);
    this.bridgePat = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BRIDGES), 1);
    this.bridgePat.setUsage(THREE.DynamicDrawUsage);
    bgeo.setAttribute('aPat', this.bridgePat);
    // a touch darker than the blocks' faces, to sit in with their softly shaded edges
    const bmat = withGlow(
      new THREE.MeshStandardMaterial({ map: sandTexture(false), color: 0xe6e2de, roughness: 0.93, metalness: 0, envMapIntensity: 0.6 }),
    );
    bmat.clippingPlanes = [this.clip];
    this.bridges = new THREE.InstancedMesh(bgeo, bmat, MAX_BRIDGES);
    this.bridges.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bridges.setColorAt(0, new THREE.Color());
    this.bridges.frustumCulled = false;

    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
    this.ghostMesh = new THREE.InstancedMesh(this.classicGeometry(), this.ghostMat, 120);
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
    for (const m of [this.mesh, this.bridges]) {
      m.castShadow = on;
      m.receiveShadow = on;
    }
  }

  private classicGeometry(): THREE.BufferGeometry {
    return new RoundedBoxGeometry(BLOCK, BLOCK, BLOCK_DEPTH, this.segments, 0.13);
  }

  private get merged(): boolean {
    return this.style !== 'classic';
  }

  private makeGeometry(): THREE.BufferGeometry {
    const geo = this.merged ? mergedGeometry(mergedLook(this.style).radius, this.segments) : this.classicGeometry();
    geo.setAttribute('aGlow', this.glow);
    geo.setAttribute('aPat', this.pat);
    geo.setAttribute('aMask', this.mask);
    return geo;
  }

  private applyStyleMaterial(): void {
    if (!this.merged) {
      this.mesh.material = this.classicMat;
      this.mesh.customDepthMaterial = undefined;
      return;
    }
    const look = mergedLook(this.style);
    this.mergedMat?.dispose();
    const mat = withGlow(new THREE.MeshStandardMaterial({ map: sandTileTexture(), roughness: 0.93, metalness: 0, envMapIntensity: 0.6 }));
    const glowPatch = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader, renderer) => {
      glowPatch.call(mat, shader, renderer);
      patchMerged(shader, look);
    };
    mat.customProgramCacheKey = () => `merged-${look.radius}-${look.score}`;
    mat.clippingPlanes = [this.clip];
    this.mergedMat = mat;
    this.mesh.material = mat;
    this.mesh.customDepthMaterial = mergedDepthMaterial(look);
  }

  /** The current look of joined blocks (merged.ts). */
  get blockStyle(): BlockStyle {
    return this.style;
  }

  setStyle(style: BlockStyle): void {
    if (style === this.style) return;
    this.style = style;
    this.rebuild();
    this.applyStyleMaterial();
  }

  /** Rounded-edge detail for the quality tier. */
  setSegments(segments: number): void {
    this.segments = segments;
    this.rebuild();
    const old = this.ghostMesh.geometry;
    this.ghostMesh.geometry = this.classicGeometry();
    old.dispose();
  }

  private rebuild(): void {
    const old = this.mesh.geometry;
    this.mesh.geometry = this.makeGeometry();
    old.dispose();
  }

  begin(): void {
    this.n = 0;
    this.nb = 0;
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
    this.mask.setX(i, this.merged ? (d.join ?? 0) : 0);
    this.bx[i] = d.x;
    this.by[i] = d.y0;
    this.bColor[i] = d.color;
    this.bSquare[i] =
      d.join === undefined &&
      d.h === 1 && !d.rotY && !d.z && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01 && Math.abs(sz - 1) < 0.01 ? 1 : 0;
  }

  /**
   * Bridges between edge-touching same-color blocks on a settled grid. `colorAt` gives the color in each cell, or
   * EMPTY; `glowAt` an optional highlight per cell.
   */
  bridgesFor(cols: number, rows: number, colorAt: (i: number) => number, glowAt?: (i: number) => number): void {
    if (this.merged) return this.joinBlocks(cols, rows, colorAt);
    const T = this.t;
    const inset = 0.13; // matches the block's corner radius
    const span = 1 - BLOCK + 2 * inset + 0.02;
    const long = BLOCK - 0.16; // fills most of the rounded dip between the two blocks
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const v = colorAt(i);
        if (v === EMPTY) continue;
        const x = T.cellX(c);
        const y = T.cellY(r);
        const g = glowAt ? glowAt(i) : 0;
        if (c + 1 < cols && colorAt(i + 1) === v) this.bridge(x + 0.5, y, span, long, BLOCK_DEPTH - 0.004, v, g);
        if (r + 1 < rows && colorAt(i + cols) === v) this.bridge(x, y - 0.5, long, span, BLOCK_DEPTH - 0.004, v, g);
        if (c + 1 < cols && r + 1 < rows && colorAt(i + 1) === v && colorAt(i + cols) === v && colorAt(i + cols + 1) === v) {
          this.bridge(x + 0.5, y - 0.5, span, span, BLOCK_DEPTH - 0.004, v, g);
        }
      }
  }

  /** Merged styles: tell each block sitting square in a settled cell which same-color neighbors it joins. */
  private joinBlocks(cols: number, rows: number, colorAt: (i: number) => number): void {
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

  private bridge(x: number, y: number, w: number, h: number, d: number, color: number, glow: number): void {
    if (this.nb >= MAX_BRIDGES) return;
    const i = this.nb++;
    this.p.set(x, y, 0);
    this.q.identity();
    this.s.set(w, h, d);
    this.m.compose(this.p, this.q, this.s);
    this.bridges.setMatrixAt(i, this.m);
    this.bridges.setColorAt(i, sandColor(color));
    this.bridgeGlow.setX(i, glow);
    this.bridgePat.setX(i, patternFor(color, this.patterns));
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
      [this.bridges, this.nb],
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
    for (const [a, count] of [
      [this.glow, this.n],
      [this.bridgeGlow, this.nb],
      [this.pat, this.n],
      [this.bridgePat, this.nb],
      [this.mask, this.n],
    ] as const) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, Math.max(1, count));
      a.needsUpdate = true;
    }
    this.ghostMat.opacity = ghostOpacity;
  }
}
