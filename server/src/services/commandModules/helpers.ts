/**
 * Shared command module utilities — eliminates code duplication
 * across SystemCommands, FileCommands, NetworkCommands, etc.
 */

import type { CommandResult, PlayerSession } from "../../../../shared/types";
import type { CommandContext } from "./interface";
import type { GameProcessType } from "../memoryService";
import { sanitizePath } from "../../utils/pathSanitizer";

// ═══════════════════════════════════════════════════════════════════
// Path Resolution
// ═══════════════════════════════════════════════════════════════════

/**
 * Resolve a relative or absolute path against the player's current directory.
 * Applies path sanitization to prevent traversal attacks.
 */
export function resolvePath(input: string, currentDir: string): string {
  let path = input;
  if (!path.startsWith("/")) {
    path = currentDir === "/" ? `/${path}` : `${currentDir}/${path}`;
  }
  return sanitizePath(path);
}

// ═══════════════════════════════════════════════════════════════════
// Session Helpers
// ═══════════════════════════════════════════════════════════════════

/**
 * Get the player's current session from GameStateManager.
 */
export function getSession(context: CommandContext): PlayerSession | undefined {
  return context.gameStateManager?.getSession(context.userId);
}

/**
 * Get the server ID the player is currently connected to (or their home server).
 */
export function getServerId(context: CommandContext): string | undefined {
  const session = getSession(context);
  return session?.currentServerId || session?.homeServerId;
}

/**
 * Get session + serverId + currentDir in one call.
 * Returns null if no session exists.
 */
export function getSessionContext(context: CommandContext): {
  session: PlayerSession;
  serverId: string;
  currentDir: string;
} | null {
  const session = getSession(context);
  if (!session) return null;
  const serverId = session.currentServerId || session.homeServerId;
  if (!serverId) return null;
  const currentDir = session.currentDirectory || "/";
  return { session, serverId, currentDir };
}

// ═══════════════════════════════════════════════════════════════════
// Command Result Factories
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a success CommandResult.
 */
export function successResult(
  output: string | string[],
  data?: Record<string, any>,
): CommandResult {
  return {
    success: true,
    output: Array.isArray(output) ? output.join("\n") : output,
    timestamp: new Date(),
    ...(data ? { data } : {}),
  };
}

/**
 * Create an error CommandResult.
 */
export function errorResult(
  output: string,
  error?: string,
): CommandResult {
  return {
    success: false,
    output,
    error: error || output,
    timestamp: new Date(),
  };
}

/**
 * Create a "no session" error result — used by many commands.
 */
export function noSessionError(): CommandResult {
  return errorResult("No active session. Please reconnect.");
}

// ═══════════════════════════════════════════════════════════════════
// Background Process Spawning
// ═══════════════════════════════════════════════════════════════════

/** Options for spawning a background process. */
export interface SpawnProcessOptions {
  /** The command context. */
  context: CommandContext;
  /** Type of process ("scan", "download", "decrypt", "hack_prep", etc.) */
  processType: GameProcessType;
  /** PlayerProgress field for duration scaling ("networking", "hacking", "cryptography", etc.) */
  skillKey: string;
  /** Human-readable label (e.g. filename, "network scan"). */
  label: string;
  /** Optional target server for the process. */
  targetServerId?: string | undefined;
  /** Async callback when process completes. */
  onComplete: () => Promise<void>;
  /** Override the skill value (e.g. for key-based decrypt). */
  effectiveSkillOverride?: number | undefined;
  /** Optional metadata passed to the process (e.g. method, tools, onCancel). */
  metadata?: Record<string, any> | undefined;
  /** Process priority (-10 aggressive to +10 stealth). Default 0. */
  priority?: number | undefined;
  /** Custom output message. If omitted, uses default format. */
  outputMessage?: string | undefined;
}

/** Result from spawning a background process — includes the process object for callers that need it. */
export interface SpawnProcessResult {
  result: CommandResult;
  process?: any; // The GameProcess, if spawn succeeded
}

/**
 * Spawn a background game process with resource checking.
 * Returns a CommandResult + optional process object.
 * Returns null if memoryService is unavailable (caller should handle fallback).
 */
export async function spawnBackgroundProcess(
  opts: SpawnProcessOptions,
): Promise<SpawnProcessResult | null> {
  const { context, processType, skillKey, label, targetServerId, onComplete, effectiveSkillOverride, metadata, priority, outputMessage } = opts;
  const memoryService = context.services.memoryService;
  if (!memoryService) return null; // Caller should handle fallback

  const progress = await context.db.client.playerProgress.findUnique({
    where: { userId: context.userId },
    select: { [skillKey]: true, level: true } as any,
  });

  memoryService.initComputerSpec(context.userId, progress?.level ?? 1);

  const check = memoryService.canSpawnProcess(context.userId, processType);
  if (!check.allowed) {
    return {
      result: errorResult(
        `${capitalize(processType)} failed: ${check.reason}\nUse 'ps' to see running processes, 'kill <pid>' to free resources.`,
      ),
    };
  }

  const session = getSession(context);
  const skill = effectiveSkillOverride ?? (progress as any)?.[skillKey] ?? 1;

  const proc = memoryService.spawnGameProcess(
    context.userId,
    session?.socketId || context.userId,
    processType,
    skill,
    label,
    targetServerId,
    onComplete,
    metadata,
    priority ?? 0,
  );

  if (!proc) {
    return { result: errorResult(`Failed to start ${processType} process.`) };
  }

  const etaSec = Math.ceil(proc.duration / 1000);
  const msg = outputMessage ??
    `${capitalize(processType)}: ${label}... ETA ${etaSec}s [PID ${proc.pid}]\nUse 'ps' to monitor progress.`;

  return {
    result: successResult(msg),
    process: proc,
  };
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, " ");
}
