import { injectable, inject } from "tsyringe";
import { db } from "../database/client";
import { MISSION_SERVICE, LOGGER, FACTION_KNOWLEDGE_SERVICE } from "../di/tokens";
import MissionService from "./missionService";
import type { Logger } from "pino";
import type { FactionKnowledgeService } from "./factionKnowledgeService";
import { safeExecute } from "../utils/safeExecute";

/**
 * Does this objective refer to the entity that just changed?
 *
 * Templates in missionTemplatePool set `target: true` as a placeholder — the
 * real entity id is backfilled into `metadata` by
 * `serverContentService.provisionMissionInfrastructure()` (`metadata.serverId`,
 * `metadata.fileId`, …). Seven call sites here compared `objective.target`
 * directly against an id, i.e. `true === "cmx…"`, which is always false — so
 * those objectives could never record progress and their missions were
 * unwinnable, occupying a slot until they expired.
 *
 * Semantics:
 *   - **Bound** (metadata holds an id, or `target` is a string): require an
 *     exact match. This is the case for provisioned missions.
 *   - **Unbound** (no id anywhere): match anything. Social objectives such as
 *     `contact_player` and `forum_reply` never get provisioned at all — the
 *     provisioner returns early when a mission needs no server — so "any
 *     recipient" / "any thread" is their only workable reading. This also
 *     matches the convention already used by `install_backdoor`
 *     (`!objective.target || objective.target === targetId`), and it keeps a
 *     mission completable if provisioning failed rather than permanently stuck.
 */
function matchesEntity(
  objective: { target?: unknown; metadata?: Record<string, unknown> },
  actualId: string | undefined,
  ...metadataKeys: string[]
): boolean {
  for (const key of metadataKeys) {
    const bound = objective.metadata?.[key];
    if (typeof bound === "string" && bound.length > 0) {
      return bound === actualId;
    }
  }
  // Legacy/hand-authored objectives may put the id directly in `target`.
  if (typeof objective.target === "string" && objective.target.length > 0) {
    return objective.target === actualId;
  }
  return true; // unbound
}

/**
 * MissionIntegration Service
 *
 * Connects game actions to mission objectives and automatically validates progress.
 * This service listens for game events and updates relevant mission objectives.
 *
 * Responsibilities:
 * - Listen for game events (hacks, file operations, social interactions, etc.)
 * - Validate mission objective completion
 * - Trigger mission updates when objectives are met
 * - Send notifications to players about mission progress
 */

@injectable()
export class MissionIntegrationService {
  private factionKnowledge: FactionKnowledgeService | null = null;

  /**
   * Get active missions filtered to only those with at least one matching objective type.
   * Avoids iterating all objectives for missions that can't possibly match.
   */
  private async getActiveMissionsWithObjectiveTypes(
    userId: string,
    relevantTypes: string[],
  ): Promise<any[]> {
    const missions = await this.missionService.getPlayerMissions(userId);
    const typeSet = new Set(relevantTypes);
    return missions.filter(
      (m: any) =>
        m.status === "active" &&
        Array.isArray(m.objectives) &&
        m.objectives.some((o: any) => typeSet.has(o.type as string)),
    );
  }

  constructor(
    @inject(LOGGER) private logger: Logger,
    @inject(MISSION_SERVICE) private missionService: MissionService,
    @inject(FACTION_KNOWLEDGE_SERVICE)
    factionKnowledgeService?: FactionKnowledgeService,
  ) {
    this.factionKnowledge = factionKnowledgeService || null;
    // Subscribe to MissionService reward events for objective tracking
    this.missionService.on(
      "rewards:xp_granted",
      (data: {
        userId: string;
        skillName: string;
        newLevel: number;
        xpGained: number;
      }) => {
        this.onSkillUpdate(
          data.userId,
          data.skillName,
          data.newLevel,
          data.xpGained,
        ).catch((err) =>
          this.logger.error(
            { err, hook: "rewards:xp_granted" },
            "Mission integration event listener error",
          ),
        );
      },
    );

    this.missionService.on(
      "rewards:credits_granted",
      (data: { userId: string; amount: number; type: "earned" | "spent" }) => {
        this.onCreditsTransaction(data.userId, data.amount, data.type).catch(
          (err) =>
            this.logger.error(
              { err, hook: "rewards:credits_granted" },
              "Mission integration event listener error",
            ),
        );
      },
    );

    this.missionService.on(
      "mission:completed",
      (data: {
        userId: string;
        missionId: string;
        missionTitle: string;
        factionId?: string;
        targetServerId?: string;
        objectives?: Array<{ type: string; metadata?: Record<string, unknown> }>;
      }) => {
        if (data.factionId) {
          this.onFactionEvent(data.userId, "mission_complete", data.factionId, {
            missionId: data.missionId,
          }).catch((err) =>
            this.logger.error(
              { err, hook: "mission:completed→faction" },
              "Mission integration event listener error",
            ),
          );

          // Feed mission discoveries into faction knowledge
          if (this.factionKnowledge) {
            this.trackMissionKnowledge(
              data.factionId,
              data.userId,
              data.objectives || [],
            ).catch((err) =>
              this.logger.error(
                { err, hook: "mission:completed→knowledge" },
                "Faction knowledge mission tracking error",
              ),
            );
          }
        }
      },
    );
  }

  // REMOVED 2026-10-07: `setSocketIO`. It had ZERO callers, so `this.io` was
  // permanently null and the one socket emit that used it — `mission:notification`
  // in the deleted `sendNotification` — could never have fired even if that
  // method had been reachable. Its other job, forwarding to
  // `missionService.setSocketIO`, is redundant: missionService takes `io` by DI
  // injection and says so at missionService.ts:131.

  // ==================== EVENT HANDLERS ====================

  /**
   * Handle hack completion event
   * Updates objectives: hack count, target hacks, stealth hacks, etc.
   */
  public async onHackComplete(
    userId: string,
    /**
     * The **SERVER** that was hacked — this is compared against
     * `objective.metadata.serverId`.
     *
     * Renamed from `targetId` because that name invited exactly the bug it got:
     * `hackService` was passing the target **user's** id here, so every
     * `hack_target` comparison was `GameServer.id === User.id` and could never
     * be true. `hack_target` was unwinnable in every case.
     */
    targetServerId: string,
    success: boolean,
    detected: boolean,
    accessLevel: number,
    method: string,
  ): Promise<void> {
    await safeExecute({
      fn: async () => {
        const hackObjectiveTypes = ["hack", "hack_target", "hack_stealth", "hack_method", "gain_access", "breach_server", "install_backdoor"];
        const activeMissions = await this.getActiveMissionsWithObjectiveTypes(userId, hackObjectiveTypes);

        for (const mission of activeMissions) {
          for (const objective of mission.objectives) {
            let shouldUpdate = false;
            let newProgress: number | string | boolean = objective.current;
            // D3 pass 2: counts are credited as a DELTA, not an absolute
            // computed from `objective.current` — that read sits outside any
            // lock, so two concurrent credits collapsed into one.
            let delta: number | null = null;

            const objType = objective.type as string;

            if (objType === "hack") {
              if (success) {
                delta = 1;
                shouldUpdate = true;
              }
            } else if (objType === "hack_target") {
              if (success && matchesEntity(objective, targetServerId, "serverId")) {
                newProgress = true;
                shouldUpdate = true;
              }
            } else if (objType === "hack_stealth") {
              if (success && !detected) {
                delta = 1;
                shouldUpdate = true;
              }
            } else if (objType === "hack_method") {
              if (success && (objective as any).metadata?.method === method) {
                delta = 1;
                shouldUpdate = true;
              }
            } else if (objType === "gain_access") {
              if (
                success &&
                accessLevel >= ((objective as any).metadata?.minLevel || 1)
              ) {
                newProgress = true;
                shouldUpdate = true;
              }
            } else if (objType === "breach_server") {
              // Any successful breach counts, at ANY access level — a "minimal"
              // breach legitimately reports accessLevel 0.
              if (success && matchesEntity(objective, targetServerId, "serverId")) {
                newProgress = true;
                shouldUpdate = true;
              }
            } else if (objType === "install_backdoor") {
              if (
                success &&
                (method === "backdoor" || method === "rootkit") &&
                matchesEntity(objective, targetServerId, "serverId")
              ) {
                // COUNT now, not boolean — see the registry note. Writing `true`
                // meant Number(true)===1, so "plant 2 backdoors" could never
                // finish.
                delta = 1;
                shouldUpdate = true;
              }
            }

            if (shouldUpdate) {
              if (delta !== null) {
                await this.missionService.creditObjective(
                  userId,
                  mission.missionId,
                  objective.id,
                  delta,
                );
              } else {
                await this.missionService.updateObjective(
                  userId,
                  mission.missionId,
                  objective.id,
                  newProgress,
                );
              }
            }
          }
        }
      },
      context: "onHackComplete",
      logger: this.logger,
      silent: true,
    })();
  }

  /**
   * Handle access gained WITHOUT hacking — an access key found in a file, or a
   * previously installed backdoor.
   *
   * Only `breach_server` and `gain_access` are credited here, and deliberately
   * not the `hack*` family: those describe the act of hacking, so crediting them
   * from a key would let any "hack N servers" mission be completed by looting
   * credentials instead.
   *
   * Without this hook the key path was a dead end for mission progress: the
   * tutorial's Breach Protocol step offers "brute force OR find the key", but
   * only `hackService` ever reported progress, so a player who took the key
   * route got access and then sat on a step that could never complete.
   */
  public async onAccessGranted(
    userId: string,
    serverId: string,
    accessLevel: number,
    /**
     * How the player got in, for the log line only. The `connect` funnel cannot
     * distinguish an access key from a backdoor bypass — both arrive the same
     * way — so it reports "connect" rather than guessing one of them.
     */
    via: "connect" | "key" | "backdoor",
  ): Promise<void> {
    await safeExecute({
      fn: async () => {
        // Only *earned* access counts. Connecting to an open server, or to a
        // server you own, must not satisfy a breach objective.
        const server = await db.client.gameServer.findUnique({
          where: { id: serverId },
          select: { accessMethod: true, ownerId: true },
        });
        if (!server) return;
        if (server.ownerId === userId) return;
        if (!["keycard", "hack_or_key", "hackable"].includes(server.accessMethod ?? "")) return;

        const creditable = ["breach_server", "gain_access"];
        const activeMissions = await this.getActiveMissionsWithObjectiveTypes(userId, creditable);

        for (const mission of activeMissions) {
          for (const objective of mission.objectives) {
            const objType = objective.type as string;
            if (!creditable.includes(objType)) continue;
            // `gain_access` is about reaching a LEVEL, so it still gates on one;
            // `breach_server` only cares that you got in.
            if (objType === "gain_access" && accessLevel < ((objective as any).metadata?.minLevel || 1)) continue;
            // A server-scoped objective still has to name this server.
            if ((objective as any).metadata?.serverId && !matchesEntity(objective, serverId, "serverId")) continue;

            await this.missionService.updateObjective(
              userId,
              mission.missionId,
              objective.id,
              true,
            );
            this.logger.info(
              { userId, serverId, via, objType, missionId: mission.missionId, objectiveId: objective.id },
              "Access objective credited from non-hack access",
            );
          }
        }
      },
      context: "onAccessGranted",
      logger: this.logger,
      silent: true,
    })();
  }

  /**
   * Handle file operation event
   * Updates objectives: steal files, download files, upload files, etc.
   */
  public async onFileOperation(
    userId: string,
    operation: "read" | "download" | "upload" | "delete",
    fileId: string,
    serverId: string,
    _metadata?: any,
  ): Promise<void> {
    await safeExecute({
      fn: async () => {
        const missions = await this.missionService.getPlayerMissions(userId);
        const activeMissions = missions.filter((m: any) => m.status === "active");

        for (const mission of activeMissions) {
          if (!mission.objectives || !Array.isArray(mission.objectives)) continue;

          for (const objective of mission.objectives) {
            let shouldUpdate = false;
            let newProgress: number | string | boolean = objective.current;
            // D3 pass 2: counts are credited as a DELTA, not an absolute
            // computed from `objective.current` — that read sits outside any
            // lock, so two concurrent credits collapsed into one.
            let delta: number | null = null;

            const objType = objective.type as string;

            if (objType === "steal") {
              if (
                operation === "download" &&
                matchesEntity(objective, fileId, "fileId")
              ) {
                newProgress = true;
                shouldUpdate = true;
              }
            } else if (objType === "steal_count") {
              if (operation === "download") {
                delta = 1;
                shouldUpdate = true;
              }
            } else if (objType === "upload_file") {
              // G6: was a raw `metadata?.serverId === serverId`, strict with no
              // unbound fallback — permanently uncreditable whenever provisioning
              // did not bind serverId (it returns null silently under a
              // `safeExecute({ silent: true })`).
              if (
                operation === "upload" &&
                matchesEntity(objective as any, serverId, "serverId")
              ) {
                newProgress = true;
                shouldUpdate = true;
              }
            } else if (objType === "delete_file") {
              if (
                operation === "delete" &&
                matchesEntity(objective, fileId, "fileId")
              ) {
                newProgress = true;
                shouldUpdate = true;
              }
            } else if (objType === "download_file") {
              if (operation === "download") {
                // G6: hand-rolled tolerance (`|| !meta?.fileId`) replaced by the
                // helper, which encodes the same rule once.
                if (matchesEntity(objective as any, fileId, "fileId")) {
                  newProgress = true;
                  shouldUpdate = true;
                }
              }
            } else if (objType === "exfiltrate_data") {
              if (operation === "download") {
                // G6: was strict on BOTH ids with no unbound fallback, so an
                // unprovisioned objective could never complete. `deep_extraction`
                // is exactly this shape.
                if (
                  matchesEntity(objective as any, serverId, "serverId") &&
                  matchesEntity(objective as any, fileId, "fileId")
                ) {
                  newProgress = true;
                  shouldUpdate = true;
                }
              }
            }

            if (shouldUpdate) {
              if (delta !== null) {
                await this.missionService.creditObjective(
                  userId,
                  mission.missionId,
                  objective.id,
                  delta,
                );
              } else {
                await this.missionService.updateObjective(
                  userId,
                  mission.missionId,
                  objective.id,
                  newProgress,
                );
              }
            }
          }
        }
      },
      context: "onFileOperation",
      logger: this.logger,
      silent: true,
    })();
  }

  /**
   * Handle message sent event
   * Updates objectives: send messages, contact specific player, etc.
   */
  public async onMessageSent(
    userId: string,
    recipientId: string,
    _messageId: string,
  ): Promise<void> {
    await safeExecute({
      fn: async () => {
        const missions = await this.missionService.getPlayerMissions(userId);
        const activeMissions = missions.filter((m: any) => m.status === "active");

        for (const mission of activeMissions) {
          if (!mission.objectives || !Array.isArray(mission.objectives)) continue;

          for (const objective of mission.objectives) {
            let shouldUpdate = false;
            let newProgress: number | string | boolean = objective.current;
            // D3 pass 2: counts are credited as a DELTA, not an absolute
            // computed from `objective.current` — that read sits outside any
            // lock, so two concurrent credits collapsed into one.
            let delta: number | null = null;

            const objType = objective.type as string;

            if (objType === "message") {
              delta = 1;
              shouldUpdate = true;
            } else if (objType === "contact_player") {
              if (matchesEntity(objective, recipientId, "recipientId", "userId")) {
                newProgress = true;
                shouldUpdate = true;
              }
            }

            if (shouldUpdate) {
              if (delta !== null) {
                await this.missionService.creditObjective(
                  userId,
                  mission.missionId,
                  objective.id,
                  delta,
                );
              } else {
                await this.missionService.updateObjective(
                  userId,
                  mission.missionId,
                  objective.id,
                  newProgress,
                );
              }
            }
          }
        }
      },
      context: "onMessageSent",
      logger: this.logger,
      silent: true,
    })();
  }

  /**
   * Handle server connection event
   * Updates objectives: connect to server, explore network, etc.
   */
  public async onServerConnect(
    userId: string,
    serverId: string,
    serverType: string,
    serverMeta?: { networkId?: string; role?: string },
  ): Promise<void> {
    await safeExecute({
      fn: async () => {
        const missions = await this.missionService.getPlayerMissions(userId);
        const activeMissions = missions.filter((m: any) => m.status === "active");

        for (const mission of activeMissions) {
          if (!mission.objectives || !Array.isArray(mission.objectives)) continue;

          for (const objective of mission.objectives) {
            let shouldUpdate = false;
            let newProgress: number | string | boolean = objective.current;
            // D3 pass 2: counts are credited as a DELTA, not an absolute
            // computed from `objective.current` — that read sits outside any
            // lock, so two concurrent credits collapsed into one.
            let delta: number | null = null;

            const objType = objective.type as string;

            if (objType === "explore") {
              delta = 1;
              shouldUpdate = true;
            } else if (objType === "connect_server") {
              if (matchesEntity(objective, serverId, "serverId")) {
                newProgress = true;
                shouldUpdate = true;
              }
            } else if (objType === "discover_server_type") {
              if ((objective as any).metadata?.serverType === serverType) {
                delta = 1;
                shouldUpdate = true;
              }
            } else if (objType === "infiltrate_network") {
              const meta = (objective as any).metadata;
              // G6: was strict on networkId, and provisioning writes
              // `networkId: targetServer.networkId || null` — so a target server
              // created without a network made the objective permanently
              // uncreditable. Route through the helper so an UNBOUND objective
              // stays creditable; a bound one still has to match exactly.
              if (
                serverMeta?.networkId &&
                matchesEntity(objective as any, serverMeta.networkId, "networkId")
              ) {
                const roleMatch = !meta.targetRole || serverMeta.role === meta.targetRole;
                if (roleMatch) {
                  newProgress = true;
                  shouldUpdate = true;
                }
              }
            } else if (objType === "trace_connection") {
              // G6: strict-only before; unbound objectives could never complete.
              if (matchesEntity(objective as any, serverId, "serverId")) {
                newProgress = true;
                shouldUpdate = true;
              }
            }

            if (shouldUpdate) {
              if (delta !== null) {
                await this.missionService.creditObjective(
                  userId,
                  mission.missionId,
                  objective.id,
                  delta,
                );
              } else {
                await this.missionService.updateObjective(
                  userId,
                  mission.missionId,
                  objective.id,
                  newProgress,
                );
              }
            }
          }
        }
      },
      context: "onServerConnect",
      logger: this.logger,
      silent: true,
    })();
  }

  /**
   * Handle forum post event
   * Updates objectives: post to forum, reply to thread, etc.
   */
  public async onForumActivity(
    userId: string,
    activityType: "post" | "reply",
    _forumId: string,
    threadId?: string,
  ): Promise<void> {
    await safeExecute({
      fn: async () => {
        const missions = await this.missionService.getPlayerMissions(userId);
        const activeMissions = missions.filter((m: any) => m.status === "active");

        for (const mission of activeMissions) {
          if (!mission.objectives || !Array.isArray(mission.objectives)) continue;

          for (const objective of mission.objectives) {
            let shouldUpdate = false;
            let newProgress: number | string | boolean = objective.current;
            // D3 pass 2: counts are credited as a DELTA, not an absolute
            // computed from `objective.current` — that read sits outside any
            // lock, so two concurrent credits collapsed into one.
            let delta: number | null = null;

            const objType = objective.type as string;

            if (objType === "forum_post") {
              if (activityType === "post") {
                delta = 1;
                shouldUpdate = true;
              }
            } else if (objType === "forum_reply") {
              if (
                activityType === "reply" &&
                matchesEntity(objective, threadId, "threadId", "postId")
              ) {
                newProgress = true;
                shouldUpdate = true;
              }
            } else if (objType === "forum_interaction") {
              delta = 1;
              shouldUpdate = true;
            }

            if (shouldUpdate) {
              if (delta !== null) {
                await this.missionService.creditObjective(
                  userId,
                  mission.missionId,
                  objective.id,
                  delta,
                );
              } else {
                await this.missionService.updateObjective(
                  userId,
                  mission.missionId,
                  objective.id,
                  newProgress,
                );
              }
            }
          }
        }
      },
      context: "onForumActivity",
      logger: this.logger,
      silent: true,
    })();
  }

  /**
   * Handle skill level up event
   * Updates objectives: reach skill level, gain XP, etc.
   */
  public async onSkillUpdate(
    userId: string,
    skillName: string,
    newLevel: number,
    xpGained: number,
  ): Promise<void> {
    await safeExecute({
      fn: async () => {
        const missions = await this.missionService.getPlayerMissions(userId);
        const activeMissions = missions.filter((m: any) => m.status === "active");

        for (const mission of activeMissions) {
          if (!mission.objectives || !Array.isArray(mission.objectives)) continue;

          for (const objective of mission.objectives) {
            let shouldUpdate = false;
            let newProgress: number | string | boolean = objective.current;
            // D3 pass 2: counts are credited as a DELTA, not an absolute
            // computed from `objective.current` — that read sits outside any
            // lock, so two concurrent credits collapsed into one.
            let delta: number | null = null;

            const objType = objective.type as string;

            if (objType === "skill_level") {
              if (
                (objective as any).metadata?.skill === skillName &&
                newLevel >= (objective.target as number)
              ) {
                newProgress = newLevel;
                shouldUpdate = true;
              }
            } else if (objType === "gain_xp") {
              delta = xpGained;
              shouldUpdate = true;
            }

            if (shouldUpdate) {
              if (delta !== null) {
                await this.missionService.creditObjective(
                  userId,
                  mission.missionId,
                  objective.id,
                  delta,
                );
              } else {
                await this.missionService.updateObjective(
                  userId,
                  mission.missionId,
                  objective.id,
                  newProgress,
                );
              }
            }
          }
        }
      },
      context: "onSkillUpdate",
      logger: this.logger,
      silent: true,
    })();
  }

  /**
   * Handle credits transaction event
   * Updates objectives: earn credits, spend credits, etc.
   */
  public async onCreditsTransaction(
    userId: string,
    amount: number,
    type: "earned" | "spent",
  ): Promise<void> {
    await safeExecute({
      fn: async () => {
        const missions = await this.missionService.getPlayerMissions(userId);
        const activeMissions = missions.filter((m: any) => m.status === "active");

        for (const mission of activeMissions) {
          if (!mission.objectives || !Array.isArray(mission.objectives)) continue;

          for (const objective of mission.objectives) {
            let shouldUpdate = false;
            const newProgress: number | string | boolean = objective.current;
            // D3 pass 2: counts are credited as a DELTA, not an absolute
            // computed from `objective.current` — that read sits outside any
            // lock, so two concurrent credits collapsed into one.
            let delta: number | null = null;

            const objType = objective.type as string;

            if (objType === "earn_credits") {
              if (type === "earned") {
                delta = amount;
                shouldUpdate = true;
              }
            } else if (objType === "spend_credits") {
              if (type === "spent") {
                delta = amount;
                shouldUpdate = true;
              }
            }

            if (shouldUpdate) {
              if (delta !== null) {
                await this.missionService.creditObjective(
                  userId,
                  mission.missionId,
                  objective.id,
                  delta,
                );
              } else {
                await this.missionService.updateObjective(
                  userId,
                  mission.missionId,
                  objective.id,
                  newProgress,
                );
              }
            }
          }
        }
      },
      context: "onCreditsTransaction",
      logger: this.logger,
      silent: true,
    })();
  }

  /**
   * Handle faction event
   * Updates objectives: join faction, complete faction mission, etc.
   */
  public async onFactionEvent(
    userId: string,
    eventType: "join" | "leave" | "neutral" | "mission_complete" | "reputation_gain",
    factionId: string | null,
    metadata?: any,
  ): Promise<void> {
    await safeExecute({
      fn: async () => {
        const missions = await this.missionService.getPlayerMissions(userId);
        const activeMissions = missions.filter((m: any) => m.status === "active");

        for (const mission of activeMissions) {
          if (!mission.objectives || !Array.isArray(mission.objectives)) continue;

          for (const objective of mission.objectives) {
            let shouldUpdate = false;
            let newProgress: number | string | boolean = objective.current;
            // D3 pass 2: counts are credited as a DELTA, not an absolute
            // computed from `objective.current` — that read sits outside any
            // lock, so two concurrent credits collapsed into one.
            let delta: number | null = null;

            const objType = objective.type as string;

            if (objType === "join_faction") {
              if (eventType === "join") {
                if (objective.target === true || objective.target === factionId) {
                  newProgress = true;
                  shouldUpdate = true;
                }
              }
            } else if (objType === "faction_choice") {
              if (eventType === "join" || eventType === "neutral") {
                newProgress = true;
                shouldUpdate = true;
              }
            } else if (objType === "faction_reputation") {
              if (
                eventType === "reputation_gain" &&
                (objective as any).metadata?.factionId === factionId
              ) {
                delta = (metadata?.amount || 0);
                shouldUpdate = true;
              }
            } else if (objType === "faction_mission") {
              if (
                eventType === "mission_complete" &&
                (objective as any).metadata?.factionId === factionId
              ) {
                delta = 1;
                shouldUpdate = true;
              }
            }

            if (shouldUpdate) {
              if (delta !== null) {
                await this.missionService.creditObjective(
                  userId,
                  mission.missionId,
                  objective.id,
                  delta,
                );
              } else {
                await this.missionService.updateObjective(
                  userId,
                  mission.missionId,
                  objective.id,
                  newProgress,
                );
              }
            }
          }
        }
      },
      context: "onFactionEvent",
      logger: this.logger,
      silent: true,
    })();
  }

  // ==================== UTILITY METHODS ====================

  // REMOVED 2026-10-07: `checkAllActiveMissions`, and with it `sendNotification`
  // and `validateMissionObjectives`. All three were transitively dead and —
  // checked before deleting — none carried functionality that is now lost:
  //
  //  - Expiry + notify is covered by the live path. `startExpirationChecker`
  //    runs the sweep, and `expireMission` emits `mission:expired` itself
  //    (missionService.ts:1752, :1804), which the client handles
  //    (client/src/services/socket.ts:751). `sendNotification`'s only type in
  //    use was "mission_expired" — a duplicate of that.
  //  - `validateMissionObjectives` was a PURE READ whose result was DISCARDED
  //    at its one call site. It re-projected `{completed, progress}` out of
  //    `getPlayerMissions`, which already returns exactly those fields. Calling
  //    it had no effect of any kind.
  //
  // The other three `sendNotification` types — objective_complete,
  // mission_complete, mission_available — were enum values no caller ever
  // passed, so they were aspiration rather than behaviour.

  // ==================== FACTION KNOWLEDGE TRACKING ====================

  /**
   * Extract server/file targets from mission objectives and feed them into faction knowledge.
   * Called after a mission is completed — the targets the player interacted with become faction intel.
   */
  private async trackMissionKnowledge(
    factionId: string,
    userId: string,
    objectives: Array<{ type: string; metadata?: Record<string, unknown> }>,
  ): Promise<void> {
    if (!this.factionKnowledge) return;

    for (const obj of objectives) {
      const meta = obj.metadata || {};

      // Track servers referenced in objectives
      if (meta.serverId && typeof meta.serverId === "string") {
        await this.factionKnowledge.addEntry(factionId, {
          assetType: "server",
          assetId: meta.serverId as string,
          assetMeta: {
            name: meta.serverName || null,
            ip: meta.serverIp || null,
            serverType: meta.serverType || null,
            fromMissionObjective: obj.type,
          },
          source: "mission_completion",
          confidence: 0.9,
          discoveredBy: userId,
        });
      }

      // Track files referenced in objectives
      if (meta.fileId && typeof meta.fileId === "string") {
        await this.factionKnowledge.addEntry(factionId, {
          assetType: "file",
          assetId: meta.fileId as string,
          assetMeta: {
            name: meta.fileName || null,
            serverId: meta.serverId || null,
            fromMissionObjective: obj.type,
          },
          source: "mission_completion",
          confidence: 0.9,
          discoveredBy: userId,
        });
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // New System Integration Hooks
  // ══════════════════════════════════════════════════════════════════

  /**
   * Handle successful decode command
   * Updates objectives: decode_content
   */
  public async onDecodeSuccess(
    userId: string,
    encoding: string,
    _decodedText: string,
  ): Promise<void> {
    await safeExecute({
      fn: async () => {
        const missions = await this.missionService.getPlayerMissions(userId);
        const activeMissions = missions.filter((m: any) => m.status === "active");

        for (const mission of activeMissions) {
          if (!mission.objectives || !Array.isArray(mission.objectives)) continue;

          for (const objective of mission.objectives) {
            if ((objective.type as string) !== "decode_content") continue;
            const meta = (objective as any).metadata;
            if (!meta?.encoding || meta.encoding === encoding) {
              await this.missionService.updateObjective(userId, mission.missionId, objective.id, true);
            }
          }
        }
      },
      context: "onDecodeSuccess",
      logger: this.logger,
      silent: true,
    })();
  }

  /**
   * Handle defense purchase/upgrade
   * Updates objectives: defend_home
   */
  public async onDefenseEvent(
    userId: string,
    defenseType: string,
    level: number,
  ): Promise<void> {
    await safeExecute({
      fn: async () => {
        const missions = await this.missionService.getPlayerMissions(userId);
        const activeMissions = missions.filter((m: any) => m.status === "active");

        for (const mission of activeMissions) {
          if (!mission.objectives || !Array.isArray(mission.objectives)) continue;

          for (const objective of mission.objectives) {
            if ((objective.type as string) !== "defend_home") continue;
            const meta = (objective as any).metadata;
            if (!meta?.defenseType || meta.defenseType === defenseType) {
              if (!meta?.minLevel || level >= meta.minLevel) {
                await this.missionService.updateObjective(userId, mission.missionId, objective.id, true);
              }
            }
          }
        }
      },
      context: "onDefenseEvent",
      logger: this.logger,
      silent: true,
    })();
  }

  /**
   * Handle bounty completion
   * Updates objectives: claim_bounty
   */
  public async onBountyCompleted(
    userId: string,
    targetFactionId?: string,
  ): Promise<void> {
    await safeExecute({
      fn: async () => {
        const missions = await this.missionService.getPlayerMissions(userId);
        const activeMissions = missions.filter((m: any) => m.status === "active");

        for (const mission of activeMissions) {
          if (!mission.objectives || !Array.isArray(mission.objectives)) continue;

          for (const objective of mission.objectives) {
            if ((objective.type as string) !== "claim_bounty") continue;
            const meta = (objective as any).metadata;
            if (!meta?.targetFactionId || meta.targetFactionId === targetFactionId) {
              await this.missionService.updateObjective(userId, mission.missionId, objective.id, true);
            }
          }
        }
      },
      context: "onBountyCompleted",
      logger: this.logger,
      silent: true,
    })();
  }

  /**
   * Handle trace evasion success
   * Updates objectives: survive_trace
   */
  public async onTraceEvaded(userId: string): Promise<void> {
    await safeExecute({
      fn: async () => {
        const missions = await this.missionService.getPlayerMissions(userId);
        const activeMissions = missions.filter((m: any) => m.status === "active");

        for (const mission of activeMissions) {
          if (!mission.objectives || !Array.isArray(mission.objectives)) continue;

          for (const objective of mission.objectives) {
            if ((objective.type as string) !== "survive_trace") continue;
            // D3 pass 2: credited as a DELTA — the old absolute was computed
            // from an `objective.current` read outside any lock.
            await this.missionService.creditObjective(userId, mission.missionId, objective.id, 1);
          }
        }
      },
      context: "onTraceEvaded",
      logger: this.logger,
      silent: true,
    })();
  }

  /**
   * Handle subnet command usage
   * Updates objectives: scan_subnet
   */
  public async onSubnetUsed(userId: string): Promise<void> {
    await safeExecute({
      fn: async () => {
        const missions = await this.missionService.getPlayerMissions(userId);
        const activeMissions = missions.filter((m: any) => m.status === "active");

        for (const mission of activeMissions) {
          if (!mission.objectives || !Array.isArray(mission.objectives)) continue;

          for (const objective of mission.objectives) {
            if ((objective.type as string) !== "scan_subnet") continue;
            // D3 pass 2: credited as a DELTA — the old absolute was computed
            // from an `objective.current` read outside any lock.
            await this.missionService.creditObjective(userId, mission.missionId, objective.id, 1);
          }
        }
      },
      context: "onSubnetUsed",
      logger: this.logger,
      silent: true,
    })();
  }

  /**
   * Handle intel report submission
   * Updates objectives: report_intel
   */
  public async onReportSubmitted(
    userId: string,
    reportType: "server" | "file" | "mission",
  ): Promise<void> {
    await safeExecute({
      fn: async () => {
        const missions = await this.missionService.getPlayerMissions(userId);
        const activeMissions = missions.filter((m: any) => m.status === "active");

        for (const mission of activeMissions) {
          if (!mission.objectives || !Array.isArray(mission.objectives)) continue;

          for (const objective of mission.objectives) {
            if ((objective.type as string) !== "report_intel") continue;
            const meta = (objective as any).metadata;
            if (!meta?.reportType || meta.reportType === reportType) {
              // D3 pass 2: credited as a DELTA — the old absolute was computed
            // from an `objective.current` read outside any lock.
              await this.missionService.creditObjective(userId, mission.missionId, objective.id, 1);
            }
          }
        }
      },
      context: "onReportSubmitted",
      logger: this.logger,
      silent: true,
    })();
  }
}

// Export for type usage
export default MissionIntegrationService;
