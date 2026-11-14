// Small Web Audio sounds, carried over from the 2D demo: a soft two-note "thup" on lift and a hiss of sand
// for the pour, louder the more blocks move. Created on first use, which is always inside a tap (iOS needs that).

export class Sound {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  muted: boolean;

  constructor(muted: boolean) {
    this.muted = muted;
  }

  private audio(): AudioContext | null {
    if (this.muted) return null;
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new Ctor();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    } catch {
      return null;
    }
  }

  tone(freqs: number[], step: number, len: number, vol: number): void {
    const a = this.audio();
    if (!a) return;
    freqs.forEach((fq, i) => {
      const o = a.createOscillator();
      const g = a.createGain();
      const t = a.currentTime + i * step;
      o.type = 'sine';
      o.frequency.setValueAtTime(fq, t);
      o.frequency.exponentialRampToValueAtTime(fq * 1.25, t + len * 0.6);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0004, t + len);
      o.connect(g).connect(a.destination);
      o.start(t);
      o.stop(t + len + 0.05);
    });
  }

  pour(delaySec: number, durSec: number, amount: number): void {
    const a = this.audio();
    if (!a || durSec <= 0 || amount <= 0) return;
    if (!this.noise) {
      this.noise = a.createBuffer(1, a.sampleRate * 2, a.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = a.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const f = a.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.8;
    const g = a.createGain();
    const t = a.currentTime + delaySec;
    const peak = Math.min(0.2, 0.025 + amount * 0.005);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.05);
    g.gain.setValueAtTime(peak, t + durSec * 0.55);
    g.gain.exponentialRampToValueAtTime(0.0004, t + durSec + 0.3);
    f.frequency.setValueAtTime(4600, t);
    f.frequency.exponentialRampToValueAtTime(1600, t + durSec + 0.3);
    s.connect(f).connect(g).connect(a.destination);
    s.start(t);
    s.stop(t + durSec + 0.35);
  }

  /** Stop anything still playing (used when a pour is fast-forwarded). */
  hush(): void {
    if (!this.ctx) return;
    const old = this.ctx;
    this.ctx = null;
    this.noise = null;
    void old.close().catch(() => undefined);
  }
}
