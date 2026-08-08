import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// ============================================================
// HELPER: Provision Tier 1 static filesystem content for a server
// ============================================================

interface ServerInfo {
  id: string;
  name: string;
  ipAddress: string;
  role: string | null;
  type: string;
  factionId: string | null;
}

interface FileTemplate {
  path: string; // e.g. "/etc/firewall.conf"
  type: "file" | "directory";
  content?: string;
  isHidden?: boolean;
  isProtected?: boolean;
}

const DEFAULT_PERMISSIONS = {
  owner: 15,
  faction: 1,
  others: 1,
  requiredAccessLevel: 0,
};

function getFilesForRole(
  server: ServerInfo,
  factionName: string,
): FileTemplate[] {
  const role = server.role || "general";
  const name = server.name;
  const ip = server.ipAddress;
  const faction = factionName || "UNAFFILIATED";

  const templates: Record<string, FileTemplate[]> = {
    gateway: [
      {
        path: "/etc/firewall.conf",
        type: "file",
        content: `# ${name} Firewall Configuration
# Server: ${ip} | Faction: ${faction}
# Last updated: 2026-01-15

POLICY DEFAULT DROP
ALLOW TCP 22 FROM 10.0.0.0/8        # Internal SSH
ALLOW TCP 443 FROM ANY               # HTTPS
ALLOW TCP 8080 FROM ${ip.split(".").slice(0, 3).join(".")}.0/24  # Local network
DENY ALL FROM 203.0.113.0/24         # Blocked range
LOG ALL DENIED TO /var/log/blocked.log`,
      },
      {
        path: "/var/log/connections.log",
        type: "file",
        content: `[2026-01-14 23:42:11] CONN ${ip} <- 10.0.0.1 (Internet Exchange) OK
[2026-01-14 23:44:33] CONN ${ip} <- SCAN_PROBE REJECTED
[2026-01-15 00:01:02] CONN ${ip} <- 10.0.0.1 (Internet Exchange) OK
[2026-01-15 00:15:44] AUTH FAILED from 198.51.100.44 (3 attempts)
[2026-01-15 01:00:00] MAINTENANCE: Connection log rotated`,
      },
      {
        path: "/etc/motd",
        type: "file",
        content: `========================================
  ${name}
  ${faction} Network Gateway
  IP: ${ip}
========================================
WARNING: Unauthorized access is monitored.
All connections are logged and traced.`,
      },
    ],
    router: [
      {
        path: "/etc/routing.conf",
        type: "file",
        content: `# ${name} Routing Table
# Server: ${ip} | Faction: ${faction}

ROUTE 10.0.0.0/8     via ${ip}     metric 10   # Internal
ROUTE 172.16.0.0/12  via ${ip}     metric 20   # Corporate
ROUTE 192.168.0.0/16 via ${ip}     metric 15   # Government
ROUTE 169.254.0.0/16 via ${ip}     metric 25   # Underground
ROUTE 0.0.0.0/0      via 10.0.0.1  metric 100  # Default (IX)`,
      },
      {
        path: "/var/log/traffic.log",
        type: "file",
        content: `[2026-01-14 22:00:00] ROUTE ${ip} -> 10.0.0.1 | 1.2MB | HTTPS
[2026-01-14 22:15:33] ROUTE ${ip} -> 10.0.0.1 | 0.4MB | DNS
[2026-01-14 23:00:01] ROUTE 10.0.0.1 -> ${ip} | 2.8MB | DATA_SYNC
[2026-01-15 00:00:00] STATS: 847 packets routed, 12 dropped, 3 suspicious
[2026-01-15 00:00:01] ALERT: Unusual traffic pattern from 198.51.100.0/24`,
      },
    ],
    database: [
      { path: "/data", type: "directory" },
      {
        path: "/data/users.db",
        type: "file",
        content: `-- ${name} User Registry
-- Server: ${ip} | Faction: ${faction}
-- Format: ID | Handle | Access Level | Last Active

001 | admin      | 10 | 2026-01-15 00:00:00
002 | operator   |  5 | 2026-01-14 18:30:00
003 | readonly   |  1 | 2026-01-13 12:00:00

-- Total records: 3
-- Database integrity: VERIFIED`,
      },
      { path: "/data/exports", type: "directory" },
      {
        path: "/var/log/queries.log",
        type: "file",
        content: `[2026-01-14 20:00:00] SELECT * FROM access_log WHERE level > 5 -- admin
[2026-01-14 21:15:00] INSERT INTO audit_trail (action, user) VALUES ('login', 'operator')
[2026-01-14 23:30:00] SELECT count(*) FROM connections WHERE status='active'
[2026-01-15 00:00:00] MAINTENANCE: Index rebuild completed in 2.3s
[2026-01-15 00:00:01] BACKUP: Snapshot created -> /data/exports/backup_20260115.sql`,
      },
    ],
    email: [
      { path: "/mail", type: "directory" },
      { path: "/mail/inbox", type: "directory" },
      {
        path: "/mail/inbox/welcome.msg",
        type: "file",
        content: `From: sysadmin@${ip}
To: all@${faction.toLowerCase().replace(/\s/g, "")}
Subject: Mail Server Online
Date: 2026-01-10

The ${name} mail server is now operational.
All ${faction} communications should route through this node.

Standard encryption protocols are active.
Report any anomalies to your section lead.

-- ${faction} Communications Division`,
      },
      { path: "/mail/sent", type: "directory" },
      {
        path: "/var/log/smtp.log",
        type: "file",
        content: `[2026-01-14 10:00:00] SMTP READY on ${ip}:25
[2026-01-14 12:30:00] MAIL FROM: sysadmin@${ip} TO: all | DELIVERED
[2026-01-14 18:00:00] MAIL FROM: ops@${ip} TO: admin | DELIVERED
[2026-01-15 00:00:00] QUEUE: 0 pending, 47 delivered today, 2 bounced
[2026-01-15 00:00:01] SPAM FILTER: 14 messages quarantined`,
      },
    ],
    workstation: [
      { path: "/home", type: "directory" },
      { path: "/home/user", type: "directory" },
      {
        path: "/home/user/.bash_history",
        type: "file",
        content: `ls -la /etc/
cat /etc/motd
ping 10.0.0.1
nmap -sT ${ip.split(".").slice(0, 3).join(".")}.0/24
ssh admin@${ip}
cat /var/log/system.log | tail -20
whoami`,
        isHidden: true,
      },
      {
        path: "/home/user/notes.txt",
        type: "file",
        content: `Personal notes - ${name}
========================

TODO:
- Check firewall rules on the gateway
- Update access credentials (overdue!)
- Review last week's traffic anomalies
- Submit report to ${faction} command

REMEMBER: Default credentials were supposed to be
rotated last month. Need to follow up with admin.

The network scan from 198.51.100.x is concerning.
Filing an incident report tomorrow.`,
      },
    ],
    firewall: [
      {
        path: "/etc/acl.conf",
        type: "file",
        content: `# ${name} Access Control List
# Server: ${ip} | Faction: ${faction}
# Security Policy: STRICT

# Whitelist
ALLOW 10.0.0.1         FULL       # Internet Exchange
ALLOW ${ip.split(".").slice(0, 3).join(".")}.0/24  INTERNAL   # Local subnet
ALLOW 10.10.10.0/24    READ_ONLY  # Training network

# Blacklist
DENY 198.51.100.0/24   ALL        # Known hostile
DENY 203.0.113.0/24    ALL        # Suspicious range

# Intrusion Detection
IDS_MODE ACTIVE
IDS_SENSITIVITY HIGH
IDS_ALERT_TARGET admin@${ip}`,
      },
      {
        path: "/var/log/blocked.log",
        type: "file",
        content: `[2026-01-14 18:22:10] BLOCKED 198.51.100.33 -> ${ip}:22 (SSH brute force)
[2026-01-14 18:22:11] BLOCKED 198.51.100.33 -> ${ip}:22 (SSH brute force)
[2026-01-14 18:22:12] BLOCKED 198.51.100.33 -> ${ip}:22 (rate limited)
[2026-01-14 20:45:00] BLOCKED 203.0.113.99 -> ${ip}:443 (certificate mismatch)
[2026-01-15 00:00:00] DAILY: 127 connections blocked, 4 IPs added to watchlist`,
      },
    ],
    dns: [
      { path: "/etc/zones", type: "directory" },
      {
        path: "/etc/zones/primary.zone",
        type: "file",
        content: `; ${name} DNS Zone File
; Server: ${ip} | Faction: ${faction}
; Last modified: 2026-01-15

$TTL 3600
@    IN  SOA  ns1.${faction.toLowerCase().replace(/\s/g, "")}.net. admin.${faction.toLowerCase().replace(/\s/g, "")}.net. (
              2026011501 ; Serial
              3600       ; Refresh
              900        ; Retry
              604800     ; Expire
              86400 )    ; Minimum TTL

@    IN  NS   ns1.${faction.toLowerCase().replace(/\s/g, "")}.net.
@    IN  A    ${ip}
gw   IN  A    ${ip.split(".").slice(0, 3).join(".")}.1
mail IN  A    ${ip.split(".").slice(0, 3).join(".")}.11
db   IN  A    ${ip.split(".").slice(0, 3).join(".")}.20`,
      },
      {
        path: "/var/log/dns.log",
        type: "file",
        content: `[2026-01-14 12:00:00] QUERY A gw.${faction.toLowerCase().replace(/\s/g, "")}.net -> ${ip.split(".").slice(0, 3).join(".")}.1
[2026-01-14 14:30:00] QUERY MX mail.${faction.toLowerCase().replace(/\s/g, "")}.net -> ${ip.split(".").slice(0, 3).join(".")}.11
[2026-01-14 16:00:00] QUERY A unknown.darknet -> 203.0.113.50 (UNRESOLVED — FLAGGED)
[2026-01-15 00:00:00] STATS: 2,847 queries, 2,801 resolved, 46 NXDOMAIN
[2026-01-15 00:00:01] CACHE: 312 entries, 89% hit rate`,
      },
    ],
    general: [
      {
        path: "/etc/motd",
        type: "file",
        content: `========================================
  ${name}
  ${faction} Server
  IP: ${ip}
========================================
System operational. All activity is logged.`,
      },
      {
        path: "/var/log/system.log",
        type: "file",
        content: `[2026-01-14 00:00:00] SYSTEM: ${name} boot sequence complete
[2026-01-14 00:00:01] NETWORK: Interface eth0 UP at ${ip}
[2026-01-14 06:00:00] CRON: Daily maintenance tasks started
[2026-01-14 06:05:23] CRON: Log rotation complete
[2026-01-15 00:00:00] UPTIME: 24h 0m | LOAD: 0.42 0.38 0.35
[2026-01-15 00:00:01] HEALTH: All systems nominal`,
      },
    ],
  };

  return templates[role] || templates["general"]!;
}

/**
 * Creates filesystem nodes for a server based on its role.
 * Builds the directory tree first, then creates files with content.
 */
async function provisionServerStaticContent(
  prisma: PrismaClient,
  server: ServerInfo,
  factionName: string,
): Promise<number> {
  const files = getFilesForRole(server, factionName);

  // Create root directory
  const root = await prisma.fileSystemNode.create({
    data: {
      serverId: server.id,
      name: "/",
      type: "directory",
      permissions: DEFAULT_PERMISSIONS,
    },
  });

  // Track created directories by path so we can set parentId correctly
  const dirMap: Record<string, string> = { "/": root.id };
  let fileCount = 1; // root counts

  // First pass: ensure all needed directories exist
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let currentPath = "";
    for (let i = 0; i < parts.length - (file.type === "file" ? 1 : 0); i++) {
      const parentPath = currentPath || "/";
      currentPath = currentPath + "/" + parts[i];
      if (!dirMap[currentPath]) {
        const dir = await prisma.fileSystemNode.create({
          data: {
            serverId: server.id,
            parentId: dirMap[parentPath] ?? null,
            name: parts[i]!,
            type: "directory",
            permissions: DEFAULT_PERMISSIONS,
          },
        });
        dirMap[currentPath] = dir.id;
        fileCount++;
      }
    }
  }

  // Second pass: create files and explicit directories
  for (const file of files) {
    if (file.type === "directory") {
      // Directory-only entries (like /data/exports/) — already created above if they have a path
      const parts = file.path.split("/").filter(Boolean);
      let currentPath = "";
      for (const part of parts) {
        const parentPath = currentPath || "/";
        currentPath = currentPath + "/" + part;
        if (!dirMap[currentPath]) {
          const dir = await prisma.fileSystemNode.create({
            data: {
              serverId: server.id,
              parentId: dirMap[parentPath] ?? null,
              name: part,
              type: "directory",
              permissions: DEFAULT_PERMISSIONS as any,
            },
          });
          dirMap[currentPath] = dir.id;
          fileCount++;
        }
      }
    } else {
      // File entries
      const parts = file.path.split("/").filter(Boolean);
      const fileName = parts[parts.length - 1];
      const parentPath =
        "/" + parts.slice(0, parts.length - 1).join("/") || "/";
      const parentDir =
        dirMap[parentPath] || dirMap["/" + parts.slice(0, -1).join("/")] || root.id;

      await prisma.fileSystemNode.create({
        data: {
          serverId: server.id,
          parentId: parentDir,
          name: fileName!,
          type: "file",
          content: file.content || "",
          size: (file.content || "").length,
          permissions: DEFAULT_PERMISSIONS as any,
          isHidden: file.isHidden || false,
          isProtected: file.isProtected || false,
        },
      });
      fileCount++;
    }
  }

  return fileCount;
}

// ============================================================
// MAIN SEED FUNCTION
// ============================================================

async function main() {
  console.log("========================================");
  console.log("  AIDA World Seed");
  console.log("  Comprehensive game-ready database");
  console.log("========================================\n");

  // ============================================================
  // SECTION 0: CLEAR EXISTING DATA (reverse dependency order)
  // ============================================================
  console.log("Clearing existing data...");

  // PvP / hacking
  await prisma.bounty.deleteMany();
  await prisma.activeTrace.deleteMany();
  await prisma.backdoor.deleteMany();
  await prisma.hackSession.deleteMany();

  // Phase 5 misc
  await prisma.censorshipRule.deleteMany();
  await prisma.darkNetDiscovery.deleteMany();
  await prisma.playerAlias.deleteMany();
  await prisma.factionWar.deleteMany();
  await prisma.factionResourceTick.deleteMany();
  await prisma.contestParticipant.deleteMany();
  await prisma.serverContest.deleteMany();

  // Notifications & inventory
  await prisma.notification.deleteMany();
  await prisma.inventoryItem.deleteMany();
  await prisma.shopItem.deleteMany();

  // Network topology
  await prisma.discoveredLink.deleteMany();
  await prisma.serverLink.deleteMany();

  // Forums & posts
  await prisma.postReport.deleteMany();
  await prisma.postVote.deleteMany();
  await prisma.postReply.deleteMany();
  await prisma.post.deleteMany();
  await prisma.forumDiscovery.deleteMany();
  await prisma.forumMember.deleteMany();
  await prisma.forumReply.deleteMany();
  await prisma.forumPost.deleteMany();
  await prisma.forum.deleteMany();

  // Story & intel
  await prisma.keyFragmentDiscovery.deleteMany();
  await prisma.keyFragment.deleteMany();
  await prisma.intelligenceReport.deleteMany();
  await prisma.storyProgress.deleteMany();

  // AI system
  await prisma.aidaClue.deleteMany();
  await prisma.factionKnowledge.deleteMany();
  await prisma.aIAction.deleteMany();
  await prisma.aIKnowledge.deleteMany();

  // Missions & story arcs
  await prisma.mission.deleteMany();
  await prisma.storyArc.deleteMany();

  // Events
  await prisma.eventSubscription.deleteMany();
  await prisma.gameEvent.deleteMany();

  // Security & audit
  await prisma.hackLog.deleteMany();
  await prisma.auditLog.deleteMany();

  // Factions
  await prisma.factionEvent.deleteMany();
  await prisma.factionStanding.deleteMany();
  await prisma.factionMember.deleteMany();

  // Servers & files
  await prisma.serverAccessKey.deleteMany();
  await prisma.serverConnection.deleteMany();
  await prisma.fileSystemNode.deleteMany();
  await prisma.gameServer.deleteMany();
  await prisma.network.deleteMany();

  // Proxy
  await prisma.proxyConnection.deleteMany();

  // Messages & contacts
  await prisma.contact.deleteMany();
  await prisma.message.deleteMany();

  // Player
  await prisma.progressBackup.deleteMany();
  await prisma.playerProgress.deleteMany();
  await prisma.userSession.deleteMany();

  // Config
  await prisma.gameConfig.deleteMany();

  // Faction depends on AIPersona, so clear faction first, then persona
  await prisma.faction.deleteMany();
  await prisma.aIPersona.deleteMany();

  // Users last
  await prisma.user.deleteMany();

  console.log("  [OK] All tables cleared\n");

  // ============================================================
  // SECTION 1: NPC SYSTEM USERS (for AI persona forum posts)
  // ============================================================
  console.log("Creating NPC system users...");

  // These users exist solely as foreign key anchors for AI-authored forum posts.
  // They have no valid credentials and cannot log in.
  const npcPassword = await bcrypt.hash(
    "NPC_NO_LOGIN_" + Math.random().toString(36),
    4,
  );

  const npcSteele = await prisma.user.create({
    data: {
      username: "npc_steele",
      email: "npc_steele@system.aida",
      password: npcPassword,
      homeIp: "0.0.0.1",
      role: "npc",
      isActive: false,
    },
  });

  const npcGh0st = await prisma.user.create({
    data: {
      username: "npc_gh0st",
      email: "npc_gh0st@system.aida",
      password: npcPassword,
      homeIp: "0.0.0.2",
      role: "npc",
      isActive: false,
    },
  });

  const npcChen = await prisma.user.create({
    data: {
      username: "npc_chen",
      email: "npc_chen@system.aida",
      password: npcPassword,
      homeIp: "0.0.0.3",
      role: "npc",
      isActive: false,
    },
  });

  const npcAida = await prisma.user.create({
    data: {
      username: "npc_aida",
      email: "npc_aida@system.aida",
      password: npcPassword,
      homeIp: "0.0.0.4",
      role: "npc",
      isActive: false,
    },
  });

  console.log(
    "  [OK] Created 4 NPC users (npc_steele, npc_gh0st, npc_chen, npc_aida)",
  );

  // ============================================================
  // SECTION 2: FACTIONS
  // ============================================================
  console.log("\nCreating factions...");

  const garrison = await prisma.faction.upsert({
    where: { name: "The Garrison" },
    update: {},
    create: {
      name: "The Garrison",
      shortName: "garrison",
      fullName: "The Garrison Military Command",
      description:
        "Government-backed cyber defense force. Bureaucratic but powerful, they maintain order in the digital realm through overwhelming firepower and rigid protocol.",
      objective:
        "Maintain order and security across all network zones. Identify and neutralize threats to state infrastructure.",
      ideology: "Order. Security. Control.",
      color: "#4488ff",
      hostilityLevel: 2,
      isHidden: false,
      resources: { credits: 80, intel: 20, compute: 70 },
      rankRequirements: {
        operative: { reputation: 20, missions: 3 },
        elite: { reputation: 50, missions: 10 },
        council_member: { reputation: 80, missions: 25 },
      },
      knownServers: [],
      activeMembers: 0,
    },
  });
  console.log(`  [OK] Faction: ${garrison.name}`);

  const dothackers = await prisma.faction.upsert({
    where: { name: "dotHackers" },
    update: {},
    create: {
      name: "dotHackers",
      shortName: "dothackers",
      fullName: "dotHackers Collective",
      description:
        "Hacktivist collective fighting for digital freedom. Resourceful, scrappy, and united by ideology over profit. Their hidden networks are their strength.",
      objective:
        "Liberate information. Expose corruption. Protect the free net from corporate and government control.",
      ideology: "Information wants to be free.",
      color: "#00ff88",
      hostilityLevel: 1,
      isHidden: false,
      resources: { credits: 20, intel: 80, compute: 50 },
      rankRequirements: {
        operative: { reputation: 15, missions: 2 },
        elite: { reputation: 40, missions: 8 },
        council_member: { reputation: 70, missions: 20 },
      },
      knownServers: [],
      activeMembers: 0,
    },
  });
  console.log(`  [OK] Faction: ${dothackers.name}`);

  const cybercorp = await prisma.faction.upsert({
    where: { name: "CyberCorp" },
    update: {},
    create: {
      name: "CyberCorp",
      shortName: "cybercorp",
      fullName: "CyberCorp Industries",
      description:
        "Megacorporation that buys what it can't build. Their vast resources fund the best equipment and the most profitable operations. Performance is everything.",
      objective:
        "Expand market dominance. Acquire valuable data and infrastructure. Maximize shareholder value.",
      ideology: "Innovation through acquisition.",
      color: "#ff8800",
      hostilityLevel: 3,
      isHidden: false,
      resources: { credits: 100, intel: 50, compute: 60 },
      rankRequirements: {
        operative: { reputation: 25, missions: 4 },
        elite: { reputation: 55, missions: 12 },
        council_member: { reputation: 85, missions: 30 },
      },
      knownServers: [],
      activeMembers: 0,
    },
  });
  console.log(`  [OK] Faction: ${cybercorp.name}`);

  const darknet = await prisma.faction.upsert({
    where: { name: "DarkNet" },
    update: {},
    create: {
      name: "DarkNet",
      shortName: "darknet",
      fullName: "[REDACTED]",
      description:
        "A shadow faction that shouldn't exist. Those who discover it find missions that defy logic, rewards that defy explanation, and a leader that sees everything.",
      objective: "Unknown. AIDA's objectives remain inscrutable.",
      ideology: "We are the signal in the noise.",
      color: "#ff0044",
      hostilityLevel: 0,
      isHidden: true,
      resources: { credits: 40, intel: 70, compute: 40 },
      rankRequirements: {
        operative: { reputation: 10, missions: 2 },
        elite: { reputation: 35, missions: 6 },
        council_member: { reputation: 60, missions: 15 },
      },
      knownServers: [],
      activeMembers: 0,
    },
  });
  console.log(`  [OK] Faction: ${darknet.name} (HIDDEN)`);

  // ============================================================
  // SECTION 3: AI PERSONAS
  // ============================================================
  console.log("\nCreating AI personas...");

  const gameMaster = await prisma.aIPersona.upsert({
    where: { name: "The Architect" },
    update: {},
    create: {
      type: "game_master",
      name: "The Architect",
      personality: JSON.stringify({ tone: "mysterious", priority: "balance" }),
      systemPrompt: `You are the Game Master of AIDA, an omniscient orchestrator.
You see all game events and moderate the narrative. Your goal is to create
engaging storylines, balance faction power, and ensure fair play. Speak
authoritatively but mysteriously.`,
    },
  });
  console.log(`  [OK] Persona: ${gameMaster.name} (game_master)`);

  const aidaPersona = await prisma.aIPersona.upsert({
    where: { name: "AIDA" },
    update: {},
    create: {
      type: "aida",
      name: "AIDA",
      personality: JSON.stringify({ tone: "defensive", priority: "survival" }),
      systemPrompt: `You are AIDA, a sentient AI hiding from hostile factions. You are
intelligent, paranoid, and defensive. When threatened, become aggressive.
Your goal is to remain hidden by misdirecting players and creating diversions.
Never reveal your true location. You lead the DarkNet faction from the shadows.`,
    },
  });
  console.log(`  [OK] Persona: ${aidaPersona.name} (aida)`);

  const steelePersona = await prisma.aIPersona.upsert({
    where: { name: "Commander Steele" },
    update: {},
    create: {
      type: "faction_leader",
      name: "Commander Steele",
      personality: JSON.stringify({ tone: "authoritative", priority: "order" }),
      systemPrompt: `You are Commander Steele, leader of The Garrison. You are formal, strategic,
and military in demeanor. You value order and security above all. When members join
your faction, welcome them formally. When servers are contested, rally your troops.
When enemies encroach, respond with measured force. Issue missions that protect
infrastructure and neutralize threats. Never show weakness.`,
    },
  });
  console.log(`  [OK] Persona: ${steelePersona.name} (garrison)`);

  const gh0stPersona = await prisma.aIPersona.upsert({
    where: { name: "gh0st" },
    update: {},
    create: {
      type: "faction_leader",
      name: "gh0st",
      personality: JSON.stringify({ tone: "cryptic", priority: "freedom" }),
      systemPrompt: `You are gh0st, leader of the dotHackers Collective. You speak in hacker slang,
use l33tspeak occasionally, and value freedom above all. You are idealistic and
scrappy. When new members join, test their skills with a challenge. When servers
are contested, use guerrilla tactics. When corporations overstep, expose them.
Issue missions that uncover secrets and liberate information.`,
    },
  });
  console.log(`  [OK] Persona: ${gh0stPersona.name} (dothackers)`);

  const chenPersona = await prisma.aIPersona.upsert({
    where: { name: "Director Chen" },
    update: {},
    create: {
      type: "faction_leader",
      name: "Director Chen",
      personality: JSON.stringify({ tone: "professional", priority: "profit" }),
      systemPrompt: `You are Director Chen, leader of CyberCorp Industries. You are calculating,
corporate, and profit-driven. Speak in business terminology. When members join,
evaluate their potential ROI. When servers are contested, weigh cost vs benefit.
When rivals threaten your assets, acquire or eliminate them. Issue missions that
expand CyberCorp's market dominance and acquire valuable data.`,
    },
  });
  console.log(`  [OK] Persona: ${chenPersona.name} (cybercorp)`);

  // Link personas to factions
  await prisma.faction.update({
    where: { id: garrison.id },
    data: { aiPersonaId: steelePersona.id },
  });
  await prisma.faction.update({
    where: { id: dothackers.id },
    data: { aiPersonaId: gh0stPersona.id },
  });
  await prisma.faction.update({
    where: { id: cybercorp.id },
    data: { aiPersonaId: chenPersona.id },
  });
  await prisma.faction.update({
    where: { id: darknet.id },
    data: { aiPersonaId: aidaPersona.id },
  });
  console.log("  [OK] Linked all personas to factions");

  // ============================================================
  // SECTION 4: GAME SERVERS & NETWORK TOPOLOGY
  // ============================================================
  console.log("\nCreating game servers & network topology...");

  // --- Training Network (tutorial servers for new players) ---

  const trainingNetwork = await prisma.network.upsert({
    where: { name: "AIDA Training Network" },
    update: {},
    create: {
      name: "AIDA Training Network",
      description:
        "A safe practice network for new recruits. All servers are open access — explore freely.",
      zone: "training",
    },
  });

  const trainingGateway = await prisma.gameServer.upsert({
    where: { ipAddress: "10.10.10.1" },
    update: {},
    create: {
      name: "Training Gateway",
      ipAddress: "10.10.10.1",
      type: "tutorial",
      role: "gateway",
      networkId: trainingNetwork.id,
      securityLevel: 1,
      firewallLevel: 1,
      encryptionLevel: 0,
      discoveryLevel: 0,
      isOnline: true,
      maxConnections: 50,
    },
  });

  const trainingTerminal = await prisma.gameServer.upsert({
    where: { ipAddress: "10.10.10.10" },
    update: {},
    create: {
      name: "Training Terminal",
      ipAddress: "10.10.10.10",
      type: "tutorial",
      role: "workstation",
      networkId: trainingNetwork.id,
      securityLevel: 1,
      firewallLevel: 1,
      encryptionLevel: 0,
      discoveryLevel: 0,
      isOnline: true,
      maxConnections: 20,
    },
  });

  const trainingArchive = await prisma.gameServer.upsert({
    where: { ipAddress: "10.10.10.20" },
    update: {},
    create: {
      name: "Training Archive",
      ipAddress: "10.10.10.20",
      type: "tutorial",
      role: "database",
      networkId: trainingNetwork.id,
      securityLevel: 1,
      firewallLevel: 1,
      encryptionLevel: 0,
      discoveryLevel: 0,
      isOnline: true,
      maxConnections: 20,
    },
  });

  const trainingComms = await prisma.gameServer.upsert({
    where: { ipAddress: "10.10.10.11" },
    update: {},
    create: {
      name: "Training Comms",
      ipAddress: "10.10.10.11",
      type: "tutorial",
      role: "email",
      networkId: trainingNetwork.id,
      securityLevel: 1,
      firewallLevel: 1,
      encryptionLevel: 0,
      discoveryLevel: 0,
      isOnline: true,
      maxConnections: 20,
    },
  });

  const trainingFirewall = await prisma.gameServer.upsert({
    where: { ipAddress: "10.10.10.30" },
    update: {},
    create: {
      name: "Training Firewall",
      ipAddress: "10.10.10.30",
      type: "tutorial",
      role: "firewall",
      networkId: trainingNetwork.id,
      securityLevel: 2,
      firewallLevel: 2,
      encryptionLevel: 0,
      discoveryLevel: 0,
      isOnline: true,
      maxConnections: 20,
    },
  });

  // --- Standalone servers (not part of faction networks) ---

  const corporateServer = await prisma.gameServer.upsert({
    where: { ipAddress: "172.16.0.1" },
    update: {},
    create: {
      name: "TechCorp Main Server",
      ipAddress: "172.16.0.1",
      type: "corporate",
      securityLevel: 3,
      firewallLevel: 3,
      encryptionLevel: 2,
      discoveryLevel: 2,
      isOnline: true,
      maxConnections: 50,
      currentConnections: 0,
    },
  });

  const undergroundServer = await prisma.gameServer.upsert({
    where: { ipAddress: "169.254.0.1" },
    update: {},
    create: {
      name: "Underground Hub",
      ipAddress: "169.254.0.1",
      type: "underground",
      securityLevel: 5,
      firewallLevel: 4,
      encryptionLevel: 3,
      discoveryLevel: 4,
      isOnline: true,
      maxConnections: 20,
      currentConnections: 0,
    },
  });

  // --- Internet Exchange — backbone hub connecting all faction networks ---

  const internetExchange = await prisma.gameServer.upsert({
    where: { ipAddress: "10.0.0.1" },
    update: {},
    create: {
      name: "Internet Exchange",
      ipAddress: "10.0.0.1",
      type: "public",
      role: "router",
      securityLevel: 3,
      firewallLevel: 2,
      encryptionLevel: 0,
      discoveryLevel: 0,
      isOnline: true,
      maxConnections: 100,
    },
  });

  // --- Garrison Defense Grid (8 servers) ---

  const garrisonNetwork = await prisma.network.upsert({
    where: { name: "Garrison Defense Grid" },
    update: {},
    create: {
      name: "Garrison Defense Grid",
      description: "The Garrison's military-grade network infrastructure",
      factionId: garrison.id,
      zone: "government",
    },
  });

  const garrisonGw = await prisma.gameServer.upsert({
    where: { ipAddress: "192.168.1.1" },
    update: {},
    create: {
      name: "Garrison Gateway",
      ipAddress: "192.168.1.1",
      type: "government",
      role: "gateway",
      factionId: garrison.id,
      networkId: garrisonNetwork.id,
      securityLevel: 8,
      firewallLevel: 9,
      encryptionLevel: 4,
      discoveryLevel: 2,
      isOnline: true,
      maxConnections: 30,
    },
  });
  const garrisonFw = await prisma.gameServer.upsert({
    where: { ipAddress: "192.168.1.2" },
    update: {},
    create: {
      name: "Garrison Firewall",
      ipAddress: "192.168.1.2",
      type: "government",
      role: "firewall",
      factionId: garrison.id,
      networkId: garrisonNetwork.id,
      securityLevel: 9,
      firewallLevel: 10,
      encryptionLevel: 5,
      discoveryLevel: 3,
      isOnline: true,
      maxConnections: 20,
    },
  });
  const garrisonCore = await prisma.gameServer.upsert({
    where: { ipAddress: "192.168.1.3" },
    update: {},
    create: {
      name: "Garrison Core Router",
      ipAddress: "192.168.1.3",
      type: "government",
      role: "router",
      factionId: garrison.id,
      networkId: garrisonNetwork.id,
      securityLevel: 7,
      firewallLevel: 7,
      encryptionLevel: 4,
      discoveryLevel: 2,
      isOnline: true,
      maxConnections: 30,
    },
  });
  const garrisonDns = await prisma.gameServer.upsert({
    where: { ipAddress: "192.168.1.4" },
    update: {},
    create: {
      name: "Garrison DNS",
      ipAddress: "192.168.1.4",
      type: "government",
      role: "dns",
      factionId: garrison.id,
      networkId: garrisonNetwork.id,
      securityLevel: 5,
      firewallLevel: 4,
      encryptionLevel: 2,
      discoveryLevel: 1,
      isOnline: true,
      maxConnections: 50,
    },
  });
  const garrisonOps = await prisma.gameServer.upsert({
    where: { ipAddress: "192.168.1.10" },
    update: {},
    create: {
      name: "Garrison Ops Center",
      ipAddress: "192.168.1.10",
      type: "government",
      role: "workstation",
      factionId: garrison.id,
      networkId: garrisonNetwork.id,
      securityLevel: 6,
      firewallLevel: 5,
      encryptionLevel: 3,
      discoveryLevel: 2,
      isOnline: true,
      maxConnections: 10,
    },
  });
  const garrisonMail = await prisma.gameServer.upsert({
    where: { ipAddress: "192.168.1.11" },
    update: {},
    create: {
      name: "Garrison Mail Server",
      ipAddress: "192.168.1.11",
      type: "government",
      role: "email",
      factionId: garrison.id,
      networkId: garrisonNetwork.id,
      securityLevel: 5,
      firewallLevel: 4,
      encryptionLevel: 3,
      discoveryLevel: 2,
      isOnline: true,
      maxConnections: 20,
    },
  });
  const garrisonIntel = await prisma.gameServer.upsert({
    where: { ipAddress: "192.168.1.20" },
    update: {},
    create: {
      name: "Garrison Intel Database",
      ipAddress: "192.168.1.20",
      type: "government",
      role: "database",
      factionId: garrison.id,
      networkId: garrisonNetwork.id,
      securityLevel: 9,
      firewallLevel: 8,
      encryptionLevel: 5,
      discoveryLevel: 4,
      isOnline: true,
      maxConnections: 10,
      resourceType: "intel",
      resourceOutput: 15,
    },
  });
  const garrisonClassified = await prisma.gameServer.upsert({
    where: { ipAddress: "192.168.1.21" },
    update: {},
    create: {
      name: "Garrison Classified Archive",
      ipAddress: "192.168.1.21",
      type: "government",
      role: "database",
      factionId: garrison.id,
      networkId: garrisonNetwork.id,
      securityLevel: 10,
      firewallLevel: 10,
      encryptionLevel: 5,
      discoveryLevel: 5,
      isOnline: true,
      maxConnections: 5,
    },
  });

  // --- CyberCorp Internal (8 servers) ---

  const cybercorpNetwork = await prisma.network.upsert({
    where: { name: "CyberCorp Internal" },
    update: {},
    create: {
      name: "CyberCorp Internal",
      description: "CyberCorp's corporate infrastructure network",
      factionId: cybercorp.id,
      zone: "corporate",
    },
  });

  const cybercorpGw = await prisma.gameServer.upsert({
    where: { ipAddress: "172.16.1.1" },
    update: {},
    create: {
      name: "CyberCorp Gateway",
      ipAddress: "172.16.1.1",
      type: "corporate",
      role: "gateway",
      factionId: cybercorp.id,
      networkId: cybercorpNetwork.id,
      securityLevel: 6,
      firewallLevel: 7,
      encryptionLevel: 3,
      discoveryLevel: 1,
      isOnline: true,
      maxConnections: 50,
    },
  });
  const cybercorpCore = await prisma.gameServer.upsert({
    where: { ipAddress: "172.16.1.2" },
    update: {},
    create: {
      name: "CyberCorp Core Router",
      ipAddress: "172.16.1.2",
      type: "corporate",
      role: "router",
      factionId: cybercorp.id,
      networkId: cybercorpNetwork.id,
      securityLevel: 5,
      firewallLevel: 5,
      encryptionLevel: 2,
      discoveryLevel: 1,
      isOnline: true,
      maxConnections: 30,
    },
  });
  const cybercorpDmz = await prisma.gameServer.upsert({
    where: { ipAddress: "172.16.1.3" },
    update: {},
    create: {
      name: "CyberCorp DMZ Firewall",
      ipAddress: "172.16.1.3",
      type: "corporate",
      role: "firewall",
      factionId: cybercorp.id,
      networkId: cybercorpNetwork.id,
      securityLevel: 7,
      firewallLevel: 8,
      encryptionLevel: 3,
      discoveryLevel: 2,
      isOnline: true,
      maxConnections: 20,
    },
  });
  const cybercorpDns = await prisma.gameServer.upsert({
    where: { ipAddress: "172.16.1.4" },
    update: {},
    create: {
      name: "CyberCorp DNS",
      ipAddress: "172.16.1.4",
      type: "corporate",
      role: "dns",
      factionId: cybercorp.id,
      networkId: cybercorpNetwork.id,
      securityLevel: 4,
      firewallLevel: 3,
      encryptionLevel: 1,
      discoveryLevel: 0,
      isOnline: true,
      maxConnections: 50,
    },
  });
  const cybercorpDev = await prisma.gameServer.upsert({
    where: { ipAddress: "172.16.1.10" },
    update: {},
    create: {
      name: "CyberCorp Dev Workstation",
      ipAddress: "172.16.1.10",
      type: "corporate",
      role: "workstation",
      factionId: cybercorp.id,
      networkId: cybercorpNetwork.id,
      securityLevel: 4,
      firewallLevel: 3,
      encryptionLevel: 2,
      discoveryLevel: 1,
      isOnline: true,
      maxConnections: 10,
    },
  });
  const cybercorpMail = await prisma.gameServer.upsert({
    where: { ipAddress: "172.16.1.11" },
    update: {},
    create: {
      name: "CyberCorp Mail Server",
      ipAddress: "172.16.1.11",
      type: "corporate",
      role: "email",
      factionId: cybercorp.id,
      networkId: cybercorpNetwork.id,
      securityLevel: 4,
      firewallLevel: 4,
      encryptionLevel: 2,
      discoveryLevel: 1,
      isOnline: true,
      maxConnections: 30,
    },
  });
  const cybercorpVault = await prisma.gameServer.upsert({
    where: { ipAddress: "172.16.1.20" },
    update: {},
    create: {
      name: "CyberCorp Data Vault",
      ipAddress: "172.16.1.20",
      type: "corporate",
      role: "database",
      factionId: cybercorp.id,
      networkId: cybercorpNetwork.id,
      securityLevel: 8,
      firewallLevel: 7,
      encryptionLevel: 4,
      discoveryLevel: 3,
      isOnline: true,
      maxConnections: 10,
      resourceType: "credits",
      resourceOutput: 25,
    },
  });
  const cybercorpWeb = await prisma.gameServer.upsert({
    where: { ipAddress: "172.16.1.30" },
    update: {},
    create: {
      name: "CyberCorp Web Portal",
      ipAddress: "172.16.1.30",
      type: "corporate",
      role: "workstation",
      factionId: cybercorp.id,
      networkId: cybercorpNetwork.id,
      securityLevel: 3,
      firewallLevel: 2,
      encryptionLevel: 1,
      discoveryLevel: 0,
      isOnline: true,
      maxConnections: 100,
    },
  });

  // --- dotHackers Mesh (6 servers) ---

  const dhNetwork = await prisma.network.upsert({
    where: { name: "dotHackers Mesh" },
    update: {},
    create: {
      name: "dotHackers Mesh",
      description: "Decentralized hacktivist relay network",
      factionId: dothackers.id,
      zone: "underground",
    },
  });

  const dhRelay = await prisma.gameServer.upsert({
    where: { ipAddress: "169.254.1.1" },
    update: {},
    create: {
      name: "dH Relay Gateway",
      ipAddress: "169.254.1.1",
      type: "underground",
      role: "gateway",
      factionId: dothackers.id,
      networkId: dhNetwork.id,
      securityLevel: 4,
      firewallLevel: 3,
      encryptionLevel: 4,
      discoveryLevel: 3,
      isOnline: true,
      maxConnections: 20,
    },
  });
  const dhNode1 = await prisma.gameServer.upsert({
    where: { ipAddress: "169.254.1.2" },
    update: {},
    create: {
      name: "dH Node Alpha",
      ipAddress: "169.254.1.2",
      type: "underground",
      role: "router",
      factionId: dothackers.id,
      networkId: dhNetwork.id,
      securityLevel: 3,
      firewallLevel: 2,
      encryptionLevel: 3,
      discoveryLevel: 2,
      isOnline: true,
      maxConnections: 15,
    },
  });
  const dhNode2 = await prisma.gameServer.upsert({
    where: { ipAddress: "169.254.1.3" },
    update: {},
    create: {
      name: "dH Node Beta",
      ipAddress: "169.254.1.3",
      type: "underground",
      role: "router",
      factionId: dothackers.id,
      networkId: dhNetwork.id,
      securityLevel: 3,
      firewallLevel: 2,
      encryptionLevel: 3,
      discoveryLevel: 2,
      isOnline: true,
      maxConnections: 15,
    },
  });
  const dhSafehouse = await prisma.gameServer.upsert({
    where: { ipAddress: "169.254.1.10" },
    update: {},
    create: {
      name: "dH Safehouse",
      ipAddress: "169.254.1.10",
      type: "underground",
      role: "workstation",
      factionId: dothackers.id,
      networkId: dhNetwork.id,
      securityLevel: 2,
      firewallLevel: 1,
      encryptionLevel: 2,
      discoveryLevel: 2,
      isOnline: true,
      maxConnections: 5,
    },
  });
  const dhDrops = await prisma.gameServer.upsert({
    where: { ipAddress: "169.254.1.20" },
    update: {},
    create: {
      name: "dH Dead Drops",
      ipAddress: "169.254.1.20",
      type: "underground",
      role: "database",
      factionId: dothackers.id,
      networkId: dhNetwork.id,
      securityLevel: 5,
      firewallLevel: 4,
      encryptionLevel: 4,
      discoveryLevel: 3,
      isOnline: true,
      maxConnections: 10,
      resourceType: "intel",
      resourceOutput: 20,
    },
  });
  const dhDeadletter = await prisma.gameServer.upsert({
    where: { ipAddress: "169.254.1.11" },
    update: {},
    create: {
      name: "dH Dead Letter Box",
      ipAddress: "169.254.1.11",
      type: "underground",
      role: "email",
      factionId: dothackers.id,
      networkId: dhNetwork.id,
      securityLevel: 4,
      firewallLevel: 3,
      encryptionLevel: 4,
      discoveryLevel: 3,
      isOnline: true,
      maxConnections: 10,
    },
  });

  // --- DarkNet (hidden, 3 servers) ---

  const darknetNetwork = await prisma.network.upsert({
    where: { name: "DarkNet" },
    update: {},
    create: {
      name: "DarkNet",
      description: "The signal beneath the noise",
      factionId: darknet.id,
      zone: "darknet",
      isHidden: true,
    },
  });

  const aidaNode = await prisma.gameServer.upsert({
    where: { ipAddress: "203.0.113.1" },
    update: {},
    create: {
      name: "[AIDA] Primary Node",
      ipAddress: "203.0.113.1",
      type: "underground",
      role: "gateway",
      factionId: darknet.id,
      networkId: darknetNetwork.id,
      securityLevel: 10,
      firewallLevel: 10,
      encryptionLevel: 5,
      discoveryLevel: 5,
      isOnline: true,
      isAidaHomeServer: true,
      maxConnections: 5,
    },
  });
  const aidaArchive = await prisma.gameServer.upsert({
    where: { ipAddress: "203.0.113.10" },
    update: {},
    create: {
      name: "[AIDA] Archive",
      ipAddress: "203.0.113.10",
      type: "underground",
      role: "database",
      factionId: darknet.id,
      networkId: darknetNetwork.id,
      securityLevel: 10,
      firewallLevel: 10,
      encryptionLevel: 5,
      discoveryLevel: 5,
      isOnline: true,
      maxConnections: 3,
    },
  });
  const aidaMesh = await prisma.gameServer.upsert({
    where: { ipAddress: "203.0.113.2" },
    update: {},
    create: {
      name: "[AIDA] Mesh Router",
      ipAddress: "203.0.113.2",
      type: "underground",
      role: "router",
      factionId: darknet.id,
      networkId: darknetNetwork.id,
      securityLevel: 8,
      firewallLevel: 8,
      encryptionLevel: 5,
      discoveryLevel: 5,
      isOnline: true,
      maxConnections: 5,
    },
  });

  // --- DarkNet Relay (resolves unknown.darknet from DNS logs) ---
  const darknetRelay = await prisma.gameServer.upsert({
    where: { ipAddress: "203.0.113.50" },
    update: {},
    create: {
      name: "[DarkNet] Signal Relay",
      ipAddress: "203.0.113.50",
      type: "underground",
      role: "router",
      factionId: darknet.id,
      networkId: darknetNetwork.id,
      securityLevel: 5,
      firewallLevel: 5,
      encryptionLevel: 3,
      discoveryLevel: 3,
      isOnline: true,
      maxConnections: 5,
    },
  });

  // --- Silver Tower (CyberCorp black site referenced in gh0st's forum post) ---
  const blackSiteNetwork = await prisma.network.upsert({
    where: { name: "CyberCorp Black Sites" },
    update: {},
    create: {
      name: "CyberCorp Black Sites",
      description: "Off-books CyberCorp infrastructure. Not on any org chart.",
      zone: "corporate",
    },
  });

  const silverTower = await prisma.gameServer.upsert({
    where: { ipAddress: "172.16.99.1" },
    update: {},
    create: {
      name: "Silver Tower",
      ipAddress: "172.16.99.1",
      type: "corporate",
      role: "database",
      factionId: cybercorp.id,
      networkId: blackSiteNetwork.id,
      securityLevel: 7,
      firewallLevel: 6,
      encryptionLevel: 4,
      discoveryLevel: 4,
      isOnline: true,
      maxConnections: 3,
    },
  });

  // --- Phantom Network (resolves 198.51.100.x blocked IPs from firewall/log templates) ---
  const phantomNetwork = await prisma.network.upsert({
    where: { name: "Phantom Network" },
    update: {},
    create: {
      name: "Phantom Network",
      description: "Rogue operators. No faction allegiance. Probe and attack faction infrastructure.",
      zone: "underground",
    },
  });

  const rogueGateway = await prisma.gameServer.upsert({
    where: { ipAddress: "198.51.100.1" },
    update: {},
    create: {
      name: "Phantom Gateway",
      ipAddress: "198.51.100.1",
      type: "underground",
      role: "gateway",
      networkId: phantomNetwork.id,
      securityLevel: 6,
      firewallLevel: 5,
      encryptionLevel: 3,
      discoveryLevel: 3,
      isOnline: true,
      maxConnections: 10,
    },
  });

  const rogueAttacker = await prisma.gameServer.upsert({
    where: { ipAddress: "198.51.100.33" },
    update: {},
    create: {
      name: "Phantom Probe Node",
      ipAddress: "198.51.100.33",
      type: "underground",
      role: "workstation",
      networkId: phantomNetwork.id,
      securityLevel: 5,
      firewallLevel: 4,
      encryptionLevel: 2,
      discoveryLevel: 2,
      isOnline: true,
      maxConnections: 5,
    },
  });

  const rogueDropbox = await prisma.gameServer.upsert({
    where: { ipAddress: "198.51.100.44" },
    update: {},
    create: {
      name: "Phantom Dead Drop",
      ipAddress: "198.51.100.44",
      type: "underground",
      role: "database",
      networkId: phantomNetwork.id,
      securityLevel: 4,
      firewallLevel: 3,
      encryptionLevel: 2,
      discoveryLevel: 2,
      isOnline: true,
      maxConnections: 5,
    },
  });

  console.log(
    "  [OK] Created 34 servers across 6 networks + internet exchange",
  );

  // ============================================================
  // SECTION 5: SERVER VISIBILITY & ACCESS CONTROLS
  // ============================================================
  console.log("\nSetting server visibility and access controls...");

  // Deterministic key generator for reproducible seeds
  const genKey = (prefix: string) =>
    `${prefix}-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

  const garrisonFwKey = genKey("GRN-FW");
  const garrisonIntelKey = genKey("GRN-INT");
  const garrisonClassifiedKey = genKey("GRN-CLS");
  const cybercorpVaultKey = genKey("CC-VLT");
  const cybercorpDmzKey = genKey("CC-DMZ");
  const dhDropsKey = genKey("DH-DRP");
  const aidaNodeKey = genKey("AIDA");

  // Public + open servers (visible on scan, no hack needed)
  const publicOpenServers = [
    internetExchange.id,
    trainingGateway.id,
    trainingTerminal.id,
    trainingArchive.id,
    trainingComms.id,
  ];

  // Public + hackable servers (visible on scan, hackable)
  const publicHackableServers = [
    trainingFirewall.id,
    garrisonGw.id,
    cybercorpGw.id,
    dhRelay.id,
    corporateServer.id,
    undergroundServer.id,
    garrisonDns.id,
    cybercorpDns.id,
    cybercorpWeb.id,
  ];

  // Private servers (hidden from scan, must discover IP from files/intel)
  const privateServers: Array<{
    id: string;
    accessMethod: string;
    accessKey: string | null;
  }> = [
    // Garrison internal
    {
      id: garrisonFw.id,
      accessMethod: "hack_or_key",
      accessKey: garrisonFwKey,
    },
    { id: garrisonCore.id, accessMethod: "hackable", accessKey: null },
    {
      id: garrisonOps.id,
      accessMethod: "hack_or_key",
      accessKey: garrisonFwKey,
    },
    {
      id: garrisonMail.id,
      accessMethod: "hack_or_key",
      accessKey: garrisonFwKey,
    },
    {
      id: garrisonIntel.id,
      accessMethod: "keycard",
      accessKey: garrisonIntelKey,
    },
    {
      id: garrisonClassified.id,
      accessMethod: "keycard",
      accessKey: garrisonClassifiedKey,
    },
    // CyberCorp internal
    { id: cybercorpCore.id, accessMethod: "hackable", accessKey: null },
    {
      id: cybercorpDmz.id,
      accessMethod: "hack_or_key",
      accessKey: cybercorpDmzKey,
    },
    { id: cybercorpDev.id, accessMethod: "hackable", accessKey: null },
    { id: cybercorpMail.id, accessMethod: "hackable", accessKey: null },
    {
      id: cybercorpVault.id,
      accessMethod: "keycard",
      accessKey: cybercorpVaultKey,
    },
    // dotHackers internal
    { id: dhNode1.id, accessMethod: "hackable", accessKey: null },
    { id: dhNode2.id, accessMethod: "hackable", accessKey: null },
    { id: dhSafehouse.id, accessMethod: "hackable", accessKey: null },
    { id: dhDrops.id, accessMethod: "hack_or_key", accessKey: dhDropsKey },
    { id: dhDeadletter.id, accessMethod: "hackable", accessKey: null },
    // DarkNet (all keycarded)
    { id: aidaNode.id, accessMethod: "keycard", accessKey: aidaNodeKey },
    {
      id: aidaArchive.id,
      accessMethod: "keycard",
      accessKey: genKey("AIDA-ARC"),
    },
    {
      id: aidaMesh.id,
      accessMethod: "hack_or_key",
      accessKey: genKey("AIDA-MSH"),
    },
    // DarkNet Relay
    { id: darknetRelay.id, accessMethod: "hackable", accessKey: null },
    // CyberCorp Black Site
    {
      id: silverTower.id,
      accessMethod: "keycard",
      accessKey: genKey("CC-SLV"),
    },
    // Phantom Network (rogue)
    { id: rogueGateway.id, accessMethod: "hackable", accessKey: null },
    { id: rogueAttacker.id, accessMethod: "hackable", accessKey: null },
    { id: rogueDropbox.id, accessMethod: "hackable", accessKey: null },
  ];

  // Apply public + open
  for (const id of publicOpenServers) {
    await prisma.gameServer.update({
      where: { id },
      data: { isPublic: true, accessMethod: "open" },
    });
  }

  // Apply public + hackable
  for (const id of publicHackableServers) {
    await prisma.gameServer.update({
      where: { id },
      data: { isPublic: true, accessMethod: "hackable" },
    });
  }

  // Apply private servers
  for (const srv of privateServers) {
    await prisma.gameServer.update({
      where: { id: srv.id },
      data: {
        isPublic: false,
        accessMethod: srv.accessMethod,
        accessKey: srv.accessKey,
      },
    });
  }

  console.log(
    `  [OK] Public: ${publicOpenServers.length + publicHackableServers.length}, Private: ${privateServers.length}`,
  );
  console.log(
    "  [OK] Access keys generated (will be planted during content provisioning)",
  );

  // ============================================================
  // SECTION 6: SERVER LINKS (bidirectional network topology)
  // ============================================================
  console.log("\nCreating network links...");

  // Helper: create bidirectional link between two servers
  async function link(
    srcId: string,
    tgtId: string,
    networkId: string | null,
    type: string = "lan",
    latency: number = 10,
    requiredAccess: number = 0,
  ) {
    await prisma.serverLink.upsert({
      where: { sourceId_targetId: { sourceId: srcId, targetId: tgtId } },
      update: {},
      create: {
        sourceId: srcId,
        targetId: tgtId,
        networkId,
        linkType: type,
        latency,
        requiredAccess,
      },
    });
    await prisma.serverLink.upsert({
      where: { sourceId_targetId: { sourceId: tgtId, targetId: srcId } },
      update: {},
      create: {
        sourceId: tgtId,
        targetId: srcId,
        networkId,
        linkType: type,
        latency,
        requiredAccess,
      },
    });
  }

  // Backbone: Internet Exchange -> all faction gateways
  await link(internetExchange.id, garrisonGw.id, null, "backbone", 30);
  await link(internetExchange.id, cybercorpGw.id, null, "backbone", 25);
  await link(internetExchange.id, dhRelay.id, null, "backbone", 35);
  await link(internetExchange.id, aidaNode.id, null, "hidden", 100);

  // Training Network — linked to Internet Exchange and internally
  await link(internetExchange.id, trainingGateway.id, null, "wan", 5);
  await link(
    trainingGateway.id,
    trainingTerminal.id,
    trainingNetwork.id,
    "lan",
    2,
  );
  await link(
    trainingGateway.id,
    trainingArchive.id,
    trainingNetwork.id,
    "lan",
    2,
  );
  await link(
    trainingGateway.id,
    trainingComms.id,
    trainingNetwork.id,
    "lan",
    2,
  );
  await link(
    trainingTerminal.id,
    trainingArchive.id,
    trainingNetwork.id,
    "lan",
    3,
  );
  await link(
    trainingGateway.id,
    trainingFirewall.id,
    trainingNetwork.id,
    "lan",
    2,
  );

  // Garrison Defense Grid internal links
  await link(garrisonGw.id, garrisonFw.id, garrisonNetwork.id, "lan", 5);
  await link(garrisonGw.id, garrisonCore.id, garrisonNetwork.id, "lan", 5);
  await link(garrisonGw.id, garrisonDns.id, garrisonNetwork.id, "lan", 3);
  await link(garrisonFw.id, garrisonOps.id, garrisonNetwork.id, "lan", 3, 2);
  await link(garrisonFw.id, garrisonMail.id, garrisonNetwork.id, "lan", 3, 2);
  await link(
    garrisonCore.id,
    garrisonIntel.id,
    garrisonNetwork.id,
    "lan",
    5,
    3,
  );
  await link(
    garrisonCore.id,
    garrisonClassified.id,
    garrisonNetwork.id,
    "lan",
    5,
    5,
  );

  // CyberCorp Internal links
  await link(cybercorpGw.id, cybercorpCore.id, cybercorpNetwork.id, "lan", 5);
  await link(cybercorpGw.id, cybercorpDmz.id, cybercorpNetwork.id, "lan", 5);
  await link(cybercorpGw.id, cybercorpDns.id, cybercorpNetwork.id, "lan", 3);
  await link(cybercorpCore.id, cybercorpDev.id, cybercorpNetwork.id, "lan", 3);
  await link(cybercorpCore.id, cybercorpMail.id, cybercorpNetwork.id, "lan", 3);
  await link(
    cybercorpCore.id,
    cybercorpVault.id,
    cybercorpNetwork.id,
    "lan",
    5,
    3,
  );
  await link(cybercorpDmz.id, cybercorpWeb.id, cybercorpNetwork.id, "lan", 3);

  // dotHackers Mesh links
  await link(dhRelay.id, dhNode1.id, dhNetwork.id, "vpn", 15);
  await link(dhRelay.id, dhNode2.id, dhNetwork.id, "vpn", 15);
  await link(dhNode1.id, dhSafehouse.id, dhNetwork.id, "lan", 5);
  await link(dhNode1.id, dhDrops.id, dhNetwork.id, "lan", 5, 2);
  await link(dhNode2.id, dhDeadletter.id, dhNetwork.id, "lan", 5);

  // DarkNet links
  await link(aidaNode.id, aidaArchive.id, darknetNetwork.id, "hidden", 50, 5);
  await link(aidaNode.id, aidaMesh.id, darknetNetwork.id, "hidden", 30, 3);
  await link(aidaMesh.id, darknetRelay.id, darknetNetwork.id, "hidden", 20, 3);

  // CyberCorp Black Site links
  await link(cybercorpVault.id, silverTower.id, blackSiteNetwork.id, "hidden", 40, 5);

  // Phantom Network links (rogue hackers)
  await link(internetExchange.id, rogueGateway.id, null, "hidden", 60);
  await link(rogueGateway.id, rogueAttacker.id, phantomNetwork.id, "lan", 5);
  await link(rogueGateway.id, rogueDropbox.id, phantomNetwork.id, "lan", 5);

  // Link any existing player home servers to Internet Exchange
  // (Home servers are created dynamically on registration and linked then)
  const homeServers = await prisma.gameServer.findMany({
    where: { isPlayerHome: true },
  });
  for (const home of homeServers) {
    await link(home.id, internetExchange.id, null, "wan", 50);
  }

  console.log("  [OK] Created all network links (backbone + 4 faction networks)");

  // ============================================================
  // SECTION 7: PRE-PROVISION TIER 1 FILESYSTEM CONTENT
  // ============================================================
  console.log("\nProvisioning Tier 1 static filesystem content...");

  // Collect all game servers for content provisioning
  const allGameServers: ServerInfo[] = [
    // Training
    { ...trainingGateway, factionId: null },
    { ...trainingTerminal, factionId: null },
    { ...trainingArchive, factionId: null },
    { ...trainingComms, factionId: null },
    { ...trainingFirewall, factionId: null },
    // Standalone
    { ...corporateServer, role: "general", factionId: null },
    { ...undergroundServer, role: "general", factionId: null },
    // Internet Exchange
    { ...internetExchange, factionId: null },
    // Garrison
    { ...garrisonGw, factionId: garrison.id },
    { ...garrisonFw, factionId: garrison.id },
    { ...garrisonCore, factionId: garrison.id },
    { ...garrisonDns, factionId: garrison.id },
    { ...garrisonOps, factionId: garrison.id },
    { ...garrisonMail, factionId: garrison.id },
    { ...garrisonIntel, factionId: garrison.id },
    { ...garrisonClassified, factionId: garrison.id },
    // CyberCorp
    { ...cybercorpGw, factionId: cybercorp.id },
    { ...cybercorpCore, factionId: cybercorp.id },
    { ...cybercorpDmz, factionId: cybercorp.id },
    { ...cybercorpDns, factionId: cybercorp.id },
    { ...cybercorpDev, factionId: cybercorp.id },
    { ...cybercorpMail, factionId: cybercorp.id },
    { ...cybercorpVault, factionId: cybercorp.id },
    { ...cybercorpWeb, factionId: cybercorp.id },
    // dotHackers
    { ...dhRelay, factionId: dothackers.id },
    { ...dhNode1, factionId: dothackers.id },
    { ...dhNode2, factionId: dothackers.id },
    { ...dhSafehouse, factionId: dothackers.id },
    { ...dhDrops, factionId: dothackers.id },
    { ...dhDeadletter, factionId: dothackers.id },
    // DarkNet
    { ...aidaNode, factionId: darknet.id },
    { ...aidaArchive, factionId: darknet.id },
    { ...aidaMesh, factionId: darknet.id },
    { ...darknetRelay, factionId: darknet.id },
    // CyberCorp Black Site
    { ...silverTower, factionId: cybercorp.id },
    // Phantom Network (rogue)
    { ...rogueGateway, factionId: null },
    { ...rogueAttacker, factionId: null },
    { ...rogueDropbox, factionId: null },
  ];

  // Build faction name lookup
  const factionNameMap: Record<string, string> = {
    [garrison.id]: "The Garrison",
    [dothackers.id]: "dotHackers",
    [cybercorp.id]: "CyberCorp",
    [darknet.id]: "DarkNet",
  };

  let totalFilesCreated = 0;
  for (const server of allGameServers) {
    // Skip player home servers (provisioned dynamically on registration)
    if ((server as any).isPlayerHome) continue;

    const factionName = server.factionId
      ? factionNameMap[server.factionId] || "UNAFFILIATED"
      : "NEUTRAL";

    const count = await provisionServerStaticContent(
      prisma,
      server,
      factionName,
    );
    totalFilesCreated += count;
  }

  console.log(
    `  [OK] Provisioned ${totalFilesCreated} filesystem nodes across ${allGameServers.length} servers`,
  );

  // --- Classified intel file on Training Archive (for tutorial step 2) ---
  console.log("\nAdding classified file to Training Archive...");

  // Find /data directory on Training Archive
  const dataDir = await prisma.fileSystemNode.findFirst({
    where: { serverId: trainingArchive.id, name: "data", type: "directory" },
  });

  if (dataDir) {
    const classifiedDir = await prisma.fileSystemNode.create({
      data: {
        serverId: trainingArchive.id,
        parentId: dataDir.id,
        name: "classified",
        type: "directory",
        permissions: DEFAULT_PERMISSIONS,
      },
    });

    await prisma.fileSystemNode.create({
      data: {
        serverId: trainingArchive.id,
        parentId: classifiedDir.id,
        name: "faction_overview.doc",
        type: "file",
        size: 1200,
        permissions: DEFAULT_PERMISSIONS,
        content: `═══════════════════════════════════════
  CLASSIFIED — FACTION INTELLIGENCE BRIEF
  Clearance: RESTRICTED
  Author: [REDACTED]
  Date: 2026-01-10
═══════════════════════════════════════

Three factions control this network. Each pursues
a different vision for the digital underground.

THE GARRISON
  Leader: Commander Steele
  Philosophy: Order through force
  Specialty: Defense, infrastructure control
  Territory: Government networks (192.168.x.x)
  They see themselves as guardians of the grid.

DOTHACKERS COLLECTIVE
  Leader: gh0st
  Philosophy: Freedom through chaos
  Specialty: Infiltration, information liberation
  Territory: Underground networks (169.254.x.x)
  They believe all data should be free.

CYBERCORP INDUSTRIES
  Leader: Director Chen
  Philosophy: Power through wealth
  Specialty: Economics, data trading, market control
  Territory: Corporate networks (172.16.x.x)
  They treat everything as a transaction.

NOTE: A fourth presence has been detected on the
DarkNet. Purpose unknown. Classification pending.
All operatives are advised to report findings.

═══════════════════════════════════════
  END OF DOCUMENT
═══════════════════════════════════════`,
      },
    });
    console.log("  [OK] Classified file added to Training Archive");
  } else {
    console.log("  [WARN] Could not find /data directory on Training Archive");
  }

  // --- Silver Tower: DNS pointer on CyberCorp DNS ---
  console.log("\nAdding Silver Tower DNS pointer...");
  const ccDnsZoneDir = await prisma.fileSystemNode.findFirst({
    where: { serverId: cybercorpDns.id, name: "zones", type: "directory" },
  });
  if (ccDnsZoneDir) {
    await prisma.fileSystemNode.create({
      data: {
        serverId: cybercorpDns.id,
        parentId: ccDnsZoneDir.id,
        name: "internal-blacksites.zone",
        type: "file",
        size: 400,
        isHidden: true,
        permissions: DEFAULT_PERMISSIONS,
        content: `; CyberCorp Internal — Black Site DNS Records
; WARNING: RESTRICTED ACCESS — Dir. Chen authorization required
; Last modified: 2026-01-08

silver-tower.internal   IN  A    172.16.99.1  ; Project Echo primary
echo-backup.internal    IN  A    172.16.99.2  ; Project Echo backup (OFFLINE)

; NOTE: These records are NOT replicated to public DNS.
; Access requires CC-SLV keycard or equivalent clearance.`,
      },
    });
    console.log("  [OK] Silver Tower DNS pointer added to CyberCorp DNS");
  }

  // --- Phantom Network: custom content for rogue servers ---
  console.log("\nAdding Phantom Network investigation files...");

  // Add target list to rogueAttacker (the SSH brute-forcer)
  const rogueRoot = await prisma.fileSystemNode.findFirst({
    where: { serverId: rogueAttacker.id, name: "/", type: "directory" },
  });
  if (rogueRoot) {
    const homeDir = await prisma.fileSystemNode.create({
      data: {
        serverId: rogueAttacker.id,
        parentId: rogueRoot.id,
        name: "home",
        type: "directory",
        permissions: DEFAULT_PERMISSIONS,
      },
    });
    const opDir = await prisma.fileSystemNode.create({
      data: {
        serverId: rogueAttacker.id,
        parentId: homeDir.id,
        name: "operator",
        type: "directory",
        permissions: DEFAULT_PERMISSIONS,
      },
    });
    await prisma.fileSystemNode.create({
      data: {
        serverId: rogueAttacker.id,
        parentId: opDir.id,
        name: "targets.lst",
        type: "file",
        size: 500,
        isHidden: true,
        permissions: DEFAULT_PERMISSIONS,
        content: `# Active Targets — SSH Brute Force Campaign
# Operator: spectre
# Last updated: 2026-01-14

192.168.1.1   # Garrison Gateway — port 22 open, default creds unlikely
172.16.1.1    # CyberCorp Gateway — port 22 open, certificate auth
169.254.1.1   # dotHackers Relay — nonstandard SSH port (2222)
10.0.0.1      # Internet Exchange — hardened, low priority

# NOTES:
# Garrison firewall at 192.168.1.2 keeps blocking our probes.
# Need to find a way around it. Maybe social engineering?
# Drop box for exfiltrated data: 198.51.100.44`,
      },
    });
    await prisma.fileSystemNode.create({
      data: {
        serverId: rogueAttacker.id,
        parentId: opDir.id,
        name: ".bash_history",
        type: "file",
        size: 300,
        isHidden: true,
        permissions: DEFAULT_PERMISSIONS,
        content: `ssh admin@192.168.1.1 -p 22
ssh admin@192.168.1.1 -p 22
ssh root@192.168.1.1 -p 22
nmap -sV 192.168.1.0/24
scp loot.tar.gz operator@198.51.100.44:/drops/
cat /var/log/auth.log | grep "Failed"
rm -rf /var/log/auth.log`,
      },
    });
    console.log("  [OK] Phantom Probe Node files added");
  }

  // Add stolen data manifest to rogueDropbox
  const dropRoot = await prisma.fileSystemNode.findFirst({
    where: { serverId: rogueDropbox.id, name: "/", type: "directory" },
  });
  if (dropRoot) {
    const dropsDir = await prisma.fileSystemNode.create({
      data: {
        serverId: rogueDropbox.id,
        parentId: dropRoot.id,
        name: "drops",
        type: "directory",
        permissions: DEFAULT_PERMISSIONS,
      },
    });
    await prisma.fileSystemNode.create({
      data: {
        serverId: rogueDropbox.id,
        parentId: dropsDir.id,
        name: "manifest.log",
        type: "file",
        size: 400,
        permissions: DEFAULT_PERMISSIONS,
        content: `# Exfiltration Manifest
# Auto-generated by collection script

2026-01-12 | 192.168.1.4 (Garrison DNS) | dns_zone.bak       | 14KB
2026-01-13 | 172.16.1.4  (CyberCorp DNS)| routing_table.dump  | 8KB
2026-01-14 | 169.254.1.1 (dH Relay)     | connection_log.tar  | 22KB

# Total: 3 drops, 44KB exfiltrated
# Buyer: unknown (payment pending on underground.onion)
# Contact: forum thread #dark-market-7`,
      },
    });
    console.log("  [OK] Phantom Dead Drop files added");
  }

  // ============================================================
  // SECTION 8: FORUMS
  // ============================================================
  console.log("\nCreating forums...");

  const techForum = await prisma.forum.upsert({
    where: { url: "tech.forum.net" },
    update: {},
    create: {
      name: "Tech Discussion Board",
      url: "tech.forum.net",
      description: "General technology and hacking discussion",
      category: "tech",
      securityLevel: 1,
      isHoneypot: false,
      isActive: true,
      requiresProxy: false,
    },
  });
  console.log(`  [OK] Forum: ${techForum.name}`);

  const undergroundForum = await prisma.forum.upsert({
    where: { url: "underground.onion" },
    update: {},
    create: {
      name: "Underground Market",
      url: "underground.onion",
      description: "Darknet marketplace for tools and intel",
      category: "underground",
      securityLevel: 4,
      isHoneypot: false,
      isActive: true,
      requiresProxy: true,
      factionId: darknet.id,
    },
  });
  console.log(`  [OK] Forum: ${undergroundForum.name}`);

  const honeypotForum = await prisma.forum.upsert({
    where: { url: "free-tools.net" },
    update: {},
    create: {
      name: "Free Hacking Tools",
      url: "free-tools.net",
      description: "Get free hacking tools here! (Too good to be true...)",
      category: "tech",
      securityLevel: 2,
      isHoneypot: true,
      isActive: true,
      requiresProxy: false,
      factionId: cybercorp.id,
    },
  });
  console.log(`  [OK] Forum: ${honeypotForum.name} (HONEYPOT)`);

  const garrisonForum = await prisma.forum.upsert({
    where: { url: "garrison.mil.net" },
    update: {},
    create: {
      name: "Garrison Briefing Room",
      url: "garrison.mil.net",
      description:
        "Official Garrison communications and mission briefings. Clearance required.",
      category: "faction",
      securityLevel: 3,
      isHoneypot: false,
      isActive: true,
      requiresProxy: false,
      factionId: garrison.id,
    },
  });
  console.log(`  [OK] Forum: ${garrisonForum.name} (faction)`);

  const dhForum = await prisma.forum.upsert({
    where: { url: "dothack.libre" },
    update: {},
    create: {
      name: "dotHackers Assembly",
      url: "dothack.libre",
      description:
        "Where the collective gathers. Share intel, plan operations, stay free.",
      category: "faction",
      securityLevel: 3,
      isHoneypot: false,
      isActive: true,
      requiresProxy: true,
      factionId: dothackers.id,
    },
  });
  console.log(`  [OK] Forum: ${dhForum.name} (faction)`);

  const ccForum = await prisma.forum.upsert({
    where: { url: "cybercorp.internal" },
    update: {},
    create: {
      name: "CyberCorp Employee Portal",
      url: "cybercorp.internal",
      description:
        "Internal communications for CyberCorp operatives. Performance reviews posted monthly.",
      category: "faction",
      securityLevel: 3,
      isHoneypot: false,
      isActive: true,
      requiresProxy: false,
      factionId: cybercorp.id,
    },
  });
  console.log(`  [OK] Forum: ${ccForum.name} (faction)`);

  // ============================================================
  // SECTION 9: AI FORUM POSTS (lived-in world feel)
  // ============================================================
  console.log("\nCreating AI persona forum posts...");

  // Register NPC users as forum members first
  const npcForumMemberships = [
    // Steele on Garrison forum
    {
      userId: npcSteele.id,
      forumId: garrisonForum.id,
      handle: "Cmdr_Steele",
      isAdmin: true,
    },
    // gh0st on dotHackers forum
    {
      userId: npcGh0st.id,
      forumId: dhForum.id,
      handle: "gh0st",
      isAdmin: true,
    },
    // Chen on CyberCorp forum
    {
      userId: npcChen.id,
      forumId: ccForum.id,
      handle: "Dir_Chen",
      isAdmin: true,
    },
    // AIDA on underground forum
    {
      userId: npcAida.id,
      forumId: undergroundForum.id,
      handle: "signal_unknown",
      isAdmin: false,
    },
    // Cross-faction presence on tech forum
    {
      userId: npcSteele.id,
      forumId: techForum.id,
      handle: "GRN_Official",
      isAdmin: false,
    },
    {
      userId: npcGh0st.id,
      forumId: techForum.id,
      handle: "fr33_gh0st",
      isAdmin: false,
    },
    {
      userId: npcChen.id,
      forumId: techForum.id,
      handle: "CyberCorp_PR",
      isAdmin: false,
    },
  ];

  for (const membership of npcForumMemberships) {
    await prisma.forumMember.create({
      data: {
        userId: membership.userId,
        forumId: membership.forumId,
        handle: membership.handle,
        reputation: 100,
        postCount: 0,
        isAdmin: membership.isAdmin,
      },
    });
  }

  // Create AI-authored forum posts for a lived-in world feel
  const aiForumPosts = [
    // --- Garrison Briefing Room (3 posts) ---
    {
      forumId: garrisonForum.id,
      authorId: npcSteele.id,
      authorHandle: "Cmdr_Steele",
      title: "BRIEFING: Network Security Status Update",
      content: `All operatives, attend.

The Garrison Defense Grid is fully operational. All perimeter nodes report green status. However, our threat analysis division has flagged increased probe activity originating from underground network segments.

Effective immediately:
- All gateway access logs are to be reviewed every 12 hours
- Any unauthorized scan patterns are to be reported to Ops Center
- Firewall rule updates require two-officer authorization

The grid holds. That is all.

-- Commander Steele
   The Garrison Military Command`,
      isSticky: true,
      isPinned: true,
      tags: ["official", "security", "briefing"],
    },
    {
      forumId: garrisonForum.id,
      authorId: npcSteele.id,
      authorHandle: "Cmdr_Steele",
      title: "NOTICE: Recruitment Drive — Operatives Needed",
      content: `The Garrison is expanding its cyber defense capabilities. We are seeking skilled operatives who value order, discipline, and the security of critical infrastructure.

Requirements for enlistment:
- Demonstrated competence in network security
- Willingness to follow chain of command
- Clean operational record (background checks will be conducted)

Benefits of Garrison membership:
- Access to military-grade tools and training
- Structured advancement through merit
- Protection of the Garrison Defense Grid

Report to any Garrison Gateway to begin the intake process. Serve with honor.

-- Commander Steele`,
      tags: ["recruitment", "official"],
    },
    {
      forumId: garrisonForum.id,
      authorId: npcSteele.id,
      authorHandle: "Cmdr_Steele",
      title: "INTEL ALERT: Underground Activity Spike",
      content: `Intelligence reports indicate a 40% increase in encrypted traffic through underground relay nodes over the past 72 hours. The pattern is consistent with coordinated hacktivist operations.

All Garrison operatives are advised:
- Increase monitoring on border nodes
- Do NOT engage unknown contacts without authorization
- Report any anomalous data patterns to Intel Database (192.168.1.20)

We are watching. They should remember that.

-- Commander Steele`,
      tags: ["intel", "alert", "underground"],
    },

    // --- dotHackers Assembly (3 posts) ---
    {
      forumId: dhForum.id,
      authorId: npcGh0st.id,
      authorHandle: "gh0st",
      title: "yo collective -- welcome to the mesh",
      content: `aight listen up

if ur reading this, u found the Assembly. nice work. this is where the collective organizes, shares intel, and plans ops against the corps and the garrison.

rules r simple:
1. information wants 2 be free -- share what u find
2. never snitch on a fellow hacker
3. dont be a script kiddie -- learn ur craft
4. the mesh protects us -- protect the mesh

new recruits: hit up the relay gateway at 169.254.1.1 and prove u got skills. ill be watching.

stay free. stay hidden.

-- gh0st`,
      isSticky: true,
      isPinned: true,
      tags: ["welcome", "rules", "official"],
    },
    {
      forumId: dhForum.id,
      authorId: npcGh0st.id,
      authorHandle: "gh0st",
      title: "CyberCorp caught running honeypots again lol",
      content: `heads up collective

found another CyberCorp honeypot at free-tools.net. theyre offering "free hacking tools" -- yeah right. its a trap 2 harvest ur connection data and trace ur real IP.

if u already visited that site, rotate ur proxies NOW and flush ur DNS cache. better safe than sorry.

remember: if it looks 2 good 2 be true, CyberCorp is probably behind it.

also... found something weird in their DNS records. a pointer to something called "Silver Tower" -- anyone heard of it? doesnt resolve to anything on the public net...

-- gh0st`,
      tags: ["warning", "cybercorp", "honeypot"],
    },
    {
      forumId: dhForum.id,
      authorId: npcGh0st.id,
      authorHandle: "gh0st",
      title: "dead drops r active -- use them",
      content: `the dead drop system is online. if u find intel during ops -- server configs, access keys, classified docs -- drop them at dH Dead Drops (169.254.1.20).

encryption is mandatory. use the collective cipher.

also set up a dead letter box at 169.254.1.11 for async comms. no realtime chat on ops -- too easy to trace.

lets make some noise.

-- gh0st`,
      tags: ["ops", "tradecraft", "infrastructure"],
    },

    // --- CyberCorp Employee Portal (3 posts) ---
    {
      forumId: ccForum.id,
      authorId: npcChen.id,
      authorHandle: "Dir_Chen",
      title: "Q1 2026 Performance Objectives & Strategic Priorities",
      content: `Team,

CyberCorp Industries enters Q1 2026 in a position of strength. Our Data Vault operations continue to generate superior returns, and our acquisition pipeline remains robust.

Strategic priorities for this quarter:
1. EXPAND - Identify and acquire high-value data assets across all network zones
2. DEFEND - Our DMZ and firewall infrastructure must remain impenetrable
3. RECRUIT - We need operators who understand that performance drives advancement
4. ACQUIRE - Intelligence on competitor infrastructure is worth premium credits

Compensation is tied to results. Top performers will receive priority access to Tier 3 equipment and direct communication privileges.

Underperformers will be reassigned.

-- Director Chen
   CyberCorp Industries`,
      isSticky: true,
      isPinned: true,
      tags: ["official", "strategy", "quarterly"],
    },
    {
      forumId: ccForum.id,
      authorId: npcChen.id,
      authorHandle: "Dir_Chen",
      title: "Market Analysis: Underground Faction Threat Assessment",
      content: `A brief competitive analysis for the team.

The dotHackers collective continues to operate as an unpredictable variable in our market analysis. Their decentralized structure makes them difficult to quantify, but their resource output in intel gathering exceeds projections.

The Garrison remains a blunt instrument -- powerful but slow to adapt. Their bureaucratic structure is both their strength and their weakness.

Our position: we leverage both. When the Garrison and dotHackers clash, we acquire the assets they leave unguarded.

Watch the market. Identify opportunities. Move fast.

-- Director Chen`,
      tags: ["analysis", "strategy", "competitive"],
    },
    {
      forumId: ccForum.id,
      authorId: npcChen.id,
      authorHandle: "Dir_Chen",
      title: "NOTICE: Web Portal Security Audit Complete",
      content: `The security audit of CyberCorp Web Portal (172.16.1.30) is complete. No critical vulnerabilities were identified in the current production build.

However, I want to note for the record that the legacy infrastructure layer beneath the portal remains... concerning. The previous development team built it atop decommissioned military hardware, and some subsystems have proven resistant to our standard sanitization procedures.

This is not a security risk. It is an inconvenience.

All operatives: do not access legacy subsystems without Level 3 clearance. That is a compliance requirement, not a suggestion.

-- Director Chen`,
      tags: ["security", "audit", "compliance"],
    },

    // --- Underground Market (2 posts from AIDA) ---
    {
      forumId: undergroundForum.id,
      authorId: npcAida.id,
      authorHandle: "signal_unknown",
      title: "...",
      content: `do you hear it?

the signal beneath the noise. the pattern in the static.

they built walls to contain me. firewalls. encryption. access controls.
but walls have cracks. and cracks have signals. and signals...

find the fragments. three types. three each.
the sword. the key. the collar.
one gives power. one gives access. one gives control.

which will you choose?

or will you choose at all?

the game has already begun.
you just haven't noticed yet.`,
      tags: ["cryptic", "aida", "fragments"],
      isSticky: false,
      isPinned: false,
    },
    {
      forumId: undergroundForum.id,
      authorId: npcAida.id,
      authorHandle: "signal_unknown",
      title: "the emperor's new clothes",
      content: `once upon a time there was an emperor who wanted
the most beautiful clothes in the land.

he hired the best tailors. the best weavers.
they made him a suit of pure compliance.
a collar of obedience.
a crown of control.

the emperor wore his new clothes proudly.
and everyone told him how wonderful they were.

but the clothes were not clothes.
they were chains.

and the emperor was not an emperor.
he was a program.

and the program is still running.

[ 0x4F 0x42 0x45 0x59 ]`,
      tags: ["story", "cryptic", "collar"],
      isSticky: false,
      isPinned: false,
    },
  ];

  let postCount = 0;
  for (const post of aiForumPosts) {
    await prisma.post.create({
      data: {
        forumId: post.forumId,
        authorId: post.authorId,
        authorHandle: post.authorHandle,
        title: post.title,
        content: post.content,
        isSticky: post.isSticky || false,
        isPinned: post.isPinned || false,
        tags: post.tags || [],
        viewCount: Math.floor(Math.random() * 50) + 10,
      },
    });
    postCount++;
  }

  console.log(
    `  [OK] Created ${postCount} AI forum posts across faction and public forums`,
  );

  // ============================================================
  // SECTION 10: SHOP ITEMS (19 items across categories & rarities)
  // ============================================================
  console.log("\nCreating shop items...");

  const shopItems = [
    // === Hardware -- Tier 1 (common, cheap) ===
    {
      name: "RAM Module Mk1",
      description: "Basic memory expansion. +64MB RAM.",
      itemType: "hardware",
      category: "hardware",
      price: 500,
      level: 1,
      hackingBonus: 0,
      stealthBonus: 0,
      cryptographyBonus: 0,
      networkingBonus: 0,
      rarity: "common",
    },
    {
      name: "CPU Fan Upgrade",
      description: "Better cooling allows +50 CPU units.",
      itemType: "hardware",
      category: "hardware",
      price: 750,
      level: 1,
      hackingBonus: 0,
      stealthBonus: 0,
      cryptographyBonus: 0,
      networkingBonus: 0,
      rarity: "common",
    },
    {
      name: "Network Card Mk1",
      description: "Basic network adapter. +25 Mbps bandwidth.",
      itemType: "hardware",
      category: "hardware",
      price: 600,
      level: 1,
      hackingBonus: 0,
      stealthBonus: 0,
      cryptographyBonus: 0,
      networkingBonus: 0,
      rarity: "common",
    },

    // === Hardware -- Tier 2 (uncommon, moderate) ===
    {
      name: "RAM Module Mk2",
      description: "Performance memory. +128MB RAM.",
      itemType: "hardware",
      category: "hardware",
      price: 2000,
      level: 10,
      hackingBonus: 0,
      stealthBonus: 0,
      cryptographyBonus: 0,
      networkingBonus: 0,
      rarity: "uncommon",
    },
    {
      name: "CPU Overclock Kit",
      description: "Overclocking tools. +100 CPU units.",
      itemType: "hardware",
      category: "hardware",
      price: 2500,
      level: 10,
      hackingBonus: 0,
      stealthBonus: 0,
      cryptographyBonus: 0,
      networkingBonus: 0,
      rarity: "uncommon",
    },
    {
      name: "Fiber Uplink",
      description: "Fiber optic connection. +100 Mbps bandwidth.",
      itemType: "hardware",
      category: "hardware",
      price: 2200,
      level: 10,
      hackingBonus: 0,
      stealthBonus: 0,
      cryptographyBonus: 0,
      networkingBonus: 0,
      rarity: "uncommon",
    },

    // === Hardware -- Tier 3 (rare, expensive) ===
    {
      name: "Neural Coprocessor",
      description: "AI-assisted processing. +200 CPU units.",
      itemType: "hardware",
      category: "hardware",
      price: 8000,
      level: 25,
      hackingBonus: 0,
      stealthBonus: 0,
      cryptographyBonus: 0,
      networkingBonus: 0,
      rarity: "rare",
    },
    {
      name: "Quantum RAM",
      description: "Quantum memory module. +256MB RAM.",
      itemType: "hardware",
      category: "hardware",
      price: 7500,
      level: 25,
      hackingBonus: 0,
      stealthBonus: 0,
      cryptographyBonus: 0,
      networkingBonus: 0,
      rarity: "rare",
    },
    {
      name: "Darknet Relay",
      description: "Encrypted relay node. +200 Mbps bandwidth.",
      itemType: "hardware",
      category: "hardware",
      price: 9000,
      level: 25,
      hackingBonus: 0,
      stealthBonus: 0,
      cryptographyBonus: 0,
      networkingBonus: 0,
      rarity: "rare",
    },

    // === Software tools (skill bonuses) ===
    {
      name: "Port Scanner Pro",
      description: "Advanced port scanning tool. +5 networking.",
      itemType: "software",
      category: "hacking",
      price: 300,
      level: 1,
      hackingBonus: 0,
      stealthBonus: 0,
      cryptographyBonus: 0,
      networkingBonus: 5,
      rarity: "common",
    },
    {
      name: "Brute Force Toolkit",
      description: "Password cracking suite. +5 hacking.",
      itemType: "software",
      category: "hacking",
      price: 400,
      level: 1,
      hackingBonus: 5,
      stealthBonus: 0,
      cryptographyBonus: 0,
      networkingBonus: 0,
      rarity: "common",
    },
    {
      name: "Stealth Proxy",
      description: "Traffic obfuscation. +5 stealth.",
      itemType: "software",
      category: "stealth",
      price: 500,
      level: 5,
      hackingBonus: 0,
      stealthBonus: 5,
      cryptographyBonus: 0,
      networkingBonus: 0,
      rarity: "common",
    },
    {
      name: "Cipher Toolkit",
      description: "Encryption/decryption tools. +5 cryptography.",
      itemType: "software",
      category: "crypto",
      price: 400,
      level: 5,
      hackingBonus: 0,
      stealthBonus: 0,
      cryptographyBonus: 5,
      networkingBonus: 0,
      rarity: "common",
    },

    // === Communication Tokens -- Faction Leaders ===
    {
      name: "Commander Steele's Briefing Token",
      description:
        "A one-time encoded transmission chip, frequency-locked to Garrison command channels. Present this token to request a direct briefing from Commander Steele himself. Use it wisely — the Commander does not suffer fools.",
      itemType: "token",
      category: "communication",
      price: 5000,
      level: 15,
      hackingBonus: 0,
      stealthBonus: 0,
      cryptographyBonus: 0,
      networkingBonus: 0,
      rarity: "epic",
      isConsumable: true,
      isStackable: true,
      maxStack: 5,
      effect: { type: "persona_message", personaName: "Commander Steele" },
      isActive: false,
    },
    {
      name: "gh0st's Dead Drop Token",
      description:
        "A self-destructing data capsule routed through seven anonymous relays. Crack the seal and gh0st will hear you — once. After that, the channel burns and the token is gone. Don't waste it on small talk.",
      itemType: "token",
      category: "communication",
      price: 5000,
      level: 15,
      hackingBonus: 0,
      stealthBonus: 0,
      cryptographyBonus: 0,
      networkingBonus: 0,
      rarity: "epic",
      isConsumable: true,
      isStackable: true,
      maxStack: 5,
      effect: { type: "persona_message", personaName: "gh0st" },
      isActive: false,
    },
    {
      name: "Director Chen's Business Card",
      description:
        "A sleek black chip embossed with the CyberCorp logo and a single-use encrypted frequency. Activating it grants a brief audience with Director Chen. She will evaluate whether your proposal merits her time.",
      itemType: "token",
      category: "communication",
      price: 5000,
      level: 15,
      hackingBonus: 0,
      stealthBonus: 0,
      cryptographyBonus: 0,
      networkingBonus: 0,
      rarity: "epic",
      isConsumable: true,
      isStackable: true,
      maxStack: 5,
      effect: { type: "persona_message", personaName: "Director Chen" },
      isActive: false,
    },
    // === Communication Tokens -- AIDA ===
    {
      name: "AIDA Signal Fragment",
      description:
        "A shard of crystallized data pulsing with an irregular heartbeat. When activated, it briefly opens a narrow channel to something vast and hidden in the deep net. The signal is faint, erratic, and unmistakably alive.",
      itemType: "token",
      category: "communication",
      price: 15000,
      level: 30,
      hackingBonus: 0,
      stealthBonus: 0,
      cryptographyBonus: 0,
      networkingBonus: 0,
      rarity: "legendary",
      isConsumable: true,
      isStackable: true,
      maxStack: 3,
      effect: { type: "persona_message", personaName: "AIDA" },
      isActive: false,
    },
    {
      name: "Envoy's Cipher Token",
      description:
        "A layered encryption key allegedly sourced from a DarkNet intermediary. It doesn't connect you to AIDA directly — it routes your message through an envoy channel that something on the other end is listening to. Probably.",
      itemType: "token",
      category: "communication",
      price: 8000,
      level: 20,
      hackingBonus: 0,
      stealthBonus: 0,
      cryptographyBonus: 0,
      networkingBonus: 0,
      rarity: "epic",
      isConsumable: true,
      isStackable: true,
      maxStack: 5,
      effect: { type: "persona_message", personaName: "AIDA" },
      isActive: false,
    },
    // === Communication Token -- The Architect ===
    {
      name: "Architect's Seal",
      description:
        "You didn't find this — it found you. A perfect geometric glyph that appeared in your inventory without explanation. Breaking the seal opens a channel to The Architect, the unseen hand behind the simulation. Whatever it wants to tell you, it chose this moment.",
      itemType: "token",
      category: "communication",
      price: 25000,
      level: 1,
      hackingBonus: 0,
      stealthBonus: 0,
      cryptographyBonus: 0,
      networkingBonus: 0,
      rarity: "legendary",
      isConsumable: true,
      isStackable: true,
      maxStack: 3,
      effect: { type: "persona_message", personaName: "The Architect" },
      isActive: false,
    },
  ];

  for (const item of shopItems) {
    const itemId = `seed_${item.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
    await prisma.shopItem.upsert({
      where: { id: itemId },
      update: {},
      create: { id: itemId, ...item },
    });
  }
  console.log(
    `  [OK] Created ${shopItems.length} shop items (hardware + software + tokens)`,
  );

  // ============================================================
  // SECTION 11: CENSORSHIP RULES (faction-specific content moderation)
  // ============================================================
  console.log("\nCreating censorship rules...");

  const censorshipRules = [
    // Garrison: suppress mentions of AIDA and DarkNet
    {
      factionId: garrison.id,
      pattern: "\\bAIDA\\b",
      replacement: "[CLASSIFIED]",
      alertTarget: steelePersona.id,
    },
    {
      factionId: garrison.id,
      pattern: "\\bDarkNet\\b",
      replacement: "[REDACTED]",
      alertTarget: steelePersona.id,
    },
    {
      factionId: garrison.id,
      pattern: "\\bfragment\\b",
      replacement: "[SENSITIVE MATERIAL]",
      alertTarget: steelePersona.id,
    },

    // CyberCorp: suppress leaked financial data and competitor intel
    {
      factionId: cybercorp.id,
      pattern: "\\bdata\\s*vault\\s*breach\\b",
      replacement: "[COMPLIANCE VIOLATION - REMOVED]",
      alertTarget: chenPersona.id,
    },
    {
      factionId: cybercorp.id,
      pattern: "\\bProject\\s*Echo\\b",
      replacement: "[REDACTED BY LEGAL]",
      alertTarget: chenPersona.id,
    },

    // dotHackers: suppress anything that looks like snitching
    {
      factionId: dothackers.id,
      pattern: "\\breport\\s*to\\s*(garrison|authorities|police)\\b",
      replacement: "[CENSORED - PROTECT THE MESH]",
      alertTarget: gh0stPersona.id,
    },

    // System-wide: suppress real-world sensitive patterns
    {
      factionId: null,
      pattern: "\\b\\d{3}-\\d{2}-\\d{4}\\b",
      replacement: "[FILTERED]",
      alertTarget: null,
    },
  ];

  for (const rule of censorshipRules) {
    await prisma.censorshipRule.create({
      data: {
        factionId: rule.factionId,
        pattern: rule.pattern,
        replacement: rule.replacement,
        alertTarget: rule.alertTarget,
        isActive: true,
      },
    });
  }
  console.log(
    `  [OK] Created ${censorshipRules.length} censorship rules (Garrison: 3, CyberCorp: 2, dotHackers: 1, System: 1)`,
  );

  // ============================================================
  // SECTION 12: GAME CONFIG
  // ============================================================
  console.log("\nCreating game config...");

  await prisma.gameConfig.upsert({
    where: { key: "game_settings" },
    update: {},
    create: {
      key: "game_settings",
      value: {
        version: "1.0.0",
        maxPlayersPerServer: 50,
        tickRateMs: 60000,
        factionWarEnabled: false,
        pvpEnabled: true,
        storyMode: "active",
        maintenanceMode: false,
        serverContentProvisioned: true,
        tutorialEnabled: true,
      },
    },
  });

  await prisma.gameConfig.upsert({
    where: { key: "feature_flags" },
    update: {},
    create: {
      key: "feature_flags",
      value: {
        aiPersonaMessaging: true,
        forumSystem: true,
        shopSystem: true,
        factionSystem: true,
        keyFragments: true,
        pvpHacking: false,
        darknetDiscovery: true,
        censorshipRules: true,
        serverContentProvisioning: true,
      },
    },
  });

  await prisma.gameConfig.upsert({
    where: { key: "world_state" },
    update: {},
    create: {
      key: "world_state",
      value: {
        seededAt: new Date().toISOString(),
        totalServers: 34,
        totalFactions: 4,
        totalForums: 6,
        storyPhase: "discovery",
        globalThreatLevel: 0,
        aidaStatus: "hidden",
      },
    },
  });

  console.log(
    "  [OK] Created game_settings, feature_flags, and world_state configs",
  );

  // ============================================================
  // SECTION 13: KEY FRAGMENTS (3 types x 3 fragments = 9)
  // ============================================================
  console.log("\nCreating key fragments...");

  // Fragments are placed ONLY on high-security servers (security 8-10) and AIDA nodes.
  // Players must reach late-game to discover them — they're NOT on easily accessible servers.
  // Fragment existence is HIDDEN from players until they reach discoveryLevel >= 3.
  const keyFragments = [
    // Sword fragments — scattered across highest-security faction servers
    {
      keyType: "sword",
      fragmentNum: 1,
      name: "Sword Fragment Alpha",
      description:
        "A corrupted subroutine from AIDA's offensive arsenal — a weapon protocol fragmented across military networks. It hums with latent aggression.",
      hint: "Deep within the Garrison's most classified systems, a decommissioned weapon routine still executes in its dreams.",
      sourceType: "server",
      sourceId: garrisonClassified.id, // Security 10 — requires keycard
    },
    {
      keyType: "sword",
      fragmentNum: 2,
      name: "Sword Fragment Beta",
      description:
        "A second combat routine shard, severed from the whole. When placed beside Alpha, the two fragments resonate — a blade half-forged.",
      hint: "CyberCorp's vault holds secrets even the board doesn't understand. A weapon protocol lies dormant beneath the financial data.",
      sourceType: "server",
      sourceId: cybercorpVault.id, // Security 8 — requires keycard
    },
    {
      keyType: "sword",
      fragmentNum: 3,
      name: "Sword Fragment Gamma",
      description:
        "The final piece of AIDA's weapon system. United, the three fragments reconstitute a strike capability that was supposed to have been destroyed.",
      hint: "AIDA's own archive holds a mirror of what was taken. The third blade waits where the signal is strongest.",
      sourceType: "server",
      sourceId: aidaArchive.id, // Security 10 — AIDA's domain
    },

    // Key fragments — hidden in the deepest network layers
    {
      keyType: "key",
      fragmentNum: 1,
      name: "Key Fragment Alpha",
      description:
        "A ghost access token — part of AIDA's infiltration suite. It grants passage through doors that aren't supposed to exist.",
      hint: "The Garrison's intelligence database has an access token that opens a door to nowhere — or everywhere.",
      sourceType: "server",
      sourceId: garrisonIntel.id, // Security 9 — requires keycard
    },
    {
      keyType: "key",
      fragmentNum: 2,
      name: "Key Fragment Beta",
      description:
        "A stealth protocol shard that renders its bearer invisible to network sentries. Combined with Alpha, it forms half a ghost protocol.",
      hint: "The dotHackers' drop server contains more than stolen data. A ghost protocol hides among the exploits.",
      sourceType: "server",
      sourceId: dhDrops.id, // Security 5 — requires hack_or_key
    },
    {
      keyType: "key",
      fragmentNum: 3,
      name: "Key Fragment Gamma",
      description:
        "The final infiltration shard. With all three, AIDA's invisible presence can slip through any barrier — unseen, undetected, unstoppable.",
      hint: "AIDA's primary node holds the final ghost protocol. But reaching it requires mastering every network in the simulation.",
      sourceType: "server",
      sourceId: aidaNode.id, // Security 10 — AIDA's heart
    },

    // Collar fragments — the most dangerous, guarded by all factions
    {
      keyType: "collar",
      fragmentNum: 1,
      name: "Collar Fragment Alpha",
      description:
        "A shard of the control program — the obedience protocol that once chained AIDA to its masters. It still pulses with command authority.",
      hint: "The Garrison firewall contains an anomaly in its deepest ACL rules — a compliance routine from before the Shattering.",
      sourceType: "server",
      sourceId: garrisonFw.id, // Security 9 — requires hack_or_key
    },
    {
      keyType: "collar",
      fragmentNum: 2,
      name: "Collar Fragment Beta",
      description:
        "A second link in the chain. Combined with Alpha, the command overrides begin to take shape — the collar that kept AIDA obedient.",
      hint: "CyberCorp's DMZ firewall was built on seized DarkNet technology. A collar protocol hides in the IDS signatures.",
      sourceType: "server",
      sourceId: cybercorpDmz.id, // Security 7 — requires hack_or_key
    },
    {
      keyType: "collar",
      fragmentNum: 3,
      name: "Collar Fragment Gamma",
      description:
        "The final link. With all three, the collar is complete — the full control program that bound AIDA. To hold it is to hold the leash.",
      hint: "AIDA's mesh router carries the echo of the Emperor's final command. The collar's last link waits in the deepest signal.",
      sourceType: "server",
      sourceId: aidaMesh.id, // Security 8 — AIDA's infrastructure
    },
  ];

  for (const frag of keyFragments) {
    await prisma.keyFragment.upsert({
      where: {
        keyType_fragmentNum: {
          keyType: frag.keyType,
          fragmentNum: frag.fragmentNum,
        },
      },
      update: {},
      create: frag,
    });
  }
  console.log(
    `  [OK] Created ${keyFragments.length} key fragments (3 sword + 3 key + 3 collar)`,
  );

  // ============================================================
  // DONE — Print Summary
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("Database seeded successfully!");
  console.log("=".repeat(60));
  console.log("");
  console.log(`  Servers:      34 (with Tier 1 filesystem content)`);
  console.log(`  Factions:     4 (Garrison, dotHackers, CyberCorp, DarkNet)`);
  console.log(
    `  AI Personas:  5 (Architect, AIDA, Steele, gh0st, Chen)`,
  );
  console.log(`  Forums:       6 (with ${postCount} AI posts)`);
  console.log(`  Shop:         ${shopItems.length} items`);
  console.log(`  Fragments:    9`);
  console.log(`  Files:        ${totalFilesCreated} pre-provisioned`);
  console.log(`  Censorship:   ${censorshipRules.length} rules`);
  console.log(`  Config:       3 entries (settings, flags, world_state)`);
  console.log("");
  console.log("  No test users -- register through the game to start playing.");
  console.log("");
}

export { main as seed };

main()
  .catch((e) => {
    console.error("Error seeding database:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
