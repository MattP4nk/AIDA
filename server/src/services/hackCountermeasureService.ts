/**
 * Countermeasures when a hack is detected: lockdown, traces, owner and faction
 * alerts, NPC reactions, bounties, reputation penalties.
 *
 * A8: split out of hackService.ts (2,739 lines). Code moved verbatim; the only
 * rewrites are the call paths between the pieces — see the commit.
 */
import { BOUNTY_BASE_CREDITS, BOUNTY_BASE_REP, BOUNTY_CREDITS_PER_EVIDENCE, BOUNTY_EVIDENCE_THRESHOLD, BOUNTY_EXPIRATION_H, CRITICAL_EVIDENCE_THRESHOLD } from "../config/gameBalance";
import { db } from "../database/client";
import { FACTION_KNOWLEDGE_SERVICE, FACTION_SERVICE, FORUM_SERVICE, MEMORY_SERVICE, NPC_REACTION_SERVICE, PERSONA_SERVICE, SOCKET_IO, TRACE_SERVICE } from "../di/tokens";
import { notifyUser } from "../utils/notify";
import { safeExecute } from "../utils/safeExecute";
import type { FactionKnowledgeService } from "./factionKnowledgeService";
import type { FactionService } from "./factionService";
import type ForumService from "./forumService";
import type MemoryService from "./memoryService";
import type TraceService from "./traceService";
import type { Server as SocketIOServer } from "socket.io";
import { EventEmitter } from "events";
import { injectable, inject } from "tsyringe";
import type { Logger } from "pino";
import { LOGGER } from "../di/tokens";

@injectable()
export class HackCountermeasureService extends EventEmitter {
  constructor(@inject(LOGGER) private logger: Logger) {
    super();
  }

  /**
   * Trigger countermeasures based on evidence and detection
   */
  public async triggerCounterMeasures(
    serverId: string,
    evidenceLevel: number,
    targetUserId: string,
    attackerId?: string,
  ): Promise<string[]> {
    const counterMeasures: string[] = [];

    try {
      const server = await db.client.gameServer.findUnique({
        where: { id: serverId },
        select: { id: true, name: true, factionId: true, firewallLevel: true, securityLevel: true, ipAddress: true },
      });
      if (!server) return ["error_no_server"];

      // ── Low evidence (0-30): Silent logging only ──
      if (evidenceLevel <= 30) {
        counterMeasures.push("silent_log");
        // Just logged to HackLog — no active response
      }

      // ── Medium evidence (31-60): Active monitoring + firewall bump ──
      if (evidenceLevel > 30 && evidenceLevel <= 60) {
        counterMeasures.push("active_monitor", "firewall_bump");

        // Temporarily increase firewall level (+1 for 30 min)
        await db.client.gameServer.update({
          where: { id: serverId },
          data: { firewallLevel: Math.min(10, server.firewallLevel + 1) },
        });
        // Schedule firewall reset after 30 min
        setTimeout(async () => {
          try {
            await db.client.gameServer.update({
              where: { id: serverId },
              data: { firewallLevel: server.firewallLevel },
            });
          } catch { /* server may have been deleted */ }
        }, 30 * 60 * 1000).unref?.();

        // Notify server owner if online
        await this.notifyServerOwner(targetUserId, server.name, evidenceLevel, "warning");
      }

      // ── High evidence (61-80): Defensive measures + faction alert + rep penalty ──
      if (evidenceLevel > 60 && evidenceLevel <= 80) {
        counterMeasures.push("firewall_strengthen", "faction_alert", "reputation_penalty");

        // Increase firewall by +2 for 1 hour
        await db.client.gameServer.update({
          where: { id: serverId },
          data: {
            firewallLevel: Math.min(10, server.firewallLevel + 2),
            securityLevel: Math.min(10, server.securityLevel + 1),
          },
        });
        setTimeout(async () => {
          try {
            await db.client.gameServer.update({
              where: { id: serverId },
              data: { firewallLevel: server.firewallLevel, securityLevel: server.securityLevel },
            });
          } catch { /* ignore */ }
        }, 60 * 60 * 1000).unref?.();

        // Notify owner
        await this.notifyServerOwner(targetUserId, server.name, evidenceLevel, "high");

        // Alert faction AI if server belongs to a faction
        if (server.factionId && attackerId) {
          await this.alertFactionAI(server.factionId, serverId, server.name, attackerId, evidenceLevel);
        }

        // Reputation penalty for attacker with the server's faction
        if (server.factionId && attackerId) {
          await this.applyDetectionReputationPenalty(attackerId, server.factionId, evidenceLevel);
        }

        // The owner notices and says so. Not gated on factionId: neutral and
        // training infrastructure has a sysadmin with a voice too, and that is
        // the first feedback a new player gets about being noisy.
        if (attackerId) {
          const reacted = await this.triggerNpcReaction(serverId, server.name, attackerId, evidenceLevel);
          if (reacted) counterMeasures.push("owner_contacted");
        }
      }

      // ── Critical evidence (81-100): Lockdown + trace + access revocation ──
      if (evidenceLevel > CRITICAL_EVIDENCE_THRESHOLD) {
        // R5 REVIEW: announce only what is actually done.
        //
        // This pushed "trace_initiated" and "access_revoked" before either was
        // attempted — the same lie R5 fixed for "trace_active" twenty lines
        // below, left intact here. Hack the same server twice while the first
        // trace is still running and the second is duplicate-rejected, yet the
        // defender is still told a trace was initiated. "access_revoked" was
        // also a duplicate of the "access_key_revoked" pushed at the point the
        // key is really revoked.
        counterMeasures.push("server_lockdown", "faction_alert");

        // Increase security to max for 2 hours
        await db.client.gameServer.update({
          where: { id: serverId },
          data: {
            firewallLevel: 10,
            securityLevel: Math.min(10, server.securityLevel + 2),
          },
        });
        setTimeout(async () => {
          try {
            await db.client.gameServer.update({
              where: { id: serverId },
              data: { firewallLevel: server.firewallLevel, securityLevel: server.securityLevel },
            });
          } catch { /* ignore */ }
        }, 2 * 60 * 60 * 1000).unref?.();

        // Notify owner — critical
        await this.notifyServerOwner(targetUserId, server.name, evidenceLevel, "critical");

        // Alert faction AI
        if (server.factionId && attackerId) {
          await this.alertFactionAI(server.factionId, serverId, server.name, attackerId, evidenceLevel);
        }

        // Heavy reputation penalty
        if (server.factionId && attackerId) {
          await this.applyDetectionReputationPenalty(attackerId, server.factionId, evidenceLevel);
        }

        // Owner reaction, escalated tone at this evidence level.
        if (attackerId) {
          const reacted = await this.triggerNpcReaction(serverId, server.name, attackerId, evidenceLevel);
          if (reacted) counterMeasures.push("owner_contacted");
        }

        // Revoke attacker's access key for this server (if they had one)
        if (attackerId) {
          await db.client.serverAccessKey.deleteMany({
            where: { userId: attackerId, serverId },
          });
          counterMeasures.push("access_key_revoked");
        }

        // Post a bounty on the attacker
        if (attackerId && server.factionId) {
          await this.postBounty(attackerId, server.factionId, server.name, serverId, evidenceLevel);
          counterMeasures.push("bounty_posted");
        }

        // Initiate trace via TraceService
        if (attackerId) {
          try {
            const { getService } = await import("../di/container");
            const traceService = getService<TraceService>(TRACE_SERVICE);
            // R5: this passed THREE arguments to a four-parameter method. The
            // effect was not a crash — `initiateTrace` catches its own errors
            // and returns `{ success: false }` — so `initiatedBy` got the
            // serverId, `serverId` got a NUMBER, `evidenceLevel` got undefined,
            // Prisma rejected the row, and the next line reported
            // "trace_active" regardless. Every critical-evidence hack told the
            // defender a trace had locked on while none existed, and left
            // `trace.evade` with nothing to evade.
            //
            // `targetUserId` is the server's owner — the same value the
            // correct call site above passes as `session.targetOwnerId`.
            const traceResult = await traceService.initiateTrace(
              attackerId,
              targetUserId,
              serverId,
              evidenceLevel,
            );
            if (traceResult?.success) counterMeasures.push("trace_active");

            // Register trace as passive resource drain on attacker.
            //
            // R4: this passed `serverId` into the `traceId` parameter. Both are
            // strings, so nothing complained — but the consumer was then keyed
            // `trace:<serverId>`, which `unregisterActiveTrace` (keyed
            // `trace:<traceId>`) could never have matched even once it had a
            // caller. Only register when a trace actually exists, and key it by
            // the trace we just created.
            if (traceResult?.success && traceResult.trace?.id) {
              const memoryService = getService<MemoryService>(MEMORY_SERVICE);
              memoryService.registerActiveTrace(
                attackerId,
                traceResult.trace.id,
                `Trace from ${server.name}`,
              );
            }
          } catch (err) {
            this.logger.error({ err }, "Failed to initiate trace");
          }
        }
      }

      // Create audit log entry for all detection levels
      await this.sendSecurityAlert(targetUserId, serverId, evidenceLevel,
        evidenceLevel > CRITICAL_EVIDENCE_THRESHOLD ? "critical" : evidenceLevel > 60 ? "high" : "warning");

      return counterMeasures;
    } catch (error) {
      this.logger.error({ err: error }, "Countermeasures error");
      return ["error_response"];
    }
  }

  /**
   * Notify server owner via Socket.IO if they're online.
   */
  private async notifyServerOwner(
    ownerId: string,
    serverName: string,
    evidenceLevel: number,
    severity: "warning" | "high" | "critical",
  ): Promise<void> {
    await safeExecute({
      fn: async () => {
        const { getService } = await import("../di/container");
        const io = getService<SocketIOServer>(SOCKET_IO);

        const messages: Record<string, string> = {
          warning: `[SECURITY] Suspicious activity detected on ${serverName}. Evidence: ${evidenceLevel}%`,
          high: `[ALERT] Intrusion detected on ${serverName}! Firewall strengthened. Evidence: ${evidenceLevel}%`,
          critical: `[CRITICAL] ${serverName} under attack! Server locked down. Trace initiated. Evidence: ${evidenceLevel}%`,
        };

        // Through notifyUser so it survives a reload. This is the alert
        // that most needed it: it is the owner's only warning that someone
        // is inside their server, and it was lost on refresh.
        await notifyUser(io, ownerId, {
          type: "security_alert",
          category: "security",
          title: "Security Alert",
          message: messages[severity] ?? "",
          severity,
        });
      },
      context: "Notify server owner of security alert",
      logger: this.logger,
      silent: true,
    })();
  }

  /**
   * Alert the faction AI leader about a detected intrusion on their server.
   * The AI can then generate counter-missions or post warnings.
   */
  /**
   * Let an NPC server owner respond to being breached, in character.
   *
   * Resolved lazily through the container so hackService keeps no hard
   * dependency on the reaction service, and returns false rather than throwing:
   * NPC flavour must never be able to break the hack pipeline.
   */
  private async triggerNpcReaction(
    serverId: string,
    serverName: string,
    attackerId: string,
    evidenceLevel: number,
  ): Promise<boolean> {
    try {
      const { getService } = await import("../di/container");
      const reactionService =
        getService<import("./npcReactionService").NpcReactionService>(
          NPC_REACTION_SERVICE,
        );
      return await reactionService.onIntrusionDetected({
        serverId,
        serverName,
        attackerId,
        evidenceLevel,
      });
    } catch (err) {
      this.logger.debug({ err, serverId }, "NPC reaction service unavailable");
      return false;
    }
  }

  private async alertFactionAI(
    factionId: string,
    serverId: string,
    serverName: string,
    attackerId: string,
    evidenceLevel: number,
  ): Promise<void> {
    try {
      const { getService } = await import("../di/container");
      // Typed, NOT `getService<any>`. The `any` here is what let the arity bug
      // below survive: this call passed a single object to a 4-positional
      // method, so `serverFactionId`/`attackerUserId`/`detected` were all
      // undefined and the lookup threw — meaning the faction AI never actually
      // learned about a high-evidence intrusion.
      const personaService =
        getService<import("./personaService").PersonaService>(PERSONA_SERVICE);

      // Feed knowledge to faction — they now know about the attacker
      const fkService = getService<FactionKnowledgeService>(FACTION_KNOWLEDGE_SERVICE);
      await fkService.addEntry(factionId, {
        assetType: "player",
        assetId: attackerId,
        assetMeta: {
          threat: true,
          evidenceLevel,
          targetServer: serverName,
          targetServerId: serverId,
          detectedAt: new Date().toISOString(),
        },
        source: "server_discovery",
        confidence: Math.min(1.0, evidenceLevel / 100),
        discoveredBy: "security_system",
      });

      // Notify the faction's AI leader — this can trigger a reactive mission
      await personaService.onFactionServerHacked(
        serverId,
        factionId,
        attackerId,
        true,
      );

      this.logger.info({ factionId, serverId, attackerId, evidenceLevel }, "Faction AI alerted about intrusion");
    } catch (err) {
      this.logger.error({ err }, "Failed to alert faction AI");
    }
  }

  /**
   * Post a bounty on a detected attacker. The bounty appears as a claimable task
   * for any player in good standing with the issuing faction.
   * Completion: hack the target's home server and read a proof file.
   */
  private async postBounty(
    targetUserId: string,
    factionId: string,
    serverName: string,
    serverId: string,
    evidenceLevel: number,
  ): Promise<void> {
    try {
      // Get target username for display
      const target = await db.client.user.findUnique({
        where: { id: targetUserId },
        select: { username: true },
      });
      if (!target) return;

      // Check if there's already an active bounty on this player from this faction
      const existing = await db.client.bounty.findFirst({
        where: {
          targetUserId,
          issuedByFactionId: factionId,
          status: "active",
        },
      });
      if (existing) {
        this.logger.debug({ targetUserId, factionId }, "Active bounty already exists, skipping");
        return;
      }

      // Reward scales with evidence: 81% → 1200c/6rep, 100% → 5000c/25rep.
      //
      // The 81%% figures were wrong in the previous comment (2000c/10rep). The
      // 100%% end was right, which is how it survived — anyone sanity-checking
      // the upper bound would have agreed with it.
      //
      // ORPHAN AUDIT 2026-09-24: these were five bare literals sitting under a
      // comment restating the formula, while the named constants had lived
      // unreferenced 1,800 lines away in gameBalance since they were written.
      // Editing the config did nothing. The `- 1` is exact, not a fudge: the
      // gate is "> threshold - 1", so the reward scales from the first
      // qualifying point.
      const evidenceOverThreshold = evidenceLevel - (BOUNTY_EVIDENCE_THRESHOLD - 1);
      const rewardCredits = Math.floor(
        BOUNTY_BASE_CREDITS + evidenceOverThreshold * BOUNTY_CREDITS_PER_EVIDENCE,
      );
      const rewardReputation = Math.floor(BOUNTY_BASE_REP + evidenceOverThreshold);

      // Find files the target downloaded from the breached server (stored on their home)
      const stolenFiles = await db.client.fileSystemNode.findMany({
        where: {
          server: { isPlayerHome: true, ownerId: targetUserId },
          type: "file",
          metadata: { path: ["sourceServerId"], equals: serverId },
        },
        select: { id: true, name: true },
      });
      const stolenFileIds = stolenFiles.map((f) => f.id);

      await db.client.bounty.create({
        data: {
          targetUserId,
          targetUsername: target.username,
          issuedByFactionId: factionId,
          reason: `Critical intrusion detected on ${serverName}. Evidence level: ${evidenceLevel}%`,
          rewardCredits,
          rewardReputation,
          status: "active",
          serverId,
          evidenceLevel,
          ...(stolenFileIds.length > 0 ? { stolenFileIds } : {}),
          expiresAt: new Date(Date.now() + BOUNTY_EXPIRATION_H * 60 * 60 * 1000), // 48 hours
        },
      });

      // Emit event for DynamicContentService (wanted notices on faction servers)
      this.emit("bounty:posted", {
        targetUsername: target.username,
        factionId,
        reason: `Critical intrusion detected on ${serverName}. Evidence level: ${evidenceLevel}%`,
        rewardCredits,
        rewardReputation,
        expiresAt: new Date(Date.now() + BOUNTY_EXPIRATION_H * 60 * 60 * 1000).toISOString(),
      });

      // Notify faction members via Socket.IO
      try {
        const { getService } = await import("../di/container");
        const io = getService<SocketIOServer>(SOCKET_IO);

        // Get all faction members to notify
        const members = await db.client.factionMember.findMany({
          where: { factionId },
          select: { userId: true },
        });

        for (const member of members) {
          if (member.userId !== targetUserId) {
            await notifyUser(io, member.userId, {
              type: "bounty_posted",
              category: "faction",
              title: "Bounty Posted",
              message: `BOUNTY: ${target.username} is wanted for hacking ${serverName}. Reward: ${rewardCredits}c + ${rewardReputation} rep. Use 'bounties' to view.`,
              data: { targetUserId, rewardCredits, rewardReputation },
            });
          }
        }
      } catch (err) {
        this.logger.warn({ err }, "Failed to send bounty notification to faction members");
      }

      // Post on faction forum via AI leader
      try {
        const { getService } = await import("../di/container");

        const faction = await db.client.faction.findUnique({
          where: { id: factionId },
          select: { aiPersonaId: true, name: true },
        });

        if (faction?.aiPersonaId) {
          const forumService = getService<ForumService>(FORUM_SERVICE);

          // Find faction forum
          const forum = await db.client.forum.findFirst({
            where: { factionId },
            select: { id: true },
          });

          if (forum) {
            await forumService.content.createAIPost(
              forum.id,
              faction.aiPersonaId,
              `WANTED: ${target.username}`,
              `Security breach on ${serverName}. Intruder left ${evidenceLevel}% evidence. Bounty: ${rewardCredits} credits + ${rewardReputation} reputation. Hack their home server to claim. Use 'bounties' for details.`,
            );
          }
        }
      } catch (err) {
        this.logger.warn({ err }, "Failed to post bounty notice to faction forum");
      }

      this.logger.info(
        { targetUserId, targetUsername: target.username, factionId, rewardCredits, evidenceLevel },
        "Bounty posted on detected attacker",
      );
    } catch (error) {
      this.logger.error({ err: error }, "Failed to post bounty");
    }
  }

  /**
   * Apply reputation penalty to an attacker caught hacking a faction's server.
   */
  private async applyDetectionReputationPenalty(
    attackerId: string,
    factionId: string,
    evidenceLevel: number,
  ): Promise<void> {
    await safeExecute({
      fn: async () => {
        const { getService } = await import("../di/container");
        const factionService = getService<FactionService>(FACTION_SERVICE);

        // Penalty scales with evidence: 61-80% → -5 rep, 81-100% → -15 rep
        const penalty = evidenceLevel > CRITICAL_EVIDENCE_THRESHOLD ? -15 : -5;
        await factionService.addReputation(
          attackerId,
          factionId,
          penalty,
          "Detected intrusion",
        );

        this.logger.info({ attackerId, factionId, penalty, evidenceLevel }, "Detection reputation penalty applied");
      },
      context: "Apply detection reputation penalty",
      logger: this.logger,
    })();
  }

  /**
   * An AUDIT RECORD, not a notification. The name overstates it.
   *
   * ORPHAN AUDIT 2026-09-24: this writes `game_events` directly, bypassing
   * `eventService.createEvent` and therefore `broadcastEvent`. The two
   * honeypot writers in fileService did the same thing and WERE a bug, since
   * nothing else told the owner. This one is deliberate: `notifyServerOwner`
   * (:1872, :1897, :1949) is the player-facing channel for exactly these
   * detections, and it persists through notifyUser. Routing this through
   * createEvent as well would send the owner two alerts for one intrusion.
   *
   * Left as a direct write on purpose. Do not "fix" it to match fileService.
   */
  public async sendSecurityAlert(
    userId: string,
    serverId: string,
    evidenceLevel: number,
    severity: string,
  ): Promise<void> {
    await safeExecute({
      fn: () => db.client.gameEvent.create({
        data: {
          type: "hack_detected",
          title: "Security Breach Detected",
          description: `Intrusion attempt detected on your server. Evidence level: ${evidenceLevel}%`,
          timestamp: new Date(),
          affectedUsers: [userId],
          metadata: { serverId, evidenceLevel },
          isGlobal: false,
          severity,
        },
      }),
      context: "Send security alert",
      logger: this.logger,
    })();
  }

  // ==================== LOGGING & STATISTICS ====================
}
