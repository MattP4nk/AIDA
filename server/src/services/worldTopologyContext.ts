/**
 * worldTopologyContext.ts — Builds a comprehensive world knowledge block
 * for AI prompts so the AI can reference real IPs, servers, networks, and forums.
 *
 * This is injected into AI system prompts for content generation,
 * Architect evaluations, persona actions, and investigation chains.
 *
 * Cached for 5 minutes to avoid repeated DB queries.
 */

import { PrismaClient } from "@prisma/client";

let cachedContext: string | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Build a comprehensive world topology summary for AI prompt injection.
 * Includes: IP range conventions, all networks with their servers, forums, and factions.
 */
export async function buildWorldTopologyContext(prisma: PrismaClient): Promise<string> {
  if (cachedContext && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedContext;
  }

  const [networks, servers, forums, factions] = await Promise.all([
    prisma.network.findMany({
      select: { id: true, name: true, zone: true, description: true },
      orderBy: { name: "asc" },
    }),
    prisma.gameServer.findMany({
      where: { isPlayerHome: false },
      select: {
        id: true, name: true, ipAddress: true, type: true, role: true,
        securityLevel: true, networkId: true, factionId: true, isPublic: true,
        accessMethod: true,
      },
      orderBy: { ipAddress: "asc" },
    }),
    prisma.forum.findMany({
      select: { id: true, name: true, url: true, category: true, factionId: true, isHoneypot: true },
      orderBy: { name: "asc" },
    }),
    prisma.faction.findMany({
      select: { id: true, name: true, shortName: true, isHidden: true },
    }),
  ]);

  // Build faction lookup
  const factionMap = new Map(factions.map(f => [f.id, f]));

  // Group servers by network
  const networkServers = new Map<string, typeof servers>();
  const standaloneServers: typeof servers = [];
  for (const server of servers) {
    if (server.networkId) {
      if (!networkServers.has(server.networkId)) networkServers.set(server.networkId, []);
      networkServers.get(server.networkId)!.push(server);
    } else {
      standaloneServers.push(server);
    }
  }

  const lines: string[] = [];

  lines.push("WORLD TOPOLOGY — Use this as your reference for ALL server IPs, names, and networks.");
  lines.push("When creating content, ONLY reference IPs and server names from this list.");
  lines.push("When you need a new server that doesn't exist, use an IP in the appropriate range.");
  lines.push("");

  // IP Range conventions
  lines.push("IP RANGE CONVENTIONS:");
  lines.push("  10.0.0.x       — Internet Exchange (public backbone)");
  lines.push("  10.10.10.x     — Training Network (tutorial, low security)");
  lines.push("  169.254.x.x    — Underground / dotHackers (VPN mesh, medium security)");
  lines.push("  172.16.0-1.x   — Corporate / CyberCorp (internal, high security)");
  lines.push("  172.16.99.x    — CyberCorp Black Sites (hidden, very high security)");
  lines.push("  192.168.x.x    — Government / Garrison (defense grid, high security)");
  lines.push("  198.51.100.x   — Phantom Network (rogue hackers, no faction)");
  lines.push("  203.0.113.x    — DarkNet (hidden, maximum security)");
  lines.push("");

  // Factions
  lines.push("FACTIONS:");
  for (const faction of factions) {
    if (faction.isHidden) continue;
    lines.push(`  ${faction.name} (${faction.shortName || "???"}) — ID: ${faction.id}`);
  }
  lines.push("");

  // Networks with servers
  lines.push("NETWORKS AND SERVERS:");
  for (const network of networks) {
    const srvs = networkServers.get(network.id) || [];
    const faction = srvs[0]?.factionId ? factionMap.get(srvs[0].factionId) : null;
    lines.push(`  [${network.name}] zone: ${network.zone || "unknown"}${faction ? ` | faction: ${faction.name}` : ""}`);
    for (const srv of srvs) {
      const access = srv.accessMethod !== "open" ? ` (${srv.accessMethod})` : "";
      lines.push(`    ${srv.ipAddress.padEnd(16)} ${srv.name} [${srv.role}] sec:${srv.securityLevel}${access}`);
    }
    lines.push("");
  }

  if (standaloneServers.length > 0) {
    lines.push("  [No Network]");
    for (const srv of standaloneServers) {
      lines.push(`    ${srv.ipAddress.padEnd(16)} ${srv.name} [${srv.role}] sec:${srv.securityLevel}`);
    }
    lines.push("");
  }

  // Forums
  lines.push("FORUMS:");
  for (const forum of forums) {
    const faction = forum.factionId ? factionMap.get(forum.factionId) : null;
    const honey = forum.isHoneypot ? " [HONEYPOT]" : "";
    lines.push(`  ${forum.url.padEnd(25)} ${forum.name}${faction ? ` (${faction.name})` : ""}${honey}`);
  }
  lines.push("");

  // Rules for AI
  lines.push("RULES FOR CONTENT GENERATION:");
  lines.push("  - When referencing a server, use its EXACT IP and name from the list above");
  lines.push("  - When referencing a forum, use its EXACT URL from the list above");
  lines.push("  - If you need to reference a server that DOESN'T exist, use an IP in the correct range for the zone");
  lines.push("  - Cross-reference between networks to create investigation trails");
  lines.push("  - A file on a Garrison server might mention a CyberCorp IP found in logs");
  lines.push("  - A dotHackers memo might reference a forum thread on underground.onion");
  lines.push("  - Partial IPs are OK for clues (e.g., '172.16.99.x' instead of the full address)");

  cachedContext = lines.join("\n");
  cacheTimestamp = Date.now();
  return cachedContext;
}

/**
 * Enrich a system prompt with world topology context.
 * Non-critical: returns the original prompt unchanged on any failure.
 */
export async function enrichWithTopology(
  basePrompt: string,
  prisma: PrismaClient,
  logger?: { warn?: (obj: any, msg: string) => void; debug?: (obj: any, msg: string) => void },
): Promise<string> {
  try {
    const topoCtx = await buildWorldTopologyContext(prisma);
    return `${basePrompt}\n\n${topoCtx}`;
  } catch (err) {
    logger?.debug?.({ err }, "Non-critical: failed to enrich prompt with topology context");
    return basePrompt;
  }
}

/**
 * Invalidate the cached topology context (call when servers/networks change).
 */
export function invalidateTopologyCache(): void {
  cachedContext = null;
  cacheTimestamp = 0;
}
