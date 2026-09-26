/**
 * F18 — procedural ambient soundscape (pure Web Audio synthesis, zero assets).
 * One shared AudioContext; each scene gets its own voice set with a short
 * crossfade when switching. Must be enabled from a user gesture (header
 * toggle) to satisfy browser autoplay policies. Volume is intentionally low.
 */

export type AmbientScene = 'solar' | 'galaxy' | 'blackhole';

interface ScenePreset {
  rootHz: number;
  fifthHz: number;
  subHz: number;
  droneGain: number;
  shimmerHz: number;
  shimmerQ: number;
  shimmerGain: number;
  sweepHz: number;
  breatheHz: number;
  /** > 0 adds a slow tremolo "heartbeat" (black hole) */
  pulseHz: number;
  master: number;
}

const PRESETS: Record<AmbientScene, ScenePreset> = {
  // serene, warm pad — planetary calm
  solar: {
    rootHz: 55,
    fifthHz: 82.4,
    subHz: 0,
    droneGain: 0.5,
    shimmerHz: 520,
    shimmerQ: 9,
    shimmerGain: 0.028,
    sweepHz: 0.09,
    breatheHz: 0.055,
    pulseHz: 0,
    master: 0.85,
  },
  // airy, wider, slightly brighter — interstellar drift
  galaxy: {
    rootHz: 41.2,
    fifthHz: 61.7,
    subHz: 0,
    droneGain: 0.42,
    shimmerHz: 960,
    shimmerQ: 14,
    shimmerGain: 0.05,
    sweepHz: 0.07,
    breatheHz: 0.042,
    pulseHz: 0,
    master: 0.9,
  },
  // deep, oppressive rumble with a slow heartbeat
  blackhole: {
    rootHz: 32.7,
    fifthHz: 49,
    subHz: 26.2,
    droneGain: 0.62,
    shimmerHz: 230,
    shimmerQ: 4,
    shimmerGain: 0.026,
    sweepHz: 0.05,
    breatheHz: 0.038,
    pulseHz: 0.13,
    master: 1,
  },
};

interface VoiceSet {
  bus: GainNode;
  sources: AudioScheduledSourceNode[];
}

/**
 * F23 — short synthesized UI event sounds ("click", "success", "switch").
 * F37 — they run on their own sfx bus, independent of the ambient toggle:
 * muting the ambient bed no longer silences UI feedback (and vice versa).
 */
export type EventSound = 'click' | 'success' | 'switch';

class AmbientSoundscape {
  private ctx: AudioContext | null = null;
  /** ambient-only bus (drones / shimmer) — faded by enable()/disable() */
  private ambientGain: GainNode | null = null;
  /** UI event-sound bus — independent of the ambient toggle (F37) */
  private sfxGain: GainNode | null = null;
  private voices: VoiceSet | null = null;
  private scene: AmbientScene = 'solar';
  private on = false;
  private sfxOn = true; // F37 — UI blips default on, persisted by the header
  /**
   * F39 — total-mute gate. The header's main 「音效」 switch now means
   * "master": when off, EVERYTHING is silent (ambient bed + UI blips),
   * fixing the bug where blips kept playing after the user muted sound.
   */
  private master = false;
  /** F39 — user volume multipliers (slider 0..1, persisted by the header) */
  private ambientVol = 1;
  private sfxVol = 1;
  private noise: AudioBuffer | null = null;
  private teardownTimer: number | null = null;

  isEnabled(): boolean {
    return this.on;
  }

  /** F37 — current UI-sound preference */
  isSfxEnabled(): boolean {
    return this.sfxOn;
  }

  /** Create the shared context + top-level buses (idempotent). */
  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (this.ctx) return this.ctx;
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();
    this.ctx = ctx;
    this.ambientGain = ctx.createGain();
    this.ambientGain.gain.value = 0;
    this.ambientGain.connect(ctx.destination);
    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = this.master && this.sfxOn ? this.sfxVol : 0;
    this.sfxGain.connect(ctx.destination);
    return ctx;
  }

  /** F39 — current ambient-bed target gain (scene preset × user volume). */
  private ambientTarget(): number {
    return 0.16 * PRESETS[this.scene].master * this.ambientVol;
  }

  /** Call from a user gesture. Resolves once audio is running. */
  async enable(): Promise<void> {
    const ctx = this.ensureContext();
    if (!ctx) return;
    try {
      await ctx.resume();
    } catch {
      /* context may already be running */
    }
    this.master = true; // F39 — main switch re-opens the whole audio graph
    this.on = true;
    this.rebuildVoices();
    const t = ctx.currentTime;
    const bus = this.ambientGain;
    if (bus) {
      bus.gain.cancelScheduledValues(t);
      bus.gain.setTargetAtTime(this.ambientTarget(), t, 0.7);
    }
    const sfx = this.sfxGain;
    if (sfx) {
      sfx.gain.cancelScheduledValues(t);
      sfx.gain.setTargetAtTime(this.sfxOn ? this.sfxVol : 0, t, 0.03);
    }
  }

  /** F39 — master mute: fades out the ambient bed AND silences UI blips. */
  disable(): void {
    this.master = false;
    this.on = false;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (this.ambientGain) {
      this.ambientGain.gain.cancelScheduledValues(t);
      this.ambientGain.gain.setTargetAtTime(0, t, 0.3);
    }
    if (this.sfxGain) {
      this.sfxGain.gain.cancelScheduledValues(t);
      this.sfxGain.gain.setTargetAtTime(0, t, 0.03);
    }
  }

  /** F37 — toggle the UI event sounds independently of the ambient bed. */
  setSfx(enabled: boolean): void {
    this.sfxOn = enabled;
    if (this.ctx && this.sfxGain) {
      const t = this.ctx.currentTime;
      this.sfxGain.gain.cancelScheduledValues(t);
      this.sfxGain.gain.setTargetAtTime(this.master && enabled ? this.sfxVol : 0, t, 0.03);
    }
  }

  /** F39 — user volume for the ambient bed (0..1; 1 = the tuned default). */
  setAmbientVolume(v: number): void {
    this.ambientVol = THREE_VOL_CLAMP(v);
    if (this.ctx && this.ambientGain && this.on && this.master) {
      const t = this.ctx.currentTime;
      this.ambientGain.gain.cancelScheduledValues(t);
      this.ambientGain.gain.setTargetAtTime(this.ambientTarget(), t, 0.08);
    }
  }

  /** F39 — user volume for UI blips (0..1). */
  setSfxVolume(v: number): void {
    this.sfxVol = THREE_VOL_CLAMP(v);
    if (this.ctx && this.sfxGain) {
      const t = this.ctx.currentTime;
      this.sfxGain.gain.cancelScheduledValues(t);
      this.sfxGain.gain.setTargetAtTime(this.master && this.sfxOn ? this.sfxVol : 0, t, 0.03);
    }
  }

  /**
   * F23/F37 — one-shot UI feedback sound, routed through its own bus so it
   * works independently of the ambient toggle. The context is created lazily
   * here (a click is a valid user gesture), so blips work even if the user
   * never enables the ambient soundscape.
   * click  — short soft blip (selecting bodies, toggles)
   * success— two-note rising chime (screenshot saved)
   * switch — airy noise swish (scene transitions)
   */
  playEvent(kind: EventSound): void {
    if (!this.master || !this.sfxOn) return; // F39 — master mute gates everything
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    const t0 = ctx.currentTime;
    const bus = ctx.createGain();
    bus.gain.value = 1;
    bus.connect(this.sfxGain);

    if (kind === 'click') {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(720, t0);
      osc.frequency.exponentialRampToValueAtTime(520, t0 + 0.07);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.055, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
      osc.connect(g);
      g.connect(bus);
      osc.start(t0);
      osc.stop(t0 + 0.12);
    } else if (kind === 'success') {
      const note = (hz: number, at: number, dur: number, vol: number) => {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = hz;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(vol, at + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
        osc.connect(g);
        g.connect(bus);
        osc.start(at);
        osc.stop(at + dur + 0.05);
      };
      note(880, t0, 0.16, 0.05);
      note(1318.5, t0 + 0.09, 0.28, 0.045);
    } else {
      // 'switch' — airy swish: noise burst through a rising bandpass
      const src = ctx.createBufferSource();
      src.buffer = this.getNoise();
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = 2.2;
      band.frequency.setValueAtTime(420, t0);
      band.frequency.exponentialRampToValueAtTime(2400, t0 + 0.16);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.19);
      src.connect(band);
      band.connect(g);
      g.connect(bus);
      src.start(t0, Math.random() * 1.2);
      src.stop(t0 + 0.24);
    }
  }

  /** Switch scene (crossfades the ambient bed when currently playing). */
  setScene(scene: AmbientScene): void {
    if (scene === this.scene) return;
    this.scene = scene;
    if (!this.on || !this.ctx || !this.ambientGain) return;
    this.rebuildVoices();
    const t = this.ctx.currentTime;
    const bus = this.ambientGain;
    bus.gain.cancelScheduledValues(t);
    bus.gain.setValueAtTime(bus.gain.value, t);
    bus.gain.linearRampToValueAtTime(0.02, t + 0.5);
    bus.gain.setTargetAtTime(this.ambientTarget(), t + 0.5, 0.6);
  }

  /** Full teardown (never strictly needed — the singleton lives app-long). */
  dispose(): void {
    if (this.teardownTimer) window.clearTimeout(this.teardownTimer);
    try {
      this.voices?.sources.forEach((s) => s.stop());
    } catch {
      /* already stopped */
    }
    this.voices = null;
    void this.ctx?.close();
    this.ctx = null;
    this.ambientGain = null;
    this.sfxGain = null;
    this.on = false;
  }

  /* ------------------------------ internals ------------------------------ */

  private getNoise(): AudioBuffer {
    if (this.noise || !this.ctx) return this.noise as AudioBuffer;
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;
    return buf;
  }

  private rebuildVoices(): void {
    if (!this.ctx || !this.ambientGain) return;
    const ctx = this.ctx;
    const p = PRESETS[this.scene];

    /* fade out + stop the previous generation */
    const old = this.voices;
    if (old) {
      const t0 = ctx.currentTime;
      old.bus.gain.cancelScheduledValues(t0);
      old.bus.gain.setTargetAtTime(0, t0, 0.22);
      if (this.teardownTimer) window.clearTimeout(this.teardownTimer);
      this.teardownTimer = window.setTimeout(() => {
        old.sources.forEach((s) => {
          try {
            s.stop();
          } catch {
            /* already stopped */
          }
        });
        try {
          old.bus.disconnect();
        } catch {
          /* fine */
        }
      }, 1400);
    }

    /* per-generation bus feeding the ambient bed */
    const bus = ctx.createGain();
    bus.gain.value = 1;
    bus.connect(this.ambientGain);
    const sources: AudioScheduledSourceNode[] = [];

    /* -- deep drone: root + detuned root + fifth (+ sub), lowpassed -- */
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = p.subHz > 0 ? 260 : 340;
    droneFilter.Q.value = 0.4;
    droneFilter.connect(bus);

    const drone = (hz: number, type: OscillatorType, gain: number, detune = 0) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = hz;
      osc.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = gain;
      osc.connect(g);
      g.connect(droneFilter);
      osc.start();
      sources.push(osc);
    };
    drone(p.rootHz, 'sine', p.droneGain);
    drone(p.rootHz, 'triangle', p.droneGain * 0.3, 7);
    drone(p.fifthHz, 'sine', p.droneGain * 0.38, -4);
    if (p.subHz > 0) drone(p.subHz, 'sine', 0.5);

    /* -- slow "breathing" on the drone filter cutoff -- */
    const breathe = ctx.createOscillator();
    breathe.frequency.value = p.breatheHz;
    const breatheAmt = ctx.createGain();
    breatheAmt.gain.value = 90;
    breathe.connect(breatheAmt);
    breatheAmt.connect(droneFilter.frequency);
    breathe.start();
    sources.push(breathe);

    /* -- airy shimmer: looping noise through a swept bandpass -- */
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = this.getNoise();
    noiseSrc.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = p.shimmerHz;
    band.Q.value = p.shimmerQ;
    const shimmerGain = ctx.createGain();
    shimmerGain.gain.value = p.shimmerGain;
    noiseSrc.connect(band);
    band.connect(shimmerGain);
    shimmerGain.connect(bus);
    const sweep = ctx.createOscillator();
    sweep.frequency.value = p.sweepHz;
    const sweepAmt = ctx.createGain();
    sweepAmt.gain.value = p.shimmerHz * 0.45;
    sweep.connect(sweepAmt);
    sweepAmt.connect(band.frequency);
    noiseSrc.start();
    sweep.start();
    sources.push(noiseSrc, sweep);

    /* -- black hole heartbeat: sub throb via tremolo on its own layer -- */
    if (p.pulseHz > 0) {
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.value = p.subHz > 0 ? p.subHz : p.rootHz * 0.5;
      const subGain = ctx.createGain();
      subGain.gain.value = 0.28;
      const trem = ctx.createOscillator();
      trem.frequency.value = p.pulseHz;
      const tremDepth = ctx.createGain();
      tremDepth.gain.value = 0.22;
      trem.connect(tremDepth);
      tremDepth.connect(subGain.gain);
      sub.connect(subGain);
      subGain.connect(bus);
      sub.start();
      trem.start();
      sources.push(sub, trem);
    }

    this.voices = { bus, sources };
  }
}

/** App-lifetime singleton. */
export const ambient = new AmbientSoundscape();

/** F23 — fire-and-forget UI feedback sound (honours the F37/F39 toggles). */
export function playEventSound(kind: EventSound): void {
  ambient.playEvent(kind);
}

/** F39 — clamp helper kept module-level (no per-call closures). */
function THREE_VOL_CLAMP(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
