import { injectable, inject } from "tsyringe";
import { MISSION_SERVICE, GAME_STATE_MANAGER } from "../di/tokens";
import MissionService from "./missionService";
import type GameStateManager from "./gameStateManager";
import { Server as SocketIOServer } from "socket.io";

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

  constructor(
    @inject(MISSION_SERVICE) private missionService: MissionService,
    @inject(GAME_STATE_MANAGER) _gameStateManager: GameStateManager,
  ) {}

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
      const missions = await this.missionService.getPlayerMissions(userId);
      const activeMissions = missions.filter((m: any) => m.status === "active");

      for (const mission of activeMissions) {
        if (!mission.objectives || !Array.isArray(mission.objectives)) continue;

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
      // Silent error - mission tracking shouldn't break gameplay
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
      // Silent error
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
      // Silent error
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
      // Silent error
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
      // Silent error
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
      // Silent error
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
      // Silent error
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
      // Silent error
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
      return [];
    }
  }

  /**
   * Send mission notification to player
   */
  private async sendNotification(
    userId: string,
    type: "objective_complete" | "mission_complete" | "mission_available",
    data: any,
  ): Promise<void> {
    if (!this.io) return;

    this.io.to(`user:${userId}`).emit("mission:notification", {
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
          await this.sendNotification(userId, "mission_complete", {
            missionId: mission.missionId,
            status: "expired",
            message: `Mission "${(mission as any).title}" has expired`,
          });
        }

        // Validate objectives
        await this.validateMissionObjectives(userId, mission.missionId);
      }
    } catch (error) {
      // Silent error
    }
  }
}

// Export for type usage
export default MissionIntegrationService;
