import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting comprehensive database seed...\n");

  // ============================================================
  // SECTION 0: CLEAR EXISTING DATA (reverse dependency order)
  // ============================================================
  console.log("🧹 Clearing existing data...");

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

  console.log("  ✓ All tables cleared\n");

  // ============================================================
  // SECTION 1: TEST USERS
  // ============================================================
  console.log("👥 Creating users...");

  const hashedPassword = await bcrypt.hash("password123", 10);

  const testUser = await prisma.user.upsert({
    where: { username: "testuser" },
    update: {},
    create: {
      username: "testuser",
      email: "test@aida.game",
      password: hashedPassword,
      homeIp: "10.10.0.1",
      role: "admin",
    },
  });
  console.log(`  ✓ Created user: ${testUser.username} (admin)`);

  const alice = await prisma.user.upsert({
    where: { username: "alice" },
    update: {},
    create: {
      username: "alice",
      email: "alice@aida.game",
      password: hashedPassword,
      homeIp: "10.20.0.1",
    },
  });
  console.log(`  ✓ Created user: ${alice.username}`);

  const bob = await prisma.user.upsert({
    where: { username: "bob" },
    update: {},
    create: {
      username: "bob",
      email: "bob@aida.game",
      password: hashedPassword,
      homeIp: "10.30.0.1",
    },
  });
  console.log(`  ✓ Created user: ${bob.username}`);

  // ============================================================
  // SECTION 2: PLAYER PROGRESS
  // ============================================================
  console.log("\n📊 Creating player progress...");

  await prisma.playerProgress.upsert({
    where: { userId: testUser.id },
    update: {},
    create: {
      userId: testUser.id,
      level: 1,
      experience: 0,
      credits: 1000,
      discoveryLevel: 0,
      hacking: 10,
      networking: 10,
      cryptography: 5,
      stealth: 10,
      socialEng: 5,
      forensics: 5,
      equipment: {},
    },
  });
  console.log(`  ✓ Progress: ${testUser.username} (level 1, starter)`);

  await prisma.playerProgress.upsert({
    where: { userId: alice.id },
    update: {},
    create: {
      userId: alice.id,
      level: 5,
      experience: 500,
      credits: 5000,
      discoveryLevel: 3,
      hacking: 30,
      networking: 25,
      cryptography: 20,
      stealth: 20,
      socialEng: 15,
      forensics: 10,
      equipment: {},
    },
  });
  console.log(`  ✓ Progress: ${alice.username} (level 5, experienced)`);

  await prisma.playerProgress.upsert({
    where: { userId: bob.id },
    update: {},
    create: {
      userId: bob.id,
      level: 3,
      experience: 250,
      credits: 2500,
      discoveryLevel: 1,
      hacking: 20,
      networking: 15,
      cryptography: 10,
      stealth: 15,
      socialEng: 10,
      forensics: 8,
      equipment: {},
    },
  });
  console.log(`  ✓ Progress: ${bob.username} (level 3, intermediate)`);

  // ============================================================
  // SECTION 3: FACTIONS
  // ============================================================
  console.log("\n⚔️  Creating factions...");

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
  console.log(`  ✓ Faction: ${garrison.name}`);

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
  console.log(`  ✓ Faction: ${dothackers.name}`);

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
  console.log(`  ✓ Faction: ${cybercorp.name}`);

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
  console.log(`  ✓ Faction: ${darknet.name} (HIDDEN)`);

  // ============================================================
  // SECTION 4: AI PERSONAS
  // ============================================================
  console.log("\n🤖 Creating AI personas...");

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
  console.log(`  ✓ Persona: ${gameMaster.name} (game_master)`);

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
  console.log(`  ✓ Persona: ${aidaPersona.name} (aida)`);

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
  console.log(`  ✓ Persona: ${steelePersona.name} (garrison)`);

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
  console.log(`  ✓ Persona: ${gh0stPersona.name} (dothackers)`);

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
  console.log(`  ✓ Persona: ${chenPersona.name} (cybercorp)`);

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
  console.log("  ✓ Linked all personas to factions");

  // ============================================================
  // SECTION 5: GAME SERVERS — standalone + network topology
  // ============================================================
  console.log("\n🖥️  Creating game servers & network topology...");

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

  console.log(
    "  ✓ Created 28 servers across 4 faction networks + internet exchange",
  );

  // ============================================================
  // SECTION 6: SERVER VISIBILITY & ACCESS CONTROLS
  // ============================================================
  console.log("\n🔐 Setting server visibility and access controls...");

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
    `  ✓ Public: ${publicOpenServers.length + publicHackableServers.length}, Private: ${privateServers.length}`,
  );
  console.log(
    "  ✓ Access keys generated (will be planted during content provisioning)",
  );

  // ============================================================
  // SECTION 7: SERVER LINKS (bidirectional network topology)
  // ============================================================
  console.log("\n🔗 Creating network links...");

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

  // Backbone: Internet Exchange → all faction gateways
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

  // Link player home servers to Internet Exchange
  const homeServers = await prisma.gameServer.findMany({
    where: { isPlayerHome: true },
  });
  for (const home of homeServers) {
    await link(home.id, internetExchange.id, null, "wan", 50);
  }

  console.log("  ✓ Created all network links (backbone + 4 faction networks)");

  // ============================================================
  // SECTION 8: FACTION STANDINGS (for all test users)
  // ============================================================
  console.log("\n📊 Initializing faction standings...");

  const visibleFactions = [garrison, dothackers, cybercorp]; // DarkNet is hidden
  for (const user of [testUser, alice, bob]) {
    for (const faction of visibleFactions) {
      await prisma.factionStanding.upsert({
        where: {
          userId_factionId: { userId: user.id, factionId: faction.id },
        },
        update: {},
        create: {
          userId: user.id,
          factionId: faction.id,
          reputation: 0,
          isAllied: false,
          isHostile: false,
          isNeutral: true,
        },
      });
    }
  }

  // Give alice some CyberCorp reputation
  await prisma.factionStanding.update({
    where: {
      userId_factionId: { userId: alice.id, factionId: cybercorp.id },
    },
    data: { reputation: 20, lastAction: "mission_complete" },
  });

  console.log(
    "  ✓ Standings initialized for all test users (alice has +20 CyberCorp rep)",
  );

  // ============================================================
  // SECTION 9: FORUMS (6 forums)
  // ============================================================
  console.log("\n📋 Creating forums...");

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
  console.log(`  ✓ Forum: ${techForum.name}`);

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
  console.log(`  ✓ Forum: ${undergroundForum.name}`);

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
  console.log(`  ✓ Forum: ${honeypotForum.name} (HONEYPOT)`);

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
  console.log(`  ✓ Forum: ${garrisonForum.name} (faction)`);

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
  console.log(`  ✓ Forum: ${dhForum.name} (faction)`);

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
  console.log(`  ✓ Forum: ${ccForum.name} (faction)`);

  // ============================================================
  // SECTION 10: FORUM MEMBERS (test users on public forums)
  // ============================================================
  console.log("\n👤 Creating forum memberships...");

  const forumMemberships = [
    // All users on the public tech forum
    {
      userId: testUser.id,
      forumId: techForum.id,
      handle: "testuser",
      isAdmin: true,
    },
    {
      userId: alice.id,
      forumId: techForum.id,
      handle: "alice_x",
      isAdmin: false,
    },
    { userId: bob.id, forumId: techForum.id, handle: "b0b_", isAdmin: false },
    // testuser and alice on underground
    {
      userId: testUser.id,
      forumId: undergroundForum.id,
      handle: "shadow_op",
      isAdmin: false,
    },
    {
      userId: alice.id,
      forumId: undergroundForum.id,
      handle: "n1ghtshade",
      isAdmin: false,
    },
  ];

  for (const membership of forumMemberships) {
    await prisma.forumMember.upsert({
      where: {
        userId_forumId: {
          userId: membership.userId,
          forumId: membership.forumId,
        },
      },
      update: {},
      create: {
        userId: membership.userId,
        forumId: membership.forumId,
        handle: membership.handle,
        reputation: 0,
        postCount: 0,
        isAdmin: membership.isAdmin,
      },
    });
  }
  console.log(`  ✓ Created ${forumMemberships.length} forum memberships`);

  // ============================================================
  // SECTION 11: SHOP ITEMS (13 items across categories & rarities)
  // ============================================================
  console.log("\n🛒 Creating shop items...");

  const shopItems = [
    // === Hardware — Tier 1 (common, cheap) ===
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

    // === Hardware — Tier 2 (uncommon, moderate) ===
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

    // === Hardware — Tier 3 (rare, expensive) ===
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

    // === Communication Tokens — Faction Leaders ===
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
    // === Communication Tokens — AIDA ===
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
    // === Communication Token — The Architect ===
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
    `  ✓ Created ${shopItems.length} shop items (hardware + software)`,
  );

  // ============================================================
  // SECTION 12: GAME CONFIG
  // ============================================================
  console.log("\n⚙️  Creating game config...");

  await prisma.gameConfig.upsert({
    where: { key: "game_settings" },
    update: {},
    create: {
      key: "game_settings",
      value: {
        version: "0.5.0",
        maxPlayersPerServer: 50,
        tickRateMs: 60000,
        factionWarEnabled: false,
        pvpEnabled: true,
        storyMode: "active",
        maintenanceMode: false,
        serverContentProvisioned: false,
        tutorialEnabled: true,
      },
    },
  });
  console.log("  ✓ Created game_settings config");

  // ============================================================
  // SECTION 13: KEY FRAGMENTS (3 types × 3 fragments = 9)
  // ============================================================
  console.log("\n🔑 Creating key fragments...");

  const keyFragments = [
    // Signal Key fragments (1-3)
    {
      keyType: "signal",
      fragmentNum: 1,
      name: "Signal Fragment Alpha",
      description:
        "A faint digital signal pattern found embedded in network traffic logs. It pulses at irregular intervals, like a heartbeat.",
      hint: "Monitor the traffic logs on Garrison's DNS server. The signal hides in the noise.",
      sourceType: "server",
      sourceId: garrisonDns.id,
    },
    {
      keyType: "signal",
      fragmentNum: 2,
      name: "Signal Fragment Beta",
      description:
        "A secondary signal pattern that resonates with Fragment Alpha. Together they form a partial waveform.",
      hint: "The dotHackers relay gateway processes thousands of packets. One of them is different.",
      sourceType: "server",
      sourceId: dhRelay.id,
    },
    {
      keyType: "signal",
      fragmentNum: 3,
      name: "Signal Fragment Gamma",
      description:
        "The final signal piece. Combined with Alpha and Beta, it reveals a complete frequency — AIDA's carrier wave.",
      hint: "CyberCorp's web portal leaks more than marketing data. Look deeper.",
      sourceType: "server",
      sourceId: cybercorpWeb.id,
    },

    // Location Key fragments (1-3)
    {
      keyType: "location",
      fragmentNum: 1,
      name: "Location Fragment Alpha",
      description:
        "A partial IP address fragment, scrambled across multiple routing tables. The first octets of something hidden.",
      hint: "Garrison's Intel Database contains classified routing tables. One entry doesn't belong.",
      sourceType: "server",
      sourceId: garrisonIntel.id,
    },
    {
      keyType: "location",
      fragmentNum: 2,
      name: "Location Fragment Beta",
      description:
        "The second part of a hidden network address, found in corrupted DNS records.",
      hint: "CyberCorp's DNS server has a record that points to an address that doesn't exist... yet.",
      sourceType: "server",
      sourceId: cybercorpDns.id,
    },
    {
      keyType: "location",
      fragmentNum: 3,
      name: "Location Fragment Gamma",
      description:
        "The final network address fragment. Combined, they reveal the subnet where AIDA hides.",
      hint: "The dH Dead Drops contain more than stolen data. One file is a map fragment.",
      sourceType: "server",
      sourceId: dhDrops.id,
    },

    // Cipher Key fragments (1-3)
    {
      keyType: "cipher",
      fragmentNum: 1,
      name: "Cipher Fragment Alpha",
      description:
        "An encryption key shard — part of the cipher needed to communicate with AIDA directly.",
      hint: "The Underground Market forum has a post that seems like nonsense. It's not.",
      sourceType: "forum",
      sourceId: undergroundForum.id,
    },
    {
      keyType: "cipher",
      fragmentNum: 2,
      name: "Cipher Fragment Beta",
      description:
        "A second cipher shard. When combined with Alpha, patterns emerge in the entropy.",
      hint: "CyberCorp's Data Vault has a file that even they don't know about.",
      sourceType: "server",
      sourceId: cybercorpVault.id,
    },
    {
      keyType: "cipher",
      fragmentNum: 3,
      name: "Cipher Fragment Gamma",
      description:
        "The final cipher shard. With all three, AIDA's encryption can be broken — or matched.",
      hint: "The Garrison Classified Archive holds a file labeled 'PROJECT ECHO'. It's the last piece.",
      sourceType: "server",
      sourceId: garrisonClassified.id,
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
    `  ✓ Created ${keyFragments.length} key fragments (3 signal + 3 location + 3 cipher)`,
  );

  // ============================================================
  // SECTION 14: STORY PROGRESS (for all test users)
  // ============================================================
  console.log("\n📖 Creating story progress...");

  for (const user of [testUser, alice, bob]) {
    await prisma.storyProgress.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        discoveryLevel: 0,
        signalKey: 0,
        locationKey: 0,
        cipherKey: 0,
        fragments: [],
        hasContactedAIDA: false,
        aidaContactCount: 0,
        aidaTrustLevel: 0,
        endgameUnlocked: false,
        gameCompleted: false,
      },
    });
  }
  console.log("  ✓ Story progress initialized for all test users");

  // ============================================================
  // DONE
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("✅ Database seeded successfully!");
  console.log("=".repeat(60));
  console.log("\n📝 Test credentials:");
  console.log("   Username: testuser  (admin)  Password: password123");
  console.log("   Username: alice               Password: password123");
  console.log("   Username: bob                 Password: password123");
  console.log(
    "\n⚔️  Factions: The Garrison, dotHackers, CyberCorp + DarkNet (hidden)",
  );
  console.log(
    "🤖 AI Personas: The Architect, AIDA, Commander Steele, gh0st, Director Chen",
  );
  console.log(
    "🌐 Networks: 4 faction networks + internet exchange (28 servers)",
  );
  console.log("📋 Forums: 6 (tech, underground, honeypot, 3 faction)");
  console.log("🛒 Shop: 13 items (hardware + software)");
  console.log("🔑 Key Fragments: 9 (signal/location/cipher × 3)");
  console.log("");
}

export { main as seed };

main()
  .catch((e) => {
    console.error("❌ Error seeding database:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
