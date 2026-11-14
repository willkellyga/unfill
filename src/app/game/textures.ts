import * as THREE from 'three';

/**
 * Every texture in the scene is drawn here at start-up, in code. No image files, so nothing to license.
 * A small seeded random keeps the look identical on every load.
 */

function rng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 2;
  return t;
}

/**
 * Packed sand: near-white with fine light and dark grains, multiplied by each block's color.
 * `edges` darkens toward the face edges, a baked stand-in for the contact shadow where blocks touch.
 */
export function sandTexture(edges: boolean): THREE.CanvasTexture {
  const S = 128;
  const [c, g] = canvas(S, S);
  const R = rng(edges ? 11 : 12);
  g.fillStyle = '#f2f2f2';
  g.fillRect(0, 0, S, S);
  // soft mottling
  for (let i = 0; i < 90; i++) {
    const x = R() * S;
    const y = R() * S;
    const r = 4 + R() * 12;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const v = R() < 0.5 ? '255,255,255' : '200,190,180';
    grd.addColorStop(0, `rgba(${v},0.18)`);
    grd.addColorStop(1, `rgba(${v},0)`);
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // grains
  for (let i = 0; i < 1500; i++) {
    const x = R() * S;
    const y = R() * S;
    const light = R() < 0.55;
    g.fillStyle = light ? `rgba(255,255,255,${0.35 + R() * 0.5})` : `rgba(110,80,60,${0.12 + R() * 0.22})`;
    const s = R() < 0.85 ? 1 : 2;
    g.fillRect(x, y, s, s);
  }
  if (edges) {
    const band = (x0: number, y0: number, x1: number, y1: number) => {
      const grd = g.createLinearGradient(x0, y0, x1, y1);
      grd.addColorStop(0, 'rgba(90,60,45,0.30)');
      grd.addColorStop(1, 'rgba(90,60,45,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, S, S);
    };
    const e = S * 0.16;
    band(0, 0, e, 0);
    band(S, 0, S - e, 0);
    band(0, S, 0, S - e * 1.3); // a little heavier at the bottom: where the block sits
    band(0, 0, 0, e * 0.8);
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Light oak for the table, the tray's base and its top rail. */
export function woodTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = 256;
  const [c, g] = canvas(W, H);
  const R = rng(5);
  g.fillStyle = '#e2c29c';
  g.fillRect(0, 0, W, H);
  // planks
  for (let p = 0; p < 4; p++) {
    const y0 = (p * H) / 4;
    const tone = 0.92 + R() * 0.12;
    g.fillStyle = `rgba(${Math.round(226 * tone)},${Math.round(192 * tone)},${Math.round(152 * tone)},0.7)`;
    g.fillRect(0, y0, W, H / 4);
    // grain lines
    for (let i = 0; i < 26; i++) {
      const y = y0 + R() * (H / 4);
      const amp = 1 + R() * 3;
      const freq = 0.004 + R() * 0.01;
      const ph = R() * 10;
      g.strokeStyle = `rgba(150,105,65,${0.06 + R() * 0.12})`;
      g.lineWidth = 0.6 + R() * 1.4;
      g.beginPath();
      for (let x = 0; x <= W; x += 8) {
        const yy = y + Math.sin(x * freq + ph) * amp;
        if (x === 0) g.moveTo(x, yy);
        else g.lineTo(x, yy);
      }
      g.stroke();
    }
    g.fillStyle = 'rgba(120,80,50,0.18)';
    g.fillRect(0, y0, W, 1.5);
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A soft blurred rectangle, used as the baked contact shadow under the tray and the bottle. */
export function softShadowTexture(round: boolean): THREE.CanvasTexture {
  const S = 128;
  const [c, g] = canvas(S, S);
  if (round) {
    const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grd.addColorStop(0, 'rgba(0,0,0,0.55)');
    grd.addColorStop(0.55, 'rgba(0,0,0,0.25)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
  } else {
    g.filter = 'blur(10px)';
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(S * 0.16, S * 0.2, S * 0.68, S * 0.6);
    g.filter = 'none';
    // Safari ignores ctx.filter: fall back to stacked translucent rects
    const d = g.getImageData(S / 2, S / 2, 1, 1).data[3];
    if (d > 120) {
      g.clearRect(0, 0, S, S);
      for (let i = 0; i < 12; i++) {
        const k = i * 2;
        g.fillStyle = 'rgba(0,0,0,0.045)';
        g.fillRect(S * 0.08 + k, S * 0.12 + k, S * 0.84 - 2 * k, S * 0.76 - 2 * k);
      }
    }
  }
  return tex(c, false);
}

/** Caustic light: thin bright cell edges, like sunlight through rippled glass. Tiles seamlessly. */
export function causticTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S, S);
  const R = rng(9);
  const pts: [number, number][] = [];
  for (let i = 0; i < 22; i++) pts.push([R() * S, R() * S]);
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let d1 = 1e9;
      let d2 = 1e9;
      for (const [px, py] of pts) {
        for (let oy = -1; oy <= 1; oy++)
          for (let ox = -1; ox <= 1; ox++) {
            const dx = x - (px + ox * S);
            const dy = y - (py + oy * S);
            const d = dx * dx + dy * dy;
            if (d < d1) {
              d2 = d1;
              d1 = d;
            } else if (d < d2) d2 = d;
          }
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1);
      const v = Math.max(0, 1 - edge / 7);
      const k = (y * S + x) * 4;
      const b = Math.round(255 * v * v);
      img.data[k] = b;
      img.data[k + 1] = b;
      img.data[k + 2] = b;
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = tex(c, false);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** The warm room behind the table: late-afternoon light, brighter toward the top left. */
export function backdropTexture(stops: readonly [string, string, string] = ['#fbeee0', '#f6e2cd', '#efd3b8']): THREE.CanvasTexture {
  const [c, g] = canvas(64, 256);
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, stops[0]);
  grd.addColorStop(0.55, stops[1]);
  grd.addColorStop(1, stops[2]);
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 256);
  return tex(c);
}

/** A diagonal glare streak for the front glass. */
export function glareTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S, S);
  g.translate(S / 2, S / 2);
  g.rotate(-0.5);
  const band = (x: number, w: number, a: number) => {
    const grd = g.createLinearGradient(x - w, 0, x + w, 0);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.5, `rgba(255,255,255,${a})`);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(x - w, -S, 2 * w, 2 * S);
  };
  band(-60, 26, 0.55);
  band(-18, 9, 0.4);
  band(70, 14, 0.25);
  return tex(c, false);
}

/** Cork: tan with darker flecks. */
export function corkTexture(): THREE.CanvasTexture {
  const S = 128;
  const [c, g] = canvas(S, S);
  const R = rng(3);
  g.fillStyle = '#c99a68';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 700; i++) {
    g.fillStyle = R() < 0.6 ? `rgba(110,70,35,${0.2 + R() * 0.4})` : `rgba(240,210,170,${0.3 + R() * 0.4})`;
    const s = 1 + R() * 2.5;
    g.fillRect(R() * S, R() * S, s, s);
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Painted wood for toy blocks: near-white with a faint grain, multiplied by each block's paint color. */
export function paintedWoodTexture(): THREE.CanvasTexture {
  const S = 128;
  const [c, g] = canvas(S, S);
  const R = rng(21);
  g.fillStyle = '#f4f4f4';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 22; i++) {
    const y = R() * S;
    const amp = 1 + R() * 2.5;
    const ph = R() * 10;
    g.strokeStyle = `rgba(90,70,50,${0.05 + R() * 0.08})`;
    g.lineWidth = 0.6 + R() * 1.2;
    g.beginPath();
    for (let x = 0; x <= S; x += 4) {
      const yy = y + Math.sin(x * 0.05 + ph) * amp;
      if (x === 0) g.moveTo(x, yy);
      else g.lineTo(x, yy);
    }
    g.stroke();
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
