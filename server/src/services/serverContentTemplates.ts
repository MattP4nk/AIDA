/**
 * Server content templates: static plans, faction rosters and secrets, and the
 * role/faction generators used when AI generation is unavailable.
 *
 * A8: extracted verbatim from serverContentService.ts, which opened with
 * ~1,450 lines of this ahead of the class. verify-phase7-a8-server-content.ts
 * fingerprints the data and every generator's output across a fixed input
 * matrix, and the move left all 228 cases byte-identical.
 */
import { ContentEncoder } from "../utils/contentEncoder";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single file to plant on a server's filesystem. */
export interface PlannedFile {
  path: string;
  content: string;
  isHidden?: boolean;
  isEncrypted?: boolean;
  isProtected?: boolean;
}

/** A single directory to create on a server's filesystem. */
export interface PlannedDirectory {
  path: string;
  isHidden?: boolean;
  isProtected?: boolean;
}

/** The full content plan for a server, either AI-generated or static. */
export interface ServerContentPlan {
  directories: PlannedDirectory[];
  files: PlannedFile[];
}

// ---------------------------------------------------------------------------
// Employee Name Pools — shared per faction, reused across all network servers
// ---------------------------------------------------------------------------

export const EMPLOYEE_ROSTERS: Record<string, string[]> = {
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

export function getEmployeeRoster(factionShortName: string | null): string[] {
  if (!factionShortName)
    return ["admin", "user01", "user02", "operator", "backup_svc"];
  return EMPLOYEE_ROSTERS[factionShortName] || EMPLOYEE_ROSTERS.cybercorp!;
}

// ---------------------------------------------------------------------------
// Faction Secret Templates — planted as hidden/encrypted files
// ---------------------------------------------------------------------------

export interface FactionSecret {
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

export function generateFactionSecrets(
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
  existingDirs: string[];
}

// ---------------------------------------------------------------------------
// Static content templates — used when AI is unavailable
// ---------------------------------------------------------------------------

export const STATIC_CONTENT: Record<string, ServerContentPlan> = {
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
          "LESSON 3: HACKING\n\nTime to learn how to breach secured servers.\n\n  hack <ip>         — Start a hack attempt against a server\n  hack.status       — Check your active hack session\n  hack.abort        — Abort the current hack\n\nHow it works:\n  1. Use 'scan' to find servers on your network\n  2. Use 'hack <ip>' to initiate a breach\n  3. Solve the minigame challenges (cipher, port sequence, memory trace)\n  4. Each server has layers — harder servers have more layers\n\nAfter a successful hack:\n  backdoor install  — Install persistent access (skip security next time)\n  trace.status      — Check if anyone is tracing you\n  trace.evade       — Attempt to evade an active trace\n\nTip: The Training Firewall (10.10.10.30) is a good first target.\nYour hacking skill improves with every attempt.\n",
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
export const DEFAULT_CONTENT: ServerContentPlan = {
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

export function generateRoleContent(ctx: NetworkContext): ServerContentPlan {
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

export function generateEncodedFiles(ctx: NetworkContext): PlannedFile[] {
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
