import * as THREE from 'three';
import { BOTTLE_H } from './bottle';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { backdropTexture, causticTexture, glareTexture, softShadowTexture, woodTexture } from './textures';
import type { Tier } from './quality';

/**
 * The terrarium: a glass sand frame on a light wood table in late-afternoon sun.
 *
 * World units are cells: one sand block is about 1 × 1. The tray stands upright in the x–y plane, so gravity in the
 * rules ("down a column") is down the screen. Column c, row r (row 0 at the top) sits at
 *   x = c − (cols − 1)/2,   y = (rows − 1 − r) + 0.5,   z = 0.
 * The tray's inner floor is y = 0, and the keepsake bottle stands on the tray's top rail at the right.
 */
export const BLOCK = 0.96;
export const BLOCK_DEPTH = 0.9;
const HEADROOM = 0.3;
const PLINTH_H = 0.45;
const RAIL_H = 0.28;
const GLASS_T = 0.06;
const INNER_DEPTH = 1.0;
const FOV = 26;
/**
 * Bottle top (Will's pick): the camera faces the tray nearly head-on so it fills the screen's width, the table is
 * cropped away, and the bottle stands centered on the top rail between the level and moves chips.
 */
const PITCH_DEG = 7;
export const BOTTLE_SCALE = 0.72;

export interface Insets {
  top: number;
  bottom: number;
  side: number;
}

export class Terrarium {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 200);
  readonly key: THREE.DirectionalLight;
  readonly fov = FOV;
  cols = 6;
  rows = 7;
  /** Rebuilt for each tray size. */
  private tray = new THREE.Group();
  private readonly wood: THREE.Texture;
  private readonly woodMat: THREE.MeshStandardMaterial;
  private readonly glassMat: THREE.MeshStandardMaterial;
  private readonly glassEdgeMat: THREE.MeshStandardMaterial;
  private readonly shadowRect: THREE.Texture;
  private bottleShadow: THREE.Mesh | null = null;
  private readonly shadowRound: THREE.Texture;
  private readonly glare: THREE.Texture;
  private readonly causticMat: THREE.ShaderMaterial;
  private causticMesh: THREE.Mesh | null = null;
  private readonly table: THREE.Mesh;
  private readonly frontPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -BLOCK_DEPTH / 2);
  private readonly ray = new THREE.Raycaster();
  private tier!: Tier;
  private viewW = 1;
  private viewH = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'default' });
    this.renderer.localClippingEnabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const s = this.scene;
    const bg = backdropTexture();
    s.background = bg;
    s.fog = new THREE.Fog(0xf3dcc5, 22, 46);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    s.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    s.environmentIntensity = 0.32;
    pmrem.dispose();

    s.add(new THREE.HemisphereLight(0xfff1e2, 0xc59a76, 1.35));
    this.key = new THREE.DirectionalLight(0xffd6a3, 2.4);
    this.key.position.set(-7, 9, 7);
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.bias = -0.0008;
    this.key.shadow.normalBias = 0.02;
    this.key.shadow.radius = 4;
    s.add(this.key, this.key.target);

    this.wood = woodTexture();
    this.woodMat = new THREE.MeshStandardMaterial({ map: this.wood, roughness: 0.78, metalness: 0 });
    this.glassMat = new THREE.MeshStandardMaterial({
      color: 0xf4fbff,
      transparent: true,
      opacity: 0.1,
      roughness: 0.05,
      metalness: 0,
      depthWrite: false,
      envMapIntensity: 3.2,
    });
    this.glassEdgeMat = new THREE.MeshStandardMaterial({
      color: 0xd9f0ec,
      transparent: true,
      opacity: 0.5,
      roughness: 0.08,
      metalness: 0,
      depthWrite: false,
      envMapIntensity: 3,
    });
    this.shadowRect = softShadowTexture(false);
    this.shadowRound = softShadowTexture(true);
    this.glare = glareTexture();

    // the table, and its wood grain running left to right
    const tableTex = this.wood.clone();
    tableTex.repeat.set(3, 6);
    tableTex.needsUpdate = true;
    this.table = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.MeshStandardMaterial({ map: tableTex, roughness: 0.82, color: 0xf4e4d0 }),
    );
    this.table.rotation.x = -Math.PI / 2;
    this.table.position.y = -PLINTH_H;
    this.table.receiveShadow = true;
    s.add(this.table);

    const caustic = causticTexture();
    this.causticMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTex: { value: caustic }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex; uniform float uTime; varying vec2 vUv;
        void main(){
          vec2 uv = vUv * vec2(2.2, 1.1);
          float a = texture2D(uTex, uv + vec2(uTime * 0.013, uTime * 0.007)).r;
          float b = texture2D(uTex, uv * 1.37 + vec2(-uTime * 0.009, uTime * 0.011)).r;
          float m = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.6, vUv.x) * smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
          float c = min(a, b) * 1.6 + a * b * 0.6;
          gl_FragColor = vec4(vec3(1.0, 0.86, 0.62) * c * m * 0.34, 1.0);
        }`,
    });
  }

  setTier(t: Tier): void {
    this.tier = t;
    this.renderer.setPixelRatio(Math.min(t.maxDpr, window.devicePixelRatio || 1));
    if (this.renderer.shadowMap.enabled !== t.shadows) {
      // shadows change every lit shader, so they recompile (only when switching to or from High)
      this.renderer.shadowMap.enabled = t.shadows;
      this.key.castShadow = t.shadows;
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        for (const x of Array.isArray(m) ? m : m ? [m] : []) x.needsUpdate = true;
      });
    }
    if (this.causticMesh) this.causticMesh.visible = t.caustics;
    this.resizeRenderer();
  }

  /** Inner floor to the underside of the top rail, where new sand pours in. */
  get innerTop(): number {
    return this.rows + HEADROOM;
  }

  /** Inner floor to the top of the rail, where the bottle stands. */
  get railTop(): number {
    return this.rows + HEADROOM + RAIL_H;
  }


  /** Where the bottle stands (its base center). */
  get bottleSpot(): THREE.Vector3 {
    return new THREE.Vector3(0, this.railTop, 0);
  }

  /** Build the tray for a board size. */
  buildTray(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    this.scene.remove(this.tray);
    this.tray.traverse((o) => {
      const g = (o as THREE.Mesh).geometry;
      if (g) g.dispose();
    });
    const t = new THREE.Group();
    this.tray = t;
    const w = cols;
    const h = rows + HEADROOM;
    const shadows = this.tier?.shadows ?? false;

    // wooden plinth and top rail
    const plinth = new THREE.Mesh(new RoundedBoxGeometry(w + 0.7, PLINTH_H, INNER_DEPTH + 0.6, 2, 0.08), this.woodMat);
    plinth.position.y = -PLINTH_H / 2;
    const rail = new THREE.Mesh(new RoundedBoxGeometry(w + 0.5, RAIL_H, INNER_DEPTH + 0.5, 2, 0.07), this.woodMat);
    rail.position.y = h + RAIL_H / 2;
    for (const m of [plinth, rail]) {
      m.castShadow = shadows;
      m.receiveShadow = shadows;
    }
    t.add(plinth, rail);

    // glass: front, back and side panes, with brighter rounded edges that catch the light
    const paneZ = INNER_DEPTH / 2 + GLASS_T / 2;
    const front = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, h, GLASS_T), this.glassMat);
    front.position.set(0, h / 2, paneZ);
    front.renderOrder = 6;
    const back = front.clone();
    back.position.z = -paneZ;
    back.renderOrder = 1;
    const sideGeo = new THREE.BoxGeometry(GLASS_T, h, INNER_DEPTH);
    const left = new THREE.Mesh(sideGeo, this.glassMat);
    left.position.set(-(w / 2 + GLASS_T / 2 + 0.02), h / 2, 0);
    const right = left.clone();
    right.position.x = -left.position.x;
    t.add(back, left, right, front);
    const edgeGeo = new THREE.CylinderGeometry(0.055, 0.055, h, 10);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const e = new THREE.Mesh(edgeGeo, this.glassEdgeMat);
        e.position.set(sx * (w / 2 + 0.06), h / 2, sz * paneZ);
        e.renderOrder = sz > 0 ? 7 : 1;
        t.add(e);
      }
    const glare = new THREE.Mesh(
      new THREE.PlaneGeometry(w + 0.1, h),
      new THREE.MeshBasicMaterial({
        map: this.glare,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    glare.position.set(0, h / 2, paneZ + GLASS_T / 2 + 0.005);
    glare.renderOrder = 8;
    t.add(glare);

    // baked contact shadows: under the tray on the table, under the bottle on the rail
    const under = new THREE.Mesh(
      new THREE.PlaneGeometry(w + 3.2, INNER_DEPTH + 3.4),
      new THREE.MeshBasicMaterial({ map: this.shadowRect, transparent: true, depthWrite: false, opacity: 0.55, color: 0x5a3a22 }),
    );
    under.rotation.x = -Math.PI / 2;
    under.position.set(0.6, -PLINTH_H + 0.01, 0.5);
    under.renderOrder = 0;
    t.add(under);
    const bottleShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 2.0),
      new THREE.MeshBasicMaterial({ map: this.shadowRound, transparent: true, depthWrite: false, opacity: 0.45, color: 0x5a3a22 }),
    );
    bottleShadow.rotation.x = -Math.PI / 2;
    const spot = this.bottleSpot;
    bottleShadow.position.set(spot.x + 0.3, spot.y + 0.005, 0.15);
    t.add(bottleShadow);
    this.bottleShadow = bottleShadow;

    // sunlight through the glass makes a soft caustic on the table in front of the tray
    this.causticMesh = new THREE.Mesh(new THREE.PlaneGeometry(w + 2, 3.2), this.causticMat);
    this.causticMesh.rotation.x = -Math.PI / 2;
    this.causticMesh.position.set(1.0, -PLINTH_H + 0.015, INNER_DEPTH / 2 + 2.0);
    this.causticMesh.visible = this.tier?.caustics ?? true;
    t.add(this.causticMesh);

    this.scene.add(t);

    // key light framing for real-time shadows
    const sc = this.key.shadow.camera;
    const r = Math.max(cols, rows) * 0.9 + 3;
    sc.left = -r;
    sc.right = r;
    sc.top = r;
    sc.bottom = -r;
    sc.near = 1;
    sc.far = 60;
    this.key.target.position.set(0, rows / 2, 0);
    this.key.position.set(-8 + 0, rows / 2 + 10, 9);
    sc.updateProjectionMatrix();
  }

  cellX(c: number): number {
    return c - (this.cols - 1) / 2;
  }

  cellY(r: number): number {
    return this.rows - 1 - r + 0.5;
  }

  /** The cell under a screen point, or null. Rays hit the front face of the blocks. */
  /** The bottle's contact shadow follows it as it drops in or slides away (dx, dy from its spot on the rail). */
  moveBottleShadow(dx: number, dy: number): void {
    const m = this.bottleShadow;
    if (!m) return;
    m.position.x = this.bottleSpot.x + 0.3 + dx;
    (m.material as THREE.MeshBasicMaterial).opacity = 0.45 * Math.max(0, 1 - dy / 1.2) * Math.max(0, 1 - dx / 3);
  }

  pick(clientX: number, clientY: number): number | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(this.frontPlane, p)) return null;
    const c = Math.floor(p.x + this.cols / 2);
    const r = this.rows - 1 - Math.floor(p.y);
    if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return null;
    return r * this.cols + c;
  }

  /** Screen position (CSS px) of a world point. */
  toScreen(v: THREE.Vector3): { x: number; y: number } {
    const p = v.clone().project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
  }

  private resizeRenderer(): void {
    const c = this.renderer.domElement;
    const w = c.clientWidth || window.innerWidth;
    const h = c.clientHeight || window.innerHeight;
    this.viewW = w;
    this.viewH = h;
    this.renderer.setSize(w, h, false);
  }

  /**
   * Fit the tray and the bottle into the part of the screen the HUD leaves free. Finds the camera distance that
   * makes the scene's box fill that region, then shifts the projection so the box sits in its middle.
   */
  frame(insets: Insets): void {
    this.resizeRenderer();
    const W = this.viewW;
    const H = this.viewH;
    const cam = this.camera;
    cam.aspect = W / H;
    cam.clearViewOffset();
    cam.updateProjectionMatrix();

    const regionW = Math.max(100, W - 2 * insets.side);
    const regionH = Math.max(100, H - insets.top - insets.bottom);
    // the glass edge to edge, and the bottle with its cork on top; the plinth and table are cropped away
    const xs = this.cols / 2 + 0.12;
    const top = this.railTop + BOTTLE_SCALE * BOTTLE_H;
    const box = new THREE.Box3(new THREE.Vector3(-xs, -0.12, -0.55), new THREE.Vector3(xs, top, 0.55));
    const center = box.getCenter(new THREE.Vector3());
    const pitch = (PITCH_DEG * Math.PI) / 180;
    const dir = new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch));
    const corners: THREE.Vector3[] = [];
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
    const extents = (d: number) => {
      cam.position.copy(center).addScaledVector(dir, d);
      cam.lookAt(center);
      cam.updateMatrixWorld(true);
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const k of corners) {
        const p = k.clone().project(cam);
        x0 = Math.min(x0, p.x);
        x1 = Math.max(x1, p.x);
        y0 = Math.min(y0, p.y);
        y1 = Math.max(y1, p.y);
      }
      return { x0, x1, y0, y1 };
    };
    let lo = 4;
    let hi = 300;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      const e = extents(mid);
      const fits = ((e.x1 - e.x0) / 2) * W <= regionW && ((e.y1 - e.y0) / 2) * H <= regionH;
      if (fits) hi = mid;
      else lo = mid;
    }
    const e = extents(hi);
    // the table fades into the room behind the tray, whatever the camera distance
    const fog = this.scene.fog as THREE.Fog;
    fog.near = hi + 4;
    fog.far = hi + 30;
    // shift so the box's projected center lands in the region's center
    const boxCx = ((e.x0 + e.x1) / 2 + 1) * 0.5 * W;
    const boxCy = (1 - (e.y0 + e.y1) / 2) * 0.5 * H;
    const regCx = W / 2;
    const regCy = insets.top + regionH / 2;
    cam.setViewOffset(W, H, boxCx - regCx, boxCy - regCy, W, H);
    cam.updateProjectionMatrix();
  }

  get viewport(): { w: number; h: number } {
    return { w: this.viewW, h: this.viewH };
  }

  tick(now: number): void {
    this.causticMat.uniforms.uTime.value = now;
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
