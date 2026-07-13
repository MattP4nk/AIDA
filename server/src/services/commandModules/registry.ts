/**
 * Command Module Registry
 *
 * Single source of truth for all command modules.
 * Add new modules here — CommandProcessor reads this list automatically.
 */

import type { CommandModule } from "./interface";

import { SystemCommandsModule } from "./systemCommands";
import { NetworkCommandsModule } from "./networkCommands";
import { HackCommandsModule } from "./hackCommands";
import { FileCommandsModule } from "./fileCommands";
import { SocialCommandsModule } from "./socialCommands";
import { GameCommandsModule } from "./gameCommands";
import { HelpCommandsModule } from "./helpCommands";
import { ProcessCommandsModule } from "./processCommands";
import { MathCommandsModule } from "./mathCommands";
import { FactionCommandsModule } from "./factionCommands";
import { AliasCommandsModule } from "./aliasCommands";
import { AdminCommandsModule } from "./adminCommands";
import { DefenseCommandsModule } from "./defenseCommands";

/** All registered module constructors in load order. */
const MODULE_CONSTRUCTORS: Array<new () => CommandModule> = [
  SystemCommandsModule,
  NetworkCommandsModule,
  HackCommandsModule,
  FileCommandsModule,
  SocialCommandsModule,
  GameCommandsModule,
  HelpCommandsModule,
  ProcessCommandsModule,
  MathCommandsModule,
  FactionCommandsModule,
  AliasCommandsModule,
  AdminCommandsModule,
  DefenseCommandsModule,
];

/** Create all command module instances. */
export function createAllModules(): CommandModule[] {
  return MODULE_CONSTRUCTORS.map((Ctor) => new Ctor());
}

/** Number of registered modules. */
export const MODULE_COUNT = MODULE_CONSTRUCTORS.length;
