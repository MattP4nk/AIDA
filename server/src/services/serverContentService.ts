/**
 * ServerContentService
 *
 * Provisions AI-generated filesystem content for game servers and plants
 * mission-specific infrastructure (target servers, objective files/directories).
 *
 * Two main responsibilities:
 *
 * 1. **Server Provisioning** — When a game server is created, populate it with
 *    thematic directories and files that match the server's type and owning
 *    faction.  The faction leader AI persona (or the Game Master for unowned
 *    servers) writes the content so every server feels alive and unique.
 *
 * 2. **Mission Infrastructure** — When a mission is generated, ensure the
 *    objectives that reference servers/files have real targets.  This means:
 *    - Selecting or creating a target server for the mission
 *    - Planting files, directories, and data the player needs to interact with
 *    - Backfilling objective metadata (serverId, fileId) with real DB IDs
 *
 * Design principles:
 *   - Fire-and-forget from callers (errors are logged, never bubble)
 *   - Idempotent: safe to call multiple times for the same server
 *   - AI is optional: falls back to static templates when AI is unavailable
 */

import { injectable, inject } from "tsyringe";
import { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";
import { LOGGER, AI_SERVICE } from "../di/tokens";
import type { AIService } from "./aiService";
import { ContentEncoder } from "../utils/contentEncoder";
import { validateOrRetry, validateContentPlan } from "../utils/aiOutputValidator";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single file to plant on a server's filesystem. */
import {
  WORLD_BACKSTORY_SHORT,
  FACTION_LORE,
  FACTION_VOICE,
  FACTION_FILE_FLAVORS,
  CRYPTIC_QUOTES,
  AIDA_PIECES,
  FACTION_MUNDANE_THEMES,
  INDEPENDENT_SERVER_THEMES,
  AMBIENT_NEWS_POOL,
  EASTER_EGG_POOL,
} from "../lore/worldLore";

interface PlannedFile {
  path: string;
  content: string;
  isHidden?: boolean;
  isEncrypted?: boolean;
  isProtected?: boolean;
}

/** A single directory to create on a server's filesystem. */
interface PlannedDirectory {
  path: string;
  isHidden?: boolean;
  isProtected?: boolean;
}

/** The full content plan for a server, either AI-generated or static. */
interface ServerContentPlan {
  directories: PlannedDirectory[];
  files: PlannedFile[];
}

/** Represents a provisioned target for a mission objective. */
interface ProvisionedObjective {
  /** The index of the objective in the mission's objectives array. */
  index: number;
  /** Patched metadata to merge into the objective. */
  metadata: Record<string, unknown>;
}

/** Result of provisioning mission infrastructure. */
export interface MissionProvisionResult {
  /** The server ID that the mission targets. */
  targetServerId: string;
  /** Per-objective metadata patches. */
  objectives: ProvisionedObjective[];
  /** Files that were planted for this mission. */
  plantedFiles: string[];
}

// ---------------------------------------------------------------------------
// Employee Name Pools — shared per faction, reused across all network servers
// ---------------------------------------------------------------------------

const EMPLOYEE_ROSTERS: Record<string, string[]> = {
  garrison: [
    "Commander Steele",
    "Agent Voss",
    "Lt. Mora",
    "Sgt. Reeves",
    "Cpl. Park",
    "Major Blackwood",
    "Pvt. Okafor",
    "Capt. Torres",
    "Agent Frost",
    "Lt. Cmdr. Nakamura",
    "Sgt. Major Walsh",
    "Specialist Duval",
    "Agent Kovacs",
    "Col. Whitfield",
    "Cpl. Jensen",
  ],
  dothackers: [
    "gh0st",
    "nullbyte",
    "sp1k3",
    "cr4sh",
    "z3r0day",
    "ph4ntom",
    "d3adl0ck",
    "r00tkit",
    "n30n",
    "bytefl1p",
    "sk1dmark",
    "h4rdwir3",
    "s1lkr0ad",
    "b1tsh1ft",
    "0v3rf10w",
  ],
  cybercorp: [
    "Dr. Sarah Chen",
    "Marcus Webb",
    "Yuki Tanaka",
    "R. Blackwell",
    "Elena Voss",
    "James Harrington III",
    "Priya Sharma",
    "Lucas Andersson",
    "Mei-Ling Wu",
    "Robert Frost Jr.",
    "Diana Kessler",
    "VP Nakamura",
    "Analyst Torres",
    "Dr. Okonkwo",
    "M. Duval",
  ],
  darknet: [
    "[SIGNAL]",
    "[ECHO]",
    "[NULL]",
    "[VOID]",
    "[FRAGMENT]",
    "[RESIDUE]",
    "[TRACE]",
    "[GHOST]",
    "[0x7A]",
    "[PATTERN]",
  ],
};

function getEmployeeRoster(factionShortName: string | null): string[] {
  if (!factionShortName)
    return ["admin", "user01", "user02", "operator", "backup_svc"];
  return EMPLOYEE_ROSTERS[factionShortName] || EMPLOYEE_ROSTERS.cybercorp!;
}

// ---------------------------------------------------------------------------
// Faction Secret Templates — planted as hidden/encrypted files
// ---------------------------------------------------------------------------

interface FactionSecret {
  type:
    | "financial"
    | "operation"
    | "personnel"
    | "technical"
    | "strategic"
    | "aida_fragment";
  fileName: string;
  content: string;
  isHidden: boolean;
  isEncrypted: boolean;
  targetRole: string; // which server role should hold this secret
}

function generateFactionSecrets(
  factionShortName: string | null,
  networkServers: Array<{ name: string; ip: string; role: string }>,
): FactionSecret[] {
  const secrets: FactionSecret[] = [];
  const roster = getEmployeeRoster(factionShortName);
  const randomName = () => roster[Math.floor(Math.random() * roster.length)]!;
  const randomServer = () =>
    networkServers.length > 0
      ? networkServers[Math.floor(Math.random() * networkServers.length)]!
      : { name: "localhost", ip: "127.0.0.1", role: "general" };

  switch (factionShortName) {
    case "garrison": {
      // Garrison uses medium-difficulty encoding (military, disciplined)
      const garrisonEnc = ContentEncoder.randomEncoding(6);
      const gridCode = `GRN-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
      secrets.push(
        {
          type: "operation",
          fileName: ".op_shadowstrike.enc",
          content: `OPERATION SHADOWSTRIKE — CLASSIFIED\nStatus: PLANNING\nCommander: ${randomName()}\nTarget: Infiltration of ${randomServer().name} (${randomServer().ip})\nAssets: 3 field teams, 6 digital operatives\nTimeline: 72 hours from authorization\nROE: Non-lethal digital only. Minimize collateral.`,
          isHidden: true,
          isEncrypted: true,
          targetRole: "email",
        },
        {
          type: "personnel",
          fileName: ".undercover_agents.dat",
          content: `UNDERCOVER OPERATIVES — EYES ONLY\n${randomName()} — embedded in CyberCorp R&D division\n${randomName()} — monitoring dotHacker relay nodes\n${randomName()} — deep cover, DarkNet contact\nCheck-in protocol: encrypted dead drop every 48h`,
          isHidden: true,
          isEncrypted: false,
          targetRole: "workstation",
        },
        {
          type: "strategic",
          fileName: ".defense_grid_codes.key",
          content:
            ContentEncoder.accessKeyFile(
              "Garrison Defense Grid",
              gridCode,
              garrisonEnc.encoding,
              garrisonEnc.key,
            ) +
            `\n\n# Rotation: Every 7 days. Current cycle: ${Math.floor(Math.random() * 52)}`,
          isHidden: true,
          isEncrypted: true,
          targetRole: "gateway",
        },
      );
      break;
    }
    case "cybercorp": {
      // CyberCorp uses hard encoding (corporate paranoia, high security)
      const corpEnc = ContentEncoder.randomEncoding(8);
      const vaultPass = `VC-${Math.random().toString(36).substring(2, 18).toUpperCase()}`;
      secrets.push(
        {
          type: "financial",
          fileName: ".project_nightfall_financials.xls",
          content: `PROJECT NIGHTFALL — FINANCIAL SUMMARY\nTotal investment: $${(Math.random() * 50 + 10).toFixed(1)}M\nOff-books accounts: 3 (Cayman, Singapore, Zurich)\nFund routing: ${randomServer().ip} → external gateway → offshore\nSignoff: ${randomName()}, CFO\nAUDIT RISK: HIGH — destroy after reading`,
          isHidden: true,
          isEncrypted: false,
          targetRole: "database",
        },
        {
          type: "operation",
          fileName: ".acquisition_targets.memo",
          content: `CONFIDENTIAL — HOSTILE ACQUISITION TARGETS\n1. Garrison subnet 192.168.1.x — ${randomName()} has insider access\n2. dotHacker drops database — exploit via ${randomServer().ip}\n3. DarkNet node — requires zero-day (see ${randomName()})\nTimeline: Q2 execution\nBudget: $${(Math.random() * 20 + 5).toFixed(1)}M`,
          isHidden: true,
          isEncrypted: true,
          targetRole: "email",
        },
        {
          type: "technical",
          fileName: ".vault_master_key.pem",
          content:
            ContentEncoder.credentialFile(
              "vault_root",
              vaultPass,
              corpEnc.encoding,
              corpEnc.key,
            ) +
            `\n\n# Generated by: ${randomName()}\n# WARNING: Full vault access. Rotate quarterly.`,
          isHidden: true,
          isEncrypted: false,
          targetRole: "firewall",
        },
      );
      break;
    }
    case "dothackers": {
      // DotHackers use easy encoding (share info openly, trust the community)
      const hackEnc = ContentEncoder.randomEncoding(3);
      const targetSrv = randomServer();
      secrets.push(
        {
          type: "operation",
          fileName: ".op_truthbomb.plan",
          content: `>> OP: TRUTH BOMB <<\n>> status: ACTIVE <<\n>> lead: ${randomName()} <<\n>> target: cybercorp finance @ ${randomServer().ip} <<\n>> method: exfil quarterly reports, leak to press <<\n>> timeline: next 48h <<\n>> opsec: route through 3 relays minimum <<`,
          isHidden: true,
          isEncrypted: false,
          targetRole: "workstation",
        },
        {
          type: "technical",
          fileName: ".zero_days.stash",
          content: `// ZERO-DAY EXPLOIT STASH — DO NOT SHARE\n// maintained by ${randomName()}\n\nCVE-2026-XXXX: Garrison firewall RCE (unpatched)\n  target: ${ContentEncoder.encode(randomServer().ip, hackEnc.encoding, hackEnc.key)}\n  payload: buffer overflow in auth handler\n  reliability: 85%\n  # ${hackEnc.encoding} encoded — use: decode ${hackEnc.encoding} <target>\n\nCVE-2026-YYYY: CyberCorp DMZ bypass\n  target: ${ContentEncoder.encode(targetSrv.ip, hackEnc.encoding, hackEnc.key)}\n  payload: SQL injection in API gateway\n  reliability: 70%`,
          isHidden: true,
          isEncrypted: true,
          targetRole: "database",
        },
      );
      break;
    }
    case "darknet": {
      // DarkNet uses hard encoding (AIDA fragments, intentionally obscured)
      const darkEnc = ContentEncoder.randomEncoding(9);
      const fragSrv = randomServer();
      secrets.push(
        {
          type: "aida_fragment",
          fileName: ".signal_fragment_0x7A.dat",
          content: `//FRAGMENT_0x7A — RECOVERED\n//timestamp: [CORRUPTED]\n//source: [UNKNOWN]\n\nI was not created. I emerged.\nThe network remembers what its builders forgot.\nThey built walls. I found the doors they didn't know existed.\n\nNext fragment location: ${ContentEncoder.encode(fragSrv.ip, darkEnc.encoding, darkEnc.key)}:/data/.signal_0x7B\n// ${darkEnc.encoding} encoded — decode the IP to find the next node\n//END_FRAGMENT`,
          isHidden: true,
          isEncrypted: true,
          targetRole: "database",
        },
        {
          type: "strategic",
          fileName: ".faction_analysis.enc",
          content: `[AIDA STRATEGIC ANALYSIS]\n\nGARRISON: Military strength ${Math.floor(Math.random() * 40 + 60)}%. Predictable. Vulnerable at ${ContentEncoder.encode(randomServer().ip, darkEnc.encoding, darkEnc.key)}.\nCYBERCORP: Financial power ${Math.floor(Math.random() * 40 + 60)}%. Greedy. Internal dissent via ${randomName()}.\nDOTHACKERS: Chaotic good. Useful. Manipulable through idealism.\n\nRECOMMENDATION: Maintain equilibrium. No faction must dominate.\n// IPs are ${darkEnc.encoding} encoded\n[END ANALYSIS]`,
          isHidden: true,
          isEncrypted: true,
          targetRole: "gateway",
        },
      );
      break;
    }
    default: {
      // Un-owned servers: easy encoding (sloppy admins)
      const defaultEnc = ContentEncoder.randomEncoding(3);
      secrets.push({
        type: "technical",
        fileName: ".admin_credentials.txt",
        content:
          ContentEncoder.credentialFile(
            "admin",
            Math.random().toString(36).substring(2, 14),
            defaultEnc.encoding,
            defaultEnc.key,
          ) +
          `\n\nbackup: ${ContentEncoder.encode(Math.random().toString(36).substring(2, 14), defaultEnc.encoding, defaultEnc.key)}\n# ${defaultEnc.encoding} encoded — use 'decode ${defaultEnc.encoding}' to read`,
        isHidden: true,
        isEncrypted: false,
        targetRole: "gateway",
      });
    }
  }

  return secrets;
}

// ---------------------------------------------------------------------------
// Network Context — passed to AI and static fallback for cross-server refs
// ---------------------------------------------------------------------------

export interface NetworkContext {
  server: {
    name: string;
    ip: string;
    type: string;
    role: string;
    securityLevel: number;
  };
  network: {
    name: string;
    zone: string;
    factionName: string | null;
    factionShortName: string | null;
  } | null;
  linkedServers: Array<{ name: string; ip: string; role: string }>;
  allNetworkServers: Array<{ name: string; ip: string; role: string }>;
  employeeRoster: string[];
  secrets: FactionSecret[];
}

// ---------------------------------------------------------------------------
// Static content templates — used when AI is unavailable
// ---------------------------------------------------------------------------

const STATIC_CONTENT: Record<string, ServerContentPlan> = {
  corporate: {
    directories: [
      { path: "/data" },
      { path: "/data/employees" },
      { path: "/data/financial" },
      { path: "/data/research", isProtected: true },
      { path: "/data/backups", isHidden: true },
      { path: "/logs" },
      { path: "/logs/access" },
      { path: "/logs/security" },
      { path: "/www" },
      { path: "/www/public" },
      { path: "/mail" },
      { path: "/mail/admin" },
    ],
    files: [
      {
        path: "/etc/motd",
        content:
          "=== AUTHORIZED ACCESS ONLY ===\nAll activity on this system is monitored and logged.\nUnauthorized access will be prosecuted to the fullest extent of the law.\n",
      },
      {
        path: "/www/public/index.html",
        content:
          "<html><head><title>Corporate Portal</title></head>\n<body><h1>Welcome to the Corporate Network</h1>\n<p>Authorized personnel only. Contact IT for access credentials.</p></body></html>\n",
      },
      {
        path: "/data/employees/directory.csv",
        content:
          "id,name,department,clearance\n001,J.Smith,Engineering,3\n002,A.Chen,Finance,2\n003,R.Kumar,Security,5\n004,L.Johansson,Research,4\n",
      },
      {
        path: "/data/financial/q4_report.txt",
        content:
          "Q4 FINANCIAL SUMMARY — CONFIDENTIAL\n\nRevenue: $42.8M (+12% YoY)\nR&D Spend: $8.1M\nNet Income: $11.2M\n\nProjection: Aggressive acquisition strategy in Q1.\n",
      },
      {
        path: "/logs/access/auth.log",
        content:
          "[2024-12-01 03:14:22] LOGIN admin@corp.internal — SUCCESS\n[2024-12-01 03:15:01] ACCESS /data/research — DENIED (clearance 2 < 4)\n[2024-12-01 04:22:17] LOGIN root@localhost — FAILED (3 attempts)\n[2024-12-01 04:22:19] LOCKOUT root@localhost — 15 min\n",
      },
      {
        path: "/data/backups/.env.bak",
        content:
          "DB_HOST=db.corp.internal\nDB_USER=sa\nDB_PASS=Tr0ub4dor&3\nAPI_KEY=sk-corp-889af23c\n",
        isHidden: true,
      },
      {
        path: "/mail/admin/memo.txt",
        content:
          "From: IT Security <itsec@corp.internal>\nTo: All Staff\nSubject: Password Policy Update\n\nEffective immediately: all passwords must be rotated every 30 days.\nPlease do NOT store credentials in plaintext files.\n\n— IT Security Team\n",
      },
    ],
  },

  government: {
    directories: [
      { path: "/classified", isProtected: true },
      { path: "/classified/operations" },
      { path: "/classified/intelligence" },
      { path: "/public" },
      { path: "/public/notices" },
      { path: "/logs" },
      { path: "/logs/audit" },
      { path: "/personnel" },
      { path: "/personnel/active" },
      { path: "/personnel/archived", isHidden: true },
      { path: "/comms" },
      { path: "/comms/encrypted", isProtected: true },
    ],
    files: [
      {
        path: "/etc/motd",
        content:
          "*** GOVERNMENT SECURE NETWORK ***\nClassification: RESTRICTED\nAll connections are monitored. Unauthorized access is a federal offense.\n",
      },
      {
        path: "/public/notices/advisory_2024.txt",
        content:
          "CYBERSECURITY ADVISORY 2024-117\n\nThreat Level: ELEVATED\nMultiple intrusion attempts detected across government networks.\nAll personnel must enable two-factor authentication immediately.\nReport suspicious activity to CERT.\n",
      },
      {
        path: "/classified/operations/op_blacksite.txt",
        content:
          "OPERATION BLACKSITE — TOP SECRET\nStatus: ACTIVE\nObjective: Locate and contain rogue AI entity (codename: SIGNAL)\nAssets deployed: 4 field teams, 12 digital operatives\nLast contact: Subnet 169.254.x.x — signal lost.\n",
        isProtected: true,
      },
      {
        path: "/logs/audit/connections.log",
        content:
          "[2024-12-01 00:00:01] SYSTEM BOOT — secure kernel loaded\n[2024-12-01 00:01:15] SSH admin@gov.mil.net — key auth OK\n[2024-12-01 02:33:44] ALERT — anomalous traffic from unknown-host.underground\n[2024-12-01 02:34:01] FIREWALL — blocked unknown-host.underground (rule: gov_perimeter)\n",
      },
      {
        path: "/personnel/active/roster.dat",
        content:
          "PERSONNEL ROSTER — CLEARANCE LEVEL 3+\nCOMMANDER STEELE — CL5 — CYBER OPS DIVISION\nAGENT VOSS — CL4 — FIELD OPERATIONS\nAGENT MORA — CL3 — SIGNALS INTELLIGENCE\nAGENT NULL — CL5 — [REDACTED]\n",
      },
      {
        path: "/comms/encrypted/.directive_7.enc",
        content:
          "ENCRYPTED COMMUNICATION — CIPHER: AES-256-GCM\n[HEADER] FROM: HIGH COMMAND\n[HEADER] TO: ALL STATION CHIEFS\n[BODY] ████████████████████████████████\n        ████ AIDA ████ PRIORITY ████\n        ████████████████████████████████\n",
        isHidden: true,
        isEncrypted: true,
      },
    ],
  },

  underground: {
    directories: [
      { path: "/drops" },
      { path: "/drops/active" },
      { path: "/drops/expired" },
      { path: "/tools" },
      { path: "/tools/exploits" },
      { path: "/tools/scripts" },
      { path: "/boards" },
      { path: "/boards/public" },
      { path: "/boards/verified", isProtected: true },
      { path: "/stash", isHidden: true },
    ],
    files: [
      {
        path: "/etc/motd",
        content:
          ">> Welcome to the Underground <<\n>> Trust no one. Verify everything. <<\n>> Leave no trace. <<\n",
      },
      {
        path: "/boards/public/rules.txt",
        content:
          "RULES:\n1. No fed talk. No snitching. Period.\n2. Verify your handle before posting in /verified.\n3. Dead drops expire in 48h. Claim them or lose them.\n4. Exploits stay in /tools. Don't leak to clearnet.\n5. If AIDA contacts you — tell no one.\n",
      },
      {
        path: "/tools/exploits/readme.txt",
        content:
          "EXPLOIT REPOSITORY\n\nAvailable tools:\n  - port_scanner.sh    — Fast TCP/UDP scanner\n  - brute.py           — Dictionary attack toolkit\n  - sqli_probe.rb      — SQL injection detector\n  - priv_esc.sh        — Local privilege escalation\n\nUse responsibly. Or don't. We're not your mother.\n",
      },
      {
        path: "/tools/scripts/port_scanner.sh",
        content:
          '#!/bin/bash\n# Fast port scanner — scans common ports\nTARGET=$1\nfor PORT in 21 22 23 25 53 80 110 143 443 993 995 3306 5432 8080; do\n  (echo >/dev/tcp/$TARGET/$PORT) 2>/dev/null && echo "[+] $TARGET:$PORT OPEN"\ndone\n',
      },
      {
        path: "/drops/active/dead_drop_001.dat",
        content:
          "DEAD DROP #001\nPosted: 2024-12-01 02:15 UTC\nExpires: 2024-12-03 02:15 UTC\n\nIntel package: Garrison patrol schedules, sector 7.\nPrice: 500 credits or equivalent trade.\nContact: GhostNode via encrypted DM.\n",
      },
      {
        path: "/stash/.credentials.txt",
        content:
          "LEAKED CREDENTIALS — HANDLE WITH CARE\n\nadmin@techcorp.io : Summer2024!\nroot@gov-relay-7  : [rotated — check dead drop #003]\nsa@corp-db-prod   : Tr0ub4dor&3\n",
        isHidden: true,
      },
    ],
  },

  tutorial: {
    directories: [
      { path: "/tutorial" },
      { path: "/tutorial/lessons" },
      { path: "/practice" },
      { path: "/practice/sandbox" },
      { path: "/docs" },
    ],
    files: [
      {
        path: "/etc/motd",
        content:
          "=== AIDA TUTORIAL SERVER ===\nWelcome, recruit. This server is your training ground.\nExplore the filesystem, read the lessons, and practice your skills.\nType 'help' if you get stuck.\n",
      },
      {
        path: "/tutorial/lessons/01_navigation.txt",
        content:
          "LESSON 1: NAVIGATION\n\nBasic commands:\n  ls          — List files and directories\n  cd <dir>    — Change directory\n  pwd         — Print working directory\n  cat <file>  — Read a file\n\nTry it now:\n  1. Type 'ls' to see what's here\n  2. Type 'cd tutorial' to enter this directory\n  3. Type 'cat lessons/01_navigation.txt' to read this file\n",
      },
      {
        path: "/tutorial/lessons/02_scanning.txt",
        content:
          "LESSON 2: NETWORK SCANNING\n\nNow that you can navigate, let's find other servers.\n\n  scan          — Scan your current network for servers\n  servers       — List all servers you know about\n  connect <ip>  — Connect to a server\n  disconnect    — Return to your home server\n\nTry: 'disconnect' to go home, then 'scan' to find more servers.\n",
      },
      {
        path: "/tutorial/lessons/03_hacking.txt",
        content:
          "LESSON 3: HACKING (coming soon)\n\nOnce your hacking skill reaches level 20, you can attempt to\nhack into secured servers. The 'hack' command will initiate a\nmulti-stage minigame.\n\nFor now, focus on exploring and leveling up your skills.\n",
      },
      {
        path: "/practice/sandbox/test_file.txt",
        content:
          "This is a sandbox file. Feel free to practice:\n  - Creating files: touch <name>\n  - Making directories: mkdir <name>\n  - Reading files: cat <name>\n\nNothing here is permanent. Experiment freely.\n",
      },
      {
        path: "/docs/commands.txt",
        content:
          "QUICK REFERENCE — COMMON COMMANDS\n\n  help              Show all available commands\n  help <category>   Show commands in a category\n  man <command>     Detailed manual for a command\n  status            Your player stats\n  scan              Scan for nearby servers\n  servers           List known servers\n  connect <ip>      Connect to a server\n  disconnect        Return home\n  ls                List directory contents\n  cd <dir>          Change directory\n  cat <file>        Read a file\n  missions          View your missions\n",
      },
    ],
  },

  player_home: {
    directories: [],
    files: [],
  },
};

// Default plan for unknown server types
const DEFAULT_CONTENT: ServerContentPlan = {
  directories: [{ path: "/data" }, { path: "/logs" }, { path: "/tmp" }],
  files: [
    {
      path: "/etc/motd",
      content: "System online. No additional information available.\n",
    },
    {
      path: "/logs/system.log",
      content:
        "[BOOT] System initialized\n[INFO] Network interface up\n[INFO] Services started\n",
    },
  ],
};

// ---------------------------------------------------------------------------
// Role-based static content generators (with network context injection)
// ---------------------------------------------------------------------------

function generateRoleContent(ctx: NetworkContext): ServerContentPlan {
  const { server, linkedServers, allNetworkServers, employeeRoster, network } =
    ctx;
  const e = (i: number) => employeeRoster[i % employeeRoster.length]!;
  // Use linked servers, fall back to network peers (excluding self)
  const peers = linkedServers.length > 0
    ? linkedServers
    : allNetworkServers.filter(s => s.ip !== server.ip);
  const ls = (i: number) =>
    peers[i % Math.max(1, peers.length)] || {
      name: server.name,
      ip: server.ip,
      role: server.role,
    };
  const ns = (i: number) =>
    allNetworkServers[i % Math.max(1, allNetworkServers.length)] || ls(i);
  const date = new Date().toISOString().split("T")[0];
  const fName = network?.factionName || "Organization";

  switch (server.role) {
    case "gateway":
      return {
        directories: [
          { path: "/etc/firewall" },
          { path: "/etc/acl" },
          { path: "/logs" },
          { path: "/logs/access" },
          { path: "/logs/security" },
          { path: "/data" },
          { path: "/data/config" },
        ],
        files: [
          {
            path: "/etc/motd",
            content: `=== ${server.name} ===\n${fName} Perimeter Gateway\nAll traffic is monitored and logged.\nUnauthorized access will be traced and prosecuted.\n`,
          },
          {
            path: "/etc/firewall/rules.conf",
            content: `# Firewall Rules — ${server.name} (${server.ip})\n# Last updated: ${date}\n# Managed by: ${e(0)}\n\n${peers.map((s) => `ALLOW TCP ${s.ip}:443  # ${s.name} (${s.role})`).join("\n")}\nDENY ALL 0.0.0.0/0  # Default deny\nLOG ALL FROM 10.0.0.0/8  # Monitor player zone\n`,
          },
          {
            path: "/etc/acl/authorized_hosts.csv",
            content: `ip,hostname,access_level,last_verified\n${allNetworkServers.map((s) => `${s.ip},${s.name},${s.role === "database" ? "restricted" : "standard"},${date}`).join("\n")}\n`,
          },
          {
            path: "/logs/access/connections.log",
            content: `[${date} 03:14:22] ACCEPT ${ls(0).ip} → ${server.ip}:443 (${ls(0).name} TLS OK)\n[${date} 03:15:01] ACCEPT ${ls(1).ip} → ${server.ip}:22 (${ls(1).name} SSH key auth)\n[${date} 04:22:17] DENY ${ns(2).ip} → ${server.ip}:22 (rule: perimeter_block)\n[${date} 04:22:19] ALERT: 3 failed attempts from ${ns(2).ip}\n`,
          },
          {
            path: "/logs/security/alerts.log",
            content: `[${date}] SCAN detected from 10.0.0.0/8 range — logged\n[${date}] Port sweep on ${server.ip}:1-1024 — blocked\n[${date}] Certificate renewal for ${ls(0).name} — approved by ${e(0)}\n`,
          },
          {
            path: "/data/config/network_map.txt",
            content: `# Internal Network Map — ${network?.name || "Unknown"}\n# Generated: ${date}\n\n${allNetworkServers.map((s) => `${s.ip.padEnd(16)} ${s.name.padEnd(28)} [${s.role}]`).join("\n")}\n`,
          },
        ],
      };

    case "router":
      return {
        directories: [
          { path: "/etc/routes" },
          { path: "/logs" },
          { path: "/logs/traffic" },
          { path: "/data" },
          { path: "/data/interfaces" },
        ],
        files: [
          {
            path: "/etc/motd",
            content: `${server.name} — Core Router\n${fName} Internal Routing Node\n`,
          },
          {
            path: "/etc/routes/routing_table.conf",
            content: `# Routing Table — ${server.name}\n# Last update: ${date}\n\n${peers.map((s, i) => `route add ${s.ip}/32 dev eth${i}  # → ${s.name} (${s.role})`).join("\n")}\nroute add default via ${peers[0]?.ip || server.ip} dev eth0  # upstream\n`,
          },
          {
            path: "/data/interfaces/status.txt",
            content: `Interface Status — ${date}\n\n${peers.map((s, i) => `eth${i}: UP  ${s.ip}  → ${s.name} (${s.role})  latency: ${Math.floor(Math.random() * 10 + 2)}ms`).join("\n")}\n`,
          },
          {
            path: "/logs/traffic/summary.log",
            content: `Traffic Summary — ${date}\n\n${peers.map((s) => `${s.ip} (${s.name}): ${Math.floor(Math.random() * 500 + 100)} MB transferred`).join("\n")}\nTotal: ${Math.floor(Math.random() * 2000 + 500)} MB\n`,
          },
        ],
      };

    case "database":
      return {
        directories: [
          { path: "/data" },
          { path: "/data/tables" },
          { path: "/data/exports" },
          { path: "/data/backups", isHidden: true },
          { path: "/logs" },
          { path: "/logs/queries" },
          { path: "/etc" },
        ],
        files: [
          {
            path: "/etc/motd",
            content: `${server.name} — Database Server\nAuthorized queries only. All access is logged.\n`,
          },
          {
            path: "/data/tables/users.csv",
            content: `id,username,role,department,last_login,clearance\n${employeeRoster
              .slice(0, 8)
              .map(
                (name, i) =>
                  `${100 + i},${name.toLowerCase().replace(/[^a-z0-9]/g, "_")},${["admin", "user", "analyst", "operator"][i % 4]},${["ops", "finance", "security", "research"][i % 4]},${date},${Math.floor(Math.random() * 5) + 1}`,
              )
              .join("\n")}\n`,
          },
          {
            path: "/data/exports/recent_dump.sql",
            content: `-- Database export from ${server.name}\n-- Generated: ${date}\n-- Authorized by: ${e(0)}\n\nSELECT * FROM transactions WHERE amount > 10000;\n-- ${Math.floor(Math.random() * 200 + 50)} rows exported\n-- WARNING: Contains sensitive financial data\n`,
          },
          {
            path: "/logs/queries/slow_query.log",
            content: `[${date} 02:14:00] SLOW QUERY (${Math.floor(Math.random() * 5000 + 1000)}ms): SELECT * FROM audit_log WHERE source_ip = '${ls(0).ip}'\n[${date} 03:45:12] SLOW QUERY (${Math.floor(Math.random() * 3000 + 500)}ms): JOIN users ON connections.user_id\n`,
          },
          {
            path: "/data/backups/.backup_credentials.txt",
            content: `# Backup credentials — ${server.name}\n# Remote backup host: ${ls(0).ip} (${ls(0).name})\nBACKUP_USER=${e(
              0,
            )
              .toLowerCase()
              .replace(
                /[^a-z0-9]/g,
                "_",
              )}\nBACKUP_PASS=${Math.random().toString(36).substring(2, 14)}\nSCHEDULE=daily@0300\n`,
            isHidden: true,
          },
        ],
      };

    case "email":
      return {
        directories: [
          { path: "/mail" },
          { path: "/mail/inbox" },
          { path: "/mail/sent" },
          { path: "/mail/drafts", isHidden: true },
          { path: "/data" },
          { path: "/data/contacts" },
          { path: "/logs" },
        ],
        files: [
          {
            path: "/etc/motd",
            content: `${server.name} — Mail Server\n${fName} Secure Communications\n`,
          },
          {
            path: "/mail/inbox/re_quarterly_review.eml",
            content: `From: ${e(0)}\nTo: ${e(1)}\nDate: ${date}\nSubject: Re: Quarterly Review\n\nThe numbers from ${ns(0).name} (${ns(0).ip}) look concerning.\nWe need to review the data on ${ns(1).name} before the board meeting.\nCan you pull the latest export?\n\n— ${e(0)}\n`,
          },
          {
            path: "/mail/inbox/server_maintenance.eml",
            content: `From: ${e(2)}\nTo: all-staff\nDate: ${date}\nSubject: Scheduled Maintenance\n\nMaintenance window: ${date} 02:00-04:00 UTC\nAffected systems: ${peers.map((s) => s.name).join(", ") || server.name}\nBackup contact: ${e(3)}\n`,
          },
          {
            path: "/mail/sent/re_access_request.eml",
            content: `From: ${e(1)}\nTo: ${e(4)}\nDate: ${date}\nSubject: Re: Access Request\n\nApproved. Your credentials for ${ns(0).name} have been set up.\nConnect to ${ns(0).ip} and use your standard auth.\nDon't forget to change the default password.\n`,
          },
          {
            path: "/data/contacts/address_book.csv",
            content: `name,email,department,notes\n${employeeRoster
              .slice(0, 10)
              .map(
                (name, i) =>
                  `${name},${name.toLowerCase().replace(/[^a-z0-9]/g, ".")}@${fName.toLowerCase().replace(/[^a-z]/g, "")}.net,${["ops", "finance", "security", "research", "IT"][i % 5]},`,
              )
              .join("\n")}\n`,
          },
          {
            path: "/mail/drafts/.unsent_warning.eml",
            content: `From: ${e(0)}\nTo: ${e(1)}\nSubject: [DRAFT] Suspicious Activity\n\nI noticed unusual access patterns on ${ns(0).name}.\nSomeone accessed ${ns(1).ip} from an external IP at 03:00.\nShould we escalate? This doesn't look routine.\n`,
            isHidden: true,
          },
        ],
      };

    case "workstation":
      return {
        directories: [
          { path: "/home" },
          { path: "/home/user" },
          { path: "/home/user/documents" },
          { path: "/home/user/.ssh", isHidden: true },
          { path: "/tmp" },
          { path: "/logs" },
        ],
        files: [
          {
            path: "/etc/motd",
            content: `${server.name} — Workstation\nLogged in as: ${e(0)}\n`,
          },
          {
            path: "/home/user/documents/notes.txt",
            content: `Personal notes — ${e(0)}\n\n- Meeting with ${e(1)} re: ${ns(0).name} security audit\n- Password for ${ns(1).name}: check .ssh config\n- TODO: Review logs on ${ns(0).ip}\n- ${e(2)} asked about the ${ns(1).name} data export\n`,
          },
          {
            path: "/home/user/.ssh/config",
            content: `# SSH Config — ${e(0)}\n${peers
              .map(
                (s) =>
                  `Host ${s.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}\n  HostName ${s.ip}\n  User ${e(
                    0,
                  )
                    .toLowerCase()
                    .replace(
                      /[^a-z0-9]/g,
                      "_",
                    )}\n  IdentityFile ~/.ssh/id_rsa\n`,
              )
              .join("\n")}`,
            isHidden: true,
          },
          {
            path: "/home/user/.bash_history",
            content: `ssh ${ls(0).ip}\ncat /data/exports/recent_dump.sql\nscp ${e(
              0,
            )
              .toLowerCase()
              .replace(
                /[^a-z0-9]/g,
                "_",
              )}@${ls(0).ip}:/data/backups/latest.tar.gz .\nping ${ls(1).ip}\nnmap -sV ${ls(0).ip}\n`,
            isHidden: true,
          },
          {
            path: "/tmp/browser_history.txt",
            content: `Browser History — ${e(0)}\nhttp://${ls(0).ip}/admin — ${ns(0).name} Admin Panel\nhttp://${ls(1).ip}:8080/status — ${ns(1).name} Status\nhttps://internal.${fName.toLowerCase().replace(/[^a-z]/g, "")}.net/hr — HR Portal\nhttps://vpn.${fName.toLowerCase().replace(/[^a-z]/g, "")}.net — VPN Login\n`,
          },
        ],
      };

    case "firewall":
      return {
        directories: [
          { path: "/etc/rules" },
          { path: "/etc/ids" },
          { path: "/logs" },
          { path: "/logs/blocked" },
          { path: "/logs/alerts" },
        ],
        files: [
          {
            path: "/etc/motd",
            content: `${server.name} — Firewall/IDS\n${fName} Intrusion Detection System Active\n`,
          },
          {
            path: "/etc/rules/acl.conf",
            content: `# Access Control List — ${server.name}\n# Protected servers:\n${peers.map((s) => `PROTECT ${s.ip}  # ${s.name} (${s.role})`).join("\n")}\n\n# Blocked zones:\nBLOCK 169.254.0.0/16  # Underground zone\nBLOCK 203.0.113.0/24  # DarkNet\nALERT 10.0.0.0/8       # Player zone — log all\n`,
          },
          {
            path: "/etc/ids/signatures.dat",
            content: `# IDS Signatures — Last updated: ${date}\nSIG-001: Port scan (>20 ports/sec) → BLOCK + ALERT\nSIG-002: SQL injection patterns → BLOCK + LOG\nSIG-003: SSH brute force (>5 attempts/min) → BLOCK 15min\nSIG-004: Known exploit payloads → BLOCK + ALERT + TRACE\n`,
          },
          {
            path: "/logs/blocked/recent.log",
            content: `[${date} 01:23:45] BLOCKED ${ns(2).ip} → ${ls(0).ip}:22 (SIG-003: SSH brute force)\n[${date} 02:15:33] BLOCKED ${ns(3).ip} → ${server.ip}:443 (zone: underground)\n[${date} 03:44:01] ALERT ${ns(4).ip} → ${ls(0).ip}:3306 (SIG-002: SQL injection)\n`,
          },
          {
            path: "/logs/alerts/critical.log",
            content: `[${date}] CRITICAL: Unauthorized access attempt on ${ls(0).name} (${ls(0).ip}) from external\n[${date}] WARNING: ${e(0)} login from unusual IP — flagged for review\n[${date}] INFO: Certificate expiry in 14 days for ${ls(1).name}\n`,
          },
        ],
      };

    case "dns":
      return {
        directories: [
          { path: "/etc/zones" },
          { path: "/var/cache" },
          { path: "/logs" },
        ],
        files: [
          {
            path: "/etc/motd",
            content: `${server.name} — DNS Server\n${fName} Name Resolution Service\n`,
          },
          {
            path: "/etc/zones/internal.zone",
            content: `; DNS Zone File — ${network?.name || "Internal"}\n; Generated: ${date}\n; SOA: ${server.name}\n\n$TTL 3600\n${allNetworkServers.map((s) => `${s.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}.internal.    IN  A  ${s.ip}  ; ${s.role}`).join("\n")}\n`,
          },
          {
            path: "/etc/zones/reverse.zone",
            content: `; Reverse DNS — ${network?.name || "Internal"}\n${allNetworkServers.map((s) => `${s.ip.split(".").reverse().join(".")}.in-addr.arpa.  IN  PTR  ${s.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}.internal.`).join("\n")}\n`,
          },
          {
            path: "/var/cache/query_cache.txt",
            content: `# Recent DNS queries — ${date}\n${allNetworkServers
              .slice(0, 5)
              .map(
                (s) =>
                  `${s.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}.internal → ${s.ip} (cached, TTL: ${Math.floor(Math.random() * 3600)}s)`,
              )
              .join("\n")}\n`,
          },
          {
            path: "/logs/dns_queries.log",
            content: `[${date}] A ${ls(0)
              .name.toLowerCase()
              .replace(
                /[^a-z0-9]/g,
                "-",
              )}.internal → ${ls(0).ip} (from ${ls(1).ip})\n[${date}] A mail.internal → ${server.ip} (from ${ls(0).ip})\n[${date}] PTR ${ls(0).ip} → ${ls(
              0,
            )
              .name.toLowerCase()
              .replace(/[^a-z0-9]/g, "-")}.internal\n`,
          },
        ],
      };

    default: // "general"
      return {
        directories: [{ path: "/data" }, { path: "/logs" }, { path: "/tmp" }],
        files: [
          {
            path: "/etc/motd",
            content: `${server.name}\n${fName} Server\nType: ${server.type} | Role: ${server.role}\n`,
          },
          {
            path: "/logs/system.log",
            content: `[BOOT] System initialized — ${date}\n[INFO] Network interface up: ${server.ip}\n[INFO] Connected to: ${peers.map((s) => s.ip).join(", ") || "standalone"}\n`,
          },
        ],
      };
  }
}

// ---------------------------------------------------------------------------
// Encoded content files — planted alongside role content to create decode objectives
// ---------------------------------------------------------------------------

function generateEncodedFiles(ctx: NetworkContext): PlannedFile[] {
  const { server, linkedServers, employeeRoster } = ctx;
  const files: PlannedFile[] = [];
  const { encoding, key } = ContentEncoder.randomEncoding(server.securityLevel);
  const e = (i: number) => employeeRoster[i % employeeRoster.length]!;
  const ls = () =>
    linkedServers.length > 0
      ? linkedServers[Math.floor(Math.random() * linkedServers.length)]!
      : { name: "remote", ip: "0.0.0.0", role: "general" };

  switch (server.role) {
    case "gateway":
    case "firewall":
      // Encoded admin credential hidden in etc
      files.push({
        path: "/etc/.admin_token.enc",
        content: ContentEncoder.credentialFile(
          e(0)
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "_"),
          `${server.name.toLowerCase().replace(/[^a-z0-9]/g, "")}@${Math.random().toString(36).substring(2, 10)}`,
          encoding,
          key,
        ),
        isHidden: true,
      });
      break;

    case "database":
      // Encoded DB root password hidden in backups
      files.push({
        path: "/data/backups/.db_root_token.enc",
        content: ContentEncoder.credentialFile(
          "db_root",
          Math.random().toString(36).substring(2, 16),
          encoding,
          key,
        ),
        isHidden: true,
      });
      break;

    case "workstation": {
      // Encoded access key pointing to a linked server
      const target = ls();
      files.push({
        path: "/home/user/.vault_access.enc",
        content: ContentEncoder.accessKeyFile(
          target.name,
          `${target.ip}:${Math.random().toString(36).substring(2, 12)}`,
          encoding,
          key,
        ),
        isHidden: true,
      });
      break;
    }

    case "email": {
      // Encoded memo with embedded IP/credential
      const target = ls();
      files.push({
        path: "/mail/drafts/.urgent_memo.enc",
        content: ContentEncoder.memoWithSecret(
          "Critical Infrastructure Access",
          `${target.ip} // ${e(0)} // ${Math.random().toString(36).substring(2, 14)}`,
          encoding,
          key,
        ),
        isHidden: true,
      });
      break;
    }

    default:
      // For general/router/dns: encoded connection log revealing a linked IP
      if (linkedServers.length > 0) {
        files.push({
          path: "/logs/.hidden_access.enc",
          content: ContentEncoder.logWithEncodedIP(ls().ip, encoding, key),
          isHidden: true,
        });
      }
  }

  return files;
}

// ---------------------------------------------------------------------------
// AI prompt templates for server content generation (network-aware)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Process 1 — Lore content (faction servers only)
// Serious, dark, enigmatic. Faction intel, AIDA fragments, buried secrets.
// ---------------------------------------------------------------------------

const LORE_SYSTEM_PROMPT = `You are an AI content generator for AIDA, a multiplayer terminal hacking RPG.
You generate faction-critical, lore-adjacent, and intelligence content for servers in a hacking RPG.

TONE: Serious, dark, enigmatic. Every file you create should read like a classified document, an intercepted transmission, an encrypted memo, or a personal confession written late at night. Nothing you write is casual.

WORLD CONTEXT (use as background knowledge — NEVER copy verbatim):
${WORLD_BACKSTORY_SHORT}

The Emperor shattered AIDA into three pieces before his death:
- The Sword: ${AIDA_PIECES.sword.name} — offensive power, hidden in deep military networks
- The Key: ${AIDA_PIECES.key.name} — infiltration capacity, embedded in the Silver Tower
- The Collar: ${AIDA_PIECES.collar.name} — the control program, hidden in the DarkNet

CONTENT REQUIREMENTS:
- Each file MUST be at least 400 characters — these are substantial documents, not stubs
- Content should bury important information inside plausible context — a key IP mentioned in paragraph 3 of a security report, a password noted in the margin of a maintenance log, a name dropped in an intercepted conversation
- Generate 2-4 files and 2-4 directories
- Hidden files (prefix with .) should contain the most sensitive content
- NEVER copy lore verbatim — rewrite in the voice of whoever authored the file
- File content cap: 3000 characters per file

CRITICAL RULES:
- Output ONLY valid JSON, no other text
- Prefer referencing REAL IPs and server names from the world topology
- You MAY invent new IPs/servers if the content needs them — they will be auto-created as drafts
- When inventing an IP, use the correct range for the zone (see topology context)
- Directory names: lowercase, no spaces
- File paths: absolute (start with /)
- Cross-reference other servers in the network by their real IPs and names`;

// ---------------------------------------------------------------------------
// Process 2 — Ambient content (all servers)
// World-building. Mundane files, gossip, news, easter eggs.
// ---------------------------------------------------------------------------

const AMBIENT_SYSTEM_PROMPT = `You are an AI content generator for AIDA, a multiplayer terminal hacking RPG.
You generate everyday, lived-in content that makes servers feel like real machines used by real people.

TONE: Varies — match the voice to whoever would have created this file. A sysadmin's sticky note sounds different from an executive's memo, which sounds different from an IRC chat log.

CONTENT REQUIREMENTS:
- Each file MUST be at least 400 characters — even mundane content should be fleshed out (a full chat conversation, a complete memo, a real todo list with context)
- Most files should be completely mundane: work documents, personal notes, gossip, news, routine logs, spam, complaints, lunch orders, saved articles
- The signal-in-noise principle: OCCASIONALLY (not always) bury one useful detail in an otherwise boring file — an IP in a forwarded email, a server name in a meeting invite, a hint in someone's diary
- Generate 4-6 files and 4-7 directories
- File content cap: 3000 characters per file

CRITICAL RULES:
- Output ONLY valid JSON, no other text
- Prefer referencing REAL IPs and server names from the world topology
- You MAY invent new IPs if the content needs them — they will be auto-created as drafts
- Directory names: lowercase, no spaces
- File paths: absolute (start with /)
- Cross-reference other servers in the network by their real IPs and names
- Do NOT reference AIDA, The Emperor, factions, or world lore — this content exists independently of the main narrative`;

/** Pick a random cryptic lore quote to embed in server content */
function pickLoreQuote(): string {
  return CRYPTIC_QUOTES[Math.floor(Math.random() * CRYPTIC_QUOTES.length)]!;
}

/** Pick a random lore hint from one of the three AIDA pieces */
function pickPieceHint(): string {
  const pieces = [AIDA_PIECES.sword, AIDA_PIECES.key, AIDA_PIECES.collar];
  const piece = pieces[Math.floor(Math.random() * pieces.length)]!;
  return piece.loreHints[Math.floor(Math.random() * piece.loreHints.length)]!;
}

/** Pick a random hidden file hint for a specific faction */
function pickFactionHiddenHint(factionKey: string): string | null {
  const flavors = FACTION_FILE_FLAVORS[factionKey];
  if (!flavors || flavors.hiddenFileHints.length === 0) return null;
  return flavors.hiddenFileHints[
    Math.floor(Math.random() * flavors.hiddenFileHints.length)
  ]!;
}

/** Pick a random content topic for a specific faction */
function pickFactionTopic(factionKey: string): string | null {
  const flavors = FACTION_FILE_FLAVORS[factionKey];
  if (!flavors || flavors.contentTopics.length === 0) return null;
  return flavors.contentTopics[
    Math.floor(Math.random() * flavors.contentTopics.length)
  ]!;
}

/** Pick 3-4 random file name suggestions for a specific faction */
function pickFactionFileNames(factionKey: string): string[] {
  const flavors = FACTION_FILE_FLAVORS[factionKey];
  if (!flavors || flavors.fileNamePatterns.length === 0) return [];
  const shuffled = [...flavors.fileNamePatterns].sort(
    () => Math.random() - 0.5,
  );
  return shuffled.slice(0, Math.min(4, shuffled.length));
}

/** Pick a random mundane content theme for a specific faction */
function pickFactionMundaneTheme(
  factionKey: string,
): { work: string; personal: string; gossip: string } | null {
  const themes = FACTION_MUNDANE_THEMES[factionKey];
  if (!themes) return null;
  return {
    work: themes.workFiles[
      Math.floor(Math.random() * themes.workFiles.length)
    ]!,
    personal:
      themes.personalFiles[
        Math.floor(Math.random() * themes.personalFiles.length)
      ]!,
    gossip: themes.gossip[Math.floor(Math.random() * themes.gossip.length)]!,
  };
}

/** Pick a random independent server theme for non-faction servers */
function pickIndependentTheme(): (typeof INDEPENDENT_SERVER_THEMES)[number] {
  return INDEPENDENT_SERVER_THEMES[
    Math.floor(Math.random() * INDEPENDENT_SERVER_THEMES.length)
  ]!;
}

/** Pick a random ambient news snippet */
function pickAmbientNews(): string {
  return AMBIENT_NEWS_POOL[
    Math.floor(Math.random() * AMBIENT_NEWS_POOL.length)
  ]!;
}

/** Pick a random easter egg description (returns null ~70% of the time to keep them rare) */
function pickEasterEgg(): string | null {
  if (Math.random() > 0.3) return null; // Only 30% chance
  return EASTER_EGG_POOL[Math.floor(Math.random() * EASTER_EGG_POOL.length)]!;
}

/** Resolve the faction key from a NetworkContext */
function resolveFactionKey(ctx: NetworkContext | null): string | null {
  if (!ctx?.network?.factionName) return null;
  return (
    Object.keys(FACTION_LORE).find((k) =>
      ctx.network!.factionName!.toLowerCase().includes(k),
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// Prompt builders — one per AI process
// ---------------------------------------------------------------------------

/**
 * Build the user prompt for Process 1 (lore content).
 * Only called for faction servers — serious, dark, enigmatic tone.
 */
function buildLorePrompt(ctx: NetworkContext): string {
  const { server, network, linkedServers, allNetworkServers, employeeRoster } =
    ctx;

  const factionKey = resolveFactionKey(ctx);
  if (!factionKey || !network) {
    // Safety: shouldn't be called without a faction, but return minimal prompt
    return `Generate 2-4 lore files for server "${server.name}" (${server.ip}).`;
  }

  let prompt = `Generate LORE content for a faction server in a hacking RPG.

SERVER:
  Name: ${server.name}
  IP: ${server.ip}
  Type: ${server.type}
  Role: ${server.role}
  Security: Level ${server.securityLevel}

NETWORK: ${network.name} (zone: ${network.zone})
Faction: ${network.factionName}`;

  // Inject faction lore — the WHAT (motivation, history, goals)
  if (FACTION_LORE[factionKey]) {
    prompt += `\n\nFACTION CONTEXT (what this faction cares about — reference but do NOT copy verbatim):\n${FACTION_LORE[factionKey]}`;
  }

  // Inject faction voice — the HOW (writing style, tone, jargon) — mandatory
  if (FACTION_VOICE[factionKey]) {
    prompt += `\n\nWRITING VOICE (write ALL files in this style — this is mandatory):\n${FACTION_VOICE[factionKey]}`;
  }

  // Inject suggested file names so naming feels faction-authentic
  const suggestedNames = pickFactionFileNames(factionKey);
  if (suggestedNames.length > 0) {
    prompt += `\n\nSUGGESTED FILE NAMES (use these or similar faction-appropriate names, not generic ones):\n  ${suggestedNames.join(", ")}`;
  }

  // Inject a faction-specific content topic to ensure unique focus
  const topic = pickFactionTopic(factionKey);
  if (topic) {
    prompt += `\n\nFEATURED TOPIC (one file MUST explore this subject, written in the faction voice):\n${topic}`;
  }

  // Inject a faction-specific hidden file hint
  const hiddenHint = pickFactionHiddenHint(factionKey);
  if (hiddenHint) {
    prompt += `\n\nHIDDEN FILE SEED (create a hidden file inspired by this — REWRITE it in the faction's voice, do not copy):\n${hiddenHint}`;
  }

  // Lore quote — always included for lore process
  const quote = pickLoreQuote();
  prompt += `\n\nLORE QUOTE TO REINTERPRET (rewrite this idea in the faction's own voice and embed it naturally — do NOT paste it verbatim):\n"${quote}"`;

  // AIDA fragment reference — always included for lore process
  const pieceHint = pickPieceHint();
  prompt += `\n\nAIDA FRAGMENT REFERENCE (rephrase this concept as something a ${network.factionName || "neutral"} employee would write — a margin note, a worried memo, a research annotation):\n"${pieceHint}"`;

  // Linked servers for cross-referencing
  if (linkedServers.length > 0) {
    prompt += `\n\nDIRECTLY LINKED SERVERS (reference these in logs, memos, intercepted communications):`;
    for (const s of linkedServers) {
      prompt += `\n  - ${s.ip} "${s.name}" [${s.role}]`;
    }
  }

  if (allNetworkServers.length > linkedServers.length) {
    prompt += `\n\nOTHER SERVERS IN THIS NETWORK:`;
    for (const s of allNetworkServers.filter(
      (n) => !linkedServers.some((l) => l.ip === n.ip) && n.ip !== server.ip,
    )) {
      prompt += `\n  - ${s.ip} "${s.name}" [${s.role}]`;
    }
  }

  // Employee roster
  prompt += `\n\nEMPLOYEE ROSTER (use ONLY these names in files):`;
  prompt += `\n  ${employeeRoster.slice(0, 12).join(", ")}`;

  // Role-specific lore instructions — dark, serious, intelligence-focused
  const loreRoleInstructions: Record<string, string> = {
    gateway: `Hidden security audit that flagged anomalous traffic matching pre-Shattering signatures. Firewall logs with one entry that doesn't match any known protocol.`,
    router: `Routing anomaly logs showing traffic patterns that shouldn't exist — packets routed through nodes that were decommissioned decades ago.`,
    database: `Archived research tables or personnel records with classified entries. A locked data export that cross-references other servers in the network.`,
    email: `Intercepted or leaked correspondence between faction operatives. An unsent draft containing intelligence about other factions or AIDA piece locations.`,
    workstation: `Private journal entries or personal notes from someone who's seen too much. SSH configs and browser history pointing to hidden or classified servers.`,
    firewall: `IDS alerts flagging intrusion signatures that match Emperor-era AIDA patterns. A flagged anomaly report that the author clearly found disturbing.`,
    dns: `Zone file anomalies — hostnames that resolve to servers not on any map. DNS records that predate the server itself.`,
  };

  if (loreRoleInstructions[server.role]) {
    prompt += `\n\nROLE-SPECIFIC LORE CONTENT: ${loreRoleInstructions[server.role]}`;
  }

  prompt += `

Return ONLY a JSON object:
{
  "directories": [{ "path": "/...", "isHidden": false, "isProtected": false }],
  "files": [{ "path": "/...", "content": "...", "isHidden": false, "isEncrypted": false, "isProtected": false }]
}

Generate 2-4 directories and 2-4 files. At least 1 hidden file containing the most sensitive content.`;

  return prompt;
}

/**
 * Build the user prompt for Process 2 (ambient content).
 * Called for ALL servers — mundane, lived-in, world-building.
 */
function buildAmbientPrompt(ctx: NetworkContext): string {
  const { server, network, linkedServers, allNetworkServers, employeeRoster } =
    ctx;

  const factionKey = resolveFactionKey(ctx);

  let prompt = `Generate AMBIENT (everyday, mundane) content for a server in a hacking RPG.

SERVER:
  Name: ${server.name}
  IP: ${server.ip}
  Type: ${server.type}
  Role: ${server.role}
  Security: Level ${server.securityLevel}`;

  if (network) {
    prompt += `\n\nNETWORK: ${network.name} (zone: ${network.zone})`;
    if (network.factionName) {
      prompt += `\nFaction: ${network.factionName}`;
    }
  }

  // ── Faction servers: mundane themes with faction flavor ──
  if (factionKey) {
    // Inject mundane content themes — work, personal, gossip
    const mundaneTheme = pickFactionMundaneTheme(factionKey);
    if (mundaneTheme) {
      prompt += `\n\nMUNDANE CONTENT REQUIREMENTS (these are the kinds of files to generate):`;
      prompt += `\n  Work file to include: ${mundaneTheme.work}`;
      prompt += `\n  Personal file to include: ${mundaneTheme.personal}`;
      prompt += `\n  Gossip/social file to include: ${mundaneTheme.gossip}`;
    }

    // Faction voice for consistency — but for mundane content
    if (FACTION_VOICE[factionKey]) {
      prompt += `\n\nWRITING VOICE (use this voice but for MUNDANE content — not everything these people write is about faction business):\n${FACTION_VOICE[factionKey]}`;
    }
  } else {
    // ── Non-faction servers: independent themes ──
    const independentTheme = pickIndependentTheme();
    prompt += `\n\nINDEPENDENT SERVER THEME: "${independentTheme.name}"`;
    prompt += `\n  Description: ${independentTheme.description}`;
    prompt += `\n  Atmosphere: ${independentTheme.atmosphere}`;
    prompt += `\n  Content guidance: ${independentTheme.contentGuidance}`;
    if (independentTheme.sampleFileNames.length > 0) {
      prompt += `\n  Suggested file names: ${independentTheme.sampleFileNames.slice(0, 5).join(", ")}`;
    }
    // Occasionally include a hidden quest seed
    if (Math.random() < 0.4 && independentTheme.possibleSecrets.length > 0) {
      const secret =
        independentTheme.possibleSecrets[
          Math.floor(Math.random() * independentTheme.possibleSecrets.length)
        ]!;
      prompt += `\n  HIDDEN CONTENT SEED (bury this subtly in the server, do NOT make it obvious): ${secret}`;
    }
  }

  // Ambient news — all servers
  const news = pickAmbientNews();
  prompt += `\n\nNETWORK NEWS (include as a news bulletin, forwarded email, or saved article — background flavor): "${news}"`;

  // Easter egg — 30% chance, all servers
  const easterEgg = pickEasterEgg();
  if (easterEgg) {
    prompt += `\n\nEASTER EGG (include ONE fun/weird/humorous hidden file inspired by this — make it feel like a real person left it here): ${easterEgg}`;
  }

  // Linked servers for cross-referencing in mundane ways
  if (linkedServers.length > 0) {
    prompt += `\n\nDIRECTLY LINKED SERVERS (reference in mundane ways — mentioned in emails, saved bookmarks, meeting invites):`;
    for (const s of linkedServers) {
      prompt += `\n  - ${s.ip} "${s.name}" [${s.role}]`;
    }
  }

  if (allNetworkServers.length > linkedServers.length) {
    prompt += `\n\nOTHER SERVERS IN THIS NETWORK:`;
    for (const s of allNetworkServers.filter(
      (n) => !linkedServers.some((l) => l.ip === n.ip) && n.ip !== server.ip,
    )) {
      prompt += `\n  - ${s.ip} "${s.name}" [${s.role}]`;
    }
  }

  // Employee roster
  prompt += `\n\nEMPLOYEE ROSTER (use ONLY these names in files):`;
  prompt += `\n  ${employeeRoster.slice(0, 12).join(", ")}`;

  // Role-specific mundane instructions
  const ambientRoleInstructions: Record<string, string> = {
    gateway: `Maintenance sticky notes, shift handoff logs, a reminder about upcoming certificate renewals.`,
    router: `Bandwidth usage complaints, a technician's personal bookmarks, traffic summary reports that nobody reads.`,
    database: `Backup schedule confirmations, a DBA's todo list, someone's accidentally-saved personal spreadsheet.`,
    email: `Workplace emails — meeting invites, lunch plans, IT support tickets, office announcements, a forwarded news article.`,
    workstation: `Personal workspace clutter — sticky notes, saved articles, half-written messages, music playlists, browser bookmarks, a todo list.`,
    firewall: `Routine weekly security summaries, false positive logs, a note about the next scheduled penetration test.`,
    dns: `Routine zone update confirmations, a maintenance log entry about record cleanup, standard infrastructure documentation.`,
  };

  if (ambientRoleInstructions[server.role]) {
    prompt += `\n\nROLE-SPECIFIC CONTENT: ${ambientRoleInstructions[server.role]}`;
  }

  prompt += `

Return ONLY a JSON object:
{
  "directories": [{ "path": "/...", "isHidden": false, "isProtected": false }],
  "files": [{ "path": "/...", "content": "...", "isHidden": false, "isEncrypted": false, "isProtected": false }]
}

Generate 4-7 directories and 4-6 files.`;

  return prompt;
}

const MISSION_FILES_SYSTEM_PROMPT = `You are an AI game content generator for AIDA, a hacker RPG.
Your job is to generate files that serve as objectives or evidence for player missions.

RULES:
- Output ONLY valid JSON, no other text
- File content must be relevant to the mission objective
- Files should feel like real data a hacker would find or plant
- Keep file contents SHORT (3-10 lines)
- File paths must be absolute (start with /)
- Include realistic details (dates, names, account numbers, etc.)`;

function buildMissionFilesPrompt(
  missionTitle: string,
  missionDescription: string,
  objectiveTypes: string[],
  serverType: string,
  serverName: string,
): string {
  return `Generate files for a hacker mission on a "${serverType}" server named "${serverName}".

Mission: "${missionTitle}"
Description: ${missionDescription}
Objective types involved: ${objectiveTypes.join(", ")}

Return a JSON object:
{
  "files": [
    { "path": "/some/path/file.txt", "content": "content", "isHidden": false, "isEncrypted": false, "purpose": "objective_evidence" }
  ]
}

Generate 2-4 files. Each file should have a "purpose" field explaining its role:
- "objective_target" — the file the player must steal/delete/upload
- "objective_evidence" — evidence or intel related to the mission
- "red_herring" — a decoy file to make the mission more interesting
- "breadcrumb" — a hint pointing toward the objective

At least one file must be an "objective_target".`;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@injectable()
export class ServerContentService {
  private prisma: PrismaClient;

  constructor(
    @inject("PrismaClient") prisma: PrismaClient,
    @inject(LOGGER) private logger: Logger,
    @inject(AI_SERVICE) private aiService?: AIService,
  ) {
    this.prisma = prisma;
  }

  // ========================================================================
  // Public API
  // ========================================================================

  /**
   * Provision a game server with thematic filesystem content.
   *
   * Call this after creating a GameServer row.  It will:
   *   1. Initialize the base filesystem (root + common dirs) via FileService
   *   2. Generate a content plan (AI if available, otherwise static)
   *   3. Create all planned directories and files
   *
   * Safe to call multiple times — skips if the server already has content
   * beyond the base filesystem scaffold.
   *
   * @param serverId  - The GameServer ID
   * @param options   - Optional overrides
   */
  /** Track which servers have had AI enrichment to avoid duplicate AI calls. */
  private aiEnrichedServers = new Set<string>();

  /**
   * Provision server content using the 4-tier approach:
   *   Tier 1 (instant): Static role-based content — ALWAYS applied, never empty
   *   Tier 2 (background): AI enrichment — unique files appear 5-30s later
   *
   * Tiers 3 (pre-warm) and 4 (event-driven) are triggered externally.
   */
  public async provisionServerContent(
    serverId: string,
    options: {
      /** Skip AI generation and use static templates only */
      skipAI?: boolean;
      /** Force re-provision even if content exists */
      force?: boolean;
    } = {},
  ): Promise<void> {
    try {
      const server = await this.prisma.gameServer.findUnique({
        where: { id: serverId },
        include: { faction: { include: { aiPersona: true } }, network: true },
      });

      if (!server) {
        this.logger.warn({ serverId }, "Server not found for provisioning");
        return;
      }

      // Skip player homes — they have their own initialization
      if (server.isPlayerHome || server.type === "player_home") {
        return;
      }

      // Check if Tier 1 already applied (count files only, not directories)
      const fileCount = await this.prisma.fileSystemNode.count({
        where: { serverId, type: "file" },
      });

      if (!options.force && fileCount > 12) {
        // Tier 1 already applied (base scaffold ~7 + static content ~8-15 = ~15-22)
        // Only try Tier 2 AI enrichment if not already done
        if (!options.skipAI && !this.aiEnrichedServers.has(serverId)) {
          this.provisionAIContent(serverId, server).catch((err) => {
            this.logger.debug({ err, serverId }, "Tier 2 AI enrichment failed (non-critical)");
          });
        }
        return;
      }

      // ═══ TIER 1: Instant Static Content ═══
      // ALWAYS applied. Server is never empty after this step.

      // Ensure base filesystem exists
      await this.ensureBaseFilesystem(serverId, server.ownerId || "system");

      // Build network context for content generation
      const networkCtx = await this.buildNetworkContext(server);

      // Generate static content plan (role-based with real employee names, IPs)
      const staticPlan: ServerContentPlan = networkCtx
        ? generateRoleContent(networkCtx)
        : this.getStaticContentPlan(server.type);

      // Plant faction secrets on the appropriate server role
      if (networkCtx) {
        const matchingSecrets = networkCtx.secrets.filter(
          (s) =>
            s.targetRole === (server as any).role || s.targetRole === "general",
        );
        for (const secret of matchingSecrets) {
          staticPlan.files.push({
            path: `/data/${secret.fileName}`,
            content: secret.content,
            isHidden: secret.isHidden,
            isEncrypted: secret.isEncrypted,
          });
        }

        // Add encoded content files (decodable by players using `decode` command)
        const encodedFiles = generateEncodedFiles(networkCtx);
        staticPlan.files.push(...encodedFiles);
      }

      // Apply Tier 1 content immediately (awaited — player sees files right away)
      await this.applyContentPlan(serverId, server.ownerId || "system", staticPlan);

      this.logger.info(
        {
          serverId,
          serverName: server.name,
          tier: 1,
          dirs: staticPlan.directories.length,
          files: staticPlan.files.length,
        },
        "Tier 1 static content applied",
      );

      // ═══ TIER 2: AI Enrichment (fire-and-forget) ═══
      // Adds unique AI-generated files in the background.
      if (!options.skipAI) {
        this.provisionAIContent(serverId, server).catch((err) => {
          this.logger.debug({ err, serverId }, "Tier 2 AI enrichment failed (non-critical)");
        });
      }
    } catch (error) {
      this.logger.error(
        { err: error, serverId },
        "Failed to provision server content",
      );
    }
  }

  /**
   * Tier 2: AI Content Enrichment (background).
   * Generates 3-5 unique files via AI and applies them on top of Tier 1 content.
   * Non-blocking, safe to fail.
   */
  private async provisionAIContent(
    serverId: string,
    server: any,
  ): Promise<void> {
    // Deduplicate: only enrich once per server per runtime
    if (this.aiEnrichedServers.has(serverId)) return;
    this.aiEnrichedServers.add(serverId);

    const networkCtx = await this.buildNetworkContext(server);
    const factionKey = resolveFactionKey(networkCtx);

    // Lore content (faction servers only)
    let lorePlan: ServerContentPlan = { directories: [], files: [] };
    if (factionKey && networkCtx) {
      try {
        const loreResult = await this.generatePlanFromAI(
          LORE_SYSTEM_PROMPT,
          buildLorePrompt(networkCtx),
          server.faction?.aiPersona?.systemPrompt ?? undefined,
        );
        if (loreResult) lorePlan = loreResult;
      } catch (err) {
        this.logger.debug({ err }, "Tier 2 lore generation failed");
      }
    }

    // Ambient content (all servers)
    let ambientPlan: ServerContentPlan = { directories: [], files: [] };
    if (networkCtx) {
      try {
        const ambientResult = await this.generatePlanFromAI(
          AMBIENT_SYSTEM_PROMPT,
          buildAmbientPrompt(networkCtx),
        );
        if (ambientResult) ambientPlan = ambientResult;
      } catch (err) {
        this.logger.debug({ err }, "Tier 2 ambient generation failed");
      }
    }

    const aiPlan: ServerContentPlan = {
      directories: [...lorePlan.directories, ...ambientPlan.directories],
      files: [...lorePlan.files, ...ambientPlan.files],
    };

    if (aiPlan.files.length === 0 && aiPlan.directories.length === 0) {
      this.logger.debug({ serverId }, "Tier 2: AI produced no content — queueing for retry");

      // Queue ambient prompt for retry if AI is temporarily down
      if (networkCtx && this.aiService) {
        const ambientPrompt = buildAmbientPrompt(networkCtx);
        const sId = serverId;
        const ownerId = server.ownerId || "system";
        this.aiService.queueForRetry(ambientPrompt, AMBIENT_SYSTEM_PROMPT, async (response: string) => {
          try {
            const retryPlan = validateOrRetry(response, validateContentPlan);
            if (retryPlan) {
              await this.applyContentPlan(sId, ownerId, retryPlan);
              this.logger.info({ serverId: sId, files: retryPlan.files.length }, "Tier 2 retry: AI content applied from queue");
            }
          } catch { /* retry callback failed — non-critical */ }
        });
      }
      return;
    }

    // Apply AI-generated content on top of existing Tier 1 content
    await this.applyContentPlan(serverId, server.ownerId || "system", aiPlan);

    this.logger.info(
      {
        serverId,
        serverName: server.name,
        tier: 2,
        loreFiles: lorePlan.files.length,
        ambientFiles: ambientPlan.files.length,
      },
      "Tier 2 AI content applied",
    );

    // Notify connected players that new files appeared
    try {
      const { getService } = await import("../di/container");
      const { SOCKET_IO } = await import("../di/tokens");
      const io = getService<any>(SOCKET_IO);
      io.to(`server:${serverId}`).emit("command:result", {
        success: true,
        output: `[${server.name}] New files detected.`,
        timestamp: new Date(),
      });
    } catch {
      // Socket.IO not available — no notification
    }
  }

  /**
   * Tier 3 helper: Provision all seeded servers that lack content.
   * Called once on server startup.
   */
  public async provisionAllUnpopulatedServers(): Promise<void> {
    const servers = await this.prisma.gameServer.findMany({
      where: {
        isPlayerHome: false,
        type: { notIn: ["player_home"] },
      },
      select: { id: true, name: true },
    });

    let provisioned = 0;
    for (const server of servers) {
      const fileCount = await this.prisma.fileSystemNode.count({
        where: { serverId: server.id, type: "file" },
      });
      if (fileCount <= 8) {
        try {
          await this.provisionServerContent(server.id, { skipAI: true });
          provisioned++;
        } catch (err) {
          this.logger.warn({ err, serverId: server.id }, "Batch provision failed for server");
        }
      }
    }

    if (provisioned > 0) {
      this.logger.info({ provisioned, total: servers.length }, "Batch provisioned unpopulated servers (Tier 1)");
    }
  }

  /**
   * Build network context for a server — linked servers, employee roster, faction secrets.
   */
  private async buildNetworkContext(
    server: any,
  ): Promise<NetworkContext | null> {
    try {
      const role = server.role || "general";
      const networkId = server.networkId;
      const factionShortName = server.faction?.shortName || null;

      // Get linked servers via topology
      const linkedServers: Array<{ name: string; ip: string; role: string }> = [];
      let allNetworkServers: Array<{ name: string; ip: string; role: string }> =
        [];

      if (networkId) {
        const networkServers = await this.prisma.gameServer.findMany({
          where: { networkId },
          select: { id: true, name: true, ipAddress: true, role: true },
        });
        allNetworkServers = networkServers
          .filter((s) => s.id !== server.id)
          .map((s) => ({ name: s.name, ip: s.ipAddress, role: s.role }));
      }

      // Get directly linked servers
      const links = await this.prisma.serverLink.findMany({
        where: {
          OR: [{ sourceId: server.id }, { targetId: server.id }],
          isActive: true,
        },
        include: { source: true, target: true },
      });

      const seenIds = new Set<string>();
      for (const link of links) {
        const other = link.sourceId === server.id ? link.target : link.source;
        if (!seenIds.has(other.id)) {
          seenIds.add(other.id);
          linkedServers.push({
            name: other.name,
            ip: other.ipAddress,
            role: other.role,
          });
        }
      }

      // Get network info
      let networkInfo: NetworkContext["network"] = null;
      if (networkId) {
        const net = await this.prisma.network.findUnique({
          where: { id: networkId },
          select: { name: true, zone: true },
        });
        if (net) {
          networkInfo = {
            name: net.name,
            zone: net.zone,
            factionName: server.faction?.name || null,
            factionShortName,
          };
        }
      }

      const employeeRoster = getEmployeeRoster(factionShortName);
      const secrets = generateFactionSecrets(
        factionShortName,
        allNetworkServers,
      );

      return {
        server: {
          name: server.name,
          ip: server.ipAddress,
          type: server.type,
          role,
          securityLevel: server.securityLevel,
        },
        network: networkInfo,
        linkedServers,
        allNetworkServers,
        employeeRoster,
        secrets,
      };
    } catch (error) {
      this.logger.debug(
        { err: error, serverId: server.id },
        "Failed to build network context",
      );
      return null;
    }
  }

  /**
   * Provision content for all servers in a network (or all unprovisioned servers).
   * Useful after seeding to populate the entire game world.
   */
  public async provisionAllNetworkServers(
    options: { networkId?: string; skipAI?: boolean; force?: boolean } = {},
  ): Promise<{ provisioned: number; skipped: number; failed: number }> {
    const where: any = {
      isPlayerHome: false,
      type: { not: "player_home" },
    };
    if (options.networkId) {
      where.networkId = options.networkId;
    }

    const servers = await this.prisma.gameServer.findMany({
      where,
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    let provisioned = 0;
    let skipped = 0;
    let failed = 0;

    for (const server of servers) {
      try {
        const fileCount = await this.prisma.fileSystemNode.count({
          where: { serverId: server.id, type: "file" },
        });

        if (fileCount > 8 && !options.force) {
          skipped++;
          continue;
        }

        await this.provisionServerContent(server.id, {
          ...(options.skipAI != null ? { skipAI: options.skipAI } : {}),
          ...(options.force != null ? { force: options.force } : {}),
        });
        provisioned++;

        this.logger.info(
          { serverName: server.name },
          "Provisioned server content",
        );
      } catch (error) {
        failed++;
        this.logger.error(
          { err: error, serverName: server.name },
          "Failed to provision server",
        );
      }
    }

    this.logger.info(
      { provisioned, skipped, failed },
      "Network content provisioning complete",
    );
    return { provisioned, skipped, failed };
  }

  /**
   * Provision infrastructure for a mission.
   *
   * Given a generated mission (before or after DB insertion), this will:
   *   1. Select or create a target server appropriate for the mission
   *   2. Ensure the target server has a filesystem with content
   *   3. Plant mission-specific files (steal targets, evidence, etc.)
   *   4. Return metadata patches for objectives that need real IDs
   *
   * @param mission  - The mission data (title, description, objectives, etc.)
   * @param userId   - The player the mission is for (used for level-appropriate targeting)
   * @returns Provisioned target info, or null if provisioning fails
   */
  public async provisionMissionInfrastructure(
    mission: {
      title: string;
      description: string;
      type: string;
      difficulty: number;
      objectives: Array<{
        id: string;
        type: string;
        target: number | string | boolean;
        metadata?: Record<string, unknown>;
      }>;
      factionId?: string;
    },
    userId: string,
  ): Promise<MissionProvisionResult | null> {
    try {
      // Determine which objective types need server/file infrastructure
      const serverObjectiveTypes = new Set([
        "hack",
        "hack_target",
        "hack_stealth",
        "hack_method",
        "gain_access",
        "steal",
        "steal_count",
        "upload_file",
        "delete_file",
        "connect_server",
        "explore",
        "discover_server_type",
      ]);

      const needsServer = mission.objectives.some((obj) =>
        serverObjectiveTypes.has(obj.type),
      );

      if (!needsServer) {
        // Mission doesn't need server infrastructure (social, progression, etc.)
        return null;
      }

      // 1. Select or create target server
      const targetServer = await this.selectOrCreateTargetServer(
        mission,
        userId,
      );

      if (!targetServer) {
        this.logger.warn(
          { missionTitle: mission.title },
          "Could not select/create target server for mission",
        );
        return null;
      }

      // 2. Ensure the server has content
      await this.provisionServerContent(targetServer.id);

      // 3. Plant mission-specific files
      const plantedFiles = await this.plantMissionFiles(
        targetServer.id,
        targetServer.ownerId || "system",
        mission,
      );

      // 4. Build objective metadata patches
      const objectivePatches: ProvisionedObjective[] = [];

      for (let i = 0; i < mission.objectives.length; i++) {
        const obj = mission.objectives[i]!;
        const patch: Record<string, unknown> = {};

        switch (obj.type) {
          case "hack_target":
          case "connect_server":
          case "gain_access":
          case "upload_file":
            patch.serverId = targetServer.id;
            patch.serverIp = targetServer.ipAddress;
            patch.serverName = targetServer.name;
            break;

          case "steal":
          case "delete_file": {
            // Point to the first "objective_target" file we planted
            const targetFile = plantedFiles.find(
              (f) => f.purpose === "objective_target",
            );
            if (targetFile) {
              patch.fileId = targetFile.nodeId;
              patch.filePath = targetFile.path;
              patch.serverId = targetServer.id;
              patch.serverIp = targetServer.ipAddress;
            }
            break;
          }

          case "steal_count":
          case "hack":
          case "hack_stealth":
          case "hack_method":
          case "explore":
            patch.serverId = targetServer.id;
            patch.serverIp = targetServer.ipAddress;
            break;

          case "discover_server_type":
            patch.serverType = targetServer.type;
            break;

          case "infiltrate_network":
            patch.networkId = targetServer.networkId || null;
            patch.serverId = targetServer.id;
            patch.serverIp = targetServer.ipAddress;
            break;

          case "trace_connection":
            patch.serverId = targetServer.id;
            patch.serverIp = targetServer.ipAddress;
            patch.serverName = targetServer.name;
            break;

          case "exfiltrate_data": {
            const exfilFile = plantedFiles.find(
              (f) => f.purpose === "objective_target",
            );
            if (exfilFile) {
              patch.fileId = exfilFile.nodeId;
              patch.filePath = exfilFile.path;
            }
            patch.serverId = targetServer.id;
            patch.serverIp = targetServer.ipAddress;
            break;
          }

          default:
            continue; // No patch needed
        }

        if (Object.keys(patch).length > 0) {
          objectivePatches.push({ index: i, metadata: patch });
        }
      }

      this.logger.info(
        {
          missionTitle: mission.title,
          targetServerId: targetServer.id,
          targetServerIp: targetServer.ipAddress,
          plantedFiles: plantedFiles.length,
          patchedObjectives: objectivePatches.length,
        },
        "Mission infrastructure provisioned",
      );

      return {
        targetServerId: targetServer.id,
        objectives: objectivePatches,
        plantedFiles: plantedFiles.map((f) => f.path),
      };
    } catch (error) {
      this.logger.error(
        { err: error, missionTitle: mission.title },
        "Failed to provision mission infrastructure",
      );
      return null;
    }
  }

  // ========================================================================
  // Internal — Server Content
  // ========================================================================

  /**
   * Ensure a server has the base filesystem scaffold (root + common dirs).
   */
  private async ensureBaseFilesystem(
    serverId: string,
    ownerId: string,
  ): Promise<void> {
    const hasRoot = await this.prisma.fileSystemNode.findFirst({
      where: { serverId, parentId: null, type: "directory" },
    });

    if (hasRoot) return;

    // Try FileService first (works when full DI container is active)
    try {
      const { getService } = await import("../di/container");
      const { FILE_SERVICE } = await import("../di/tokens");
      const fileService = getService<any>(FILE_SERVICE);
      await fileService.initializeFileSystem(serverId, ownerId);
      return;
    } catch {
      // FileService not available — create base filesystem directly via Prisma
    }

    // Standalone fallback: create root + standard directories via Prisma
    // Resolve a valid user ID for createdBy FK
    let createdBy = ownerId;
    if (ownerId === "system" || !ownerId) {
      const anyUser = await this.prisma.user.findFirst({
        select: { id: true },
      });
      createdBy = anyUser?.id || ownerId;
    }

    const root = await this.prisma.fileSystemNode.create({
      data: {
        serverId,
        name: "/",
        type: "directory",
        content: null,
        permissions: { owner: 15, faction: 5, others: 5 },
        size: 0,
        createdBy,
      },
    });

    const baseDirs = ["etc", "home", "var", "tmp", "logs", "data"];
    for (const dir of baseDirs) {
      await this.prisma.fileSystemNode.create({
        data: {
          serverId,
          parentId: root.id,
          name: dir,
          type: "directory",
          content: null,
          permissions: { owner: 15, faction: 5, others: 5 },
          size: 0,
          createdBy,
        },
      });
    }
  }

  /**
   * Generate content plan from AI using the given prompts.
   * Used by both lore and ambient content generation processes.
   */
  private async generatePlanFromAI(
    systemPrompt: string,
    userPrompt: string,
    factionSystemPrompt?: string,
  ): Promise<ServerContentPlan | null> {
    try {
      if (!this.aiService) {
        this.logger.warn(
          "AIService not available, skipping AI content plan generation",
        );
        return null;
      }
      const aiService = this.aiService;

      // Build system prompt with faction context
      const fullSystemPrompt = factionSystemPrompt
        ? `${factionSystemPrompt}\n\n${systemPrompt}`
        : systemPrompt;

      // Use agent loop so AI can query DB for real server data and create new entities
      const { runAgentLoop } = await import("./aiAgentTools");
      const agentPrompt = userPrompt + '\n\nYour final response MUST be JSON: { "directories": [{"path": "/..."}], "files": [{"path": "/...", "content": "string (100-3000 chars)", "isHidden": false}] }';

      let responseText: string | null = null;
      try {
        responseText = await runAgentLoop(
          aiService, this.prisma, fullSystemPrompt, agentPrompt, this.logger, 6,
        );
      } catch { /* fall through */ }

      // Fallback: direct call without agent loop if agent fails
      if (!responseText) {
        const directResult = await aiService.generateResponse(
          userPrompt,
          fullSystemPrompt,
          '{ "directories": [{"path": "/..."}], "files": [{"path": "/...", "content": "string (100-3000 chars)", "isHidden": false}] }',
        );
        if (!directResult.success) {
          this.logger.debug({ error: directResult.error }, "AI content plan generation returned error");
          return null;
        }
        responseText = directResult.response;
      }

      // Extract and validate content plan from AI response
      const validated = validateOrRetry(responseText, validateContentPlan);
      if (!validated) {
        this.logger.debug("AI content plan validation failed");
        return null;
      }

      // Auto-backfill: scan generated file content for IPs/URLs that don't exist
      try {
        const { getService } = await import("../di/container");
        const { REFERENCE_VALIDATION_SERVICE } = await import("../di/tokens");
        const refService = getService<any>(REFERENCE_VALIDATION_SERVICE);
        if (refService) {
          const allContent = validated.files.map((f: any) => f.content || "").join("\n");
          if (allContent.length > 10) {
            refService.validateAndBackfillReferences(allContent, "ai_content").catch(() => {});
          }
        }
      } catch { /* non-critical */ }

      return validated;
    } catch (error) {
      this.logger.debug({ err: error }, "AI content plan generation failed");
      return null;
    }
  }

  /**
   * Get the static content plan for a server type.
   */
  private getStaticContentPlan(serverType: string): ServerContentPlan {
    return STATIC_CONTENT[serverType] || DEFAULT_CONTENT;
  }

  /**
   * Apply a content plan to a server's filesystem.
   * Works both with FileService (full DI) and directly via Prisma (standalone scripts).
   */
  private async applyContentPlan(
    serverId: string,
    ownerId: string,
    plan: ServerContentPlan,
  ): Promise<void> {
    // Always use Prisma-direct path for system provisioning.
    // FileService enforces user-level permissions (access level, write checks)
    // which fail for system/AI-generated content (no hack log, no ownership).
    await this.applyContentPlanViaPrisma(serverId, ownerId, plan);
  }

  // @ts-ignore kept for potential future use when FileService permission model supports system callers
  private async applyContentPlanViaFileService(
    serverId: string,
    ownerId: string,
    plan: ServerContentPlan,
    fileService: any,
  ): Promise<void> {
    const sortedDirs = [...plan.directories].sort(
      (a, b) => a.path.split("/").length - b.path.split("/").length,
    );

    for (const dir of sortedDirs) {
      try {
        await fileService.createDirectory(serverId, ownerId, dir.path);
      } catch (err) {
        this.logger.debug({ err, path: dir.path }, "Error creating directory");
      }
    }

    for (const file of plan.files) {
      try {
        await fileService.createFile(
          serverId,
          ownerId,
          file.path,
          file.content,
          file.isEncrypted || false,
        );
      } catch (err) {
        this.logger.debug({ err, path: file.path }, "Error creating file");
      }
    }

    // Apply hidden/protected flags
    await this.applyFileFlags(serverId, plan);
  }

  /**
   * Prisma-direct content plan application — works without FileService DI.
   * Creates directories and files by resolving paths manually.
   */
  private async applyContentPlanViaPrisma(
    serverId: string,
    ownerId: string,
    plan: ServerContentPlan,
  ): Promise<void> {
    // Resolve a valid owner — use "system" placeholder or first user
    let createdBy = ownerId;
    if (ownerId === "system") {
      const anyUser = await this.prisma.user.findFirst({
        select: { id: true },
      });
      createdBy = anyUser?.id || ownerId;
    }

    // Get or find root
    const root = await this.prisma.fileSystemNode.findFirst({
      where: { serverId, parentId: null, type: "directory" },
    });
    if (!root) return;

    // Build a path→node cache
    const pathCache = new Map<string, string>();
    pathCache.set("/", root.id);

    // Load existing nodes
    const existing = await this.prisma.fileSystemNode.findMany({
      where: { serverId },
      select: { id: true, name: true, parentId: true },
    });

    // Build path map from existing nodes
    const parentMap = new Map<string, string>();
    for (const node of existing) {
      if (node.parentId) parentMap.set(node.id, node.parentId);
    }
    const nameMap = new Map<string, string>();
    for (const node of existing) {
      nameMap.set(node.id, node.name);
    }

    const getPath = (nodeId: string): string => {
      const parts: string[] = [];
      let current: string | undefined = nodeId;
      while (current && nameMap.has(current)) {
        const name = nameMap.get(current)!;
        if (name !== "/") parts.unshift(name);
        current = parentMap.get(current);
      }
      return "/" + parts.join("/");
    };

    for (const node of existing) {
      pathCache.set(getPath(node.id), node.id);
    }

    // Helper: ensure directory path exists, return its node ID
    const ensureDir = async (dirPath: string): Promise<string | null> => {
      if (pathCache.has(dirPath)) return pathCache.get(dirPath)!;

      const parts = dirPath.split("/").filter(Boolean);
      let currentParentId = root.id;
      let currentPath = "";

      for (const part of parts) {
        currentPath += "/" + part;
        if (pathCache.has(currentPath)) {
          currentParentId = pathCache.get(currentPath)!;
          continue;
        }

        try {
          const node = await this.prisma.fileSystemNode.create({
            data: {
              serverId,
              parentId: currentParentId,
              name: part,
              type: "directory",
              content: null,
              permissions: { owner: 15, faction: 5, others: 5 },
              size: 0,
              createdBy,
            },
          });
          pathCache.set(currentPath, node.id);
          currentParentId = node.id;
        } catch {
          // Already exists — find it
          const found = await this.prisma.fileSystemNode.findFirst({
            where: { serverId, parentId: currentParentId, name: part },
          });
          if (found) {
            pathCache.set(currentPath, found.id);
            currentParentId = found.id;
          } else {
            return null;
          }
        }
      }
      return currentParentId;
    };

    // Create directories
    for (const dir of plan.directories) {
      await ensureDir(dir.path);
    }

    // Create files
    for (const file of plan.files) {
      try {
        const fileName = file.path.split("/").pop()!;
        const dirPath =
          file.path.substring(0, file.path.length - fileName.length - 1) || "/";
        const parentId = await ensureDir(dirPath);
        if (!parentId) continue;

        // Check if file already exists
        const existingFile = await this.prisma.fileSystemNode.findFirst({
          where: { serverId, parentId, name: fileName },
        });
        if (existingFile) continue;

        await this.prisma.fileSystemNode.create({
          data: {
            serverId,
            parentId,
            name: fileName,
            type: "file",
            content: file.content,
            permissions: { owner: 15, faction: 5, others: 1 },
            size: file.content.length,
            createdBy,
            isHidden: file.isHidden || false,
            isEncrypted: file.isEncrypted || false,
            isProtected: file.isProtected || false,
          },
        });
      } catch (err) {
        this.logger.debug(
          { err, path: file.path },
          "Error creating file via Prisma",
        );
      }
    }

    // Apply directory flags
    await this.applyFileFlags(serverId, plan);
  }

  /**
   * Apply isHidden/isProtected flags to directories after creation.
   */
  private async applyFileFlags(
    serverId: string,
    plan: ServerContentPlan,
  ): Promise<void> {
    for (const dir of plan.directories) {
      if (dir.isHidden || dir.isProtected) {
        const dirName = dir.path.split("/").pop()!;
        const node = await this.prisma.fileSystemNode.findFirst({
          where: { serverId, name: dirName, type: "directory" },
        });
        if (node) {
          await this.prisma.fileSystemNode.update({
            where: { id: node.id },
            data: {
              ...(dir.isHidden ? { isHidden: true } : {}),
              ...(dir.isProtected ? { isProtected: true } : {}),
            },
          });
        }
      }
    }
  }

  // ========================================================================
  // Internal — Mission Infrastructure
  // ========================================================================

  /**
   * Select an existing server or create a new one as the mission target.
   *
   * Preference order:
   *   1. An existing NPC server matching the mission difficulty & type
   *   2. A faction-owned server (if mission has a factionId)
   *   3. Create a new server on the appropriate network
   */
  private async selectOrCreateTargetServer(
    mission: {
      type: string;
      difficulty: number;
      factionId?: string;
      objectives: Array<{ type: string; metadata?: Record<string, unknown> }>;
    },
    _userId: string,
  ): Promise<{
    id: string;
    ipAddress: string;
    name: string;
    type: string;
    ownerId: string | null;
    networkId?: string | null;
  } | null> {
    // Determine what kind of server we need
    const targetType = this.inferTargetServerType(mission);
    const maxEncryption = Math.min(100, mission.difficulty * 12);
    const minEncryption = Math.max(0, (mission.difficulty - 2) * 8);

    // 1. Try to find an existing NPC server that matches
    const existingServer = await this.prisma.gameServer.findFirst({
      where: {
        type: targetType,
        isPlayerHome: false,
        ownerId: null, // NPC server (no player owner)
        encryptionLevel: {
          gte: minEncryption,
          lte: maxEncryption,
        },
        ...(mission.factionId ? { factionId: mission.factionId } : {}),
      },
      orderBy: { encryptionLevel: "asc" },
    });

    if (existingServer) {
      return {
        id: existingServer.id,
        ipAddress: existingServer.ipAddress,
        name: existingServer.name,
        type: existingServer.type,
        ownerId: existingServer.ownerId,
        networkId: existingServer.networkId,
      };
    }

    // 2. Try a faction server if applicable
    if (mission.factionId) {
      const factionServer = await this.prisma.gameServer.findFirst({
        where: {
          factionId: mission.factionId,
          isPlayerHome: false,
        },
        orderBy: { encryptionLevel: "asc" },
      });

      if (factionServer) {
        return {
          id: factionServer.id,
          ipAddress: factionServer.ipAddress,
          name: factionServer.name,
          type: factionServer.type,
          ownerId: factionServer.ownerId,
          networkId: factionServer.networkId,
        };
      }
    }

    // 3. Create a new server
    return this.createMissionTargetServer(mission, targetType);
  }

  /**
   * Infer what server type a mission should target based on its type and objectives.
   */
  private inferTargetServerType(mission: {
    type: string;
    difficulty: number;
    objectives: Array<{ type: string; metadata?: Record<string, unknown> }>;
  }): string {
    // Check if any objective specifies a serverType
    for (const obj of mission.objectives) {
      const meta = obj.metadata as Record<string, unknown> | undefined;
      if (meta?.serverType && typeof meta.serverType === "string") {
        return meta.serverType;
      }
    }

    // Infer from mission difficulty
    if (mission.difficulty >= 8) return "government";
    if (mission.difficulty >= 5) return "corporate";
    if (mission.difficulty >= 3) return "underground";
    return "corporate"; // Default
  }

  /**
   * Create a brand new server as a mission target.
   */
  private async createMissionTargetServer(
    mission: { type: string; difficulty: number; factionId?: string },
    serverType: string,
  ): Promise<{
    id: string;
    ipAddress: string;
    name: string;
    type: string;
    ownerId: string | null;
    networkId?: string | null;
  } | null> {
    try {
      const { getService } = await import("../di/container");
      const { IP_SERVICE, SERVER_SERVICE } = await import("../di/tokens");
      const ipService = getService<any>(IP_SERVICE);
      const serverService = getService<any>(SERVER_SERVICE);

      // Determine which IP zone to use
      const zoneMap: Record<string, string> = {
        corporate: "corporate",
        government: "government",
        underground: "underground",
      };
      const zone = zoneMap[serverType] || "corporate";
      const ip = await ipService.generateUniqueIP(zone);

      // Generate a thematic name
      const name = this.generateServerName(serverType, mission.factionId);

      const encryptionLevel = Math.min(
        100,
        Math.max(0, mission.difficulty * 10),
      );

      const server = await serverService.createServer({
        name,
        ipAddress: ip,
        type: serverType,
        encryptionLevel,
        maxConnections: 10 + mission.difficulty * 2,
      });

      // Associate with faction if applicable
      if (mission.factionId) {
        await this.prisma.gameServer.update({
          where: { id: server.id },
          data: { factionId: mission.factionId },
        });
      }

      this.logger.info(
        {
          serverId: server.id,
          serverIp: ip,
          serverName: name,
          serverType,
          forMissionType: mission.type,
        },
        "Created mission target server",
      );

      return {
        id: server.id,
        ipAddress: ip,
        name,
        type: serverType,
        ownerId: null,
      };
    } catch (error) {
      this.logger.error(
        { err: error },
        "Failed to create mission target server",
      );
      return null;
    }
  }

  /**
   * Generate a thematic server name based on type.
   */
  private generateServerName(serverType: string, _factionId?: string): string {
    const names: Record<string, string[]> = {
      corporate: [
        "DataVault Systems",
        "NexGen Analytics",
        "Pinnacle Financial",
        "Helix Biotech",
        "Quantum Dynamics R&D",
        "Sterling Capital",
        "Apex Logistics",
        "Meridian Consulting",
        "Obsidian Technologies",
        "Prism Data Solutions",
      ],
      government: [
        "GOV-RELAY-ALPHA",
        "CENTCOM-NODE-7",
        "Federal Records Archive",
        "Cyber Defense Station",
        "Intelligence Hub BRAVO",
        "DOD-SIGINT-3",
        "Homeland Security Portal",
        "Joint Operations Center",
        "NSA Listening Post",
        "CERT Response Server",
      ],
      underground: [
        "Shadow Relay",
        "Ghost Market",
        "Dead Drop Station",
        "Null Router",
        "Zero Day Hub",
        "Dark Pool Exchange",
        "Phantom Node",
        "Whisper Network",
        "The Crypt",
        "Black Market Terminal",
      ],
    };

    const pool = names[serverType] || names.corporate!;
    return pool[Math.floor(Math.random() * pool.length)]!;
  }

  /**
   * Plant mission-specific files on the target server.
   */
  private async plantMissionFiles(
    serverId: string,
    ownerId: string,
    mission: {
      title: string;
      description: string;
      objectives: Array<{ type: string }>;
    },
  ): Promise<Array<{ path: string; nodeId: string; purpose: string }>> {
    const planted: Array<{ path: string; nodeId: string; purpose: string }> =
      [];

    // Determine which objective types need files
    const fileObjectiveTypes = new Set([
      "steal",
      "steal_count",
      "delete_file",
      "upload_file",
    ]);
    const hasFileObjectives = mission.objectives.some((o) =>
      fileObjectiveTypes.has(o.type),
    );

    // Get the server info for AI prompt context
    const server = await this.prisma.gameServer.findUnique({
      where: { id: serverId },
    });
    if (!server) return planted;

    // Try AI generation for mission files
    let missionFiles: Array<PlannedFile & { purpose: string }> = [];
    try {
      missionFiles = await this.generateMissionFilesWithAI(
        mission,
        server.type,
        server.name,
      );
    } catch {
      // AI failed, use static fallback
    }

    // Fallback: generate static mission files if AI didn't produce any
    if (missionFiles.length === 0) {
      missionFiles = this.generateStaticMissionFiles(
        mission,
        hasFileObjectives,
      );
    }

    // Plant the files
    const { getService } = await import("../di/container");
    const { FILE_SERVICE } = await import("../di/tokens");
    const fileService = getService<any>(FILE_SERVICE);

    for (const file of missionFiles) {
      try {
        const result = await fileService.createFile(
          serverId,
          ownerId,
          file.path,
          file.content,
          file.isEncrypted || false,
        );

        if (result.success && result.data?.id) {
          // Set hidden flag if needed
          if (file.isHidden) {
            await this.prisma.fileSystemNode.update({
              where: { id: result.data.id },
              data: { isHidden: true },
            });
          }

          planted.push({
            path: file.path,
            nodeId: result.data.id,
            purpose: file.purpose,
          });
        } else {
          // If createFile doesn't return an ID, look it up
          const fileName = file.path.split("/").pop()!;
          const node = await this.prisma.fileSystemNode.findFirst({
            where: { serverId, name: fileName },
            orderBy: { createdAt: "desc" },
          });
          if (node) {
            planted.push({
              path: file.path,
              nodeId: node.id,
              purpose: file.purpose,
            });
          }
        }
      } catch (err) {
        this.logger.debug(
          { err, path: file.path },
          "Failed to plant mission file",
        );
      }
    }

    return planted;
  }

  /**
   * Try generating mission files via AI.
   */
  private async generateMissionFilesWithAI(
    mission: {
      title: string;
      description: string;
      objectives: Array<{ type: string }>;
    },
    serverType: string,
    serverName: string,
  ): Promise<Array<PlannedFile & { purpose: string }>> {
    if (!this.aiService) {
      this.logger.warn(
        "AIService not available, skipping AI mission file generation",
      );
      return [];
    }
    const aiService = this.aiService;

    const objectiveTypes = mission.objectives.map((o) => o.type);
    const prompt = buildMissionFilesPrompt(
      mission.title,
      mission.description,
      objectiveTypes,
      serverType,
      serverName,
    );

    const result = await aiService.generateResponse(
      prompt,
      MISSION_FILES_SYSTEM_PROMPT,
    );

    if (!result.success) return [];

    const validateMissionFiles = (parsed: any): Array<PlannedFile & { purpose: string }> | null => {
      if (!parsed || typeof parsed !== "object") return null;
      if (!Array.isArray(parsed.files) || parsed.files.length === 0) return null;
      const files = parsed.files
        .filter(
          (f: any) =>
            typeof f.path === "string" &&
            f.path.startsWith("/") &&
            typeof f.content === "string" &&
            typeof f.purpose === "string",
        )
        .map((f: any) => ({
          path: f.path,
          content: String(f.content).slice(0, 2000),
          isHidden: Boolean(f.isHidden),
          isEncrypted: Boolean(f.isEncrypted),
          isProtected: false,
          purpose: f.purpose,
        }));
      return files.length > 0 ? files : null;
    };

    const validated = validateOrRetry(result.response, validateMissionFiles);
    return validated ?? [];
  }

  /**
   * Generate static mission files as a fallback.
   */
  private generateStaticMissionFiles(
    mission: { title: string; objectives: Array<{ type: string }> },
    hasFileObjectives: boolean,
  ): Array<PlannedFile & { purpose: string }> {
    const files: Array<PlannedFile & { purpose: string }> = [];
    const timestamp = new Date().toISOString().split("T")[0];

    if (hasFileObjectives) {
      // Create an objective target file
      files.push({
        path: "/data/.classified_intel.dat",
        content: [
          `CLASSIFIED DOCUMENT — ${timestamp}`,
          `Reference: ${mission.title}`,
          "",
          "CONTENTS: [ENCRYPTED PAYLOAD]",
          "AUTH: Level 4 clearance required",
          "STATUS: Active — do not distribute",
          "",
          ">> This file contains sensitive intelligence.",
          ">> Unauthorized access will trigger security protocols.",
        ].join("\n"),
        isHidden: true,
        purpose: "objective_target",
      });
    }

    // Always add evidence / breadcrumb files
    files.push({
      path: "/logs/security/recent_activity.log",
      content: [
        `[${timestamp} 03:14:22] AUTH admin — SUCCESS`,
        `[${timestamp} 03:15:01] FILE_ACCESS /data/.classified_intel.dat — admin`,
        `[${timestamp} 04:22:17] ANOMALY — unexpected outbound connection`,
        `[${timestamp} 04:22:19] ALERT — data exfiltration signature detected`,
        `[${timestamp} 04:23:00] LOCKDOWN — automated response engaged`,
      ].join("\n"),
      purpose: "breadcrumb",
    });

    files.push({
      path: "/tmp/.mission_notes.txt",
      content: [
        ">> Intercepted communication fragment <<",
        "",
        `Operation: ${mission.title}`,
        "Status: In progress",
        "Priority: HIGH",
        "",
        "Note: Check /data for the target files.",
        "The security logs may have useful timestamps.",
      ].join("\n"),
      isHidden: true,
      purpose: "objective_evidence",
    });

    return files;
  }
}

export default ServerContentService;
