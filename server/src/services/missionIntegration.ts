import { injectable, inject } from "tsyringe";
import { MISSION_SERVICE, LOGGER, FACTION_KNOWLEDGE_SERVICE } from "../di/tokens";
import MissionService from "./missionService";
import type { Logger } from "pino";
import { Server as SocketIOServer } from "socket.io";
import type { FactionKnowledgeService } from "./factionKnowledgeService";

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
    try {
      const hackObjectiveTypes = ["hack", "hack_target", "hack_stealth", "hack_method", "gain_access", "install_backdoor"];
      const activeMissions = await this.getActiveMissionsWithObjectiveTypes(userId, hackObjectiveTypes);

      for (const mission of activeMissions) {
        for (const objective of mission.objectives) {
          let shouldUpdate = false;
          let newProgress: number | string | boolean = objective.current;

          const objType = objective.type as string;

          if (objType === "hack") {
            // Generic hack objective - count all successful hacks
            if (success) {
              newProgress = (objective.current as number) + 1;
              shouldUpdate = true;
            }
          } else if (objType === "hack_target") {
            // Specific target hack
            if (success && objective.target === targetId) {
              newProgress = true;
              shouldUpdate = true;
            }
          } else if (objType === "hack_stealth") {
            // Stealth hack (not detected)
            if (success && !detected) {
              newProgress = (objective.current as number) + 1;
              shouldUpdate = true;
            }
          } else if (objType === "hack_method") {
            // Specific hack method
            if (success && (objective as any).metadata?.method === method) {
              newProgress = (objective.current as number) + 1;
              shouldUpdate = true;
            }
          } else if (objType === "gain_access") {
            // Gain access level
            if (
              success &&
              accessLevel >= ((objective as any).metadata?.minLevel || 1)
            ) {
              newProgress = true;
              shouldUpdate = true;
            }
          } else if (objType === "install_backdoor") {
            // Install backdoor on specific server (method must be backdoor or rootkit)
            if (
              success &&
              (method === "backdoor" || method === "rootkit") &&
              (!objective.target || objective.target === targetId)
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
    } catch (error) {
      this.logger.error(
        { err: error, userId, targetId, hook: "onHackComplete" },
        "Mission integration error",
      );
    }
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
    try {
      const missions = await this.missionService.getPlayerMissions(userId);
      const activeMissions = missions.filter((m: any) => m.status === "active");

      for (const mission of activeMissions) {
        if (!mission.objectives || !Array.isArray(mission.objectives)) continue;

        for (const objective of mission.objectives) {
          let shouldUpdate = false;
          let newProgress: number | string | boolean = objective.current;

          const objType = objective.type as string;

          if (objType === "steal") {
            // Steal specific file
            if (operation === "download" && objective.target === fileId) {
              newProgress = true;
              shouldUpdate = true;
            }
          } else if (objType === "steal_count") {
            // Steal multiple files
            if (operation === "download") {
              newProgress = (objective.current as number) + 1;
              shouldUpdate = true;
            }
          } else if (objType === "upload_file") {
            // Upload file to specific server
            if (
              operation === "upload" &&
              (objective as any).metadata?.serverId === serverId
            ) {
              newProgress = true;
              shouldUpdate = true;
            }
          } else if (objType === "delete_file") {
            // Delete specific file
            if (operation === "delete" && objective.target === fileId) {
              newProgress = true;
              shouldUpdate = true;
            }
          } else if (objType === "download_file") {
            // Download specific file to home server
            if (operation === "download") {
              const meta = (objective as any).metadata;
              if (meta?.fileId === fileId || !meta?.fileId) {
                newProgress = true;
                shouldUpdate = true;
              }
            }
          } else if (objType === "exfiltrate_data") {
            // Download specific file from a specific server
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
    } catch (error) {
      this.logger.error(
        { err: error, userId, operation, fileId, hook: "onFileOperation" },
        "Mission integration error",
      );
    }
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
    try {
      const missions = await this.missionService.getPlayerMissions(userId);
      const activeMissions = missions.filter((m: any) => m.status === "active");

      for (const mission of activeMissions) {
        if (!mission.objectives || !Array.isArray(mission.objectives)) continue;

        for (const objective of mission.objectives) {
          let shouldUpdate = false;
          let newProgress: number | string | boolean = objective.current;

          const objType = objective.type as string;

          if (objType === "message") {
            // Send any message
            newProgress = (objective.current as number) + 1;
            shouldUpdate = true;
          } else if (objType === "contact_player") {
            // Contact specific player
            if (objective.target === recipientId) {
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
    } catch (error) {
      this.logger.error(
        { err: error, userId, recipientId, hook: "onMessageSent" },
        "Mission integration error",
      );
    }
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
    try {
      const missions = await this.missionService.getPlayerMissions(userId);
      const activeMissions = missions.filter((m: any) => m.status === "active");

      for (const mission of activeMissions) {
        if (!mission.objectives || !Array.isArray(mission.objectives)) continue;

        for (const objective of mission.objectives) {
          let shouldUpdate = false;
          let newProgress: number | string | boolean = objective.current;

          const objType = objective.type as string;

          if (objType === "explore") {
            // Connect to any server
            newProgress = (objective.current as number) + 1;
            shouldUpdate = true;
          } else if (objType === "connect_server") {
            // Connect to specific server
            if (objective.target === serverId) {
              newProgress = true;
              shouldUpdate = true;
            }
          } else if (objType === "discover_server_type") {
            // Discover specific server type
            if ((objective as any).metadata?.serverType === serverType) {
              newProgress = (objective.current as number) + 1;
              shouldUpdate = true;
            }
          } else if (objType === "infiltrate_network") {
            // Reach a server deep inside a specific network
            const meta = (objective as any).metadata;
            if (
              serverMeta?.networkId &&
              meta?.networkId === serverMeta.networkId
            ) {
              // Check optional targetRole constraint
              const roleMatch = !meta.targetRole || serverMeta.role === meta.targetRole;
              if (roleMatch) {
                newProgress = true;
                shouldUpdate = true;
              }
            }
          } else if (objType === "trace_connection") {
            // Discover a specific server by following network clues
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
    } catch (error) {
      this.logger.error(
        { err: error, userId, serverId, hook: "onServerConnect" },
        "Mission integration error",
      );
    }
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
    try {
      const missions = await this.missionService.getPlayerMissions(userId);
      const activeMissions = missions.filter((m: any) => m.status === "active");

      for (const mission of activeMissions) {
        if (!mission.objectives || !Array.isArray(mission.objectives)) continue;

        for (const objective of mission.objectives) {
          let shouldUpdate = false;
          let newProgress: number | string | boolean = objective.current;

          const objType = objective.type as string;

          if (objType === "forum_post") {
            // Make any forum post
            if (activityType === "post") {
              newProgress = (objective.current as number) + 1;
              shouldUpdate = true;
            }
          } else if (objType === "forum_reply") {
            // Reply to specific thread
            if (activityType === "reply" && objective.target === threadId) {
              newProgress = true;
              shouldUpdate = true;
            }
          } else if (objType === "forum_interaction") {
            // Any forum interaction
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
    } catch (error) {
      this.logger.error(
        { err: error, userId, activityType, hook: "onForumActivity" },
        "Mission integration error",
      );
    }
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
    try {
      const missions = await this.missionService.getPlayerMissions(userId);
      const activeMissions = missions.filter((m: any) => m.status === "active");

      for (const mission of activeMissions) {
        if (!mission.objectives || !Array.isArray(mission.objectives)) continue;

        for (const objective of mission.objectives) {
          let shouldUpdate = false;
          let newProgress: number | string | boolean = objective.current;

          const objType = objective.type as string;

          if (objType === "skill_level") {
            // Reach specific skill level
            if (
              (objective as any).metadata?.skill === skillName &&
              newLevel >= (objective.target as number)
            ) {
              newProgress = newLevel;
              shouldUpdate = true;
            }
          } else if (objType === "gain_xp") {
            // Gain XP
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
    } catch (error) {
      this.logger.error(
        { err: error, userId, skillName, hook: "onSkillUpdate" },
        "Mission integration error",
      );
    }
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
    try {
      const missions = await this.missionService.getPlayerMissions(userId);
      const activeMissions = missions.filter((m: any) => m.status === "active");

      for (const mission of activeMissions) {
        if (!mission.objectives || !Array.isArray(mission.objectives)) continue;

        for (const objective of mission.objectives) {
          let shouldUpdate = false;
          let newProgress: number | string | boolean = objective.current;

          const objType = objective.type as string;

          if (objType === "earn_credits") {
            // Earn credits
            if (type === "earned") {
              newProgress = (objective.current as number) + amount;
              shouldUpdate = true;
            }
          } else if (objType === "spend_credits") {
            // Spend credits
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
    } catch (error) {
      this.logger.error(
        { err: error, userId, amount, type, hook: "onCreditsTransaction" },
        "Mission integration error",
      );
    }
  }

  /**
   * Handle faction event
   * Updates objectives: join faction, complete faction mission, etc.
   */
  public async onFactionEvent(
    userId: string,
    eventType: "join" | "leave" | "mission_complete" | "reputation_gain",
    factionId: string,
    metadata?: any,
  ): Promise<void> {
    try {
      const missions = await this.missionService.getPlayerMissions(userId);
      const activeMissions = missions.filter((m: any) => m.status === "active");

      for (const mission of activeMissions) {
        if (!mission.objectives || !Array.isArray(mission.objectives)) continue;

        for (const objective of mission.objectives) {
          let shouldUpdate = false;
          let newProgress: number | string | boolean = objective.current;

          const objType = objective.type as string;

          if (objType === "join_faction") {
            // Join specific faction
            if (eventType === "join" && objective.target === factionId) {
              newProgress = true;
              shouldUpdate = true;
            }
          } else if (objType === "faction_reputation") {
            // Gain faction reputation
            if (
              eventType === "reputation_gain" &&
              (objective as any).metadata?.factionId === factionId
            ) {
              newProgress =
                (objective.current as number) + (metadata?.amount || 0);
              shouldUpdate = true;
            }
          } else if (objType === "faction_mission") {
            // Complete faction mission
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
    } catch (error) {
      this.logger.error(
        { err: error, userId, eventType, factionId, hook: "onFactionEvent" },
        "Mission integration error",
      );
    }
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
    try {
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
    } catch (error) {
      this.logger.error(
        { err: error, userId, missionId, hook: "validateMissionObjectives" },
        "Mission integration error",
      );
      return [];
    }
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
    try {
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
    } catch (error) {
      this.logger.error(
        { err: error, userId, hook: "checkAllActiveMissions" },
        "Mission integration error",
      );
    }
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
    try {
      const missions = await this.missionService.getPlayerMissions(userId);
      const activeMissions = missions.filter((m: any) => m.status === "active");

      for (const mission of activeMissions) {
        if (!mission.objectives || !Array.isArray(mission.objectives)) continue;

        for (const objective of mission.objectives) {
          if ((objective.type as string) !== "decode_content") continue;
          const meta = (objective as any).metadata;
          // Match if encoding matches or no specific encoding required
          if (!meta?.encoding || meta.encoding === encoding) {
            await this.missionService.updateObjective(userId, mission.missionId, objective.id, true);
          }
        }
      }
    } catch (error) {
      this.logger.error({ err: error, userId, hook: "onDecodeSuccess" }, "Mission integration error");
    }
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
    try {
      const missions = await this.missionService.getPlayerMissions(userId);
      const activeMissions = missions.filter((m: any) => m.status === "active");

      for (const mission of activeMissions) {
        if (!mission.objectives || !Array.isArray(mission.objectives)) continue;

        for (const objective of mission.objectives) {
          if ((objective.type as string) !== "defend_home") continue;
          const meta = (objective as any).metadata;
          // Match if defense type matches (or any defense)
          if (!meta?.defenseType || meta.defenseType === defenseType) {
            if (!meta?.minLevel || level >= meta.minLevel) {
              await this.missionService.updateObjective(userId, mission.missionId, objective.id, true);
            }
          }
        }
      }
    } catch (error) {
      this.logger.error({ err: error, userId, hook: "onDefenseEvent" }, "Mission integration error");
    }
  }

  /**
   * Handle bounty completion
   * Updates objectives: claim_bounty
   */
  public async onBountyCompleted(
    userId: string,
    targetFactionId?: string,
  ): Promise<void> {
    try {
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
    } catch (error) {
      this.logger.error({ err: error, userId, hook: "onBountyCompleted" }, "Mission integration error");
    }
  }

  /**
   * Handle trace evasion success
   * Updates objectives: survive_trace
   */
  public async onTraceEvaded(userId: string): Promise<void> {
    try {
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
    } catch (error) {
      this.logger.error({ err: error, userId, hook: "onTraceEvaded" }, "Mission integration error");
    }
  }

  /**
   * Handle subnet command usage
   * Updates objectives: scan_subnet
   */
  public async onSubnetUsed(userId: string): Promise<void> {
    try {
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
    } catch (error) {
      this.logger.error({ err: error, userId, hook: "onSubnetUsed" }, "Mission integration error");
    }
  }
}

// Export for type usage
export default MissionIntegrationService;
