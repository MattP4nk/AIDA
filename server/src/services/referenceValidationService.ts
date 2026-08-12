/**
 * ReferenceValidationService — Ensures AI-generated content references real game objects.
 *
 * When AI creates file content that mentions IPs, server names, or forum URLs,
 * this service checks if those references exist. If not, it creates ContentDrafts
 * for the missing entities so admins can review and approve them.
 *
 * Also provides investigation chain generation — creating multi-step clue trails
 * that span servers and forums.
 */

import "reflect-metadata";
import { injectable, inject } from "tsyringe";
import { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";
import { PRISMA_CLIENT, LOGGER, AI_SERVICE } from "../di/tokens";
import type { ContentDraftService } from "./contentDraftService";
import type { AIService } from "./aiService";

// IP address regex: matches standard dotted-quad IPs
const IP_REGEX = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g;

// Forum/URL regex: matches common URL-like patterns in game content
const URL_REGEX = /\b([a-z0-9][\w-]*\.(onion|net|org|mil|internal|libre|darknet|tor|gov))\b/gi;

// Server name regex (reserved for future use)
// const SERVER_NAME_REGEX = /(?:server|node|relay|gateway|hub|tower|vault|archive)\s+["']?([A-Z][\w\s-]{2,30})["']?/gi;

@injectable()
export class ReferenceValidationService {
  private draftService: ContentDraftService | null = null;

  constructor(
    @inject(PRISMA_CLIENT) private prisma: PrismaClient,
    @inject(LOGGER) private logger: Logger,
    @inject(AI_SERVICE) private aiService: AIService,
  ) {}

  /** Late-bind ContentDraftService to avoid circular DI */
  setDraftService(draftService: ContentDraftService): void {
    this.draftService = draftService;
  }

  /**
   * Scan content for IP addresses and forum URLs. For each reference that doesn't
   * exist in the game world, create a ContentDraft for the missing entity.
   *
   * @returns Array of created drafts
   */
  async validateAndBackfillReferences(
    content: string,
    source: "ai_content" | "architect" | "admin" | "epoch_event",
    sourceId?: string,
  ): Promise<any[]> {
    if (!this.draftService || !content) return [];

    const drafts: any[] = [];

    // ── Check IP references ──
    const ips = this.extractIPs(content);
    for (const ip of ips) {
      const exists = await this.prisma.gameServer.findFirst({
        where: { ipAddress: ip },
      });
      if (!exists) {
        try {
          const draft = await this.generateServerDraft(ip, content, source, sourceId);
          if (draft) drafts.push(draft);
        } catch (err) {
          this.logger.warn({ err, ip }, "Failed to generate server draft for missing IP");
        }
      }
    }

    // ── Check forum URL references ──
    const urls = this.extractForumURLs(content);
    for (const url of urls) {
      const exists = await this.prisma.forum.findFirst({
        where: { url: { equals: url, mode: "insensitive" } },
      });
      if (!exists) {
        try {
          const draft = await this.draftService.createDraft({
            type: "forum",
            title: `Forum: ${url}`,
            description: `AI content referenced forum "${url}" which doesn't exist. Auto-generated draft.`,
            payload: {
              name: url.split(".")[0]?.replace(/-/g, " ") || url,
              url,
              description: `Forum discovered via AI content generation.`,
              category: url.includes("onion") || url.includes("darknet") ? "underground" : "tech",
              securityLevel: url.includes("onion") || url.includes("darknet") ? 4 : 2,
              isHoneypot: false,
              requiresProxy: url.includes("onion") || url.includes("tor"),
            },
            source,
            ...(sourceId ? { sourceId } : {}),
          });
          drafts.push(draft);
        } catch (err) {
          this.logger.warn({ err, url }, "Failed to create forum draft for missing URL");
        }
      }
    }

    if (drafts.length > 0) {
      this.logger.info(
        { count: drafts.length, source },
        "Created backfill drafts for missing references",
      );
    }

    return drafts;
  }

  /**
   * Generate an investigation chain — a series of connected clues spanning
   * multiple servers and optionally forums.
   *
   * @param startServerId - Server where the first clue is planted
   * @param depth - Number of steps in the chain (2-5)
   * @param theme - Narrative theme (e.g., "corporate espionage", "data breach", "missing operative")
   * @returns Array of ContentDrafts for admin review
   */
  async generateInvestigationChain(
    startServerId: string,
    depth: number = 3,
    theme: string = "suspicious activity",
  ): Promise<any[]> {
    if (!this.draftService) return [];

    const clampedDepth = Math.max(2, Math.min(depth, 5));
    const drafts: any[] = [];

    // Get starting server info
    const startServer = await this.prisma.gameServer.findUnique({
      where: { id: startServerId },
      select: { id: true, name: true, ipAddress: true, networkId: true, factionId: true },
    });
    if (!startServer) throw new Error("Start server not found");

    // Generate the chain using AI
    const chainPrompt = `You are creating an investigation trail for a hacking game. Theme: "${theme}".

The trail starts on server "${startServer.name}" (${startServer.ipAddress}).
Generate a ${clampedDepth}-step investigation chain. Each step is a clue that leads to the next.

Respond ONLY with valid JSON in this format:
{
  "steps": [
    {
      "type": "file",
      "serverName": "name for target server (step 2+)",
      "serverIp": "IP for target server in format X.X.X.X (step 2+)",
      "serverRole": "gateway|router|workstation|database|email|firewall",
      "fileName": "clue_filename.ext",
      "filePath": "/var/log/clue_filename.ext",
      "fileContent": "Content of the clue file. Must reference the NEXT step's server IP or name.",
      "isHidden": false
    }
  ],
  "finalSecret": "What the investigator discovers at the end"
}

Step 1 is a file on the starting server. Steps 2+ each create a NEW server + clue file.
Each clue must mention a partial IP or server name leading to the next step.
Use IPs in ranges: 172.16.x.x (corporate), 192.168.x.x (government), 169.254.x.x (underground).`;

    const systemPrompt = "You are a game content generator for a multiplayer hacking game. Generate realistic investigation chains with authentic-feeling server names, file names, and log entries. Use the available tools to look up REAL server IPs and names — never invent them.";

    // Use agent loop so AI can query the DB for real server data
    const { runAgentLoop } = await import("./aiAgentTools");
    let agentResponse: string | null = null;
    try {
      agentResponse = await runAgentLoop(
        this.aiService, this.prisma, systemPrompt, chainPrompt, this.logger, 4,
      );
    } catch { /* fall through to template */ }

    if (!agentResponse) {
      this.logger.warn("AI failed to generate investigation chain — using template");
      return this.generateTemplateChain(startServer, clampedDepth, theme);
    }

    // Parse AI response
    let chain: any;
    try {
      const jsonMatch = agentResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found");
      chain = JSON.parse(jsonMatch[0]);
    } catch {
      this.logger.warn("Failed to parse AI chain response — using template");
      return this.generateTemplateChain(startServer, clampedDepth, theme);
    }

    if (!chain.steps || !Array.isArray(chain.steps)) {
      return this.generateTemplateChain(startServer, clampedDepth, theme);
    }

    // Step 1: file on starting server
    const step1 = chain.steps[0];
    if (step1) {
      drafts.push(await this.draftService.createDraft({
        type: "file",
        title: `Chain clue: ${step1.fileName || "clue.log"} on ${startServer.name}`,
        description: `Investigation chain step 1/${clampedDepth}. Theme: ${theme}. Planted on ${startServer.name}.`,
        payload: {
          serverId: startServerId,
          name: step1.fileName || "clue.log",
          path: step1.filePath || "/var/log/clue.log",
          content: step1.fileContent || `Suspicious activity detected. Trace leads to ${chain.steps[1]?.serverIp || "unknown"}.`,
          isHidden: step1.isHidden ?? false,
        },
        source: "ai_content",
        sourceId: startServerId,
      }));
    }

    // Steps 2+: new server + clue file
    for (let i = 1; i < chain.steps.length; i++) {
      const step = chain.steps[i];
      if (!step) continue;

      const ip = step.serverIp || `172.16.${50 + i}.${Math.floor(Math.random() * 254) + 1}`;

      // Check IP doesn't already exist
      const existing = await this.prisma.gameServer.findFirst({ where: { ipAddress: ip } });
      if (existing) {
        // Just add a file to existing server
        drafts.push(await this.draftService.createDraft({
          type: "file",
          title: `Chain clue: ${step.fileName || "clue.log"} on ${existing.name}`,
          description: `Investigation chain step ${i + 1}/${clampedDepth}. Theme: ${theme}.`,
          payload: {
            serverId: existing.id,
            name: step.fileName || "trace.log",
            path: step.filePath || "/var/log/trace.log",
            content: step.fileContent || "",
            isHidden: step.isHidden ?? true,
          },
          source: "ai_content",
          sourceId: startServerId,
        }));
      } else {
        // Create server draft
        drafts.push(await this.draftService.createDraft({
          type: "server",
          title: `Chain server: ${step.serverName || `Trace Node ${i}`}`,
          description: `Investigation chain step ${i + 1}/${clampedDepth}. Theme: ${theme}. IP: ${ip}`,
          payload: {
            name: step.serverName || `Trace Node ${i}`,
            ipAddress: ip,
            type: ip.startsWith("172.16") ? "corporate" : ip.startsWith("192.168") ? "government" : "underground",
            role: step.serverRole || "workstation",
            securityLevel: Math.min(3 + i, 8),
            firewallLevel: Math.min(2 + i, 7),
            encryptionLevel: i > 2 ? 2 : 0,
            discoveryLevel: i,
            isPublic: false,
            accessMethod: "hackable",
            isOnline: true,
            maxConnections: 10,
          },
          source: "ai_content",
          sourceId: startServerId,
        }));

        // Create file draft for the clue on this new server
        drafts.push(await this.draftService.createDraft({
          type: "file",
          title: `Chain clue: ${step.fileName || "evidence.log"}`,
          description: `File for investigation chain step ${i + 1}/${clampedDepth}. To be placed on server ${ip} after approval.`,
          payload: {
            serverId: "__pending__", // Will need manual linking after server is created
            name: step.fileName || "evidence.log",
            path: step.filePath || "/var/log/evidence.log",
            content: step.fileContent || "",
            isHidden: step.isHidden ?? true,
            _note: `This file belongs on server "${step.serverName}" (${ip}). Create the server draft first, then update this file's serverId.`,
          },
          source: "ai_content",
          sourceId: startServerId,
        }));
      }
    }

    this.logger.info(
      { startServer: startServer.name, depth: clampedDepth, theme, draftCount: drafts.length },
      "Investigation chain generated",
    );

    return drafts;
  }

  // ═══════════════════════════════════════════════════════════════
  // Private helpers
  // ═══════════════════════════════════════════════════════════════

  private extractIPs(content: string): string[] {
    const matches = content.match(IP_REGEX) || [];
    // Deduplicate and filter out obvious non-server IPs (0.0.0.0, 127.x, 255.x)
    return [...new Set(matches)].filter((ip) => {
      const first = parseInt(ip.split(".")[0]!, 10);
      return first > 0 && first < 255 && ip !== "127.0.0.1" && ip !== "0.0.0.0";
    });
  }

  private extractForumURLs(content: string): string[] {
    const matches = content.match(URL_REGEX) || [];
    return [...new Set(matches.map((u) => u.toLowerCase()))];
  }

  /**
   * Generate a template-based investigation chain when AI is unavailable.
   */
  private async generateTemplateChain(
    startServer: { id: string; name: string; ipAddress: string },
    depth: number,
    theme: string,
  ): Promise<any[]> {
    if (!this.draftService) return [];
    const drafts: any[] = [];

    const templates = [
      {
        fileName: "access.log",
        content: (nextIp: string) =>
          `[ALERT] Unauthorized access from ${nextIp}\nMultiple failed auth attempts detected.\nPattern consistent with automated probe.\nInvestigation required.`,
      },
      {
        fileName: "trace.dat",
        content: (nextIp: string) =>
          `TRACE ROUTE:\n  Hop 1: ${startServer.ipAddress}\n  Hop 2: ${nextIp}\n  Hop 3: [ENCRYPTED]\nConnection terminated by remote host.`,
      },
      {
        fileName: "incident_report.txt",
        content: (nextIp: string) =>
          `INCIDENT REPORT\nDate: ${new Date().toISOString().split("T")[0]}\nSubject: ${theme}\nSource: ${nextIp}\nStatus: Under investigation\nNotes: Data exfiltration pattern detected. Follow the trail.`,
      },
    ];

    for (let i = 0; i < depth; i++) {
      const nextIp = `172.16.${50 + i}.${Math.floor(Math.random() * 200) + 10}`;
      const template = templates[i % templates.length]!;

      if (i === 0) {
        // File on starting server
        drafts.push(await this.draftService.createDraft({
          type: "file",
          title: `Chain clue: ${template.fileName} on ${startServer.name}`,
          description: `Investigation chain step ${i + 1}/${depth}. Theme: ${theme}.`,
          payload: {
            serverId: startServer.id,
            name: template.fileName,
            path: `/var/log/${template.fileName}`,
            content: template.content(nextIp),
            isHidden: false,
          },
          source: "ai_content",
          sourceId: startServer.id,
        }));
      } else {
        // New server
        const finalNextIp = i < depth - 1
          ? `172.16.${50 + i + 1}.${Math.floor(Math.random() * 200) + 10}`
          : "[CLASSIFIED]";

        drafts.push(await this.draftService.createDraft({
          type: "server",
          title: `Chain server: Trace Node ${i}`,
          description: `Investigation chain step ${i + 1}/${depth}. Theme: ${theme}.`,
          payload: {
            name: `Trace Node ${String.fromCharCode(65 + i)}`,
            ipAddress: nextIp,
            type: "corporate",
            role: "workstation",
            securityLevel: Math.min(3 + i, 8),
            firewallLevel: Math.min(2 + i, 7),
            isPublic: false,
            accessMethod: "hackable",
            isOnline: true,
            maxConnections: 10,
          },
          source: "ai_content",
          sourceId: startServer.id,
        }));

        drafts.push(await this.draftService.createDraft({
          type: "file",
          title: `Chain clue: ${template.fileName}`,
          description: `File for step ${i + 1}/${depth}. Place on server ${nextIp} after approval.`,
          payload: {
            serverId: "__pending__",
            name: template.fileName,
            path: `/var/log/${template.fileName}`,
            content: template.content(finalNextIp),
            isHidden: true,
            _note: `Place on server at ${nextIp} after creating it.`,
          },
          source: "ai_content",
          sourceId: startServer.id,
        }));
      }
    }

    return drafts;
  }

  /**
   * Generate a ContentDraft for a server at a missing IP address.
   */
  /**
   * Generate a ContentDraft for a server at a missing IP address.
   * Resolves network, type, faction, security, and gateway from the IP range.
   */
  private async generateServerDraft(
    ipAddress: string,
    contextHint: string,
    source: "ai_content" | "architect" | "admin" | "epoch_event",
    sourceId?: string,
  ): Promise<any | null> {
    if (!this.draftService) return null;

    const topo = await resolveTopologyFromIP(this.prisma, ipAddress);

    // Try AI for a good name, fall back to template
    const { safeExecute } = await import("../utils/safeExecute");
    const defaultName = `Unknown ${topo.zone} Server`;

    const name = await safeExecute({
      fn: async () => {
        const result = await this.aiService.generateOrThrow(
          `Generate a short server name (2-4 words) for a ${topo.type} server in the ${topo.zone} zone at IP ${ipAddress}. ` +
          `Context: ${contextHint.substring(0, 200)}. Respond with ONLY the name, nothing else.`,
        );
        const trimmed = result.response.trim().replace(/['"]/g, "");
        if (trimmed.length > 0 && trimmed.length < 40) return trimmed;
        return defaultName;
      },
      context: "Generate server name for draft",
      logger: this.logger,
      silent: true,
      fallback: defaultName,
    })();

    const drafts: any[] = [];

    // Server draft
    const serverDraft = await this.draftService.createDraft({
      type: "server",
      title: `Referenced server: ${name} (${ipAddress})`,
      description: `AI content referenced IP ${ipAddress} which doesn't exist.\nZone: ${topo.zone} | Network: ${topo.networkName || "none"} | Gateway: ${topo.gatewayIp || "none"}`,
      payload: {
        name,
        ipAddress,
        type: topo.type,
        role: "workstation",
        networkId: topo.networkId,
        factionId: topo.factionId,
        securityLevel: topo.securityLevel,
        firewallLevel: topo.firewallLevel,
        isPublic: false,
        accessMethod: "hackable",
        isOnline: true,
        maxConnections: 10,
      },
      source,
      ...(sourceId ? { sourceId } : {}),
    });
    drafts.push(serverDraft);

    // Link draft — connect to gateway if one exists
    if (topo.gatewayId) {
      const linkDraft = await this.draftService.createDraft({
        type: "link",
        title: `Link: ${name} ↔ ${topo.gatewayName || "gateway"}`,
        description: `Topology link connecting ${ipAddress} to network gateway ${topo.gatewayIp || ""}`,
        payload: {
          sourceId: "__pending_server__",
          targetId: topo.gatewayId,
          networkId: topo.networkId,
          linkType: topo.linkType,
          latency: topo.latency,
          requiredAccess: 0,
          _note: `sourceId should be replaced with the actual server ID after the server draft above is approved.`,
        },
        source,
        ...(sourceId ? { sourceId } : {}),
      });
      drafts.push(linkDraft);
    }

    return serverDraft; // Return the server draft (link is a bonus)
  }
}

// ═══════════════════════════════════════════════════════════════
// Topology Resolution — Maps IP ranges to networks, factions, gateways
// ═══════════════════════════════════════════════════════════════

interface TopologyInfo {
  type: string;           // Server type (underground, corporate, government, tutorial)
  zone: string;           // Human-readable zone name
  networkId: string | null;
  networkName: string | null;
  factionId: string | null;
  gatewayId: string | null;
  gatewayIp: string | null;
  gatewayName: string | null;
  securityLevel: number;
  firewallLevel: number;
  linkType: string;
  latency: number;
}

/**
 * Given an IP address, determine which network/zone it belongs to,
 * find the gateway server, and suggest appropriate security settings.
 *
 * IP Range → Zone mapping:
 *   10.0.0.x       → Internet Exchange (public)
 *   10.10.10.x     → Training Network (tutorial)
 *   169.254.x.x    → Underground / dotHackers
 *   172.16.0-1.x   → Corporate / CyberCorp
 *   172.16.99.x    → CyberCorp Black Sites
 *   192.168.x.x    → Government / Garrison
 *   198.51.100.x   → Phantom Network (rogue)
 *   203.0.113.x    → DarkNet
 */
export async function resolveTopologyFromIP(
  prisma: PrismaClient,
  ipAddress: string,
): Promise<TopologyInfo> {
  const octets = ipAddress.split(".");
  const first = parseInt(octets[0]!, 10);
  const second = parseInt(octets[1]!, 10);
  const third = parseInt(octets[2]!, 10);

  let networkName: string | null = null;
  let type = "underground";
  let zone = "underground";
  let securityLevel = 4;
  let firewallLevel = 3;
  let linkType = "lan";
  let latency = 5;

  // ── Map IP range to zone ──
  if (first === 10 && second === 10 && third === 10) {
    networkName = "AIDA Training Network";
    type = "tutorial";
    zone = "training";
    securityLevel = 1;
    firewallLevel = 1;
  } else if (first === 10 && second === 0) {
    zone = "public";
    type = "public";
    securityLevel = 2;
    firewallLevel = 2;
    linkType = "backbone";
    latency = 10;
  } else if (first === 169 && second === 254) {
    networkName = "dotHackers Mesh";
    type = "underground";
    zone = "underground";
    securityLevel = 4;
    firewallLevel = 3;
    linkType = "vpn";
    latency = 15;
  } else if (first === 172 && second === 16 && third === 99) {
    networkName = "CyberCorp Black Sites";
    type = "corporate";
    zone = "corporate-black";
    securityLevel = 7;
    firewallLevel = 6;
    linkType = "hidden";
    latency = 40;
  } else if (first === 172 && second === 16) {
    networkName = "CyberCorp Internal";
    type = "corporate";
    zone = "corporate";
    securityLevel = 5;
    firewallLevel = 4;
    linkType = "lan";
    latency = 5;
  } else if (first === 192 && second === 168) {
    networkName = "Garrison Defense Grid";
    type = "government";
    zone = "government";
    securityLevel = 6;
    firewallLevel = 5;
    linkType = "lan";
    latency = 5;
  } else if (first === 198 && second === 51 && third === 100) {
    networkName = "Phantom Network";
    type = "underground";
    zone = "rogue";
    securityLevel = 5;
    firewallLevel = 4;
    linkType = "hidden";
    latency = 30;
  } else if (first === 203 && second === 0 && third === 113) {
    networkName = "DarkNet";
    type = "underground";
    zone = "darknet";
    securityLevel = 8;
    firewallLevel = 7;
    linkType = "hidden";
    latency = 50;
  }

  // ── Resolve network + gateway from DB ──
  let networkId: string | null = null;
  let factionId: string | null = null;
  let gatewayId: string | null = null;
  let gatewayIp: string | null = null;
  let gatewayName: string | null = null;

  if (networkName) {
    const network = await prisma.network.findFirst({
      where: { name: { contains: networkName, mode: "insensitive" } },
      select: { id: true, name: true },
    });

    if (network) {
      networkId = network.id;
      networkName = network.name;

      // Find gateway server in this network
      const gateway = await prisma.gameServer.findFirst({
        where: { networkId: network.id, role: "gateway" },
        select: { id: true, ipAddress: true, name: true, factionId: true },
      });

      if (gateway) {
        gatewayId = gateway.id;
        gatewayIp = gateway.ipAddress;
        gatewayName = gateway.name;
        factionId = gateway.factionId;
      } else {
        // No gateway — find any server in the network as link target
        const anyServer = await prisma.gameServer.findFirst({
          where: { networkId: network.id },
          select: { id: true, ipAddress: true, name: true, factionId: true },
          orderBy: { securityLevel: "asc" },
        });
        if (anyServer) {
          gatewayId = anyServer.id;
          gatewayIp = anyServer.ipAddress;
          gatewayName = anyServer.name;
          factionId = anyServer.factionId;
        }
      }
    }
  }

  return {
    type,
    zone,
    networkId,
    networkName,
    factionId,
    gatewayId,
    gatewayIp,
    gatewayName,
    securityLevel,
    firewallLevel,
    linkType,
    latency,
  };
}
