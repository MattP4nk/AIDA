/**
 * User settings — persisted to localStorage.
 * Accessible via `settings` command or Ctrl shortcuts.
 */

import { writable, get } from "svelte/store";

export interface UserSettings {
  typewriterSpeed: "instant" | "fast" | "cinematic";
  soundEnabled: boolean;
  soundVolume: number; // 0.0 - 1.0
  crtEffects: boolean;
  timestampsVisible: boolean;
}

const STORAGE_KEY = "aida_settings";

const defaults: UserSettings = {
  typewriterSpeed: "instant",
  soundEnabled: true,
  soundVolume: 0.3,
  crtEffects: true,
  timestampsVisible: true,
};

function loadSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Validate types to prevent corrupted localStorage values
      const validated: Partial<UserSettings> = {};
      if (["instant", "fast", "cinematic"].includes(parsed.typewriterSpeed))
        validated.typewriterSpeed = parsed.typewriterSpeed;
      if (typeof parsed.soundEnabled === "boolean")
        validated.soundEnabled = parsed.soundEnabled;
      if (typeof parsed.soundVolume === "number" && parsed.soundVolume >= 0 && parsed.soundVolume <= 1)
        validated.soundVolume = parsed.soundVolume;
      if (typeof parsed.crtEffects === "boolean")
        validated.crtEffects = parsed.crtEffects;
      if (typeof parsed.timestampsVisible === "boolean")
        validated.timestampsVisible = parsed.timestampsVisible;
      return { ...defaults, ...validated };
    }
  } catch {
    // ignore parse errors
  }
  return { ...defaults };
}

function saveSettings(settings: UserSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore storage errors
  }
}

export const settings = writable<UserSettings>(loadSettings());

// Auto-save on change
settings.subscribe((s) => saveSettings(s));

/** Update a single setting. */
export function setSetting<K extends keyof UserSettings>(
  key: K,
  value: UserSettings[K],
): void {
  settings.update((s) => ({ ...s, [key]: value }));
}

/** Get current settings snapshot. */
export function getSettings(): UserSettings {
  return get(settings);
}
