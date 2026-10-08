// A5: type-only. All three are used purely as types here, but a VALUE import
// of the shared barrel pulls in a runtime module (shared/types/index.ts
// re-exports real consts such as ReservedPID) from what is otherwise a pure
// declaration file imported by 20 others. PLAN pointed at line 21 — which was
// already `import type` — and missed these three.
import type { Command, CommandResult } from "../../../../shared/types";
import type { Server as SocketIOServer } from "socket.io";

// Use type-only imports to avoid circular dependency issues
import type PlayerProgressRepository from "../../repositories/playerProgressRepository";
import type FileService from "../fileService";
import type GameStateManager from "../gameStateManager";

export interface CommandContext {
  userId: string;
  role: string;
  terminalWidth: number;
  fileService: FileService;
  io?: SocketIOServer;
  commandHistory: Map<string, Command[]>;
  gameStateManager: GameStateManager;
  modules: CommandModule[];
  /**
   * Phase 3 (D4/D5/D8) — the ONLY sanctioned way for a command module to
   * read or write `player_progress`. A4 removed `db` from this context: a
   * command module has no database handle at all, so it reaches the database
   * only through a service or repository.
   */
  playerProgress: PlayerProgressRepository;
  // A4: no `services` bag. A module imports the services it uses from
  // ./deps — that import line is its dependency interface.
}

export interface CommandInfo {
  command: string;
  category: string;
  description: string;
  usage: string;
  examples?: string[];
}

export interface CommandModule {
  /** The category name for this module (e.g. "system", "network", "hack"). */
  category: string;
  commands: Set<string>;
  execute(command: Command, context: CommandContext): Promise<CommandResult>;
  getCommandInfo?(): CommandInfo[];
}
