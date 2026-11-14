import * as THREE from 'three';
import { glassMaterial } from './glass';
import { corkTexture, sandTexture } from './textures';

/**
 * The keepsake bottle. Every lift pours a layer of its color in, in order, sized by how many blocks it held, so the
 * bottle is exactly full when the tray is empty. Layer tops wander a little, like hand-poured sand art.
 * On clear, a cork twists in.
 *
 * Local coordinates: the bottle's base center is the origin, y up.
 */
const BODY_R = 0.78;
const INNER_R = 0.7;
const FLOOR_Y = 0.07;
const BODY_TOP = 1.96;
const MOUTH_Y = 3.1;
const SEGS = 40;
/** The bottle is modelled at about a 1.6-block width and shown a little smaller. */
const SCALE = 0.84;
/** Bottle height above the rail at scale 1, cork included. */
export const BOTTLE_H = 3.3;
const CORK_H = 0.42;
const CORK_SEAT = MOUTH_Y + 0.14 - CORK_H / 2; // cork center when pressed in

interface Layer {
  mesh: THREE.Mesh;
  pos: THREE.BufferAttribute;
  /** Boundary heights per angle sample: bottom (the previous layer's top) and this layer's final top. */
  bottom: Float32Array;
  top: Float32Array;
  t0: number;
  t1: number;
  grown: number;
  amount: number;
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

export class Bottle {
  readonly group = new THREE.Group();
  private readonly layersGroup = new THREE.Group();
  private readonly layers: Layer[] = [];
  private readonly sandMat: THREE.MeshStandardMaterial;
  private readonly layerMats = new Map<number, THREE.MeshStandardMaterial>();
  private readonly cork: THREE.Mesh;
  private corkT0 = Infinity;
  /** Where the bottle stands on the rail; enter/exit animate around it. */
  readonly home = new THREE.Vector3();
  private enterT0 = -Infinity;
  /** Overall size; layouts that give the tray more room use a smaller bottle. */
  scale = SCALE;
  /** Current enter/exit displacement from home. */
  readonly offset = new THREE.Vector2();
  private exitT0 = Infinity;
  private bobT0 = Infinity;
  private filled = 0;
  private rand = 1;

  constructor() {
    // glass: drawn back faces first, then the sand, then front faces
    const profile = [
      [0.0, 0.0],
      [0.7, 0.0],
      [BODY_R, 0.07],
      [BODY_R, BODY_TOP],
      [0.75, 2.14],
      [0.62, 2.34],
      [0.42, 2.5],
      [0.29, 2.62],
      [0.265, 2.95],
      [0.31, 2.99],
      [0.325, 3.06],
      [0.28, MOUTH_Y],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const glassGeo = new THREE.LatheGeometry(profile, 36);
    const glassBack = new THREE.Mesh(glassGeo, glassMaterial({ side: THREE.BackSide, base: 0.1, rim: 0.3, env: 1.5 }));
    glassBack.renderOrder = 1;
    const glassFront = new THREE.Mesh(glassGeo, glassMaterial({ side: THREE.FrontSide, base: 0.06, rim: 0.6, env: 3.5 }));
    glassFront.renderOrder = 9;
    this.sandMat = new THREE.MeshStandardMaterial({ map: sandTexture(false), roughness: 0.95 });

    const ct = corkTexture();
    this.cork = new THREE.Mesh(
      new THREE.CylinderGeometry(0.31, 0.25, CORK_H, 20),
      new THREE.MeshStandardMaterial({ map: ct, roughness: 0.9 }),
    );
    this.cork.visible = false;

    this.group.add(glassBack, this.layersGroup, this.cork, glassFront);
    this.group.scale.setScalar(this.scale);
  }

  /** The bottle mouth in world space. */
  mouth(): THREE.Vector3 {
    return this.group.localToWorld(new THREE.Vector3(0, MOUTH_Y + 0.05, 0));
  }

  get innerRadius(): number {
    return INNER_R;
  }

  /** World y of the sand surface once every poured layer has finished growing. */
  surfaceY(): number {
    return this.group.localToWorld(new THREE.Vector3(0, FLOOR_Y + (BODY_TOP - FLOOR_Y) * this.filled, 0)).y;
  }

  /** World center of the bottle body (for sparkles). */
  center(): THREE.Vector3 {
    return this.group.localToWorld(new THREE.Vector3(0, 1.4, 0));
  }

  private random(): number {
    this.rand = (Math.imul(this.rand, 1103515245) + 12345) | 0;
    return ((this.rand >>> 8) & 0xffff) / 0x10000;
  }

  /**
   * Pour a layer: `amount` is its share of the whole tray (blocks lifted / blocks at the start). It grows from t0 to
   * t1 (scene clock seconds).
   */
  addLayer(color: THREE.Color, amount: number, t0: number, t1: number): void {
    const prev = this.layers[this.layers.length - 1];
    const baseH = FLOOR_Y + (BODY_TOP - FLOOR_Y) * this.filled;
    this.filled = Math.min(1, this.filled + amount);
    const topH = FLOOR_Y + (BODY_TOP - FLOOR_Y) * this.filled;
    const h = topH - baseH;
    const bottom = new Float32Array(SEGS + 1);
    const top = new Float32Array(SEGS + 1);
    // a random gentle wave added to the previous boundary, kept small and never thinner than 30% of the layer
    const amp = Math.min(0.06, 0.6 * h);
    const k1 = (this.random() - 0.5) * 2 * amp;
    const k2 = (this.random() - 0.5) * 2 * amp * 0.6;
    const ph1 = this.random() * Math.PI * 2;
    const ph2 = this.random() * Math.PI * 2;
    const last = this.filled >= 0.999;
    for (let i = 0; i <= SEGS; i++) {
      const a = (i / SEGS) * Math.PI * 2;
      const b = prev ? prev.top[i] : FLOOR_Y;
      bottom[i] = b;
      let off = (prev ? prev.top[i] - (FLOOR_Y + (BODY_TOP - FLOOR_Y) * (this.filled - amount)) : 0) * 0.85;
      off += k1 * Math.sin(a + ph1) + k2 * Math.sin(2 * a + ph2);
      off = Math.max(-0.1, Math.min(0.1, off));
      let y = topH + off;
      if (last) y = topH + off * 0.25; // the last layer levels off under the shoulder
      top[i] = Math.max(b + 0.3 * h, y);
    }

    // geometry: a side wall (2 rings) and a top cap (center + ring); positions rewritten while it grows
    const ringN = SEGS + 1;
    const pos = new THREE.BufferAttribute(new Float32Array((ringN * 3 + 1) * 3), 3);
    pos.setUsage(THREE.DynamicDrawUsage);
    const uv = new Float32Array((ringN * 3 + 1) * 2);
    const nrm = new Float32Array((ringN * 3 + 1) * 3);
    const idx: number[] = [];
    for (let i = 0; i < ringN; i++) {
      const a = (i / SEGS) * Math.PI * 2;
      const nx = Math.sin(a);
      const nz = Math.cos(a);
      // side: bottom ring i, top ring ringN+i
      nrm.set([nx, 0, nz], i * 3);
      nrm.set([nx, 0, nz], (ringN + i) * 3);
      uv.set([(i / SEGS) * 4, 0], i * 2);
      uv.set([(i / SEGS) * 4, 0.3], (ringN + i) * 2);
      // cap ring
      nrm.set([0, 1, 0], (2 * ringN + i) * 3);
      uv.set([0.5 + nx * 0.5, 0.5 + nz * 0.5], (2 * ringN + i) * 2);
      if (i < SEGS) {
        const b0 = i;
        const b1 = i + 1;
        const t0 = ringN + i;
        const t1 = ringN + i + 1;
        idx.push(b0, b1, t1, b0, t1, t0);
        idx.push(3 * ringN, 2 * ringN + i, 2 * ringN + i + 1);
      }
    }
    nrm.set([0, 1, 0], 3 * ringN * 3);
    uv.set([0.5, 0.5], 3 * ringN * 2);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', pos);
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.2, 0), 2.5);
    // one material per sand color, kept for the life of the game, so its shader stays compiled
    const key = color.getHex();
    let mat = this.layerMats.get(key);
    if (!mat) {
      mat = this.sandMat.clone();
      mat.color.copy(color);
      this.layerMats.set(key, mat);
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 2;
    const layer: Layer = { mesh, pos, bottom, top, t0, t1, grown: -1, amount };
    this.writeLayer(layer, 0);
    this.layersGroup.add(mesh);
    this.layers.push(layer);
  }

  private writeLayer(L: Layer, f: number): void {
    const ringN = SEGS + 1;
    let sum = 0;
    for (let i = 0; i < ringN; i++) {
      const a = (i / SEGS) * Math.PI * 2;
      const x = Math.sin(a) * INNER_R;
      const z = Math.cos(a) * INNER_R;
      const yb = L.bottom[i];
      const yt = yb + (L.top[i] - yb) * f;
      L.pos.setXYZ(i, x, yb, z);
      L.pos.setXYZ(ringN + i, x, yt, z);
      L.pos.setXYZ(2 * ringN + i, x, yt, z);
      if (i < SEGS) sum += yt;
    }
    L.pos.setXYZ(3 * ringN, 0, sum / SEGS + 0.01 * f, 0);
    L.pos.needsUpdate = true;
    L.mesh.visible = f > 0.002;
    L.grown = f;
  }

  /** Remove the newest layer (undo). */
  popLayer(): void {
    const L = this.layers.pop();
    if (!L) return;
    this.filled = Math.max(0, this.filled - L.amount);
    this.layersGroup.remove(L.mesh);
    L.mesh.geometry.dispose();
    this.uncork();
  }

  get layerCount(): number {
    return this.layers.length;
  }

  /** Empty bottle, no cork. */
  reset(): void {
    while (this.layers.length) this.popLayer();
    this.filled = 0;
    this.uncork();
  }

  /** Finish any growing layers now (fast-forward). */
  settleAll(): void {
    for (const L of this.layers) {
      L.t0 = Math.min(L.t0, -1);
      L.t1 = Math.min(L.t1, 0);
      if (L.grown < 1) this.writeLayer(L, 1);
    }
  }

  setScale(s: number): void {
    this.scale = s;
    this.group.scale.setScalar(s);
    this.group.updateMatrixWorld(true);
  }

  /** A fresh empty bottle drops onto the rail at t0. */
  enterAt(t0: number): void {
    this.enterT0 = t0;
    this.exitT0 = Infinity;
  }

  /** The corked bottle slides off along the rail at t0 (0.55 s), making room for the next one. */
  exitAt(t0: number): void {
    this.exitT0 = t0;
  }

  /** Start the cork at time t0; it seats at t0 + 0.75 s. */
  corkAt(t0: number): void {
    this.corkT0 = t0;
    this.cork.visible = false;
  }

  /** When the cork finishes seating (the pop). */
  get corkSeatTime(): number {
    return this.corkT0 + 0.75;
  }

  /** Materials that only appear later (layers, cork), so the game can compile their shaders before play. */
  warmables(colors: readonly THREE.Color[]): THREE.Material[] {
    for (const c of colors) {
      const key = c.getHex();
      if (!this.layerMats.has(key)) {
        const m = this.sandMat.clone();
        m.color.copy(c);
        this.layerMats.set(key, m);
      }
    }
    return [...this.layerMats.values(), this.cork.material as THREE.Material];
  }

  uncork(): void {
    this.corkT0 = Infinity;
    this.bobT0 = Infinity;
    this.cork.visible = false;
    this.group.scale.setScalar(this.scale);
    this.group.rotation.z = 0;
  }

  /** Reduced motion: the bottle doesn't drop in, slide off or bob, and the cork simply appears, seated. */
  reduced = false;

  update(now: number): void {
    // enter: drops in from above with a soft landing; exit: slides away to the right and off the tray
    let dx = 0;
    let dy = 0;
    const et = (now - this.enterT0) / 0.5;
    if (this.reduced) {
      if (now >= this.exitT0) dx = 7;
    } else if (et >= 0 && et < 1) {
      const e = 1 - Math.pow(1 - et, 3);
      dy = 1.8 * (1 - e) - 0.06 * Math.sin(et * Math.PI);
    }
    const xt = (now - this.exitT0) / 0.55;
    if (xt >= 0 && !this.reduced) {
      const e = Math.min(1, xt);
      dx = 7 * e * e;
      dy += 0.25 * Math.sin(e * Math.PI);
    }
    this.group.position.set(this.home.x + dx, this.home.y + dy, this.home.z);
    this.offset.set(dx, dy);
    for (const L of this.layers) {
      if (L.grown >= 1) continue;
      const f = now <= L.t0 ? 0 : now >= L.t1 ? 1 : easeOut((now - L.t0) / (L.t1 - L.t0));
      if (f !== L.grown) this.writeLayer(L, f);
    }
    // cork: drops in from above (0–0.4 s), twists down (0.4–0.75 s), then the bottle does a happy little bob
    const ct = now - this.corkT0;
    if (ct >= 0) {
      this.cork.visible = true;
      let y: number;
      let spin = 0;
      if (this.reduced) {
        y = CORK_SEAT;
        spin = Math.PI * 1.4;
      } else if (ct < 0.4) {
        const e = easeOut(ct / 0.4);
        y = CORK_SEAT + 0.95 - 0.8 * e;
      } else if (ct < 0.75) {
        const e = (ct - 0.4) / 0.35;
        y = CORK_SEAT + 0.15 * (1 - e);
        spin = e * Math.PI * 1.4;
      } else {
        y = CORK_SEAT;
        spin = Math.PI * 1.4;
        if (this.bobT0 === Infinity) this.bobT0 = this.corkSeatTime;
      }
      this.cork.position.set(0, y, 0);
      this.cork.rotation.y = spin;
    }
    const bt = now - this.bobT0;
    if (bt >= 0 && bt < 0.9 && !this.reduced) {
      const k = Math.sin(bt * Math.PI * 4) * Math.exp(-bt * 4.5);
      this.group.scale.set(this.scale * (1 - 0.03 * k), this.scale * (1 + 0.05 * k), this.scale * (1 - 0.03 * k));
      this.group.rotation.z = 0.035 * Math.sin(bt * Math.PI * 3) * Math.exp(-bt * 3);
    } else if (bt >= 0.9) {
      this.group.scale.setScalar(this.scale);
      this.group.rotation.z = 0;
    }
  }
}
