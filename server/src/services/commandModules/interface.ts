import { Command, CommandResult } from "../../../../shared/types";
import { FileService } from "../fileService";
import { PrismaClient } from "@prisma/client";
import { Server as SocketIOServer } from "socket.io";

export interface CommandContext {
  userId: string;
  db: { client: PrismaClient }; // Matching the structure used in existing code (db.client)
  fileService: FileService;
  io?: SocketIOServer;
  commandHistory: Map<string, Command[]>;
  gameStateManager?: any; // Typed as any for now to avoid circular imports, or use a shared interface if available
  services: {
    [key: string]: any; // For other services like shopService, missionService, etc.
  };
  modules: import("./interface").CommandModule[];
}

export interface CommandInfo {
  command: string;
  category: string;
  description: string;
  usage: string;
  examples?: string[];
}

export interface CommandModule {
  commands: Set<string>;
  execute(command: Command, context: CommandContext): Promise<CommandResult>;
  getCommandInfo?(): CommandInfo[];
}
