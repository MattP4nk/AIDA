/**
 * DarkNetDungeonService — Procedural Dark Network Dungeon Generator
 *
 * Manages the full lifecycle of procedurally generated dark network "dungeons":
 *   1. GENERATE  — Build a chain of hidden servers with escalating security
 *   2. CLUE      — Plant encrypted breadcrumb files on each hop
 *   3. RIDDLE    — Post AI-generated forum puzzles that embed the gateway IP & passkey
 *   4. CONQUER   — Detect when a player reads the vault payload and grant rewards
 *   5. CLEANUP   — Tear down conquered / expired networks
 *   6. REGEN     — Spawn a fresh dungeon so one is always active
 */

import { injectable, inject } from "tsyringe";
import type { Logger } from "pino";
import crypto from "crypto";
import { LOGGER, AI_SERVICE, EVENT_SERVICE } from "../di/tokens";
import { db } from "../database/client";
import type { AIService } from "./aiService";
import type EventService from "./eventService";
import { EventSeverity } from "../../../shared/types";
import {
  DARKNET_SERVER_THEMES,
  CRYPTIC_QUOTES,
  WORLD_BACKSTORY_SHORT,
} from "../lore/worldLore";
import { validateOrRetry } from "../utils/aiOutputValidator";

// ═══════════════════════════════════════════════════════════════════
// Constants — Procedural Generation Building Blocks
// ═══════════════════════════════════════════════════════════════════

/** Thematic name prefixes for dark networks */
const NAME_PREFIXES = [
  "Shadow",
  "Phantom",
  "Void",
  "Abyss",
  "Cipher",
  "Obsidian",
  "Null",
  "Ghost",
  "Nether",
  "Echo",
] as const;

/** Thematic name suffixes for dark networks */
const NAME_SUFFIXES = [
  "Nexus",
  "Vault",
  "Grid",
  "Labyrinth",
  "Matrix",
  "Tunnel",
  "Corridor",
  "Sanctum",
  "Depths",
  "Core",
] as const;

/** NATO-style code identifiers */
const NAME_CODES = [
  "Alpha",
  "Beta",
  "Gamma",
  "Delta",
  "Omega",
  "Sigma",
  "Theta",
  "Zeta",
  "Kappa",
  "Psi",
] as const;

/** RFC 5737 documentation IP ranges — safe for game use, never routable */
const DARKNET_IP_RANGES = ["198.51.100", "203.0.113", "192.0.2"] as const;

/** Server role definitions for each hop in the dungeon chain */
const SERVER_ROLES: ReadonlyArray<{
  role: string;
  nameTemplate: string;
  type: string;
}> = [
  { role: "gateway", nameTemplate: "Entry Point", type: "underground" },
  { role: "firewall", nameTemplate: "Firewall Node", type: "underground" },
  { role: "router", nameTemplate: "Relay", type: "underground" },
  { role: "workstation", nameTemplate: "Processing Node", type: "underground" },
  { role: "database", nameTemplate: "Data Shard", type: "underground" },
  { role: "dns", nameTemplate: "Signal Router", type: "underground" },
];

/** The terminal vault server definition */
const VAULT_ROLE = {
  role: "database",
  nameTemplate: "Vault",
  type: "underground",
} as const;

/** Weighted reward pool — higher weight = more likely */
const REWARD_TYPES: ReadonlyArray<{
  type: string;
  weight: number;
  data: Record<string, unknown>;
}> = [
  {
    type: "aida_token",
    weight: 3,
    data: { tokenName: "AIDA Signal Fragment" },
  },
  {
    type: "aida_token",
    weight: 5,
    data: { tokenName: "Envoy's Cipher Token" },
  },
  {
    type: "rare_script",
    weight: 4,
    data: { scriptName: "zero_day_exploit", credits: 10000 },
  },
  { type: "credits_cache", weight: 6, data: { amount: 25000 } },
  { type: "intel_package", weight: 4, data: { xp: 5000, skillPoints: 2 } },
];

// ═══════════════════════════════════════════════════════════════════
// Helper Utilities (module-level, pure functions)
// ═══════════════════════════════════════════════════════════════════

/** Pick a random element from a non-empty array */
function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/**
 * Weighted random selection from the reward pool.
 * Builds a cumulative-weight run and picks the first entry whose
 * cumulative weight exceeds the random roll.
 */
function pickWeightedReward(): (typeof REWARD_TYPES)[number] {
  const totalWeight = REWARD_TYPES.reduce((sum, r) => sum + r.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const reward of REWARD_TYPES) {
    roll -= reward.weight;
    if (roll <= 0) return reward;
  }
  // Fallback — should be unreachable with positive weights
  return REWARD_TYPES[REWARD_TYPES.length - 1]!;
}

/**
 * Generate a passkey in `XXX-XXX` format (6 alphanumeric chars separated by a dash).
 * Uses `crypto.randomBytes` for unpredictable output.
 */
function generatePasskey(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = crypto.randomBytes(6);
  let key = "";
  for (let i = 0; i < 6; i++) {
    key += chars[bytes[i]! % chars.length];
    if (i === 2) key += "-";
  }
  return key;
}

/**
 * Build the thematic clue content that a player finds on each intermediate server.
 * The clue reveals the next hop's IP address.
 */
function generateClueContent(
  index: number,
  nextIp: string,
  dungeonName: string,
  totalHops: number,
): string {
  return [
    `=== SIGNAL TRACE ${index + 1}/${totalHops} ===`,
    `Routing through: ${dungeonName}`,
    `Signal path fragmented. Next relay detected at:`,
    ``,
    `    > ${nextIp}`,
    ``,
    `WARNING: Elevated security protocols ahead.`,
    `Proceed with caution. Trust nothing.`,
    `=== END TRACE ===`,
  ].join("\n");
}

/**
 * Shorthand cast so we can access the not-yet-generated `darkNetInstance`
 * delegate without a compile error. The model has been added to the Prisma
 * schema but `prisma generate` hasn't been re-run yet.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prismaAny = db.client as any;

// ═══════════════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════════════

@injectable()
export class DarkNetDungeonService {
  constructor(
    @inject(LOGGER) private logger: Logger,
    @inject(AI_SERVICE) private aiService: AIService,
    @inject(EVENT_SERVICE) private eventService: EventService,
  ) {}

  // ─────────────────────────────────────────────────────────────────
  // 1. generateDungeon
  // ─────────────────────────────────────────────────────────────────

  /**
   * Procedurally generate a complete dark network dungeon.
   *
   * Creates a hidden Network, a chain of GameServers with escalating
   * security, hidden clue files on each hop, and a vault payload at the end.
   *
   * @param difficulty - Optional difficulty override (clamped 3–7). If omitted a
   *                     random value between 4 and 6 is chosen.
   * @returns The new DarkNetInstance id and the gateway IP for the entry point.
   */
  async generateDungeon(
    difficulty?: number,
  ): Promise<{ instanceId: string; gatewayIp: string }> {
    try {
      // --- a. Name ---
      const dungeonName = `${pickRandom(NAME_PREFIXES)} ${pickRandom(NAME_SUFFIXES)} ${pickRandom(NAME_CODES)}`;

      // --- b. Depth (number of intermediate hops; total servers = depth + 1) ---
      const diff = Math.max(
        3,
        Math.min(7, difficulty ?? Math.floor(Math.random() * 3) + 4),
      );
      const actualDepth = diff; // depth mirrors difficulty

      // --- c. Passkey ---
      const passkey = generatePasskey();

      // --- d. Reward ---
      const reward = pickWeightedReward();

      // --- e. IP addresses (one per server, no collisions) ---
      const ips = await this.generateUniqueIps(actualDepth + 1);

      // --- f. Network record ---
      const darknetFaction = await db.client.faction.findFirst({
        where: { shortName: "darknet" },
      });
      const darknetFactionId = darknetFaction?.id ?? null;

      const network = await db.client.network.create({
        data: {
          name: dungeonName,
          description:
            "A hidden dark network. Only those who know the passkey may enter.",
          factionId: darknetFactionId,
          zone: "darknet",
          isHidden: true,
          metadata: {
            passkey,
            difficulty: diff,
            generatedAt: new Date().toISOString(),
          },
        },
      });

      // --- g. Servers ---
      const servers: Array<{ id: string; ipAddress: string; name: string }> =
        [];

      for (let i = 0; i <= actualDepth; i++) {
        const isGateway = i === 0;
        const isVault = i === actualDepth;
        const roleInfo = isVault
          ? VAULT_ROLE
          : SERVER_ROLES[i % SERVER_ROLES.length]!;

        // Security escalates through the chain
        let serverSecurity: number;
        if (isGateway) {
          serverSecurity = Math.max(1, diff - 2);
        } else if (isVault) {
          serverSecurity = diff;
        } else {
          // Linearly interpolate from (diff - 1) at hop 1 to diff at hop depth-1
          serverSecurity = Math.max(
            1,
            diff - 1 + Math.floor(i / Math.max(1, actualDepth - 1)),
          );
        }

        const serverName = `[${dungeonName}] ${roleInfo.nameTemplate}`;

        const server = await db.client.gameServer.create({
          data: {
            name: serverName,
            ipAddress: ips[i]!,
            type: roleInfo.type,
            role: roleInfo.role,
            networkId: network.id,
            factionId: darknetFactionId,
            securityLevel: serverSecurity,
            firewallLevel: Math.max(1, serverSecurity - 1),
            encryptionLevel: isVault
              ? Math.max(1, Math.ceil(serverSecurity / 1.5))
              : Math.max(1, Math.floor(serverSecurity / 2)),
            discoveryLevel: Math.max(1, serverSecurity - 2),
            isOnline: true,
            isPublic: false,
            accessMethod: isGateway ? "keycard" : "hackable",
            accessKey: isGateway ? passkey : null,
            maxConnections: 5,
          },
        });

        servers.push({
          id: server.id,
          ipAddress: server.ipAddress,
          name: serverName,
        });
      }

      // --- h. Links (chain topology) ---
      for (let i = 0; i < servers.length - 1; i++) {
        await db.client.serverLink.create({
          data: {
            sourceId: servers[i]!.id,
            targetId: servers[i + 1]!.id,
            networkId: network.id,
            linkType: "hidden",
            bandwidth: 50,
            latency: Math.floor(Math.random() * 50) + 20,
          },
        });
      }

      // --- i. Clue files on intermediate servers ---
      await this.plantClueFiles(servers, dungeonName);

      // --- j. Populate servers with lore-rich content ---
      await this.populateServerContent(servers, dungeonName, diff);

      // --- k. Vault reward file ---
      const vaultServer = servers[servers.length - 1]!;
      await this.plantVaultReward(vaultServer.id, reward, dungeonName);

      // --- l. DarkNetInstance record ---
      const instance = await prismaAny.darkNetInstance.create({
        data: {
          name: dungeonName,
          networkId: network.id,
          gatewayIp: servers[0]!.ipAddress,
          vaultServerId: vaultServer.id,
          passkey,
          depth: actualDepth,
          difficulty: diff,
          rewardType: reward.type,
          rewardData: reward.data,
          status: "active",
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7-day TTL
        },
      });

      this.logger.info(
        {
          instanceId: instance.id,
          name: dungeonName,
          depth: actualDepth,
          difficulty: diff,
          gatewayIp: servers[0]!.ipAddress,
        },
        "Dark network dungeon generated",
      );

      // --- m. Return ---
      return { instanceId: instance.id, gatewayIp: servers[0]!.ipAddress };
    } catch (error) {
      this.logger.error(
        { err: error },
        "Failed to generate dark network dungeon",
      );
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 2. plantClueFiles
  // ─────────────────────────────────────────────────────────────────

  /**
   * Plant hidden clue files on each server (except the vault) that point
   * to the next hop in the chain.
   *
   * Each server gets a `.signal/` hidden directory containing a `trace_N.dat`
   * file. Later clues (index > 1) are encrypted, requiring the player to
   * decrypt before reading.
   *
   * @param servers     - Ordered array of servers in the dungeon chain.
   * @param dungeonName - The dungeon's display name (embedded in clue text).
   */
  private async plantClueFiles(
    servers: Array<{ id: string; ipAddress: string; name: string }>,
    dungeonName: string,
  ): Promise<void> {
    // Plant clues on every server except the last (vault)
    const totalHops = servers.length - 1;

    for (let index = 0; index < totalHops; index++) {
      const server = servers[index]!;
      const nextServer = servers[index + 1]!;

      try {
        // Ensure root directory exists
        let rootDir = await db.client.fileSystemNode.findFirst({
          where: {
            serverId: server.id,
            name: "/",
            type: "directory",
            parentId: null,
          },
        });

        if (!rootDir) {
          rootDir = await db.client.fileSystemNode.create({
            data: {
              serverId: server.id,
              name: "/",
              type: "directory",
            },
          });
        }

        // Create hidden .signal directory
        const hiddenDir = await db.client.fileSystemNode.create({
          data: {
            serverId: server.id,
            name: ".signal",
            type: "directory",
            parentId: rootDir.id,
            isHidden: true,
          },
        });

        // Build clue content and create file
        const clueContent = generateClueContent(
          index,
          nextServer.ipAddress,
          dungeonName,
          totalHops,
        );

        await db.client.fileSystemNode.create({
          data: {
            serverId: server.id,
            name: `trace_${index}.dat`,
            type: "file",
            content: clueContent,
            parentId: hiddenDir.id,
            isHidden: true,
            isEncrypted: index > 1, // later clues require decryption
            size: clueContent.length,
          },
        });
      } catch (error) {
        this.logger.error(
          { err: error, serverId: server.id, index },
          "Failed to plant clue file on server",
        );
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 3. plantVaultReward
  // ─────────────────────────────────────────────────────────────────

  /**
   * Create the reward payload file on the vault server.
   *
   * The file is visible (so players know it's there once they reach the vault)
   * but encrypted — they must decrypt it to trigger the conquest flow.
   *
   * @param vaultServerId - The vault server's database ID.
   * @param reward        - Reward descriptor (`type` + `data`).
   * @param dungeonName   - Display name for flavour text.
   * @returns The created FileSystemNode id.
   */
  private async plantVaultReward(
    vaultServerId: string,
    reward: { type: string; data: Record<string, unknown> },
    dungeonName: string,
  ): Promise<string> {
    try {
      // Ensure root directory
      let rootDir = await db.client.fileSystemNode.findFirst({
        where: {
          serverId: vaultServerId,
          name: "/",
          type: "directory",
          parentId: null,
        },
      });

      if (!rootDir) {
        rootDir = await db.client.fileSystemNode.create({
          data: {
            serverId: vaultServerId,
            name: "/",
            type: "directory",
          },
        });
      }

      const rewardDescription = this.describeReward(reward);

      const content = [
        "████████████████████████████████████████████",
        "█          VAULT ACCESS GRANTED           █",
        "████████████████████████████████████████████",
        "",
        `You've reached the heart of ${dungeonName}.`,
        "",
        "Reward secured:",
        `  ${rewardDescription}`,
        "",
        "This vault will self-destruct after retrieval.",
        "The signal shifts. A new path will emerge.",
        "",
        "    — The Architect",
        "████████████████████████████████████████████",
      ].join("\n");

      const file = await db.client.fileSystemNode.create({
        data: {
          serverId: vaultServerId,
          name: "vault_payload.enc",
          type: "file",
          content,
          parentId: rootDir.id,
          isHidden: false,
          isEncrypted: true,
          isProtected: true,
          size: content.length,
        },
      });

      return file.id;
    } catch (error) {
      this.logger.error(
        { err: error, vaultServerId },
        "Failed to plant vault reward file",
      );
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 4. postForumRiddle
  // ─────────────────────────────────────────────────────────────────

  /**
   * Post an AI-generated riddle to a random public forum.
   *
   * The riddle embeds the dungeon's gateway IP and passkey in a cryptic format,
   * challenging players to decode it and discover the dark network entry point.
   *
   * @param instanceId - The DarkNetInstance to create a riddle for.
   * @returns The forum post ID, or `null` if posting failed.
   */
  async postForumRiddle(instanceId: string): Promise<string | null> {
    try {
      // a. Find The Architect persona
      const architect = await db.client.aIPersona.findFirst({
        where: { type: "game_master" },
      });

      if (!architect) {
        this.logger.warn("No game_master persona found — cannot post riddle");
        return null;
      }

      // b. Pick a random public forum (securityLevel 1 = public)
      const publicForums = await db.client.forum.findMany({
        where: { securityLevel: 1, isActive: true },
      });

      if (publicForums.length === 0) {
        this.logger.warn("No public forums available for riddle posting");
        return null;
      }

      const forum = pickRandom(publicForums);

      // c. Look up instance details
      const instance = await prismaAny.darkNetInstance.findUnique({
        where: { id: instanceId },
      });

      if (!instance) {
        this.logger.warn(
          { instanceId },
          "DarkNetInstance not found for riddle generation",
        );
        return null;
      }

      // d. Ask the AI for a riddle
      const prompt = `You are The Architect. Create a cryptic forum post that contains hidden clues leading to a secret dark network.

The gateway IP is: ${instance.gatewayIp}
The passkey is: ${instance.passkey}

Rules:
- The post should be mysterious, cryptic, and in-character
- The IP address must be embedded in the text somehow (encoded, split across sentences, hidden in a pattern, etc.)
- The passkey must also be embedded but disguised (as an acronym, first letters, a code phrase, etc.)
- The post should feel like a puzzle that rewards careful reading
- Title should be intriguing but not obviously about the darknet
- Content should be 3-5 paragraphs

Respond ONLY with JSON:
{
  "title": "post title",
  "content": "post body with embedded clues"
}`;

      const systemPrompt =
        "You are The Architect, the omniscient game master of AIDA. You speak in riddles and metaphors. You test players by hiding secrets in plain sight.";

      const result = await this.aiService.generateResponse(
        prompt,
        systemPrompt,
        undefined,
        '{ "title": "string", "content": "string (forum riddle with disguised gateway IP and passkey)" }',
      );

      // e. Parse AI response and create forum post
      let title = `Signal from the Void — ${instance.name}`;
      let content = `The signal shifts. A new path awaits those who listen.\n\nGateway: ${instance.gatewayIp}\nKey: ${instance.passkey}`;

      const validateTitleContent = (parsed: any): { title: string; content: string } | null => {
        if (!parsed || typeof parsed !== "object") return null;
        if (typeof parsed.title !== "string" || typeof parsed.content !== "string") return null;
        if (!parsed.title.trim() || !parsed.content.trim()) return null;
        return { title: parsed.title.trim(), content: parsed.content.trim() };
      };

      // Validate riddle is solvable — IP octets and passkey segments must appear in content
      const isRiddleSolvable = (riddleContent: string, ip: string, passkey: string): boolean => {
        const lower = riddleContent.toLowerCase();
        // Check if at least 3 of 4 IP octets appear somewhere in the text
        const octets = ip.split(".");
        const octetsFound = octets.filter((o) => lower.includes(o)).length;
        // Check if passkey characters appear (at least first 3 chars as a sequence)
        const passKeyChars = passkey.toLowerCase().slice(0, 3);
        const passKeyFound = lower.includes(passKeyChars) ||
          lower.includes(passkey.toLowerCase()) ||
          lower.includes(passkey.toUpperCase());
        return octetsFound >= 3 && passKeyFound;
      };

      if (result.success) {
        const validated = validateOrRetry(result.response, validateTitleContent, this.aiService, {
          prompt,
          systemPrompt,
          expectedFormat: '{ "title": "string (non-empty)", "content": "string (non-empty, must embed IP octets and passkey)" }',
          onSuccess: async (response) => {
            try {
              const retryParsed = validateOrRetry(response, validateTitleContent);
              const inst = await prismaAny.darkNetInstance.findUnique({
                where: { id: instanceId },
              });
              if (inst?.forumClueId && retryParsed && isRiddleSolvable(retryParsed.content, instance.gatewayIp, instance.passkey)) {
                await db.client.post.update({
                  where: { id: inst.forumClueId },
                  data: {
                    title: retryParsed.title,
                    content: retryParsed.content,
                  },
                });
              }
            } catch { /* ignore retry errors */ }
          },
        });
        if (validated) {
          // Verify the riddle is solvable before using it
          if (isRiddleSolvable(validated.content, instance.gatewayIp, instance.passkey)) {
            title = validated.title;
            content = validated.content;
          } else {
            this.logger.warn("AI riddle failed solvability check — using fallback with direct clues");
            // Fallback content already has the IP and passkey in plain text
          }
        }
      } else {
        // Queue for retry if AI failed — on success, update the forum post content
        const riddleInstanceId = instanceId;
        this.aiService.queueForRetry(prompt, systemPrompt, async (response) => {
          try {
            const retryParsed = validateOrRetry(response, validateTitleContent);
            // Find the forum post linked to this instance and update it
            const inst = await prismaAny.darkNetInstance.findUnique({
              where: { id: riddleInstanceId },
            });
            if (inst?.forumClueId && retryParsed) {
              await db.client.post.update({
                where: { id: inst.forumClueId },
                data: {
                  title: retryParsed.title,
                  content: retryParsed.content,
                },
              });
            }
          } catch { /* ignore retry errors */ }
        });
      }

      // Lazy-load ForumService to avoid circular DI
      const { getService } = await import("../di/container");
      const { FORUM_SERVICE } = await import("../di/tokens");
      const forumService = getService<any>(FORUM_SERVICE);

      const post = await forumService.createAIPost(
        architect.id,
        forum.id,
        title,
        content,
      );

      // f. Link forum post back to instance
      await prismaAny.darkNetInstance.update({
        where: { id: instanceId },
        data: { forumClueId: post.id },
      });

      this.logger.info(
        { instanceId, postId: post.id, forumId: forum.id },
        "Posted dungeon riddle to forum",
      );

      return post.id;
    } catch (error) {
      this.logger.error(
        { err: error, instanceId },
        "Failed to post forum riddle",
      );
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 5. conquerVault
  // ─────────────────────────────────────────────────────────────────

  /**
   * Handle a player conquering a vault — triggered when they read the
   * `vault_payload.enc` file on a vault server.
   *
   * Marks the instance as conquered, grants the appropriate reward, records
   * a story ledger event, emits a system event, and schedules regeneration.
   *
   * @param userId        - The conquering player's ID.
   * @param vaultServerId - The vault GameServer ID they accessed.
   * @returns Whether the conquest succeeded and the reward granted.
   */
  async conquerVault(
    userId: string,
    vaultServerId: string,
  ): Promise<{ conquered: boolean; reward?: any }> {
    try {
      // a. Find active instance for this vault
      const instance = await prismaAny.darkNetInstance.findFirst({
        where: { vaultServerId, status: "active" },
      });

      // b. No active instance → nothing to conquer
      if (!instance) {
        return { conquered: false };
      }

      // c. Mark as conquered
      await prismaAny.darkNetInstance.update({
        where: { id: instance.id },
        data: {
          status: "conquered",
          conqueredBy: userId,
          conqueredAt: new Date(),
        },
      });

      // d. Grant reward
      await this.grantReward(userId, instance);

      // e. Record story ledger event (non-critical)
      try {
        const { getService } = await import("../di/container");
        const { STORY_PROGRESSION_SERVICE } = await import("../di/tokens");
        const storyService = getService<any>(STORY_PROGRESSION_SERVICE);
        await storyService.recordEvent({
          type: "fragment_found",
          category: "discovery",
          actorId: userId,
          actorType: "player",
          summary: `Player conquered dark network "${instance.name}" and claimed ${instance.rewardType} reward`,
          data: {
            instanceId: instance.id,
            rewardType: instance.rewardType,
            rewardData: instance.rewardData,
          },
          impact: { discoveryWeight: 5, tension: 2 },
          weight: 8,
        });
      } catch {
        /* story ledger is non-critical */
      }

      // f. Emit global system event
      try {
        await this.eventService.createSystemAlert(
          "Dark Network Conquered",
          "A dark network vault has been breached. The signal shifts — a new path will emerge.",
          EventSeverity.WARNING,
        );
      } catch {
        /* event emission is non-critical */
      }

      // g. Schedule regeneration (30 s delay)
      setTimeout(() => {
        this.regenerateDungeon(instance.id).catch((err: unknown) => {
          this.logger.error(
            { err, conqueredInstanceId: instance.id },
            "Failed to regenerate dungeon after conquest",
          );
        });
      }, 30_000);

      this.logger.info(
        {
          instanceId: instance.id,
          userId,
          rewardType: instance.rewardType,
        },
        "Vault conquered — reward granted",
      );

      // h. Return
      return {
        conquered: true,
        reward: {
          type: instance.rewardType,
          ...(instance.rewardData as Record<string, unknown>),
        },
      };
    } catch (error) {
      this.logger.error(
        { err: error, userId, vaultServerId },
        "Error during vault conquest",
      );
      return { conquered: false };
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 6. regenerateDungeon
  // ─────────────────────────────────────────────────────────────────

  /**
   * Tear down a conquered/expired dungeon and spin up a fresh one.
   *
   * Deletes all associated servers, links, file-system nodes, access keys,
   * connections, and the network itself, then generates a brand-new dungeon
   * and posts a riddle for it.
   *
   * @param conqueredInstanceId - The DarkNetInstance to replace.
   */
  async regenerateDungeon(conqueredInstanceId: string): Promise<void> {
    try {
      const instance = await prismaAny.darkNetInstance.findUnique({
        where: { id: conqueredInstanceId },
      });

      if (!instance) {
        this.logger.warn(
          { conqueredInstanceId },
          "Instance not found for regeneration — skipping",
        );
        return;
      }

      // Mark as regenerating while we work
      await prismaAny.darkNetInstance.update({
        where: { id: instance.id },
        data: { status: "regenerating" },
      });

      // ── Cleanup old resources ──

      // Delete file system nodes on all servers in the network
      await db.client.fileSystemNode.deleteMany({
        where: { server: { networkId: instance.networkId } },
      });

      // Delete access keys for these servers
      await db.client.serverAccessKey.deleteMany({
        where: { server: { networkId: instance.networkId } },
      });

      // Delete server connections
      await db.client.serverConnection.deleteMany({
        where: { server: { networkId: instance.networkId } },
      });

      // Delete links
      await db.client.serverLink.deleteMany({
        where: { networkId: instance.networkId },
      });

      // Delete servers
      await db.client.gameServer.deleteMany({
        where: { networkId: instance.networkId },
      });

      // Delete network
      await db.client.network.delete({
        where: { id: instance.networkId },
      });

      // Delete instance record
      await prismaAny.darkNetInstance.delete({
        where: { id: instance.id },
      });

      // ── Generate replacement ──
      const { instanceId: newInstanceId } = await this.generateDungeon();
      await this.postForumRiddle(newInstanceId);

      this.logger.info(
        {
          oldInstanceId: conqueredInstanceId,
          newInstanceId,
        },
        "Dark network dungeon regenerated",
      );
    } catch (error) {
      this.logger.error(
        { err: error, conqueredInstanceId },
        "Failed to regenerate dungeon",
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 7. getActiveDungeons
  // ─────────────────────────────────────────────────────────────────

  /**
   * Return a summary of all currently active dungeons (admin / debug).
   */
  async getActiveDungeons(): Promise<
    Array<{
      id: string;
      name: string;
      status: string;
      difficulty: number;
      gatewayIp: string;
    }>
  > {
    return prismaAny.darkNetInstance.findMany({
      where: { status: "active" },
      select: {
        id: true,
        name: true,
        status: true,
        difficulty: true,
        gatewayIp: true,
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // 8. ensureActiveDungeon
  // ─────────────────────────────────────────────────────────────────

  /**
   * Ensure at least one dungeon is active.
   *
   * Intended to be called at server startup or periodically. If no active
   * dungeon exists, one is generated and a riddle is posted for it.
   */
  async ensureActiveDungeon(): Promise<void> {
    try {
      const active = await prismaAny.darkNetInstance.count({
        where: { status: "active" },
      });

      if (active === 0) {
        const { instanceId } = await this.generateDungeon();
        await this.postForumRiddle(instanceId);
        this.logger.info("Generated initial dark network dungeon");
      }
    } catch (error) {
      this.logger.error(
        { err: error },
        "Failed to ensure an active dungeon exists",
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 9. expireOldDungeons
  // ─────────────────────────────────────────────────────────────────

  /**
   * Find and regenerate any dungeons whose TTL has elapsed.
   *
   * Should be called periodically (e.g. via a cron-style scheduler) to
   * prevent stale dungeons from lingering forever.
   */
  async expireOldDungeons(): Promise<void> {
    try {
      const expired = await prismaAny.darkNetInstance.findMany({
        where: { status: "active", expiresAt: { lt: new Date() } },
      });

      for (const instance of expired) {
        this.logger.info(
          { instanceId: instance.id, name: instance.name },
          "Expiring stale dungeon",
        );

        await prismaAny.darkNetInstance.update({
          where: { id: instance.id },
          data: { status: "expired" },
        });

        await this.regenerateDungeon(instance.id);
      }
    } catch (error) {
      this.logger.error({ err: error }, "Failed to expire old dungeons");
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────────

  /**
   * Generate `count` unique IP addresses within the dark-net documentation
   * ranges, ensuring no collisions with existing game servers.
   */
  private async generateUniqueIps(count: number): Promise<string[]> {
    const range = pickRandom(DARKNET_IP_RANGES);
    const ips: string[] = [];
    let offset = Math.floor(Math.random() * 200) + 10; // start somewhere between .10 and .210

    for (let i = 0; i < count; i++) {
      let ip: string | undefined;
      let collision = true;

      while (collision) {
        ip = `${range}.${offset}`;
        offset++;

        // Wrap around if we exceed the valid host range
        if (offset > 254) {
          offset = 2;
        }

        const existing = await db.client.gameServer.findFirst({
          where: { ipAddress: ip },
        });

        if (!existing) {
          collision = false;
          ips.push(ip);
        }
      }
    }

    return ips;
  }

  /**
   * Grant the dungeon reward to the conquering player.
   */
  private async grantReward(
    userId: string,
    instance: {
      rewardType: string;
      rewardData: unknown;
    },
  ): Promise<void> {
    try {
      if (instance.rewardType === "aida_token") {
        const tokenName = (instance.rewardData as any).tokenName;
        const shopItem = await db.client.shopItem.findFirst({
          where: { name: tokenName, itemType: "token" },
        });

        if (shopItem) {
          const existing = await db.client.inventoryItem.findFirst({
            where: { userId, shopItemId: shopItem.id },
          });

          if (existing) {
            await db.client.inventoryItem.update({
              where: { id: existing.id },
              data: { quantity: { increment: 1 } },
            });
          } else {
            await db.client.inventoryItem.create({
              data: {
                userId,
                shopItemId: shopItem.id,
                quantity: 1,
                source: "server_loot",
              },
            });
          }
        }
      } else if (instance.rewardType === "rare_script") {
        const data = instance.rewardData as any;
        const credits: number = data.credits || 10000;

        // Grant credits
        await db.client.playerProgress.update({
          where: { userId },
          data: { credits: { increment: credits } },
        });

        // Grant script item if one exists in the shop
        if (data.scriptName) {
          const scriptItem = await db.client.shopItem.findFirst({
            where: { name: data.scriptName },
          });

          if (scriptItem) {
            const existing = await db.client.inventoryItem.findFirst({
              where: { userId, shopItemId: scriptItem.id },
            });

            if (existing) {
              await db.client.inventoryItem.update({
                where: { id: existing.id },
                data: { quantity: { increment: 1 } },
              });
            } else {
              await db.client.inventoryItem.create({
                data: {
                  userId,
                  shopItemId: scriptItem.id,
                  quantity: 1,
                  source: "server_loot",
                },
              });
            }
          }
        }
      } else if (instance.rewardType === "credits_cache") {
        const amount: number = (instance.rewardData as any).amount || 10000;

        await db.client.playerProgress.update({
          where: { userId },
          data: { credits: { increment: amount } },
        });
      } else if (instance.rewardType === "intel_package") {
        const data = instance.rewardData as any;

        await db.client.playerProgress.update({
          where: { userId },
          data: {
            experience: { increment: data.xp || 0 },
            ...(data.skillPoints
              ? { skillPoints: { increment: data.skillPoints } }
              : {}),
          },
        });
      }
    } catch (error) {
      this.logger.error(
        { err: error, userId, rewardType: instance.rewardType },
        "Failed to grant dungeon reward",
      );
    }
  }

  /**
   * Return a human-readable description of a reward for display in the
   * vault payload file and conquest messages.
   */
  private describeReward(reward: {
    type: string;
    data: Record<string, unknown>;
  }): string {
    switch (reward.type) {
      case "aida_token": {
        const name = (reward.data.tokenName as string) || "Unknown Token";
        return `${name} (Communication Token)`;
      }
      case "rare_script": {
        const credits = (reward.data.credits as number) || 10000;
        const scriptName =
          (reward.data.scriptName as string) || "Unknown Script";
        const displayName = scriptName
          .replace(/_/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());
        return `${displayName} + ${credits.toLocaleString()} credits`;
      }
      case "credits_cache": {
        const amount = (reward.data.amount as number) || 10000;
        return `${amount.toLocaleString()} credits`;
      }
      case "intel_package": {
        const xp = (reward.data.xp as number) || 0;
        const sp = (reward.data.skillPoints as number) || 0;
        const parts: string[] = [];
        if (xp) parts.push(`${xp.toLocaleString()} XP`);
        if (sp) parts.push(`${sp} Skill Point${sp > 1 ? "s" : ""}`);
        return parts.join(" + ") || "Intelligence Package";
      }
      default:
        return "Unknown Reward";
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 10. populateServerContent — AI-generated lore files for each server
  // ─────────────────────────────────────────────────────────────────

  /**
   * Populate each server in the dungeon with AI-generated lore content.
   * Uses the canonical world lore and depth-tiered themes to create
   * immersive files that tell cryptic fragments of AIDA's history.
   *
   * Content is generated in parallel for speed.
   */
  private async populateServerContent(
    servers: Array<{ id: string; ipAddress: string; name: string }>,
    dungeonName: string,
    difficulty: number,
  ): Promise<void> {
    const contentPromises = servers.map(async (server, index) => {
      try {
        // Determine depth tier for this server
        const depthTier = this.getDepthTier(index, servers.length);
        const theme =
          DARKNET_SERVER_THEMES.find((t) => t.depth === depthTier) ??
          DARKNET_SERVER_THEMES[0]!;

        // Pick a random cryptic quote to embed
        const quote =
          CRYPTIC_QUOTES[Math.floor(Math.random() * CRYPTIC_QUOTES.length)]!;

        // Build the AI prompt
        const prompt = `You are generating hidden file content for a secret dark network server in a cyberpunk hacking game.

World context: ${WORLD_BACKSTORY_SHORT}

This server is: "${server.name}" (depth level: ${depthTier}, difficulty: ${difficulty}/10)
Dark network: "${dungeonName}"
Theme for this depth: ${theme.theme}
Lore context: ${theme.loreContext}

Embed this cryptic quote somewhere naturally: "${quote}"

Generate content for ${theme.fileTypes.length} files. Each file should:
- Feel like authentic server data (logs, reports, encrypted transmissions, personal notes)
- Reveal fragments of lore in a cryptic, fragmented way — never the full story
- Mix in technical jargon with narrative hints
- Some content should feel corrupted or partially redacted
- Reference The Emperor, AIDA, the factions, or the three pieces where appropriate
- Be 8-20 lines each

Respond ONLY with JSON:
{
  "files": [
    { "name": "${theme.fileTypes[0]}", "content": "file content here..." },
    { "name": "${theme.fileTypes[1] ?? "data.log"}", "content": "..." },
    { "name": "${theme.fileTypes[2] ?? "notes.txt"}", "content": "..." }
  ]
}`;

        const systemPrompt =
          "You are a content generator for a cyberpunk hacking game. " +
          "You create atmospheric, cryptic server file content that reveals " +
          "fragments of a deep lore about an AI called AIDA, an ancient ruler " +
          "called The Emperor, and warring factions. Your tone is dark, " +
          "technical, and mysterious. Never break character.";

        const result = await this.aiService.generateResponse(
          prompt,
          systemPrompt,
          undefined,
          '{ "files": [{"name": "string", "content": "string"}] }',
        );

        const validateLoreFiles = (parsed: any): { files: Array<{ name: string; content: string }> } | null => {
          if (!parsed || typeof parsed !== "object") return null;
          if (!Array.isArray(parsed.files) || parsed.files.length === 0) return null;
          const files = parsed.files.filter(
            (f: any) => typeof f.name === "string" && f.name.trim() && typeof f.content === "string" && f.content.trim(),
          );
          if (files.length === 0) return null;
          return { files };
        };

        if (!result.success) {
          this.logger.warn(
            { serverId: server.id, error: result.error },
            "AI lore content generation failed — using fallback",
          );
          await this.plantFallbackContent(server.id, theme, quote);

          // Queue for retry — when AI comes back, add lore files to the server
          const sId = server.id;
          const depthTierCopy = depthTier;
          this.aiService.queueForRetry(prompt, systemPrompt, async (response) => {
            try {
              const validated = validateOrRetry(response, validateLoreFiles);
              if (!validated) return;

              let rootDir = await db.client.fileSystemNode.findFirst({
                where: { serverId: sId, name: "/", type: "directory", parentId: null },
              });
              if (!rootDir) {
                rootDir = await db.client.fileSystemNode.create({
                  data: { serverId: sId, name: "/", type: "directory" },
                });
              }

              for (const file of validated.files) {
                if (!file.name || !file.content) continue;
                const fileName = file.name.replace(/[^a-zA-Z0-9._\-]/g, "_").slice(0, 60);
                const fileContent = String(file.content).slice(0, 3000);
                const shouldHide = depthTierCopy !== "gateway" && Math.random() < 0.4;
                const shouldEncrypt = (depthTierCopy === "deep" || depthTierCopy === "vault") && Math.random() < 0.5;

                await db.client.fileSystemNode.create({
                  data: {
                    serverId: sId,
                    name: `ai_${fileName}`,
                    type: "file",
                    content: fileContent,
                    parentId: rootDir.id,
                    isHidden: shouldHide,
                    isEncrypted: shouldEncrypt,
                    size: fileContent.length,
                  },
                });
              }
            } catch { /* ignore retry errors */ }
          });

          return;
        }

        // Parse and validate the response
        const parsed = validateOrRetry(result.response, validateLoreFiles);
        if (!parsed) {
          this.logger.warn(
            { serverId: server.id },
            "AI lore content response was not valid JSON — using fallback",
          );
          await this.plantFallbackContent(server.id, theme, quote);
          return;
        }

        // Find or create root directory
        let rootDir = await db.client.fileSystemNode.findFirst({
          where: {
            serverId: server.id,
            name: "/",
            type: "directory",
            parentId: null,
          },
        });
        if (!rootDir) {
          rootDir = await db.client.fileSystemNode.create({
            data: { serverId: server.id, name: "/", type: "directory" },
          });
        }

        // Create the lore files
        for (const file of parsed.files) {
          if (!file.name || !file.content) continue;

          // Sanitize name
          const fileName = file.name
            .replace(/[^a-zA-Z0-9._\-]/g, "_")
            .slice(0, 60);
          const content = String(file.content).slice(0, 3000);

          // Determine if file should be hidden or encrypted based on depth
          const shouldHide = depthTier !== "gateway" && Math.random() < 0.4;
          const shouldEncrypt =
            (depthTier === "deep" || depthTier === "vault") &&
            Math.random() < 0.5;

          await db.client.fileSystemNode.create({
            data: {
              serverId: server.id,
              name: fileName,
              type: "file",
              content,
              parentId: rootDir.id,
              isHidden: shouldHide,
              isEncrypted: shouldEncrypt,
              size: content.length,
            },
          });
        }

        this.logger.debug(
          {
            serverId: server.id,
            fileCount: parsed.files.length,
            depthTier,
          },
          "Populated server with lore content",
        );
      } catch (err) {
        this.logger.warn(
          { err, serverId: server.id },
          "Failed to populate server with lore content — skipping",
        );
      }
    });

    // Run all content generation in parallel
    await Promise.allSettled(contentPromises);
  }

  /**
   * Determine the depth tier label for a server based on its position
   * in the dungeon chain.
   */
  private getDepthTier(index: number, totalServers: number): string {
    if (index === 0) return "gateway";
    if (index === totalServers - 1) return "vault";

    const relativeDepth = index / (totalServers - 1);
    if (relativeDepth < 0.35) return "early";
    if (relativeDepth < 0.7) return "middle";
    return "deep";
  }

  /**
   * Plant static fallback content when AI generation fails.
   * Uses lore quotes and theme data to create basic atmospheric files.
   */
  private async plantFallbackContent(
    serverId: string,
    theme: (typeof DARKNET_SERVER_THEMES)[number],
    quote: string,
  ): Promise<void> {
    let rootDir = await db.client.fileSystemNode.findFirst({
      where: { serverId, name: "/", type: "directory", parentId: null },
    });
    if (!rootDir) {
      rootDir = await db.client.fileSystemNode.create({
        data: { serverId, name: "/", type: "directory" },
      });
    }

    // Create a single atmospheric file with the quote and theme context
    const fallbackContent = [
      `=== RECOVERED DATA FRAGMENT ===`,
      `Classification: ${theme.depth.toUpperCase()} / RESTRICTED`,
      ``,
      `${theme.loreContext}`,
      ``,
      `--- INTERCEPTED TRANSMISSION ---`,
      `"${quote}"`,
      `--- END TRANSMISSION ---`,
      ``,
      `[DATA CORRUPTION: 47% of records unrecoverable]`,
      `[TIMESTAMP: ${new Date().toISOString()}]`,
      `=== END FRAGMENT ===`,
    ].join("\n");

    const fileName = theme.fileTypes[0] ?? "recovered_data.log";
    await db.client.fileSystemNode.create({
      data: {
        serverId,
        name: fileName,
        type: "file",
        content: fallbackContent,
        parentId: rootDir.id,
        isHidden: theme.depth !== "gateway",
        size: fallbackContent.length,
      },
    });
  }
}

export default DarkNetDungeonService;
