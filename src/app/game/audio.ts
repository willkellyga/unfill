/**
 * Every sound is made here with Web Audio at run time: no sound files, so nothing to license.
 *
 *  - grain hiss for each pour stream: a buffer of fine noise with tiny grain clicks, band-passed at a slightly
 *    different pitch per sand color, and as loud as the amount of sand moving at that moment;
 *  - a muffled "thup" when a group lifts;
 *  - a ribbon of sand into the bottle, with a soft glassy resonance that rises as the bottle fills, and a faint
 *    tinkle where it lands;
 *  - a cork squeak and pop, and a warm little chime when a tray is emptied.
 *
 * There is no background sound: only things that happen make a sound.
 *
 * iPhone notes: the context is created inside the first tap (iOS requires it), and the audio session is set to
 * "playback" where Safari supports it, so the ringer switch doesn't silence the game. Phones can't vibrate from the
 * web on iOS, so these sounds carry the feel there.
 */
type Curve = [time: number, level: number][];

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private sandBuf: AudioBuffer | null = null;
  private live: AudioScheduledSourceNode[] = [];
  muted: boolean;

  constructor(muted: boolean) {
    this.muted = muted;
  }

  /** Call from inside a tap. Safe to call many times. */
  unlock(): void {
    try {
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      if (nav.audioSession && nav.audioSession.type !== 'playback') nav.audioSession.type = 'playback';
    } catch {
      /* not supported */
    }
    const a = this.context();
    if (!a) return;
    if (a.state === 'suspended') void a.resume();
    // a silent blip: older iOS only unlocks once something has played inside the gesture
    const b = a.createBuffer(1, 1, a.sampleRate);
    const s = a.createBufferSource();
    s.buffer = b;
    s.connect(a.destination);
    s.start();
  }

  /** iOS leaves the context "interrupted" or "suspended" after the app was in the background; resume it in a tap. */
  resumeIfSuspended(): void {
    if (this.ctx && this.ctx.state !== 'running' && !document.hidden) void this.ctx.resume();
  }

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const a = new Ctor({ latencyHint: 'interactive' });
      this.ctx = a;
      const comp = a.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 12;
      comp.ratio.value = 4;
      this.master = a.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(comp).connect(a.destination);
      this.sfx = a.createGain();
      this.sfx.connect(this.master);
      this.sandBuf = this.makeSand(a);
      document.addEventListener('visibilitychange', () => {
        if (!this.ctx) return;
        if (document.hidden) void this.ctx.suspend();
        else void this.ctx.resume();
      });
      return a;
    } catch {
      return null;
    }
  }

  /** Pouring sand: soft noise plus sparse tiny clicks of single grains. Two seconds, loops seamlessly enough. */
  private makeSand(a: AudioContext): AudioBuffer {
    const n = a.sampleRate * 2;
    const buf = a.createBuffer(1, n, a.sampleRate);
    const d = buf.getChannelData(0);
    let seed = 7;
    const R = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      return ((seed >>> 8) & 0xffffff) / 0x1000000;
    };
    let lp = 0;
    for (let i = 0; i < n; i++) {
      lp += (R() * 2 - 1 - lp) * 0.55;
      d[i] = lp * 0.5;
    }
    // grain ticks: ~1,500 per second, each a few samples of decaying noise
    const ticks = Math.floor((1500 * n) / a.sampleRate);
    for (let k = 0; k < ticks; k++) {
      const at = Math.floor(R() * (n - 64));
      const amp = 0.3 + R() * 0.9;
      for (let j = 0; j < 40; j++) d[at + j] += (R() * 2 - 1) * amp * Math.exp(-j / 6);
    }
    // fade the loop ends into each other
    const f = 2000;
    for (let i = 0; i < f; i++) {
      const w = i / f;
      d[i] = d[i] * w + d[n - f + i] * (1 - w);
    }
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
    for (let i = 0; i < n; i++) d[i] /= peak;
    return buf;
  }

  private track(s: AudioScheduledSourceNode): void {
    this.live.push(s);
    s.onended = () => {
      const i = this.live.indexOf(s);
      if (i >= 0) this.live.splice(i, 1);
    };
  }

  /**
   * A stream of sand. `curve` is [seconds from now, loudness 0..1] points; pitch is the band center in Hz.
   * `bright` lifts it for grains landing on glass.
   */
  hiss(curve: Curve, pitch: number, vol: number, q = 0.9): void {
    const a = this.ctx;
    if (!a || this.muted || !this.sandBuf || curve.length < 2) return;
    const t = a.currentTime + 0.01;
    const s = a.createBufferSource();
    s.buffer = this.sandBuf;
    s.loop = true;
    s.loopStart = Math.random() * 1.5;
    s.playbackRate.value = 0.92 + Math.random() * 0.16;
    const bp = a.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = pitch;
    bp.Q.value = q;
    const hp = a.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 700;
    const g = a.createGain();
    g.gain.setValueAtTime(0, t);
    for (const [at, lv] of curve) g.gain.linearRampToValueAtTime(Math.max(0, lv) * vol, t + at);
    const end = curve[curve.length - 1][0];
    g.gain.linearRampToValueAtTime(0, t + end + 0.08);
    s.connect(bp).connect(hp).connect(g).connect(this.sfx!);
    s.start(t, s.loopStart);
    s.stop(t + end + 0.12);
    this.track(s);
  }

  /** The muffled thup of a group lifting out: a low soft thump and a puff of air. */
  thup(size: number): void {
    const a = this.ctx;
    if (!a || this.muted) return;
    const t = a.currentTime + 0.005;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = 'sine';
    const f0 = 150 - Math.min(40, size * 2);
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + 0.14);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.42, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.2);
    o.connect(g).connect(this.sfx!);
    o.start(t);
    o.stop(t + 0.25);
    this.track(o);
    // the puff
    this.hiss(
      [
        [0.01, 1],
        [0.09, 0.2],
        [0.14, 0],
      ],
      700,
      0.22,
      0.6,
    );
  }

  /**
   * Sand into the bottle: a brighter ribbon of grains, a soft hollow resonance that rises with the fill level
   * (like a jar filling), and a faint glassy tinkle as the first grains land.
   */
  bottlePour(delay: number, dur: number, fillFrom: number, fillTo: number, pitch: number): void {
    const a = this.ctx;
    if (!a || this.muted || !this.sandBuf) return;
    this.hiss(
      [
        [delay, 0],
        [delay + 0.04, 0.8],
        [delay + dur * 0.8, 0.65],
        [delay + dur, 0],
      ],
      pitch * 1.25,
      0.2,
      1.2,
    );
    // resonance: band-passed noise at a pitch that climbs as the bottle fills
    const t = a.currentTime + 0.01 + delay;
    const s = a.createBufferSource();
    s.buffer = this.sandBuf;
    s.loop = true;
    const bp = a.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 14;
    const f = (x: number) => 420 * Math.pow(2.6, x);
    bp.frequency.setValueAtTime(f(fillFrom), t);
    bp.frequency.linearRampToValueAtTime(f(fillTo), t + dur);
    const g = a.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.05);
    g.gain.linearRampToValueAtTime(0.35, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.12);
    s.connect(bp).connect(g).connect(this.sfx!);
    s.start(t);
    s.stop(t + dur + 0.2);
    this.track(s);
    this.tinkle(delay + 0.03, 2 + Math.floor(Math.random() * 2), 0.05);
  }

  /** A few tiny glassy pings. */
  tinkle(delay: number, count: number, vol: number): void {
    const a = this.ctx;
    if (!a || this.muted) return;
    for (let i = 0; i < count; i++) {
      const t = a.currentTime + 0.01 + delay + i * (0.03 + Math.random() * 0.05);
      const base = 2600 + Math.random() * 2400;
      for (const [mult, lv] of [
        [1, 1],
        [2.76, 0.35],
      ]) {
        const o = a.createOscillator();
        const g = a.createGain();
        o.type = 'sine';
        o.frequency.value = base * mult;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(vol * lv, t + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        o.connect(g).connect(this.sfx!);
        o.start(t);
        o.stop(t + 0.2);
        this.track(o);
      }
    }
  }

  /** A soft pat as a landing block firms up. */
  pat(delay: number, vol: number): void {
    const a = this.ctx;
    if (!a || this.muted) return;
    const t = a.currentTime + 0.01 + delay;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(210, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.06);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0003, t + 0.09);
    o.connect(g).connect(this.sfx!);
    o.start(t);
    o.stop(t + 0.12);
    this.track(o);
  }

  /** The cork: a small rubbery squeak while it twists, then a hollow pop when it seats. */
  cork(squeakDelay: number, popDelay: number): void {
    const a = this.ctx;
    if (!a || this.muted) return;
    const t = a.currentTime + 0.01;
    // squeak
    const o = a.createOscillator();
    const lfo = a.createOscillator();
    const lg = a.createGain();
    const g = a.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(880, t + squeakDelay);
    o.frequency.linearRampToValueAtTime(1180, t + popDelay);
    lfo.frequency.value = 38;
    lg.gain.value = 60;
    lfo.connect(lg).connect(o.frequency);
    const bp = a.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1100;
    bp.Q.value = 3;
    g.gain.setValueAtTime(0, t + squeakDelay);
    g.gain.linearRampToValueAtTime(0.05, t + squeakDelay + 0.04);
    g.gain.linearRampToValueAtTime(0.035, t + popDelay - 0.04);
    g.gain.linearRampToValueAtTime(0, t + popDelay);
    o.connect(bp).connect(g).connect(this.sfx!);
    o.start(t + squeakDelay);
    lfo.start(t + squeakDelay);
    o.stop(t + popDelay + 0.05);
    lfo.stop(t + popDelay + 0.05);
    this.track(o);
    // pop: a quick falling tone and a click of air
    const p = a.createOscillator();
    const pg = a.createGain();
    p.type = 'sine';
    p.frequency.setValueAtTime(620, t + popDelay);
    p.frequency.exponentialRampToValueAtTime(190, t + popDelay + 0.07);
    pg.gain.setValueAtTime(0, t + popDelay);
    pg.gain.linearRampToValueAtTime(0.55, t + popDelay + 0.003);
    pg.gain.exponentialRampToValueAtTime(0.0004, t + popDelay + 0.13);
    p.connect(pg).connect(this.sfx!);
    p.start(t + popDelay);
    p.stop(t + popDelay + 0.16);
    this.track(p);
    this.hiss(
      [
        [popDelay, 0],
        [popDelay + 0.005, 1],
        [popDelay + 0.05, 0],
      ],
      1500,
      0.35,
      1.5,
    );
  }

  /** A warm rising chime: the tray is empty. */
  chime(delay: number): void {
    const a = this.ctx;
    if (!a || this.muted) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((fq, i) => {
      const t = a.currentTime + 0.01 + delay + i * 0.11;
      for (const [mult, lv] of [
        [1, 0.16],
        [2, 0.05],
        [4.01, 0.018],
      ]) {
        const o = a.createOscillator();
        const g = a.createGain();
        o.type = 'sine';
        o.frequency.value = fq * mult;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(lv, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0002, t + 1.1 - i * 0.1);
        o.connect(g).connect(this.sfx!);
        o.start(t);
        o.stop(t + 1.2);
        this.track(o);
      }
    });
  }

  /** A soft "no" for a tap that can't happen (out of moves). */
  bonk(): void {
    const a = this.ctx;
    if (!a || this.muted) return;
    const t = a.currentTime + 0.005;
    for (const [fq, at] of [
      [330, 0],
      [262, 0.1],
    ]) {
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = 'sine';
      o.frequency.value = fq;
      g.gain.setValueAtTime(0, t + at);
      g.gain.linearRampToValueAtTime(0.12, t + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0003, t + at + 0.2);
      o.connect(g).connect(this.sfx!);
      o.start(t + at);
      o.stop(t + at + 0.25);
      this.track(o);
    }
  }

  /** Stop pour sounds now (fast-forward, undo, restart). */
  hush(): void {
    const a = this.ctx;
    if (!a) return;
    for (const s of this.live.slice()) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.live = [];
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (m) this.hush();
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.03);
  }
}
