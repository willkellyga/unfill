/** A tiny procedural synth: every sound is made in code, so nothing to license. */
export class Synth {
  ctx: AudioContext | null = null;
  muted = false;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    try {
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      if (nav.audioSession) nav.audioSession.type = 'playback';
    } catch {
      /* not supported */
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  private ok(): AudioContext | null {
    return this.ctx && !this.muted ? this.ctx : null;
  }

  /** A pitched ping: sine/triangle with a fast attack and an exponential tail. */
  tone(freq: number, delay: number, dur: number, vol: number, type: OscillatorType = 'sine', glide = 0): void {
    const a = this.ok();
    if (!a) return;
    const t = a.currentTime + 0.005 + Math.max(0, delay);
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * glide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Filtered noise: rustles, thumps and whooshes. */
  noise(delay: number, dur: number, vol: number, freq: number, q = 1, type: BiquadFilterType = 'bandpass'): void {
    const a = this.ok();
    if (!a || !this.noiseBuf) return;
    const t = a.currentTime + 0.005 + Math.max(0, delay);
    const s = a.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = a.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.02, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master!);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }
}

export const synth = new Synth();
