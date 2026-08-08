/**
 * aiAgentTools.ts — Tool-use system for AI content generation.
 *
 * Gives the AI the ability to query the game database mid-conversation.
 * Instead of dumping the entire world state into every prompt, the AI can
 * request specific data it needs, then use it to generate coherent content.
 *
 * Architecture:
 *   1. AI receives a system prompt listing available tools
 *   2. AI responds with a tool call: { "tool": "get_servers", "params": {...} }
 *   3. Server executes the query, returns results to AI
 *   4. AI continues reasoning with the data
 *   5. AI produces final output: { "final": true, "result": {...} }
 *   Max 6 rounds to prevent infinite loops.
 */

import { PrismaClient } from "@prisma/client";
import type { AIService } from "./aiService";
import type { Logger } from "pino";
import { safeExecute } from "../utils/safeExecute";

// ═══════════════════════════════════════════════════════════════
// Tool Definitions
// ═══════════════════════════════════════════════════════════════

export interface ToolDefinition {
  name: string;
  description: string;
  params: string; // Human-readable param description
  execute: (prisma: PrismaClient, params: Record<string, any>) => Promise<any>; // prisma always passed even if tool uses DI instead
}

const TOOLS: ToolDefinition[] = [
  {
    name: "get_networks",
    description: "List all networks with their zone, description, and server count",
    params: "none",
    execute: async (prisma) => {
      const networks = await prisma.network.findMany({
        include: { _count: { select: { servers: true } } },
        orderBy: { name: "asc" },
      });
      return networks.map(n => ({
        id: n.id, name: n.name, zone: n.zone,
        description: n.description, serverCount: n._count.servers,
      }));
    },
  },
  {
    name: "get_servers",
    description: "List servers, optionally filtered by networkId, factionId, or type",
    params: "{ networkId?: string, factionId?: string, type?: string, limit?: number }",
    execute: async (prisma, params) => {
      const where: Record<string, any> = {};
      if (params.networkId) where.networkId = params.networkId;
      if (params.factionId) where.factionId = params.factionId;
      if (params.type) where.type = params.type;
      where.isPlayerHome = false;

      const servers = await prisma.gameServer.findMany({
        where,
        select: {
          id: true, name: true, ipAddress: true, type: true, role: true,
          securityLevel: true, factionId: true, networkId: true,
          accessMethod: true, isPublic: true, isOnline: true,
        },
        take: params.limit || 30,
        orderBy: { ipAddress: "asc" },
      });
      return servers;
    },
  },
  {
    name: "get_server_details",
    description: "Get full details for a specific server including files, links, and network info",
    params: "{ serverId?: string, ipAddress?: string }",
    execute: async (prisma, params) => {
      const where = params.serverId
        ? { id: params.serverId }
        : { ipAddress: params.ipAddress };

      const server = await prisma.gameServer.findFirst({
        where,
        include: {
          network: { select: { id: true, name: true, zone: true } },
          fileSystem: { select: { name: true, type: true, content: true, isHidden: true }, take: 50 },
          linksOut: { include: { target: { select: { id: true, name: true, ipAddress: true } } } },
          linksIn: { include: { source: { select: { id: true, name: true, ipAddress: true } } } },
        },
      });
      if (!server) return { error: "Server not found" };
      return {
        ...server,
        links: [
          ...server.linksOut.map(l => ({ direction: "out", server: l.target })),
          ...server.linksIn.map(l => ({ direction: "in", server: l.source })),
        ],
      };
    },
  },
  {
    name: "get_factions",
    description: "List all factions with member count, leader, and territory info",
    params: "{ includeHidden?: boolean }",
    execute: async (prisma, params) => {
      const where: Record<string, any> = {};
      if (!params.includeHidden) where.isHidden = false;

      const factions = await prisma.faction.findMany({
        where,
        include: {
          _count: { select: { members: true, servers: true } },
          aiPersona: { select: { name: true, type: true } },
        },
      });
      return factions.map(f => ({
        id: f.id, name: f.name, shortName: f.shortName,
        ideology: (f as any).ideology, isHidden: f.isHidden,
        memberCount: f._count.members, serverCount: f._count.servers,
        leader: f.aiPersona?.name || null,
      }));
    },
  },
  {
    name: "get_forums",
    description: "List all forums with post counts",
    params: "none",
    execute: async (prisma) => {
      const forums = await prisma.forum.findMany({
        include: { _count: { select: { posts: true } }, faction: { select: { name: true } } },
      });
      return forums.map(f => ({
        id: f.id, name: f.name, url: f.url, category: f.category,
        faction: f.faction?.name || null, isHoneypot: f.isHoneypot,
        postCount: f._count.posts,
      }));
    },
  },
  {
    name: "get_forum_posts",
    description: "Get recent posts from a specific forum",
    params: "{ forumId: string, limit?: number }",
    execute: async (prisma, params) => {
      const posts = await prisma.post.findMany({
        where: { forumId: params.forumId },
        select: { id: true, title: true, content: true, authorHandle: true, createdAt: true },
        take: params.limit || 10,
        orderBy: { createdAt: "desc" },
      });
      return posts;
    },
  },
  {
    name: "get_recent_events",
    description: "Get recent story events from the ledger",
    params: "{ limit?: number, type?: string, category?: string }",
    execute: async (prisma, params) => {
      const where: Record<string, any> = {};
      if (params.type) where.type = params.type;
      if (params.category) where.category = params.category;

      return prisma.storyLedger.findMany({
        where,
        select: { type: true, category: true, summary: true, weight: true, createdAt: true },
        take: params.limit || 20,
        orderBy: { createdAt: "desc" },
      });
    },
  },
  {
    name: "get_players",
    description: "List active players with level, faction, and online status",
    params: "{ limit?: number, onlineOnly?: boolean }",
    execute: async (prisma, params) => {
      const where: Record<string, any> = { role: { not: "npc" } };
      if (params.onlineOnly) where.isOnline = true;

      return prisma.user.findMany({
        where,
        select: {
          id: true, username: true, isOnline: true,
          progress: { select: { level: true, credits: true } },
          factionMembers: { select: { faction: { select: { name: true } } } },
        },
        take: params.limit || 20,
      });
    },
  },
  {
    name: "search_files",
    description: "Search file content across all servers for a keyword or pattern",
    params: "{ query: string, serverId?: string, limit?: number }",
    execute: async (prisma, params) => {
      const where: Record<string, any> = {
        type: "file",
        content: { contains: params.query, mode: "insensitive" },
      };
      if (params.serverId) where.serverId = params.serverId;

      const files = await prisma.fileSystemNode.findMany({
        where,
        select: {
          name: true, content: true, serverId: true,
          server: { select: { name: true, ipAddress: true } },
        },
        take: params.limit || 10,
      });
      return files.map(f => ({
        fileName: f.name,
        serverName: f.server.name,
        serverIp: f.server.ipAddress,
        contentPreview: f.content?.substring(0, 200) || "",
      }));
    },
  },
  {
    name: "get_current_epoch",
    description: "Get the current active narrative epoch and its events",
    params: "none",
    execute: async (prisma) => {
      return prisma.narrativeEpoch.findFirst({
        where: { status: "active" },
        include: { events: { orderBy: { createdAt: "asc" } } },
      });
    },
  },
  {
    name: "get_ip_ranges",
    description: "Get IP range conventions for each network zone",
    params: "none",
    execute: async () => ({
      ranges: [
        { range: "10.0.0.x", zone: "public", type: "Internet Exchange backbone" },
        { range: "10.10.10.x", zone: "training", type: "Tutorial servers, low security" },
        { range: "169.254.x.x", zone: "underground", type: "dotHackers territory, medium-high security" },
        { range: "172.16.0-1.x", zone: "corporate", type: "CyberCorp territory, high security" },
        { range: "172.16.99.x", zone: "corporate-black", type: "CyberCorp Black Sites, very high security" },
        { range: "192.168.x.x", zone: "government", type: "Garrison territory, high security" },
        { range: "198.51.100.x", zone: "rogue", type: "Phantom Network, rogue hackers" },
        { range: "203.0.113.x", zone: "darknet", type: "DarkNet, maximum security" },
      ],
    }),
  },

  // ═══════════════════════════════════════════════════════════════
  // Game Intelligence Tools — Deep world state for richer content
  // ═══════════════════════════════════════════════════════════════

  {
    name: "get_faction_knowledge",
    description: "Get a faction's intelligence/knowledge base — what they know about servers, files, players, and threats",
    params: "{ factionId: string, limit?: number }",
    execute: async (prisma, params) => {
      return prisma.factionKnowledge.findMany({
        where: { factionId: params.factionId },
        select: { assetType: true, assetId: true, assetMeta: true, source: true, confidence: true, discoveredAt: true },
        take: params.limit || 20,
        orderBy: { discoveredAt: "desc" },
      });
    },
  },
  {
    name: "get_active_bounties",
    description: "Get active bounties — who has a price on their head and why",
    params: "{ limit?: number }",
    execute: async (prisma, params) => {
      return prisma.bounty.findMany({
        where: { status: "active" },
        select: {
          targetUsername: true, reason: true, rewardCredits: true,
          rewardReputation: true, issuedByFactionId: true, expiresAt: true,
        },
        take: params.limit || 10,
      });
    },
  },
  {
    name: "get_active_wars",
    description: "Get ongoing faction wars — who is fighting whom",
    params: "none",
    execute: async (prisma) => {
      return prisma.factionWar.findMany({
        where: { status: "active" },
        select: {
          attackerFactionId: true, defenderFactionId: true,
          attackerScore: true, defenderScore: true,
          reputationMultiplier: true, terms: true,
          startedAt: true, endedAt: true,
        },
      });
    },
  },
  {
    name: "get_story_arcs",
    description: "Get active story arcs — ongoing narrative threads players are experiencing",
    params: "{ status?: string }",
    execute: async (prisma, params) => {
      const where: Record<string, any> = {};
      if (params.status) where.status = params.status;
      else where.status = { in: ["active", "branching"] };

      return prisma.storyArc.findMany({
        where,
        select: {
          id: true, title: true, description: true, status: true,
          currentStep: true, totalSteps: true,
          factionId: true, createdAt: true,
        },
        take: 10,
        orderBy: { createdAt: "desc" },
      });
    },
  },
  {
    name: "get_censorship_rules",
    description: "Get faction censorship rules — what topics are monitored, banned, or flagged by each faction",
    params: "{ factionId?: string }",
    execute: async (prisma, params) => {
      const where: Record<string, any> = {};
      if (params.factionId) where.factionId = params.factionId;

      return prisma.censorshipRule.findMany({
        where,
        select: {
          pattern: true, replacement: true, isActive: true,
          server: { select: { name: true, ipAddress: true } },
        },
      });
    },
  },
  {
    name: "get_key_fragments",
    description: "Get the status of AIDA key fragments — the endgame artifacts (sword, key, collar)",
    params: "none",
    execute: async (prisma) => {
      return prisma.keyFragment.findMany({
        select: {
          name: true, keyType: true, fragmentNum: true,
          heldByUserId: true, description: true,
          sourceType: true, sourceId: true,
        },
      });
    },
  },
  {
    name: "get_ai_personas",
    description: "Get AI persona details — their names, types, factions, and personality prompts",
    params: "{ type?: string }",
    execute: async (prisma, params) => {
      const where: Record<string, any> = {};
      if (params.type) where.type = params.type;

      return prisma.aIPersona.findMany({
        where,
        select: {
          id: true, name: true, type: true,
          faction: { select: { name: true } },
          systemPrompt: true,
        },
      });
    },
  },
  {
    name: "get_shop_items",
    description: "Get available shop items — tools, software, and upgrades players can buy",
    params: "{ category?: string }",
    execute: async (prisma, params) => {
      const where: Record<string, any> = {};
      if (params.category) where.category = params.category;

      return prisma.shopItem.findMany({
        where,
        select: { name: true, description: true, category: true, price: true, itemType: true },
        orderBy: { price: "asc" },
      });
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // Player Activity Tools — Reactive content based on what players do
  // ═══════════════════════════════════════════════════════════════

  {
    name: "get_player_activity",
    description: "Get a specific player's recent activity — hacks, missions, connections, level",
    params: "{ userId?: string, username?: string }",
    execute: async (prisma, params) => {
      const where = params.userId
        ? { id: params.userId }
        : { username: params.username };

      const user = await prisma.user.findFirst({
        where: where as any,
        select: {
          id: true, username: true, isOnline: true,
          progress: {
            select: {
              level: true, credits: true, experience: true,
              hacking: true, networking: true, cryptography: true,
              stealth: true, socialEng: true, forensics: true,
            },
          },
          factionMembers: {
            select: { faction: { select: { name: true } }, rank: true },
          },
        },
      });
      if (!user) return { error: "Player not found" };

      const recentHacks = await prisma.hackLog.findMany({
        where: { attackerId: user.id },
        select: { targetServerId: true, method: true, success: true, timestamp: true },
        take: 10,
        orderBy: { timestamp: "desc" },
      });

      const progress = await prisma.playerProgress.findUnique({
        where: { userId: user.id },
        select: { missionProgress: true },
      });
      const missions = progress?.missionProgress
        ? Object.values(progress.missionProgress as any).filter((m: any) => m.status === "active").slice(0, 5)
        : [];

      return { ...user, recentHacks, activeMissions: missions };
    },
  },
  {
    name: "get_recent_hack_activity",
    description: "Get recent hack attempts across all players — who is hacking what",
    params: "{ limit?: number, serverId?: string }",
    execute: async (prisma, params) => {
      const where: Record<string, any> = {};
      if (params.serverId) where.targetServerId = params.serverId;

      return prisma.hackLog.findMany({
        where,
        select: {
          attackerId: true, targetServerId: true, method: true,
          success: true, detected: true, timestamp: true,
        },
        take: params.limit || 20,
        orderBy: { timestamp: "desc" },
      });
    },
  },
  {
    name: "get_active_backdoors",
    description: "Get active backdoors across the game — who has persistent access where",
    params: "{ serverId?: string, userId?: string }",
    execute: async (prisma, params) => {
      const where: Record<string, any> = { isActive: true };
      if (params.serverId) where.serverId = params.serverId;
      if (params.userId) where.installerId = params.userId;

      return prisma.backdoor.findMany({
        where,
        select: {
          type: true, accessLevel: true, detectionRisk: true,
          expiresAt: true, createdAt: true,
        },
        take: 20,
      });
    },
  },
  {
    name: "get_server_access_keys",
    description: "Get access keys that have been discovered — which players have keys to which servers",
    params: "{ serverId?: string }",
    execute: async (prisma, params) => {
      const where: Record<string, any> = {};
      if (params.serverId) where.serverId = params.serverId;

      return prisma.serverAccessKey.findMany({
        where,
        select: { userId: true, serverId: true, keyValue: true, source: true },
        take: 20,
      });
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // Creation Tools — AI can invent new game entities as drafts
  // ═══════════════════════════════════════════════════════════════

  {
    name: "create_server",
    description: "Create a new server in the game world (as a draft for admin review). Use when you need a server that doesn't exist yet. It will be auto-linked to the correct network gateway based on its IP.",
    params: '{ name: string, ipAddress: string, type: "underground"|"corporate"|"government"|"tutorial", role: "gateway"|"router"|"workstation"|"database"|"email"|"firewall"|"dns", securityLevel: number (1-10), description?: string }',
    execute: async (_prisma, params) => {
      const { getService } = await import("../di/container");
      const { CONTENT_DRAFT_SERVICE } = await import("../di/tokens");
      const draftService = getService<any>(CONTENT_DRAFT_SERVICE);

      const draft = await draftService.createDraft({
        type: "server",
        title: `AI-created: ${params.name} (${params.ipAddress})`,
        description: params.description || `Server created by AI during content generation.`,
        payload: {
          name: params.name,
          ipAddress: params.ipAddress,
          type: params.type || "underground",
          role: params.role || "workstation",
          securityLevel: params.securityLevel ?? 4,
          firewallLevel: Math.max(1, (params.securityLevel ?? 4) - 1),
          isPublic: false,
          accessMethod: "hackable",
          isOnline: true,
          maxConnections: 10,
        },
        source: "ai_content" as const,
      });
      return { created: true, draftId: draft.id, note: "Server created as draft — admin will review. You can reference this IP in your content." };
    },
  },
  {
    name: "create_network",
    description: "Create a new network (as a draft for admin review). Use when you need a network that doesn't exist.",
    params: '{ name: string, zone: string, description: string }',
    execute: async (_prisma, params) => {
      const { getService } = await import("../di/container");
      const { CONTENT_DRAFT_SERVICE } = await import("../di/tokens");
      const draftService = getService<any>(CONTENT_DRAFT_SERVICE);

      const draft = await draftService.createDraft({
        type: "network",
        title: `AI-created network: ${params.name}`,
        description: params.description || `Network created by AI.`,
        payload: {
          name: params.name,
          zone: params.zone || "underground",
          description: params.description || "",
        },
        source: "ai_content" as const,
      });
      return { created: true, draftId: draft.id };
    },
  },
  {
    name: "create_file",
    description: "Create a file on an existing server (as a draft for admin review). Use to plant clues, evidence, logs, or documents.",
    params: '{ serverId: string, path: string, name: string, content: string, isHidden?: boolean }',
    execute: async (_prisma, params) => {
      const { getService } = await import("../di/container");
      const { CONTENT_DRAFT_SERVICE } = await import("../di/tokens");
      const draftService = getService<any>(CONTENT_DRAFT_SERVICE);

      // Verify server exists
      const server = await _prisma.gameServer.findUnique({
        where: { id: params.serverId },
        select: { name: true, ipAddress: true },
      });

      const serverLabel = server ? `${server.name} (${server.ipAddress})` : params.serverId;

      const draft = await draftService.createDraft({
        type: "file",
        title: `AI-created file: ${params.name} on ${serverLabel}`,
        description: `File planted by AI on ${serverLabel}.`,
        payload: {
          serverId: params.serverId,
          name: params.name,
          path: params.path || `/var/log/${params.name}`,
          content: params.content || "",
          isHidden: params.isHidden ?? false,
        },
        source: "ai_content" as const,
      });
      return { created: true, draftId: draft.id };
    },
  },
  {
    name: "create_link",
    description: "Create a network link between two servers (as a draft). Needed to make a new server reachable from an existing one.",
    params: '{ sourceId: string, targetId: string, linkType?: "lan"|"wan"|"vpn"|"backbone"|"hidden", latency?: number }',
    execute: async (_prisma, params) => {
      const { getService } = await import("../di/container");
      const { CONTENT_DRAFT_SERVICE } = await import("../di/tokens");
      const draftService = getService<any>(CONTENT_DRAFT_SERVICE);

      const draft = await draftService.createDraft({
        type: "link",
        title: `AI-created link: ${params.sourceId} ↔ ${params.targetId}`,
        description: `Network link created by AI.`,
        payload: {
          sourceId: params.sourceId,
          targetId: params.targetId,
          linkType: params.linkType || "lan",
          latency: params.latency ?? 5,
          requiredAccess: 0,
        },
        source: "ai_content" as const,
      });
      return { created: true, draftId: draft.id };
    },
  },
  {
    name: "create_forum_post",
    description: "Create a forum post (as a draft). Use to plant rumors, intel, or faction communications on forums.",
    params: '{ forumId: string, authorHandle: string, title: string, content: string }',
    execute: async (_prisma, params) => {
      const { getService } = await import("../di/container");
      const { CONTENT_DRAFT_SERVICE } = await import("../di/tokens");
      const draftService = getService<any>(CONTENT_DRAFT_SERVICE);

      // Get a valid author ID (use first NPC user)
      const npc = await _prisma.user.findFirst({
        where: { role: "npc" },
        select: { id: true },
      });

      const draft = await draftService.createDraft({
        type: "forum_post",
        title: `AI forum post: ${params.title}`,
        description: `Forum post by ${params.authorHandle}, created by AI.`,
        payload: {
          forumId: params.forumId,
          authorId: npc?.id || "system",
          authorHandle: params.authorHandle,
          title: params.title,
          content: params.content || "",
          tags: [],
          isSticky: false,
          isPinned: false,
        },
        source: "ai_content" as const,
      });
      return { created: true, draftId: draft.id };
    },
  },
];

// Build tool registry
const TOOL_MAP = new Map(TOOLS.map(t => [t.name, t]));

// ═══════════════════════════════════════════════════════════════
// Tool-Use Prompt Block
// ═══════════════════════════════════════════════════════════════

/**
 * Generate the tool-use instruction block for AI system prompts.
 */
export function buildToolUsePrompt(): string {
  const toolList = TOOLS.map(t =>
    `  - ${t.name}: ${t.description}\n    Params: ${t.params}`
  ).join("\n");

  return `
AVAILABLE TOOLS — You can query AND create game entities.
To use a tool, respond with ONLY this JSON: { "tool": "<tool_name>", "params": { ... } }
After receiving tool results, you can call another tool or give your final response.
To give your final response, respond with ONLY: { "final": true, "result": <your_output> }

Tools:
${toolList}

RULES:
- Use lookup tools (get_*) to find REAL servers, IPs, networks, and forums
- Use creation tools (create_*) when you need an entity that doesn't exist yet
- When you create a server, you CAN reference its IP in your content — it will exist after admin review
- If a file mentions a server, forum, or network that doesn't exist, CREATE IT with the appropriate tool
- Every piece of information in your content must lead somewhere real — no dead-end references
- Use IPs in the correct range for the zone (call get_ip_ranges if unsure)
- Maximum 5 tool calls per request — then you MUST give a final response
- Always end with { "final": true, "result": ... }
`;
}

// ═══════════════════════════════════════════════════════════════
// Agent Loop
// ═══════════════════════════════════════════════════════════════

/**
 * Run an AI agent loop with tool-use capabilities.
 *
 * @param aiService - The AI service for generating responses
 * @param prisma - Prisma client for executing tool queries
 * @param systemPrompt - Base system prompt (tool instructions are appended)
 * @param userPrompt - The task for the AI to perform
 * @param logger - Logger for debugging
 * @param maxRounds - Maximum tool-call rounds (default 6)
 * @returns The AI's final response string, or null on failure
 */
export async function runAgentLoop(
  aiService: AIService,
  prisma: PrismaClient,
  systemPrompt: string,
  userPrompt: string,
  logger: Logger,
  maxRounds: number = 6,
): Promise<string | null> {
  const fullSystemPrompt = systemPrompt + "\n" + buildToolUsePrompt();

  // Build conversation as a growing prompt (since Ollama doesn't support multi-turn natively in single API)
  let conversationHistory = userPrompt;
  let context: number[] | undefined;

  for (let round = 0; round < maxRounds; round++) {
    const result = await safeExecute({
      fn: async () => {
        const aiResult = await aiService.generateOrThrow(
          conversationHistory,
          fullSystemPrompt,
          context,
        );
        return aiResult;
      },
      context: `AI agent round ${round}`,
      logger,
      silent: true,
    })();

    if (!result) return null;

    context = result.context as number[] | undefined; // Preserve context for multi-turn

    // Parse response
    const response = result.response.trim();
    let parsed: any;
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        // AI returned plain text — treat as final response
        return response;
      }
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      // Can't parse — treat as final response
      return response;
    }

    // Check if it's a final response
    if (parsed.final) {
      const finalResult = parsed.result;
      return typeof finalResult === "string" ? finalResult : JSON.stringify(finalResult);
    }

    // Check if it's a tool call
    if (parsed.tool) {
      const tool = TOOL_MAP.get(parsed.tool);
      if (!tool) {
        conversationHistory += `\n\nTool "${parsed.tool}" not found. Available tools: ${TOOLS.map(t => t.name).join(", ")}. Try again or give your final response with { "final": true, "result": ... }`;
        continue;
      }

      try {
        const toolResult = await tool.execute(prisma, parsed.params || {});
        const resultStr = JSON.stringify(toolResult, null, 2);
        // Truncate very large results
        const truncated = resultStr.length > 4000
          ? resultStr.substring(0, 4000) + "\n... (truncated, request with a filter for more specific data)"
          : resultStr;

        conversationHistory += `\n\nTool result for ${parsed.tool}:\n${truncated}\n\nContinue with another tool call or give your final response.`;

        logger.debug(
          { round, tool: parsed.tool, resultLength: resultStr.length },
          "AI agent tool call executed",
        );
      } catch (err) {
        conversationHistory += `\n\nTool "${parsed.tool}" failed: ${err instanceof Error ? err.message : "Unknown error"}. Try a different approach or give your final response.`;
      }
      continue;
    }

    // Unknown format — treat as final
    return response;
  }

  // Max rounds reached — ask for final answer
  logger.warn({ maxRounds }, "AI agent reached max rounds without final response");
  return null;
}
