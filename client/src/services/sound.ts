/**
 * Sound Service — synthesized audio feedback using Web Audio API.
 * No audio files needed — all sounds are generated programmatically.
 * Respects browser autoplay policy (no sound until first interaction).
 */

import { getSettings } from "../stores/settings";

let audioCtx: AudioContext | null = null;
let userInteracted = false;

// Enable audio on first user interaction
if (typeof window !== "undefined") {
  const enableAudio = () => {
    userInteracted = true;
    window.removeEventListener("click", enableAudio);
    window.removeEventListener("keydown", enableAudio);
  };
  window.addEventListener("click", enableAudio);
  window.addEventListener("keydown", enableAudio);
}

function getContext(): AudioContext | null {
  if (!userInteracted) return null;
  if (!audioCtx) {
    try {
      audioCtx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playTone(
  frequency: number,
  duration: number,
  type: OscillatorType = "sine",
  volumeMultiplier: number = 1.0,
): void {
  const { soundEnabled, soundVolume } = getSettings();
  if (!soundEnabled) return;

  const ctx = getContext();
  if (!ctx) return;

  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(soundVolume * volumeMultiplier * 0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch {
    // Silently fail
  }
}

function playSequence(
  notes: Array<{ freq: number; delay: number; duration: number; type?: OscillatorType }>,
  volumeMultiplier: number = 1.0,
): void {
  for (const note of notes) {
    setTimeout(() => {
      playTone(note.freq, note.duration, note.type || "sine", volumeMultiplier);
    }, note.delay);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Sound Effects
// ═══════════════════════════════════════════════════════════════════

export const sound = {
  /** Soft blip when command is submitted. */
  submit(): void {
    playTone(600, 0.08, "sine");
  },

  /** Ascending tone on successful command. */
  success(): void {
    playSequence([
      { freq: 500, delay: 0, duration: 0.1 },
      { freq: 700, delay: 80, duration: 0.1 },
    ]);
  },

  /** Low descending buzz on error. */
  error(): void {
    playSequence([
      { freq: 300, delay: 0, duration: 0.15, type: "square" },
      { freq: 200, delay: 100, duration: 0.15, type: "square" },
    ], 0.5);
  },

  /** Completion chime when a process finishes. */
  processComplete(): void {
    playSequence([
      { freq: 600, delay: 0, duration: 0.1 },
      { freq: 800, delay: 80, duration: 0.1 },
      { freq: 1000, delay: 160, duration: 0.15 },
    ]);
  },

  /** Triumphant chord on hack success. */
  hackSuccess(): void {
    playSequence([
      { freq: 400, delay: 0, duration: 0.2 },
      { freq: 500, delay: 60, duration: 0.2 },
      { freq: 600, delay: 120, duration: 0.2 },
      { freq: 800, delay: 200, duration: 0.3 },
    ]);
  },

  /** Fanfare on level up. */
  levelUp(): void {
    playSequence([
      { freq: 523, delay: 0, duration: 0.1 },
      { freq: 659, delay: 80, duration: 0.1 },
      { freq: 784, delay: 160, duration: 0.1 },
      { freq: 1047, delay: 240, duration: 0.2 },
      { freq: 784, delay: 360, duration: 0.1 },
      { freq: 1047, delay: 440, duration: 0.3 },
    ]);
  },

  /** Sharp alert tone for urgent notifications. */
  alert(): void {
    playSequence([
      { freq: 800, delay: 0, duration: 0.1, type: "square" },
      { freq: 1000, delay: 120, duration: 0.1, type: "square" },
      { freq: 800, delay: 240, duration: 0.1, type: "square" },
    ], 0.7);
  },

  /** Soft notification beep. */
  notification(): void {
    playTone(800, 0.1, "sine", 0.6);
  },

  /** Connection established. */
  connected(): void {
    playSequence([
      { freq: 400, delay: 0, duration: 0.08 },
      { freq: 600, delay: 60, duration: 0.08 },
      { freq: 800, delay: 120, duration: 0.12 },
    ], 0.8);
  },
};
