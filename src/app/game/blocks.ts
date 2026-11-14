import * as THREE from 'three';
import { EMPTY } from '../../core';
import { BLOCK, BLOCK_DEPTH, type Terrarium } from './scene';
import { sandColor } from './palette';
import { sandTexture } from './textures';

/**
 * Sand blocks as instanced meshes: one draw call for every block on screen, one for the "bridges" that fill the
 * seams between touching blocks of one color (so a group reads as one piece of packed sand), and one for the
 * translucent ghost shown while holding to preview.
 *
 * Each frame the caller describes what to draw with `begin`, `block`, `bridgesFor` and `ghost`, then `end`.
 */
const MAX_BLOCKS = 300;
const MAX_BRIDGES = 400;

/** Adds a per-instance glow (0..1) to a standard material, for the hover and preview highlights. */
function withGlow(mat: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.94, 0.84) * vGlow * 0.55;',
      );
  };
  mat.customProgramCacheKey = () => 'glow';
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
}

export class Blocks {
  readonly mesh: THREE.InstancedMesh;
  readonly bridges: THREE.InstancedMesh;
  readonly ghostMesh: THREE.InstancedMesh;
  private readonly glow: THREE.InstancedBufferAttribute;
  private readonly bridgeGlow: THREE.InstancedBufferAttribute;
  private readonly ghostMat: THREE.MeshBasicMaterial;
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
    geo: THREE.BufferGeometry,
  ) {
    const mat = withGlow(new THREE.MeshStandardMaterial({ map: sandTexture(true), roughness: 0.93, metalness: 0, envMapIntensity: 0.6 }));
    mat.clippingPlanes = [this.clip];
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_BLOCKS);
    this.glow = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BLOCKS), 1);
    this.glow.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aGlow', this.glow);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.frustumCulled = false;

    const bgeo = new THREE.BoxGeometry(1, 1, 1);
    this.bridgeGlow = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BRIDGES), 1);
    this.bridgeGlow.setUsage(THREE.DynamicDrawUsage);
    bgeo.setAttribute('aGlow', this.bridgeGlow);
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
    this.ghostMesh = new THREE.InstancedMesh(geo, this.ghostMat, 120);
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

  /** Swap the block geometry (quality tier changed). */
  setGeometry(geo: THREE.BufferGeometry): void {
    const old = this.mesh.geometry;
    geo.setAttribute('aGlow', this.glow);
    this.mesh.geometry = geo;
    this.ghostMesh.geometry = geo;
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
  }

  /**
   * Bridges between edge-touching same-color blocks on a settled grid. `colorAt` gives the color in each cell, or
   * EMPTY; `glowAt` an optional highlight per cell.
   */
  bridgesFor(cols: number, rows: number, colorAt: (i: number) => number, glowAt?: (i: number) => number): void {
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
    ] as const) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, Math.max(1, count));
      a.needsUpdate = true;
    }
    this.ghostMat.opacity = ghostOpacity;
  }
}
