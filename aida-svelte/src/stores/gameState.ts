import { writable, derived, get } from 'svelte/store';
import type { Writable, Readable } from 'svelte/store';
import { Server } from '../models/Server';
import { Directory } from '../models/Directory';

// Output line type
export interface OutputLine {
  text: string;
  timestamp: number;
}

// Game state stores
export const user = writable<string | null>(null);
export const networkAccess = writable<boolean>(false);
export const currentServer = writable<Server | null>(null);
export const currentDirectory = writable<Directory | null>(null);
export const outputLines = writable<OutputLine[]>([]);
export const servers = writable<Server[]>([]);
export const commandHistory = writable<string[]>([]);
export const historyIndex = writable<number>(-1);

// Derived store for terminal prompt
export const terminalPrompt: Readable<string> = derived(
  [user, currentDirectory],
  ([$user, $currentDirectory]) => {
    const username = $user || 'Guest';
    const dirName = $currentDirectory?.getName() || '~';
    return `${username} ${dirName}$ `;
  }
);

// Helper functions
export function addOutput(text: string): void {
  outputLines.update(lines => [
    ...lines,
    { text, timestamp: Date.now() }
  ]);
}

export function clearOutput(): void {
  outputLines.set([]);
}

export function setUser(username: string): void {
  user.set(username);
  networkAccess.set(true);
  addOutput('SCANNING IRIS...\nSAVING NEW IDENTIFICATORS...\nDONE');
  addOutput(`New user registered, welcome to the Neurolink Network: ${username}`);
}

export function addToHistory(command: string): void {
  if (command.trim()) {
    commandHistory.update(history => {
      const newHistory = [...history, command];
      // Keep last 100 commands
      return newHistory.slice(-100);
    });
    historyIndex.set(-1);
  }
}

export function navigateHistory(direction: 'up' | 'down'): string | null {
  const history = get(commandHistory);
  const currentIndex = get(historyIndex);

  if (direction === 'up') {
    const newIndex = currentIndex < history.length - 1 ? currentIndex + 1 : currentIndex;
    historyIndex.set(newIndex);
    return history[history.length - 1 - newIndex] || null;
  } else {
    const newIndex = currentIndex > -1 ? currentIndex - 1 : -1;
    historyIndex.set(newIndex);
    return newIndex === -1 ? '' : (history[history.length - 1 - newIndex] || null);
  }
}

export function addServer(server: Server): void {
  servers.update(list => [...list, server]);
}

export function getKnownServers(): Server[] {
  return get(servers).filter(s => s.known);
}

export function findServerByIP(ip: string): Server | undefined {
  return get(servers).find(s => s.path === ip);
}

export function connectToServer(server: Server): void {
  currentServer.set(server);
  const home = server.getHome();
  if (home) {
    currentDirectory.set(home);
  }
}
