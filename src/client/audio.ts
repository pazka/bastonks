// Music and sound effects, synthesised in the browser with Web Audio: no audio file, nothing to license
// (made for this project, CC0). Starts on the first user gesture (mobile autoplay rules); mute is remembered.

const PENTA = [0, 2, 4, 7, 9]; // major pentatonic
const ROOT = 196; // G3

export class SoundBoard {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private sfx: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private nextBeat = 0;
  private step = 0;
  private timer: number | undefined;
  muted: boolean;

  constructor(muted: boolean) {
    this.muted = muted;
  }

  /** Call from a user gesture. Idempotent. */
  start() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const Ctor = globalThis.AudioContext ??
      (globalThis as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    this.music = ctx.createGain();
    this.music.gain.value = 0.32;
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.7;
    // a soft feedback echo on the music
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const lp = ctx.createBiquadFilter();
    lp.frequency.value = 2400;
    this.music.connect(this.master);
    this.music.connect(delay).connect(lp).connect(fb).connect(delay);
    lp.connect(this.master);
    this.sfx.connect(this.master);
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.nextBeat = ctx.currentTime + 0.2;
    this.startForest();
    this.timer = setInterval(() => {
      this.schedule();
      this.forestEvents();
    }, 120);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.08);
  }

  stop() {
    clearInterval(this.timer);
    this.ctx?.close();
    this.ctx = null;
  }

  // ---- music: a slow, gentle pentatonic loop over a two-chord pad ------------------------------------

  private schedule() {
    const ctx = this.ctx!;
    const beat = 60 / 76 / 2; // eighth notes at 76 bpm
    while (this.nextBeat < ctx.currentTime + 0.5) {
      const t = this.nextBeat;
      const bar = Math.floor(this.step / 8) % 8;
      const chord = [0, 0, 5, 5, 3, 3, 4, 7][bar]; // I I IV IV ii ii iii V (in scale degrees of the major scale)
      if (this.step % 16 === 0) this.pad(t, chord, beat * 16);
      // melody: a deterministic wander on the pentatonic scale, with rests
      const seed = (this.step * 7919 + bar * 104729) % 97;
      if (seed % 3 !== 0) {
        const deg = PENTA[(seed + chord) % 5] + (seed % 7 === 0 ? 12 : 0);
        this.pluck(t, ROOT * 2 * 2 ** (deg / 12), seed % 5 === 0 ? 0.11 : 0.07);
      }
      if (this.step % 4 === 2) this.pluck(t, ROOT * 2 ** ((chord + 12) / 12) / 2, 0.05);
      this.nextBeat += beat;
      this.step++;
    }
  }

  private pad(t: number, degree: number, dur: number) {
    const ctx = this.ctx!;
    const major = [0, 2, 4, 5, 7, 9, 11];
    const notes = [0, 2, 4].map((k) => {
      const d = degree + k * 2;
      return major[d % 7] + 12 * Math.floor(d / 7);
    });
    for (const n of notes) {
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = ROOT * 2 ** (n / 12);
      o.detune.value = (Math.random() - 0.5) * 8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.045, t + dur * 0.3);
      g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(g).connect(this.music!);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
  }

  private pluck(t: number, f: number, vol: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = "sine";
    o2.frequency.value = f * 2.003;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(this.music!);
    o.start(t);
    o2.start(t);
    o.stop(t + 1.5);
    o2.stop(t + 1.5);
  }

  // ---- the forest: wind and leaves (following the gusts), birds and other creatures ---------------------

  private ambience: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private leavesGain: GainNode | null = null;
  private nextBird = 0;
  private nextWoodpecker = 0;
  private nextCuckoo = 0;
  private nextCrickets = 0;

  private startForest() {
    const ctx = this.ctx!;
    this.ambience = ctx.createGain();
    this.ambience.gain.value = 0.9;
    this.ambience.connect(this.master!);
    const loop = (rate: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.value = rate;
      src.start();
      return src;
    };
    // wind: low, breathy noise whose brightness and level rise with the gust
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "lowpass";
    this.windFilter.frequency.value = 380;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.04;
    loop(0.5).connect(this.windFilter).connect(this.windGain).connect(this.ambience);
    // leaves: a soft high hiss that only really comes in with the gusts
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2800;
    const shelf = ctx.createBiquadFilter();
    shelf.type = "lowpass";
    shelf.frequency.value = 7000;
    this.leavesGain = ctx.createGain();
    this.leavesGain.gain.value = 0.004;
    loop(1.1).connect(hp).connect(shelf).connect(this.leavesGain).connect(this.ambience);
    const now = ctx.currentTime;
    this.nextBird = now + 2 + Math.random() * 4;
    this.nextWoodpecker = now + 30 + Math.random() * 40;
    this.nextCuckoo = now + 50 + Math.random() * 60;
    this.nextCrickets = now + 10 + Math.random() * 15;
  }

  /** Gust strength 0..1 (from the weather that also sways the trees). */
  setWind(g: number) {
    if (!this.ctx || !this.windGain || !this.leavesGain || !this.windFilter) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0.03 + g * 0.22, t, 0.4);
    this.windFilter.frequency.setTargetAtTime(300 + g * 700, t, 0.5);
    this.leavesGain.gain.setTargetAtTime(0.003 + g * g * 0.07, t, 0.3);
  }

  private forestEvents() {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    if (now >= this.nextBird) {
      const r = Math.random();
      if (r < 0.45) this.birdChirps(now);
      else if (r < 0.75) this.birdWarble(now);
      else this.birdCall(now);
      // birds answer each other now and then
      this.nextBird = now + (Math.random() < 0.3 ? 0.8 + Math.random() * 1.5 : 4 + Math.random() * 10);
    }
    if (now >= this.nextWoodpecker) {
      this.woodpecker(now);
      this.nextWoodpecker = now + 45 + Math.random() * 70;
    }
    if (now >= this.nextCuckoo) {
      this.cuckoo(now);
      this.nextCuckoo = now + 70 + Math.random() * 90;
    }
    if (now >= this.nextCrickets) {
      this.crickets(now);
      this.nextCrickets = now + 14 + Math.random() * 26;
    }
  }

  /** A voice placed somewhere around the listener, at a random distance (pan + level). */
  private voice(vol: number): AudioNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = vol * (0.35 + Math.random() * 0.65);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    g.connect(pan).connect(this.ambience!);
    return g;
  }

  private tone(
    out: AudioNode,
    t: number,
    dur: number,
    f0: number,
    f1: number,
    vol: number,
    type: OscillatorType = "sine",
  ) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(0.02, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Quick rising chirps. */
  private birdChirps(t: number) {
    const out = this.voice(0.12);
    const n = 2 + Math.floor(Math.random() * 4);
    const base = 2600 + Math.random() * 1400;
    for (let i = 0; i < n; i++) {
      const s = t + i * (0.09 + Math.random() * 0.07);
      this.tone(out, s, 0.07, base * (0.9 + Math.random() * 0.2), base * 1.45, 0.5);
    }
  }

  /** A little warbling song. */
  private birdWarble(t: number) {
    const ctx = this.ctx!;
    const out = this.voice(0.08);
    const dur = 0.6 + Math.random() * 0.8;
    const o = ctx.createOscillator();
    const f = 2800 + Math.random() * 900;
    o.frequency.setValueAtTime(f, t);
    for (let k = 1; k <= 6; k++) {
      o.frequency.linearRampToValueAtTime(f * (0.85 + Math.random() * 0.35), t + (dur * k) / 6);
    }
    const vib = ctx.createOscillator();
    vib.frequency.value = 22 + Math.random() * 14;
    const vg = ctx.createGain();
    vg.gain.value = 180;
    vib.connect(vg).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.05);
    g.gain.setValueAtTime(0.4, t + dur - 0.1);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    vib.start(t);
    o.stop(t + dur + 0.05);
    vib.stop(t + dur + 0.05);
  }

  /** A two-note call, repeated two or three times ("tui-tui"). */
  private birdCall(t: number) {
    const out = this.voice(0.1);
    const hi = 2100 + Math.random() * 700, lo = hi * (0.7 + Math.random() * 0.1);
    const reps = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < reps; i++) {
      const s = t + i * 0.42;
      this.tone(out, s, 0.14, hi, hi * 1.05, 0.45);
      this.tone(out, s + 0.17, 0.16, lo, lo * 0.95, 0.4);
    }
  }

  /** A woodpecker far away: a fast drum roll that slows down. */
  private woodpecker(t: number) {
    const ctx = this.ctx!;
    const out = this.voice(0.18);
    const n = 10 + Math.floor(Math.random() * 7);
    let s = t;
    for (let i = 0; i < n; i++) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1100 + Math.random() * 200;
      bp.Q.value = 6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.9, s);
      g.gain.exponentialRampToValueAtTime(0.001, s + 0.03);
      src.connect(bp).connect(g).connect(out);
      src.start(s, Math.random() * 0.8, 0.04);
      s += 0.05 + i * 0.004;
    }
  }

  /** The cuckoo, from the edge of the forest. */
  private cuckoo(t: number) {
    const out = this.voice(0.14);
    const reps = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < reps; i++) {
      const s = t + i * 0.9;
      this.tone(out, s, 0.32, 740, 720, 0.5, "triangle");
      this.tone(out, s + 0.36, 0.42, 590, 570, 0.5, "triangle");
    }
  }

  /** Crickets: a few soft, buzzing trills. */
  private crickets(t: number) {
    const ctx = this.ctx!;
    const out = this.voice(0.035);
    const bursts = 3 + Math.floor(Math.random() * 5);
    for (let i = 0; i < bursts; i++) {
      const s = t + i * (0.5 + Math.random() * 0.3);
      const o = ctx.createOscillator();
      o.frequency.value = 4400 + Math.random() * 300;
      const am = ctx.createOscillator();
      am.frequency.value = 28;
      const amg = ctx.createGain();
      amg.gain.value = 0.5;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.5, s + 0.03);
      g.gain.linearRampToValueAtTime(0, s + 0.28);
      am.connect(amg).connect(g.gain);
      o.connect(g).connect(out);
      o.start(s);
      am.start(s);
      o.stop(s + 0.3);
      am.stop(s + 0.3);
    }
  }

  /** Leaves brushed by the pigeon. */
  rustle(vol = 0.5) {
    if (!this.gate("rustle", 0.35)) return;
    const ctx = this.ctx!, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 3500 + Math.random() * 1500;
    bp.Q.value = 0.7;
    const g = ctx.createGain();
    const dur = 0.25 + Math.random() * 0.25;
    g.gain.setValueAtTime(0, t);
    // a few crackling swells, like leaves rubbing
    for (let k = 0; k < 4; k++) {
      g.gain.linearRampToValueAtTime(vol * (0.15 + Math.random() * 0.2), t + (dur * (k + 0.5)) / 4);
    }
    g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(bp).connect(g).connect(this.sfx!);
    src.start(t, Math.random() * 0.6, dur + 0.05);
  }

  // ---- effects -------------------------------------------------------------------------------------------

  private ready() {
    return !!this.ctx && !this.muted;
  }

  private lastPlayed = new Map<string, number>();
  /** Rate limit per effect: held buttons or fast state changes never machine-gun a sound. */
  private gate(name: string, minGap: number): boolean {
    if (!this.ready()) return false;
    const now = this.ctx!.currentTime;
    if (now - (this.lastPlayed.get(name) ?? -1e9) < minGap) return false;
    this.lastPlayed.set(name, now);
    return true;
  }

  wing() {
    if (!this.gate("wing", 0.3)) return;
    const ctx = this.ctx!, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.exponentialRampToValueAtTime(400, t + 0.12);
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    src.connect(bp).connect(g).connect(this.sfx!);
    src.start(t, Math.random() * 0.5, 0.2);
  }

  coo() {
    if (!this.gate("coo", 4)) return;
    const ctx = this.ctx!, t = ctx.currentTime;
    // one or two notes, a little different each time
    const k = 0.9 + Math.random() * 0.2;
    const parts: [number, number, number][] = Math.random() < 0.35
      ? [[0, 0.38, 310 * k]]
      : [[0, 0.22, 330 * k], [0.26 + Math.random() * 0.08, 0.4, 300 * k]];
    for (const [start, dur, f] of parts) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(f, t + start);
      o.frequency.linearRampToValueAtTime(f * 0.82, t + start + dur);
      const trem = ctx.createOscillator();
      trem.frequency.value = 22;
      const tg = ctx.createGain();
      tg.gain.value = 0.35;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + start);
      g.gain.linearRampToValueAtTime(0.18, t + start + 0.05);
      g.gain.linearRampToValueAtTime(0, t + start + dur);
      trem.connect(tg).connect(g.gain);
      const lp = ctx.createBiquadFilter();
      lp.frequency.value = 900;
      o.connect(lp).connect(g).connect(this.sfx!);
      o.start(t + start);
      trem.start(t + start);
      o.stop(t + start + dur + 0.05);
      trem.stop(t + start + dur + 0.05);
    }
  }

  private bell(freqs: number[], gap: number, vol = 0.16) {
    if (!this.ready()) return;
    const ctx = this.ctx!, t = ctx.currentTime;
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      const g = ctx.createGain();
      const s = t + i * gap;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(vol, s + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 1.2);
      o.connect(g).connect(this.sfx!);
      o.start(s);
      o.stop(s + 1.3);
    });
  }

  inspect() {
    if (!this.gate("inspect", 0.6)) return;
    this.bell([784, 1175], 0.07, 0.1);
  }
  pickup() {
    this.bell([523, 659, 784, 1047, 1319], 0.08, 0.15);
  }
  land() {
    if (!this.gate("land", 0.4)) return;
    const ctx = this.ctx!, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.frequency.value = 600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    src.connect(lp).connect(g).connect(this.sfx!);
    src.start(t, Math.random(), 0.1);
  }
  celebrate() {
    this.bell([523, 659, 784, 988, 1047, 1319, 1568], 0.12, 0.13);
  }
}
