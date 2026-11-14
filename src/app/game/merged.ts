import * as THREE from 'three';
import { BLOCK, BLOCK_DEPTH } from './scene';

/**
 * Merged sand: touching blocks of one color drawn as one continuous rounded piece, with no seams, instead of
 * separate rounded cubes with strips laid over the joins.
 *
 * Every block is still one instance of one mesh (one draw call), but the mesh is a finely divided box the size of a
 * whole cell, which the vertex shader wraps around the block's actual shape. That shape is a rounded box grown
 * around a "core": the block's own square, shrunk by the corner radius, plus a strip to the center of each
 * same-color neighbor it touches, plus the square between four same-color blocks in a 2x2. Each instance carries an
 * 8-bit mask of which neighbors it joins (aMask), so a lone or moving block is the same soft cube as before and a
 * settled group is one smooth piece: one outline, one bevel, one sand texture running straight across.
 *
 * Neighbors agree on every vertex they share (they compute the same core near their common edge), so there are no
 * cracks. Neighbor bits: 1 right, 2 left, 4 up, 8 down, 16 up-right, 32 up-left, 64 down-left, 128 down-right
 * (a diagonal bit only when both sides and the diagonal block are the same color).
 */

export const BLOCK_STYLES = ['classic', 'merged', 'puffy', 'scored', 'grooved', 'pillowed', 'softscored', 'stamped'] as const;
export type BlockStyle = (typeof BLOCK_STYLES)[number];

export function parseBlockStyle(v: string | null): BlockStyle {
  return (BLOCK_STYLES as readonly string[]).includes(v ?? '') ? (v as BlockStyle) : 'merged';
}

export interface MergedLook {
  /** Corner and bevel radius, world units (a cell is 1). */
  radius: number;
  /**
   * What marks the joins inside a piece: 0 nothing, 1 a soft shaded score line, 2 a pressed groove that catches the
   * light, 3 each cell gently domed (a chocolate bar), 4 a row of stamped dimples, 5 a bolder score line.
   */
  score: number;
}

export function mergedLook(style: BlockStyle): MergedLook {
  switch (style) {
    case 'puffy':
      return { radius: 0.24, score: 0 };
    case 'scored':
      return { radius: 0.13, score: 1 };
    case 'grooved':
      return { radius: 0.13, score: 2 };
    case 'pillowed':
      return { radius: 0.13, score: 3 };
    case 'softscored':
      return { radius: 0.24, score: 5 };
    case 'stamped':
      return { radius: 0.13, score: 4 };
    default:
      return { radius: 0.13, score: 0 };
  }
}

export const NB = { R: 1, L: 2, U: 4, D: 8, UR: 16, UL: 32, DL: 64, DR: 128 } as const;

/**
 * Neighbor mask for cell i on a cols x rows grid, rows counted from the top. `same(j)` says whether cell j is the
 * same color as cell i.
 */
export function neighborMask(i: number, cols: number, rows: number, same: (j: number) => boolean): number {
  const c = i % cols;
  const r = (i / cols) | 0;
  const R = c + 1 < cols && same(i + 1);
  const L = c > 0 && same(i - 1);
  const U = r > 0 && same(i - cols);
  const D = r + 1 < rows && same(i + cols);
  let m = 0;
  if (R) m |= NB.R;
  if (L) m |= NB.L;
  if (U) m |= NB.U;
  if (D) m |= NB.D;
  if (U && R && same(i - cols + 1)) m |= NB.UR;
  if (U && L && same(i - cols - 1)) m |= NB.UL;
  if (D && L && same(i + cols - 1)) m |= NB.DL;
  if (D && R && same(i + cols + 1)) m |= NB.DR;
  return m;
}

/**
 * Neighbor masks for a loose group of same-color blocks at whole-cell offsets (a lifted piece in flight). Blocks
 * with `alive[k]` false join nothing.
 */
export function groupMasks(pts: { x: number; y: number }[], alive: (k: number) => boolean): number[] {
  const key = (x: number, y: number) => `${Math.round(x)},${Math.round(y)}`;
  const at = new Map<string, number>();
  pts.forEach((p, k) => alive(k) && at.set(key(p.x, p.y), k));
  return pts.map((p, k) => {
    if (!alive(k)) return 0;
    const has = (dx: number, dy: number) => at.has(key(p.x + dx, p.y + dy));
    const R = has(1, 0);
    const L = has(-1, 0);
    const U = has(0, 1);
    const D = has(0, -1);
    let m = (R ? NB.R : 0) | (L ? NB.L : 0) | (U ? NB.U : 0) | (D ? NB.D : 0);
    if (U && R && has(1, 1)) m |= NB.UR;
    if (U && L && has(-1, 1)) m |= NB.UL;
    if (D && L && has(-1, -1)) m |= NB.DL;
    if (D && R && has(1, -1)) m |= NB.DR;
    return m;
  });
}

/**
 * A box over the whole cell (x, y in -0.5..0.5, z through the block's depth), divided so that once the shader wraps
 * it, the rounded edges get evenly spaced rings of vertices (even steps of angle around the bevel).
 */
export function mergedGeometry(radius: number, segments: number): THREE.BufferGeometry {
  const half = BLOCK / 2;
  const core = half - radius;
  const hz = BLOCK_DEPTH / 2;
  const iz = hz - radius;
  const steps = Math.max(2, segments + 1);
  // across x and y: the flat middle, then rings out to the cell edge
  const reach = 0.5 - core; // how far past the core the cell edge is
  const maxA = Math.atan(reach / radius);
  const band: number[] = [];
  for (let k = 1; k <= steps; k++) band.push(core + radius * Math.tan((maxA * k) / steps));
  band[band.length - 1] = 0.5;
  const xs = [...band.map((v) => -v).reverse(), -core, 0, core, ...band];
  // through z: the flat side wall, then rings over to the front and back faces
  const maxB = Math.atan(radius / reach);
  const zb: number[] = [];
  for (let k = 1; k <= steps; k++) zb.push(iz + reach * Math.tan((maxB * k) / steps));
  zb[zb.length - 1] = hz;
  const zs = [...zb.map((v) => -v).reverse(), -iz, iz, ...zb];

  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  // one face: u along a, v along b, fixed coordinate w on axis c, normal sign s
  const face = (us: number[], vs: number[], put: (u: number, v: number) => [number, number, number], n: [number, number, number]) => {
    const base = pos.length / 3;
    for (const v of vs)
      for (const u of us) {
        pos.push(...put(u, v));
        nrm.push(...n);
      }
    const w = us.length;
    for (let j = 0; j + 1 < vs.length; j++)
      for (let i = 0; i + 1 < w; i++) {
        const a = base + j * w + i;
        const b = a + 1;
        const c = a + w;
        const d = c + 1;
        idx.push(a, b, d, a, d, c);
      }
  };
  const rev = (a: number[]) => [...a].reverse();
  face(xs, xs, (x, y) => [x, y, hz], [0, 0, 1]); // front
  face(rev(xs), xs, (x, y) => [x, y, -hz], [0, 0, -1]); // back
  face(zs, xs, (z, y) => [0.5, y, -z], [1, 0, 0]); // right
  face(zs, xs, (z, y) => [-0.5, y, z], [-1, 0, 0]); // left
  face(xs, zs, (x, z) => [x, 0.5, -z], [0, 1, 0]); // top
  face(xs, zs, (x, z) => [x, -0.5, z], [0, -1, 0]); // bottom
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setIndex(idx);
  return g;
}

const MAP_GLSL = /* glsl */ `
attribute float aMask;
uniform float uCore;
uniform float uRad;
uniform float uHalfZ;
flat varying float vMask;
varying vec3 vLocal;
varying vec3 vLocalN;

void unfillCand(vec2 q, vec2 lo, vec2 hi, inout vec2 best, inout float bd) {
  vec2 cp = clamp(q, lo, hi);
  vec2 dd = q - cp;
  float d2 = dot(dd, dd);
  if (d2 < bd) { bd = d2; best = cp; }
}

// Wrap a vertex of the cell-sized box around this block's rounded shape.
void unfillMap(vec3 p, vec3 n, out vec3 pos, out vec3 nrm) {
  int m = int(aMask + 0.5);
  float c = uCore;
  vec2 q = p.xy;
  vec2 best = clamp(q, vec2(-c), vec2(c));
  float bd = dot(q - best, q - best);
  if ((m & 1) != 0) unfillCand(q, vec2(0.0, -c), vec2(1.0, c), best, bd);
  if ((m & 2) != 0) unfillCand(q, vec2(-1.0, -c), vec2(0.0, c), best, bd);
  if ((m & 4) != 0) unfillCand(q, vec2(-c, 0.0), vec2(c, 1.0), best, bd);
  if ((m & 8) != 0) unfillCand(q, vec2(-c, -1.0), vec2(c, 0.0), best, bd);
  if ((m & 16) != 0) unfillCand(q, vec2(0.0), vec2(1.0), best, bd);
  if ((m & 32) != 0) unfillCand(q, vec2(-1.0, 0.0), vec2(0.0, 1.0), best, bd);
  if ((m & 64) != 0) unfillCand(q, vec2(-1.0), vec2(0.0), best, bd);
  if ((m & 128) != 0) unfillCand(q, vec2(0.0, -1.0), vec2(1.0, 0.0), best, bd);
  float iz = clamp(p.z, -(uHalfZ - uRad), uHalfZ - uRad);
  vec3 o = vec3(q - best, p.z - iz);
  float L = length(o);
  if (L > 1e-5) {
    nrm = o / L;
    pos = vec3(best, iz) + nrm * uRad;
  } else {
    nrm = n;
    pos = p;
  }
  // A side wall where this block joins a neighbor is inside the piece. Fold it flat against the back, or at a
  // glancing angle its top edge pokes through the front as a thin dark seam.
  if (abs(n.z) < 0.5 && dot(q - best, q - best) < 1e-10) pos.z = -uHalfZ;
  // grow a hair, so joined neighbors overlap instead of leaving a pixel crack where their edges meet
  pos.xy *= 1.004;
}
`;

const SCORE_GLSL = /* glsl */ `
uniform float uScore;
flat varying float vMask;
varying vec3 vLocal;
varying vec3 vLocalN;
varying vec3 vTx;
varying vec3 vTy;
vec2 unfillGrad = vec2(0.0);

// One join's relief, seen from inside this block: e is the distance in from the joined edge, t the position along
// it. Adds to the slope of the surface (grad, along the outward direction a) and returns how shadowed it is (0..1).
float unfillJoin(int kind, float e, float t, vec2 a) {
  if (kind == 1 || kind == 5) {
    // a soft shaded score line, with no slope (5: a little bolder, for the rounder outline)
    return kind == 1 ? 0.2 * exp(-pow(e / 0.035, 2.0)) : 0.3 * exp(-pow(e / 0.04, 2.0));
  }
  if (kind == 2) {
    // a pressed groove: its two walls catch and lose the light
    float w = 0.045;
    float g = exp(-pow(e / w, 2.0));
    unfillGrad -= a * (0.045 * 2.0 * e / (w * w) * g);
    return 0.16 * g;
  }
  if (kind == 3) {
    // each cell domed, dipping into a soft crease at the join
    float w = 0.32;
    if (e >= w) return 0.0;
    float k = 1.0 - e / w;
    unfillGrad -= a * (0.13 * 2.0 * k / w);
    return 0.16 * k * k * k;
  }
  // stamped dimples in a row along the join
  float rr = 0.06;
  float c = clamp(floor(t / 0.2 + 0.5) * 0.2, -0.4, 0.4);
  vec2 rv = vec2(e, t - c);
  float r = length(rv);
  if (r >= rr) return 0.0;
  float q = 1.0 - (r * r) / (rr * rr);
  // height -D q^2: the slope rises away from the dimple's center
  vec2 along = abs(a.x) > 0.5 ? vec2(0.0, 1.0) : vec2(1.0, 0.0);
  vec2 d = -a * rv.x + along * rv.y; // from the dimple center to here
  unfillGrad += d * (0.03 * 4.0 * q / (rr * rr));
  return 0.32 * q;
}

// Soft shading for the merged shape: a little darker toward the outline (the old baked edge band), and the marks
// where the blocks of a piece meet.
float unfillShade() {
  int m = int(vMask + 0.5);
  float rim = clamp(1.0 - vLocalN.z, 0.0, 1.0);
  float s = 1.0 - 0.18 * rim - 0.12 * max(-vLocalN.y, 0.0);
  int kind = int(uScore + 0.5);
  if (kind > 0 && vLocalN.z > 0.6) {
    vec2 p = vLocal.xy;
    float occ = 0.0;
    if ((m & 1) != 0) occ = max(occ, unfillJoin(kind, 0.5 - p.x, p.y, vec2(1.0, 0.0)));
    if ((m & 2) != 0) occ = max(occ, unfillJoin(kind, p.x + 0.5, p.y, vec2(-1.0, 0.0)));
    if ((m & 4) != 0) occ = max(occ, unfillJoin(kind, 0.5 - p.y, p.x, vec2(0.0, 1.0)));
    if ((m & 8) != 0) occ = max(occ, unfillJoin(kind, p.y + 0.5, p.x, vec2(0.0, -1.0)));
    s *= 1.0 - occ;
    // fade the relief out where the front face rounds over into the bevel
    unfillGrad *= smoothstep(0.6, 0.9, vLocalN.z);
  }
  return s;
}
`;

/** Material changes for the merged shape, on top of the glow and pattern ones (blocks.ts). */
export function patchMerged(shader: THREE.WebGLProgramParametersWithUniforms, look: MergedLook): void {
  const radius = look.radius;
  shader.uniforms.uCore = { value: BLOCK / 2 - radius };
  shader.uniforms.uRad = { value: radius };
  shader.uniforms.uHalfZ = { value: BLOCK_DEPTH / 2 };
  shader.uniforms.uScore = { value: look.score };
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\n' + MAP_GLSL + 'varying vec3 vTx;\nvarying vec3 vTy;\n')
    .replace(
      '#include <beginnormal_vertex>',
      'vec3 unfillPos;\nvec3 objectNormal;\nunfillMap(position, normal, unfillPos, objectNormal);\nvMask = aMask;\nvLocal = unfillPos;\nvLocalN = objectNormal;\n' +
        '#ifdef USE_INSTANCING\nmat3 unfillM = mat3(modelViewMatrix) * mat3(instanceMatrix);\n#else\nmat3 unfillM = mat3(modelViewMatrix);\n#endif\n' +
        'vTx = normalize(unfillM * vec3(1.0, 0.0, 0.0));\nvTy = normalize(unfillM * vec3(0.0, 1.0, 0.0));',
    )
    .replace('#include <begin_vertex>', 'vec3 transformed = unfillPos;\n#ifdef USE_MAP\nvMapUv = unfillPos.xy + 0.5;\n#endif');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\n' + SCORE_GLSL)
    .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= unfillShade();')
    .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(normal - unfillGrad.x * vTx - unfillGrad.y * vTy);');
}

/** Shadow-map material that wraps the box the same way. */
export function mergedDepthMaterial(look: MergedLook): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uCore = { value: BLOCK / 2 - look.radius };
    shader.uniforms.uRad = { value: look.radius };
    shader.uniforms.uHalfZ = { value: BLOCK_DEPTH / 2 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + MAP_GLSL)
      .replace(
        '#include <begin_vertex>',
        'vec3 unfillPos;\nvec3 unfillN;\nunfillMap(position, normal, unfillPos, unfillN);\nvMask = aMask;\nvLocal = unfillPos;\nvLocalN = unfillN;\nvec3 transformed = unfillPos;',
      );
    // the varyings above are written but unused here; declare them for the fragment side to keep the link happy
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      '#include <common>\nflat varying float vMask;\nvarying vec3 vLocal;\nvarying vec3 vLocalN;',
    );
  };
  m.customProgramCacheKey = () => `unfill-depth-${look.radius}`;
  return m;
}
