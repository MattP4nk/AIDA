import { injectable, inject } from "tsyringe";
import { MISSION_SERVICE, LOGGER, FACTION_KNOWLEDGE_SERVICE } from "../di/tokens";
import MissionService from "./missionService";
import type { Logger } from "pino";
import { Server as SocketIOServer } from "socket.io";
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

interface ObjectiveValidationResult {
  missionId: string;
  objectiveId: string;
  completed: boolean;
  progress: number | string | boolean;
}

@injectable()
export class MissionIntegrationService {
  private io: SocketIOServer | null = null;
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

  /**
   * Set Socket.IO instance for real-time notifications
   */
  public setSocketIO(io: SocketIOServer): void {
    this.io = io;
    this.missionService.setSocketIO(io);
  }

  // ==================== EVENT HANDLERS ====================

  /**
   * Handle hack completion event
   * Updates objectives: hack count, target hacks, stealth hacks, etc.
   */
  public async onHackComplete(
    userId: string,
    targetId: string,
    success: boolean,
    detected: boolean,
    accessLevel: number,
    method: string,
  ): Promise<void> {
    await safeExecute({
      fn: async () => {
        const hackObjectiveTypes = ["hack", "hack_target", "hack_stealth", "hack_method", "gain_access", "install_backdoor"];
        const activeMissions = await this.getActiveMissionsWithObjectiveTypes(userId, hackObjectiveTypes);

        for (const mission of activeMissions) {
          for (const objective of mission.objectives) {
            let shouldUpdate = false;
            let newProgress: number | string | boolean = objective.current;

            const objType = objective.type as string;

            if (objType === "hack") {
              if (success) {
                newProgress = (objective.current as number) + 1;
                shouldUpdate = true;
              }
            } else if (objType === "hack_target") {
              if (success && matchesEntity(objective, targetId, "serverId")) {
                newProgress = true;
                shouldUpdate = true;
              }
            } else if (objType === "hack_stealth") {
              if (success && !detected) {
                newProgress = (objective.current as number) + 1;
                shouldUpdate = true;
              }
            } else if (objType === "hack_method") {
              if (success && (objective as any).metadata?.method === method) {
                newProgress = (objective.current as number) + 1;
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
            } else if (objType === "install_backdoor") {
              if (
                success &&
                (method === "backdoor" || method === "rootkit") &&
                matchesEntity(objective, targetId, "serverId")
              ) {
                newProgress = true;
                shouldUpdate = true;
              }
            }

            if (shouldUpdate) {
              await this.missionService.updateObjective(
                userId,
                mission.missionId,
                objective.id,
                newProgress,
              );
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
                newProgress = (objective.current as number) + 1;
                shouldUpdate = true;
              }
            } else if (objType === "upload_file") {
              if (
                operation === "upload" &&
                (objective as any).metadata?.serverId === serverId
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
                const meta = (objective as any).metadata;
                if (meta?.fileId === fileId || !meta?.fileId) {
                  newProgress = true;
                  shouldUpdate = true;
                }
              }
            } else if (objType === "exfiltrate_data") {
              if (operation === "download") {
                const meta = (objective as any).metadata;
                if (meta?.serverId === serverId && meta?.fileId === fileId) {
                  newProgress = true;
                  shouldUpdate = true;
                }
              }
            }

            if (shouldUpdate) {
              await this.missionService.updateObjective(
                userId,
                mission.missionId,
                objective.id,
                newProgress,
              );
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

            const objType = objective.type as string;

            if (objType === "message") {
              newProgress = (objective.current as number) + 1;
              shouldUpdate = true;
            } else if (objType === "contact_player") {
              if (matchesEntity(objective, recipientId, "recipientId", "userId")) {
                newProgress = true;
                shouldUpdate = true;
              }
            }

            if (shouldUpdate) {
              await this.missionService.updateObjective(
                userId,
                mission.missionId,
                objective.id,
                newProgress,
              );
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

            const objType = objective.type as string;

            if (objType === "explore") {
              newProgress = (objective.current as number) + 1;
              shouldUpdate = true;
            } else if (objType === "connect_server") {
              if (matchesEntity(objective, serverId, "serverId")) {
                newProgress = true;
                shouldUpdate = true;
              }
            } else if (objType === "discover_server_type") {
              if ((objective as any).metadata?.serverType === serverType) {
                newProgress = (objective.current as number) + 1;
                shouldUpdate = true;
              }
            } else if (objType === "infiltrate_network") {
              const meta = (objective as any).metadata;
              if (
                serverMeta?.networkId &&
                meta?.networkId === serverMeta.networkId
              ) {
                const roleMatch = !meta.targetRole || serverMeta.role === meta.targetRole;
                if (roleMatch) {
                  newProgress = true;
                  shouldUpdate = true;
                }
              }
            } else if (objType === "trace_connection") {
              const meta = (objective as any).metadata;
              if (meta?.serverId === serverId) {
                newProgress = true;
                shouldUpdate = true;
              }
            }

            if (shouldUpdate) {
              await this.missionService.updateObjective(
                userId,
                mission.missionId,
                objective.id,
                newProgress,
              );
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

            const objType = objective.type as string;

            if (objType === "forum_post") {
              if (activityType === "post") {
                newProgress = (objective.current as number) + 1;
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
              newProgress = (objective.current as number) + 1;
              shouldUpdate = true;
            }

            if (shouldUpdate) {
              await this.missionService.updateObjective(
                userId,
                mission.missionId,
                objective.id,
                newProgress,
              );
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
              newProgress = (objective.current as number) + xpGained;
              shouldUpdate = true;
            }

            if (shouldUpdate) {
              await this.missionService.updateObjective(
                userId,
                mission.missionId,
                objective.id,
                newProgress,
              );
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
            let newProgress: number | string | boolean = objective.current;

            const objType = objective.type as string;

            if (objType === "earn_credits") {
              if (type === "earned") {
                newProgress = (objective.current as number) + amount;
                shouldUpdate = true;
              }
            } else if (objType === "spend_credits") {
              if (type === "spent") {
                newProgress = (objective.current as number) + amount;
                shouldUpdate = true;
              }
            }

            if (shouldUpdate) {
              await this.missionService.updateObjective(
                userId,
                mission.missionId,
                objective.id,
                newProgress,
              );
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
                newProgress =
                  (objective.current as number) + (metadata?.amount || 0);
                shouldUpdate = true;
              }
            } else if (objType === "faction_mission") {
              if (
                eventType === "mission_complete" &&
                (objective as any).metadata?.factionId === factionId
              ) {
                newProgress = (objective.current as number) + 1;
                shouldUpdate = true;
              }
            }

            if (shouldUpdate) {
              await this.missionService.updateObjective(
                userId,
                mission.missionId,
                objective.id,
                newProgress,
              );
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

  /**
   * Validate all objectives for a mission
   * Useful for checking mission state on reconnect or periodic validation
   */
  public async validateMissionObjectives(
    userId: string,
    missionId: string,
  ): Promise<ObjectiveValidationResult[]> {
    return (await safeExecute({
      fn: async () => {
        const missions = await this.missionService.getPlayerMissions(userId);
        const mission = missions.find((m: any) => m.missionId === missionId);

        if (!mission || !mission.objectives) {
          return [];
        }

        const results: ObjectiveValidationResult[] = [];

        for (const objective of mission.objectives) {
          results.push({
            missionId,
            objectiveId: objective.id,
            completed: objective.completed,
            progress: objective.current,
          });
        }

        return results;
      },
      context: "validateMissionObjectives",
      logger: this.logger,
      fallback: [] as ObjectiveValidationResult[],
    })()) ?? [];
  }

  /**
   * Send mission notification to player
   */
  private async sendNotification(
    userId: string,
    type:
      | "objective_complete"
      | "mission_complete"
      | "mission_available"
      | "mission_expired",
    data: any,
  ): Promise<void> {
    if (!this.io) return;

    this.io.to(`player:${userId}`).emit("mission:notification", {
      type,
      data,
      timestamp: new Date(),
    });
  }

  /**
   * Check and update all active missions for a user
   * Useful for periodic background checks
   */
  public async checkAllActiveMissions(userId: string): Promise<void> {
    await safeExecute({
      fn: async () => {
        const missions = await this.missionService.getPlayerMissions(userId);
        const activeMissions = missions.filter((m: any) => m.status === "active");

        for (const mission of activeMissions) {
          // Check expiration
          if (mission.expiresAt && new Date(mission.expiresAt) < new Date()) {
            await this.missionService.expireMission(userId, mission.missionId);
            await this.sendNotification(userId, "mission_expired", {
              missionId: mission.missionId,
              status: "expired",
              message: `Mission "${(mission as any).title}" has expired`,
            });
          }

          // Validate objectives
          await this.validateMissionObjectives(userId, mission.missionId);
        }
      },
      context: "checkAllActiveMissions",
      logger: this.logger,
      silent: true,
    })();
  }

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
            const newProgress = ((objective.current as number) || 0) + 1;
            await this.missionService.updateObjective(userId, mission.missionId, objective.id, newProgress);
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
            const newProgress = ((objective.current as number) || 0) + 1;
            await this.missionService.updateObjective(userId, mission.missionId, objective.id, newProgress);
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
              const newProgress = ((objective.current as number) || 0) + 1;
              await this.missionService.updateObjective(userId, mission.missionId, objective.id, newProgress);
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
