import { injectable, inject } from "tsyringe";
import { PrismaClient } from "@prisma/client";
import { Logger } from "pino";
import { Server as SocketIOServer } from "socket.io";
import { ServerContestInfo, FactionResources } from "../../../shared/types";
import { getService } from "../di/container";
import { LOGGER, PERSONA_SERVICE } from "../di/tokens";

/** Cost to initiate a contest */
const CONTEST_COST: Partial<FactionResources> = { credits: 500, compute: 200 };

/** Max active contests per faction */
const MAX_ACTIVE_CONTESTS = 2;

/** Minimum rank required to declare a contest */
const REQUIRED_RANK = "council_member";

@injectable()
export default class ContestService {
  private prisma: PrismaClient;
  private logger: Logger;
  private io: SocketIOServer;

  constructor(
    @inject("PrismaClient") prisma: PrismaClient,
    @inject(LOGGER) logger: Logger,
    @inject("SocketIO") io: SocketIOServer,
  ) {
    this.prisma = prisma;
    this.logger = logger;
    this.io = io;
  }

  /**
   * Declare a contest on a faction-owned server.
   */
  public async declareContest(
    userId: string,
    serverId: string,
    attackingFactionId: string,
  ): Promise<{ success: boolean; message: string; contestId?: string }> {
    // Validate attacker is a member with sufficient rank
    const membership = await this.prisma.factionMember.findUnique({
      where: { userId_factionId: { userId, factionId: attackingFactionId } },
      include: { faction: true },
    });

    if (!membership) {
      return { success: false, message: "You must be a member of the attacking faction." };
    }

    if (membership.rank !== REQUIRED_RANK) {
      return {
        success: false,
        message: `Only ${REQUIRED_RANK.toUpperCase()} rank members can declare contests.`,
      };
    }

    // Validate target server
    const server = await this.prisma.gameServer.findUnique({
      where: { id: serverId },
      include: { faction: true },
    });

    if (!server) {
      return { success: false, message: "Server not found." };
    }

    if (!server.factionId) {
      return { success: false, message: "This server is not owned by any faction." };
    }

    if (server.factionId === attackingFactionId) {
      return { success: false, message: "You cannot contest your own faction's server." };
    }

    if (server.isContested) {
      return { success: false, message: "This server is already being contested." };
    }

    // Check active contest limit
    const activeContests = await this.prisma.serverContest.count({
      where: { attackingFactionId, status: "active" },
    });

    if (activeContests >= MAX_ACTIVE_CONTESTS) {
      return {
        success: false,
        message: `Your faction already has ${MAX_ACTIVE_CONTESTS} active contests. Resolve one first.`,
      };
    }

    // Spend resources
    const { getService } = await import("../di/container");
    const resourceService = getService<import("./resourceService").default>("ResourceService");

    const canAfford = await resourceService.spendResources(attackingFactionId, CONTEST_COST);
    if (!canAfford) {
      return {
        success: false,
        message: `Insufficient resources. Contest costs ${CONTEST_COST.credits} credits and ${CONTEST_COST.compute} compute.`,
      };
    }

    // Generate contest layers based on server security
    const layers = this.generateContestLayers(server.securityLevel);

    // Create the contest
    const contest = await this.prisma.serverContest.create({
      data: {
        serverId,
        attackingFactionId,
        defendingFactionId: server.factionId,
        initiatedBy: userId,
        layers: layers as any,
        resourceCost: CONTEST_COST as any,
      },
    });

    // Mark server as contested
    await this.prisma.gameServer.update({
      where: { id: serverId },
      data: { isContested: true },
    });

    // Auto-join the initiator
    await this.prisma.contestParticipant.create({
      data: {
        contestId: contest.id,
        userId,
        factionId: attackingFactionId,
        side: "attack",
      },
    });

    // Create faction events
    await this.prisma.factionEvent.create({
      data: {
        factionId: attackingFactionId,
        eventType: "attack",
        title: "Contest Declared",
        description: `Contest declared on ${server.name} (${server.ipAddress}).`,
        impact: "neutral",
        resourceChange: CONTEST_COST as any,
      },
    });

    if (server.factionId) {
      await this.prisma.factionEvent.create({
        data: {
          factionId: server.factionId,
          eventType: "attack",
          title: "Server Under Contest!",
          description: `${membership.faction.name} is contesting ${server.name} (${server.ipAddress})!`,
          impact: "negative",
        },
      });
    }

    // Broadcast contest event
    this.io.emit("faction:contest_started", {
      contestId: contest.id,
      serverName: server.name,
      serverIp: server.ipAddress,
      attackingFaction: membership.faction.name,
      defendingFaction: server.faction?.name,
    });

    this.logger.info(
      { contestId: contest.id, serverId, attackingFactionId },
      "Contest declared",
    );

    return {
      success: true,
      message: `Contest declared on ${server.name}! Other faction members can join with 'faction contest join ${contest.id.slice(-6)}'.`,
      contestId: contest.id,
    };
  }

  /**
   * Join an active contest.
   */
  public async joinContest(
    contestId: string,
    userId: string,
    side: "attack" | "defend" | "neutral",
  ): Promise<{ success: boolean; message: string }> {
    const contest = await this.prisma.serverContest.findUnique({
      where: { id: contestId },
      include: { attackingFaction: true, defendingFaction: true },
    });

    if (!contest || contest.status !== "active") {
      return { success: false, message: "Contest not found or not active." };
    }

    // Check if already a participant
    const existing = await this.prisma.contestParticipant.findUnique({
      where: { contestId_userId: { contestId, userId } },
    });

    if (existing) {
      return { success: false, message: "You are already participating in this contest." };
    }

    // Determine faction alignment
    const membership = await this.prisma.factionMember.findFirst({
      where: { userId },
    });

    let factionId: string | null = membership?.factionId || null;

    // Validate side matches faction
    if (side === "attack" && factionId !== contest.attackingFactionId) {
      return { success: false, message: "You must be a member of the attacking faction to join as attacker." };
    }
    if (side === "defend" && factionId !== contest.defendingFactionId) {
      return { success: false, message: "You must be a member of the defending faction to join as defender." };
    }

    await this.prisma.contestParticipant.create({
      data: {
        contestId,
        userId,
        factionId,
        side,
      },
    });

    const sideName = side === "attack"
      ? contest.attackingFaction.name
      : side === "defend"
        ? contest.defendingFaction?.name || "defenders"
        : "neutral observers";

    return {
      success: true,
      message: `Joined the contest as ${side} (${sideName}).`,
    };
  }

  /**
   * Contribute decryption progress (attack side) or encryption reinforcement (defend side).
   */
  public async contribute(
    contestId: string,
    userId: string,
    amount: number,
  ): Promise<{ success: boolean; message: string; progress?: number }> {
    const contest = await this.prisma.serverContest.findUnique({
      where: { id: contestId },
    });

    if (!contest || contest.status !== "active") {
      return { success: false, message: "Contest not found or not active." };
    }

    const participant = await this.prisma.contestParticipant.findUnique({
      where: { contestId_userId: { contestId, userId } },
    });

    if (!participant) {
      return { success: false, message: "You are not participating in this contest." };
    }

    // Determine effective contribution based on side
    const effectiveAmount = participant.side === "defend" ? -amount : amount;

    // Update participant contribution
    await this.prisma.contestParticipant.update({
      where: { id: participant.id },
      data: { contribution: { increment: Math.abs(amount) } },
    });

    // Update contest progress (clamped to [0, 1])
    const newProgress = Math.max(
      0,
      Math.min(1, contest.decryptionProgress + effectiveAmount),
    );

    await this.prisma.serverContest.update({
      where: { id: contestId },
      data: { decryptionProgress: newProgress },
    });

    // Check for completion
    if (newProgress >= 1.0) {
      await this.resolveContest(contestId, contest.attackingFactionId);
      return {
        success: true,
        message: "Decryption complete! The attackers have captured the server!",
        progress: 1.0,
      };
    }

    if (newProgress <= 0.0 && contest.decryptionProgress > 0) {
      await this.resolveContest(contestId, contest.defendingFactionId || "");
      return {
        success: true,
        message: "Encryption reinforced! The defenders have repelled the attack!",
        progress: 0.0,
      };
    }

    const action = participant.side === "defend" ? "reinforced" : "decrypted";
    return {
      success: true,
      message: `Layer ${action}. Progress: ${(newProgress * 100).toFixed(1)}%`,
      progress: newProgress,
    };
  }

  /**
   * Resolve a contest — transfer server ownership if attacker wins.
   */
  public async resolveContest(
    contestId: string,
    winnerId: string,
  ): Promise<void> {
    const contest = await this.prisma.serverContest.findUnique({
      where: { id: contestId },
      include: {
        server: true,
        attackingFaction: true,
        defendingFaction: true,
      },
    });

    if (!contest) return;

    // End the contest
    await this.prisma.serverContest.update({
      where: { id: contestId },
      data: {
        status: "resolved",
        endedAt: new Date(),
        winnerId,
      },
    });

    // Un-contest the server
    await this.prisma.gameServer.update({
      where: { id: contest.serverId },
      data: { isContested: false },
    });

    // If attacker won, transfer ownership
    if (winnerId === contest.attackingFactionId) {
      await this.prisma.gameServer.update({
        where: { id: contest.serverId },
        data: { factionId: contest.attackingFactionId },
      });

      // Create events
      await this.prisma.factionEvent.create({
        data: {
          factionId: contest.attackingFactionId,
          eventType: "attack",
          title: "Server Captured!",
          description: `Successfully captured ${contest.server.name} from ${contest.defendingFaction?.name || "unknown"}.`,
          impact: "positive",
        },
      });

      if (contest.defendingFactionId) {
        await this.prisma.factionEvent.create({
          data: {
            factionId: contest.defendingFactionId,
            eventType: "attack",
            title: "Server Lost!",
            description: `${contest.server.name} was captured by ${contest.attackingFaction.name}.`,
            impact: "negative",
          },
        });
      }
    } else {
      // Defender won
      await this.prisma.factionEvent.create({
        data: {
          factionId: winnerId,
          eventType: "attack",
          title: "Server Defended!",
          description: `Successfully defended ${contest.server.name} against ${contest.attackingFaction.name}.`,
          impact: "positive",
        },
      });
    }

    // Broadcast result
    this.io.emit("faction:contest_resolved", {
      contestId,
      serverName: contest.server.name,
      winnerId,
      winnerName:
        winnerId === contest.attackingFactionId
          ? contest.attackingFaction.name
          : contest.defendingFaction?.name,
    });

    // Notify faction leaders via PersonaService (lazy resolution to avoid circular dep)
    try {
      const personaService = getService<import("./personaService").PersonaService>(PERSONA_SERVICE);
      const attackerWon = winnerId === contest.attackingFactionId;

      // Notify attacker
      await personaService.onServerContestResolved(contest.attackingFactionId, contest.serverId, attackerWon);

      // Notify defender (if any)
      if (contest.defendingFactionId) {
        await personaService.onServerContestResolved(contest.defendingFactionId, contest.serverId, !attackerWon);
      }
    } catch (error) {
      this.logger.warn({ error }, "Could not notify personas of contest resolution");
    }

    this.logger.info(
      { contestId, winnerId, serverId: contest.serverId },
      "Contest resolved",
    );
  }

  /**
   * Get active contests, optionally filtered by faction.
   */
  public async getActiveContests(
    factionId?: string,
  ): Promise<ServerContestInfo[]> {
    const where: any = { status: "active" };
    if (factionId) {
      where.OR = [
        { attackingFactionId: factionId },
        { defendingFactionId: factionId },
      ];
    }

    const contests = await this.prisma.serverContest.findMany({
      where,
      include: {
        server: true,
        attackingFaction: true,
        defendingFaction: true,
        _count: { select: { participants: true } },
      },
      orderBy: { startedAt: "desc" },
    });

    return contests.map((c) => ({
      id: c.id,
      serverId: c.serverId,
      serverName: c.server.name,
      serverIp: c.server.ipAddress,
      attackingFactionId: c.attackingFactionId,
      attackingFactionName: c.attackingFaction.name,
      defendingFactionId: c.defendingFactionId,
      defendingFactionName: c.defendingFaction?.name || null,
      status: c.status as any,
      decryptionProgress: c.decryptionProgress,
      startedAt: c.startedAt,
      participantCount: c._count.participants,
    }));
  }

  /**
   * Get a specific contest by short ID (last 6 chars).
   */
  public async findContestByShortId(
    shortId: string,
  ): Promise<string | null> {
    const contests = await this.prisma.serverContest.findMany({
      where: { status: "active" },
      select: { id: true },
    });

    const match = contests.find((c) => c.id.endsWith(shortId));
    return match?.id || null;
  }

  /**
   * Generate challenge layers for a contest based on server security level.
   */
  private generateContestLayers(
    securityLevel: number,
  ): { layer: number; type: string; difficulty: number }[] {
    const layerCount = Math.min(5, Math.max(2, Math.ceil(securityLevel / 2)));
    const types = ["firewall", "encryption", "intrusion_detection", "access_control", "data_lock"];
    const layers = [];

    for (let i = 0; i < layerCount; i++) {
      layers.push({
        layer: i + 1,
        type: types[i % types.length]!,
        difficulty: securityLevel + i,
      });
    }

    return layers;
  }
}
