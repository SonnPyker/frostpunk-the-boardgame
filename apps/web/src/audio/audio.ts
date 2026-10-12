// Audio engine: ambient loop (the mod's ambient track when the manifest has one, otherwise a procedural
// wind bed) and procedural Web Audio sound effects (no files). Nothing plays before the first user gesture
// (browser autoplay policy): call unlockAudio() from a pointer or key handler.
import { ambientTrackUrl } from '../components/ui/assets';

export type SfxName = 'click' | 'confirm' | 'error' | 'heatUp' | 'snowWind' | 'bell' | 'tick';

const MIN_GAP_MS: Record<SfxName, number> = {
  click: 35,
  confirm: 80,
  error: 200,
  heatUp: 400,
  snowWind: 800,
  bell: 600,
  tick: 25,
};

type AudioCtor = typeof AudioContext;

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private windBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private track: HTMLAudioElement | null = null;
  private windSrc: AudioBufferSourceNode | null = null;
  private musicVol = 0.45;
  private sfxVol = 0.7;
  private unlocked = false;
  private lastPlayed: Partial<Record<SfxName, number>> = {};

  /** Call from a user gesture. Creates the context and starts the ambient bed. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext) as
          | AudioCtor
          | undefined;
        if (!Ctor) return;
        const ctx = new Ctor();
        const master = ctx.createGain();
        master.gain.value = 1;
        master.connect(ctx.destination);
        const sfxBus = ctx.createGain();
        sfxBus.gain.value = this.sfxVol;
        sfxBus.connect(master);
        const windBus = ctx.createGain();
        windBus.gain.value = 0;
        windBus.connect(master);
        this.ctx = ctx;
        this.master = master;
        this.sfxBus = sfxBus;
        this.windBus = windBus;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      this.unlocked = true;
      this.refreshAmbient();
    } catch {
      // no audio device or the context is blocked: the game is fully playable without sound
    }
  }

  /** Applies the Settings volumes (0..1). */
  setVolumes(music: number, sfx: number): void {
    this.musicVol = clamp01(music);
    this.sfxVol = clamp01(sfx);
    if (this.sfxBus) this.sfxBus.gain.value = this.sfxVol;
    if (this.track) this.track.volume = this.musicVol * 0.6;
    if (this.windBus) this.windBus.gain.value = this.musicVol * 0.22;
    this.refreshAmbient();
  }

  /** Plays one procedural effect. Silently ignored before unlock or when the same effect fires too often. */
  playSfx(name: SfxName): void {
    if (!this.unlocked || !this.ctx || !this.sfxBus || this.sfxVol <= 0) return;
    const now = performance.now();
    const last = this.lastPlayed[name] ?? 0;
    if (now - last < MIN_GAP_MS[name]) return;
    this.lastPlayed[name] = now;
    try {
      const t = this.ctx.currentTime + 0.005;
      switch (name) {
        case 'click':
          this.blip(t, 1400, 640, 0.07, 0.22, 'triangle');
          break;
        case 'tick':
          this.blip(t, 900, 880, 0.012, 0.05, 'square');
          break;
        case 'confirm':
          this.blip(t, 520, 540, 0.1, 0.2, 'sine');
          this.blip(t + 0.09, 780, 800, 0.16, 0.2, 'sine');
          break;
        case 'error':
          this.sweep(t, 220, 110, 0.28, 0.16, 'sawtooth', 900);
          break;
        case 'heatUp':
          this.hiss(t, 300, 2400, 1.2, 0.1);
          this.sweep(t, 90, 240, 0.9, 0.05, 'sawtooth', 500);
          break;
        case 'snowWind':
          this.hiss(t, 700, 1500, 1.8, 0.16, true);
          break;
        case 'bell':
          this.bell(t, 330);
          break;
      }
    } catch {
      // ignore: sound is decoration
    }
  }

  /** Stops everything (used when the tab is hidden or the player mutes). */
  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
    if (this.track) this.track.pause();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended' && this.unlocked) void this.ctx.resume();
    this.refreshAmbient();
  }

  // ---- ambient ----------------------------------------------------------------

  private refreshAmbient(): void {
    if (!this.unlocked || !this.ctx) return;
    if (this.musicVol <= 0) {
      if (this.track) this.track.pause();
      if (this.windBus) this.windBus.gain.value = 0;
      return;
    }
    if (!this.track && !this.windSrc) this.startAmbient();
    if (this.track) {
      this.track.volume = this.musicVol * 0.6;
      if (this.track.paused && !(typeof document !== 'undefined' && document.hidden)) void this.track.play().catch(() => this.startWind());
    }
  }

  private startAmbient(): void {
    const url = ambientTrackUrl();
    if (url && typeof Audio !== 'undefined') {
      const el = new Audio(url);
      el.loop = true;
      el.preload = 'auto';
      el.volume = this.musicVol * 0.6;
      this.track = el;
      if (typeof document !== 'undefined' && document.hidden) return; // resumes on the next visible volume refresh
      void el.play().catch(() => {
        this.track = null;
        this.startWind();
      });
      return;
    }
    this.startWind();
  }

  /** Procedural wind bed: looping filtered noise with a slow swell. */
  private ensureNoise(): AudioBuffer | null {
    if (this.noise) return this.noise;
    if (!this.ctx) return null;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 4, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      // brown-ish noise: smoother than white, reads as wind
      last = (last + (Math.random() * 2 - 1) * 0.04) * 0.995;
      data[i] = last * 6;
    }
    this.noise = buf;
    return buf;
  }

  private startWind(): void {
    if (!this.ctx || !this.windBus || this.windSrc) return;
    const ctx = this.ctx;
    const noise = this.ensureNoise();
    if (!noise) return;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.Q.value = 0.4;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const depth = ctx.createGain();
    depth.gain.value = 350;
    lfo.connect(depth).connect(lp.frequency);
    src.connect(lp).connect(this.windBus);
    src.start();
    lfo.start();
    this.windSrc = src;
    this.windBus.gain.value = this.musicVol * 0.22;
  }

  // ---- effect building blocks ---------------------------------------------------

  private out(): AudioNode {
    return this.sfxBus as GainNode;
  }

  private blip(t: number, f0: number, f1: number, dur: number, peak: number, type: OscillatorType): void {
    const ctx = this.ctx as AudioContext;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out());
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private sweep(t: number, f0: number, f1: number, dur: number, peak: number, type: OscillatorType, cutoff: number): void {
    const ctx = this.ctx as AudioContext;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp).connect(g).connect(this.out());
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private hiss(t: number, f0: number, f1: number, dur: number, peak: number, swell = false): void {
    const ctx = this.ctx as AudioContext;
    const noise = this.ensureNoise();
    if (!noise) return;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    if (swell) {
      g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    } else {
      g.gain.exponentialRampToValueAtTime(peak, t + 0.2);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    }
    src.connect(bp).connect(g).connect(this.out());
    src.start(t, Math.random() * 2);
    src.stop(t + dur + 0.05);
  }

  private bell(t: number, base: number): void {
    const ctx = this.ctx as AudioContext;
    const partials: [number, number][] = [
      [1, 0.22],
      [2.76, 0.12],
      [5.4, 0.05],
    ];
    for (const [ratio, amp] of partials) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = base * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(amp, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
      o.connect(g).connect(this.out());
      o.start(t);
      o.stop(t + 2.9);
    }
  }
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

export const audio = new AudioEngine();
