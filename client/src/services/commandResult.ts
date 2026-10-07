/**
 * What the terminal does with a command and its server result, minus the
 * component state.
 *
 * A8: these lived inside Terminal.svelte's 292-line `handleSubmit`. They touch
 * only stores (passed in, so a harness can drive them with plain `writable`s)
 * or nothing at all, so they can be tested without a browser. Anything that
 * assigns component state stays in the component, where Svelte tracks it.
 */
import type { Writable } from "svelte/store";
import { ReservedPID } from "../../../shared/types";

// ── Commands that open a dialog instead of going to the server ────────────

/** Typed so the compiler checks every route against what openDialog accepts. */
export type DialogName = "shop" | "equipment" | "chat" | "mail" | "forum";

interface DialogRoute {
  dialog: DialogName;
  /** chat and forum receive the parsed command; the others open bare. */
  passCommand: boolean;
}

const DIALOG_COMMANDS: Record<string, DialogRoute> = {
  shop: { dialog: "shop", passCommand: false },
  inventory: { dialog: "equipment", passCommand: false },
  equipment: { dialog: "equipment", passCommand: false },
  gear: { dialog: "equipment", passCommand: false },
  scripts: { dialog: "equipment", passCommand: false },
  msg: { dialog: "chat", passCommand: true },
  message: { dialog: "chat", passCommand: true },
  chat: { dialog: "chat", passCommand: true },
  dm: { dialog: "chat", passCommand: true },
  mail: { dialog: "mail", passCommand: false },
  inbox: { dialog: "mail", passCommand: false },
  messages: { dialog: "mail", passCommand: false },
  forum: { dialog: "forum", passCommand: true },
  forums: { dialog: "forum", passCommand: true },
};

/**
 * The dialog a command opens, or null if it goes to the server. Was five
 * near-identical `if` blocks in handleSubmit, each repeating the same
 * three-line exit.
 */
export function resolveDialogCommand(
  command: string,
): { dialog: DialogName; data?: { command: string[] } } | null {
  const cmdParts = command.trim().split(/\s+/);
  const route = DIALOG_COMMANDS[cmdParts[0]!.toLowerCase()];
  if (!route) return null;
  return route.passCommand ? { dialog: route.dialog, data: { command: cmdParts } } : { dialog: route.dialog };
}

// ── Challenge state carried on an HTTP command result ─────────────────────

export interface ChallengeStores {
  activeProcesses: Writable<any[]>;
  activeConnectionSession: Writable<any>;
  activeHackSession: Writable<any>;
  activeFileChallenge: Writable<any>;
}

/**
 * Start, advance or clear the connection / hack / file-access challenge a
 * result describes, and keep the ProcessBar entry for each in step.
 *
 * Moved verbatim from handleSubmit. The one change: it did
 * `const { activeProcesses } = await import("../services/socket")` five
 * times, re-importing a store Terminal.svelte already imported statically.
 */
export function applyChallengeState(data: any, stores: ChallengeStores): void {
  const { activeProcesses, activeConnectionSession, activeHackSession, activeFileChallenge } = stores;

  // Handle challenge starts from HTTP results (connection/hack)
  if (data?.connectionSessionId && data?.connectionChallenge) {
    activeConnectionSession.set({
      active: true,
      targetIp: data.targetIp,
      challenge: data.connectionChallenge,
      sessionId: data.connectionSessionId,
    });
    // Register in ProcessBar for countdown
    const connTimeLimit = data.connectionChallenge?.timeLimit || 45;
    activeProcesses.update(procs => [
      ...procs.filter((p: any) => p.pid !== ReservedPID.CONNECTION_CHALLENGE),
      { pid: ReservedPID.CONNECTION_CHALLENGE, type: "connection_challenge", description: `Connection challenge — ${data.targetIp}`, progress: 0, eta: connTimeLimit },
    ]);
  }
  if (data?.connectionResolved) {
    activeConnectionSession.set(null);
    activeProcesses.update(procs => procs.filter((p: any) => p.pid !== ReservedPID.CONNECTION_CHALLENGE));
  }

  // Handle hack session start from HTTP fallback (when memoryService unavailable)
  if (data?.sessionId && data?.targetIp && !data?.connectionSessionId) {
    activeHackSession.set({
      active: true,
      targetIp: data.targetIp,
      currentLayer: 0,
      totalLayers: data.totalLayers,
      challenge: data.challenge,
    });
    activeProcesses.update(procs => [
      ...procs.filter((p: any) => p.pid !== ReservedPID.HACK_CHALLENGE),
      { pid: ReservedPID.HACK_CHALLENGE, type: "hack", description: `Hacking ${data.targetIp}`, progress: 0 },
    ]);
  }
  // Handle hack layer progression (nextChallenge) or resolution (hackResolved)
  if (data?.nextChallenge) {
    activeHackSession.update((session: any) => {
      if (!session) return session;
      return { ...session, currentLayer: (session.currentLayer || 0) + 1, challenge: data.nextChallenge };
    });
  }
  if (data?.hackResolved) {
    activeHackSession.set(null);
    activeProcesses.update(procs => procs.filter((p: any) => p.pid !== ReservedPID.HACK_CHALLENGE));
  }

  // Handle file access challenge start from HTTP
  if (data?.fileAccessSessionId && data?.fileAccessType) {
    activeFileChallenge.set({
      active: true,
      type: data.fileAccessType,
      targetFile: data.targetFile,
      targetDir: data.targetDir,
      challenge: data.challenge,
      sessionId: data.fileAccessSessionId,
    });
    activeProcesses.update(procs => [
      ...procs.filter((p: any) => p.pid !== ReservedPID.FILE_CHALLENGE),
      { pid: ReservedPID.FILE_CHALLENGE, type: "file_challenge", description: `${data.fileAccessType} challenge`, progress: 0 },
    ]);
  }
  // Handle file access resolution
  if (data?.fileAccessResolved) {
    activeFileChallenge.set(null);
    activeProcesses.update(procs => procs.filter((p: any) => p.pid !== ReservedPID.FILE_CHALLENGE));
  }
}

// ── The suggested next command ─────────────────────────────────────────────

/**
 * The command to offer next: the server's own `suggestedCommand` if it sent
 * one, else a regex over the output — accepted ONLY when its first word is a
 * known command, so file content like "report to..." is not offered.
 * null means "leave the current suggestion as it is", as before.
 */
export function extractSuggestedCommand(
  result: { suggestedCommand?: string; output?: string | string[] },
  knownCommands: readonly string[],
): string | null {
  if (result.suggestedCommand) return result.suggestedCommand;
  const outputText = Array.isArray(result.output)
    ? result.output.join("\n")
    : result.output || "";
  const suggestionMatch = outputText.match(
    /(?:Submit with|Submit:|Try:|Use:|Run:|Type:)\s+([a-z][a-z0-9_.]+(?:\s+\S+)*)/i,
  );
  if (suggestionMatch?.[1]) {
    const firstWord = suggestionMatch[1].split(/\s+/)[0]?.toLowerCase() || "";
    if (knownCommands.includes(firstWord)) return suggestionMatch[1].trim();
  }
  return null;
}
