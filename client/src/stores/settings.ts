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
      return { ...defaults, ...JSON.parse(raw) };
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
