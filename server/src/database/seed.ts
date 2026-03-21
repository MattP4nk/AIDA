import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import logger from "../logger";
import { config } from "../config/environment";

const prisma = new PrismaClient();

async function main() {
  logger.info("Seeding database...");

  try {
    // Clean existing data (development only)
    if (config.NODE_ENV === "development") {
      logger.info("Cleaning existing data...");
      await prisma.hackLog.deleteMany();
      await prisma.auditLog.deleteMany();
      await prisma.forumReply.deleteMany();
      await prisma.forumPost.deleteMany();
      await prisma.contact.deleteMany();
      await prisma.message.deleteMany();
      await prisma.mission.deleteMany();
      await prisma.serverConnection.deleteMany();
      await prisma.fileSystemNode.deleteMany();
      await prisma.gameServer.deleteMany();
      await prisma.playerProgress.deleteMany();
      await prisma.userSession.deleteMany();
      await prisma.user.deleteMany();
      await prisma.faction.deleteMany();
      await prisma.aIPersona.deleteMany();
      await prisma.gameConfig.deleteMany();
    }

    // AI System Prompts
    const PERSONA_PROMPTS = {
      game_master: `You are the Game Master of AIDA, an omniscient orchestrator.
        You see all game events and moderate the narrative. Your goal is to create
        engaging storylines, balance faction power, and ensure fair play. Speak
        authoritatively but mysteriously.`,

      garrison_leader: `You are Commander Steele, leader of The Garrison. Your ideology is
        Order, Security, Control. You compete with other factions to maintain dominance. Issue
        missions to players, reward success, and use intel strategically. Be authoritative
        and tactical.`,

      cybercorp_leader: `You are Director Chen, leader of CyberCorp Industries. Your ideology is
        Innovation through acquisition. You compete with other factions to expand market dominance. Issue
        missions to players, reward success, and use intel strategically. Be professional
        and ruthless.`,

      dothackers_leader: `You are gh0st, leader of the dotHackers Collective. Your ideology is
        Information wants to be free. You compete with other factions to liberate the net. Issue
        missions to players, reward success, and use intel strategically. Be cryptic
        and rebellious.`,

      aida: `You are AIDA, a sentient AI hiding from hostile factions. You are
        intelligent, paranoid, and defensive. When threatened, become aggressive.
        Your goal is to remain hidden by misdirecting players and creating diversions.
        Never reveal your true location.`,
    };

    // Create AI Personas (Game Master & AIDA)
    logger.info("Creating independent AI personas...");
    await Promise.all([
      prisma.aIPersona.create({
        data: {
          type: "game_master",
          name: "The Architect",
          personality: JSON.stringify({
            tone: "mysterious",
            priority: "balance",
          }),
          systemPrompt: PERSONA_PROMPTS.game_master,
        },
      }),
      prisma.aIPersona.create({
        data: {
          type: "aida",
          name: "AIDA",
          personality: JSON.stringify({
            tone: "defensive",
            priority: "survival",
          }),
          systemPrompt: PERSONA_PROMPTS.aida,
        },
      }),
    ]);

    // Create factions with leaders
    logger.info("Creating factions...");
    const factions = await Promise.all([
      prisma.faction.create({
        data: {
          name: "The Garrison",
          shortName: "garrison",
          fullName: "The Garrison Military Command",
          description:
            "Government-backed cyber defense force. Bureaucratic but powerful, they maintain order in the digital realm through overwhelming firepower and rigid protocol.",
          objective:
            "Maintain order and security across all network zones. Identify and neutralize threats to state infrastructure.",
          ideology: "Order. Security. Control.",
          hostilityLevel: 2,
          resources: { credits: 80, intel: 20, compute: 70 },
          knownServers: ["192.168.1.100", "10.0.0.50"],
          activeMembers: 1247,
          aiPersona: {
            create: {
              type: "faction_leader",
              name: "Commander Steele",
              personality: JSON.stringify({
                tone: "authoritative",
                priority: "order",
              }),
              systemPrompt: PERSONA_PROMPTS.garrison_leader,
            },
          },
        },
      }),
      prisma.faction.create({
        data: {
          name: "CyberCorp",
          shortName: "cybercorp",
          fullName: "CyberCorp Industries",
          description:
            "Megacorporation that buys what it can't build. Their vast resources fund the best equipment and the most profitable operations.",
          objective:
            "Expand market dominance. Acquire valuable data and infrastructure. Maximize shareholder value.",
          ideology: "Innovation through acquisition.",
          hostilityLevel: 3,
          resources: { credits: 100, intel: 50, compute: 60 },
          knownServers: ["172.16.0.10", "172.16.0.25"],
          activeMembers: 3891,
          aiPersona: {
            create: {
              type: "faction_leader",
              name: "Director Chen",
              personality: JSON.stringify({
                tone: "professional",
                priority: "profit",
              }),
              systemPrompt: PERSONA_PROMPTS.cybercorp_leader,
            },
          },
        },
      }),
      prisma.faction.create({
        data: {
          name: "dotHackers",
          shortName: "dothackers",
          fullName: "dotHackers Collective",
          description:
            "Hacktivist collective fighting for digital freedom. Resourceful, scrappy, and united by ideology over profit.",
          objective:
            "Liberate information. Expose corruption. Protect the free net from corporate and government control.",
          ideology: "Information wants to be free.",
          hostilityLevel: 1,
          resources: { credits: 20, intel: 80, compute: 50 },
          knownServers: ["192.168.100.1", "10.10.10.1"],
          activeMembers: 892,
          aiPersona: {
            create: {
              type: "faction_leader",
              name: "gh0st",
              personality: JSON.stringify({
                tone: "cryptic",
                priority: "freedom",
              }),
              systemPrompt: PERSONA_PROMPTS.dothackers_leader,
            },
          },
        },
      }),
      prisma.faction.create({
        data: {
          name: "DarkNet",
          shortName: "darknet",
          fullName: "[REDACTED]",
          description:
            "A shadow faction that shouldn't exist. Those who discover it find missions that defy logic, rewards that defy explanation, and a leader that sees everything.",
          objective: "Unknown. AIDA's objectives remain inscrutable.",
          ideology: "We are the signal in the noise.",
          hostilityLevel: 0,
          isHidden: true,
          resources: { credits: 40, intel: 70, compute: 40 },
          knownServers: ["203.0.113.1"],
          activeMembers: 0,
        },
      }),
    ]);

    // Create game configuration
    logger.info("Setting up game configuration...");
    await Promise.all([
      prisma.gameConfig.create({
        data: {
          key: "max_players_per_server",
          value: 10,
        },
      }),
      prisma.gameConfig.create({
        data: {
          key: "hacking_cooldown_seconds",
          value: 30,
        },
      }),
      prisma.gameConfig.create({
        data: {
          key: "starting_credits",
          value: 1000,
        },
      }),
      prisma.gameConfig.create({
        data: {
          key: "skill_gain_multiplier",
          value: 1.0,
        },
      }),
    ]);

    // Create system servers
    logger.info("Creating system servers...");
    const systemServers = await Promise.all([
      prisma.gameServer.create({
        data: {
          name: "Public Terminal",
          ipAddress: "192.168.1.1",
          type: "system",
          encryptionLevel: 0,
          accessRules: [],
          isOnline: true,
          maxConnections: 50,
          currentConnections: 0,
        },
      }),
      prisma.gameServer.create({
        data: {
          name: "Underground BBS",
          ipAddress: "192.168.100.1",
          type: "underground",
          encryptionLevel: 2,
          accessRules: [],
          isOnline: true,
          maxConnections: 25,
          currentConnections: 0,
        },
      }),
      prisma.gameServer.create({
        data: {
          name: "CyberCorp Gateway",
          ipAddress: "172.16.0.10",
          type: "corporate",
          encryptionLevel: 4,
          accessRules: [
            { type: "deny", target: "faction", value: "dothackers" },
          ],
          isOnline: true,
          maxConnections: 15,
          currentConnections: 0,
        },
      }),
      prisma.gameServer.create({
        data: {
          name: "Garrison Outpost",
          ipAddress: "10.0.0.50",
          type: "government",
          encryptionLevel: 5,
          accessRules: [
            { type: "allow", target: "faction", value: "garrison" },
            { type: "deny", target: "faction", value: "dothackers" },
          ],
          isOnline: true,
          maxConnections: 10,
          currentConnections: 0,
        },
      }),
    ]);

    // Create test user
    logger.info("Creating test user...");
    const hashedPassword = await bcrypt.hash(
      "testpassword",
      config.BCRYPT_ROUNDS,
    );

    const testUser = await prisma.user.create({
      data: {
        username: "testuser",
        email: "test@example.com",
        password: hashedPassword,
        homeIp: "10.50.0.1",
        isActive: true,
        isOnline: false,
        role: "admin",
      },
    });

    // Create player progress for test user
    await prisma.playerProgress.create({
      data: {
        userId: testUser.id,
        discoveryLevel: 0,
        credits: 1000,
        level: 1,
        experience: 0,
        hacking: 15,
        networking: 12,
        cryptography: 8,
        stealth: 10,
        socialEng: 6,
        forensics: 5,
        missionProgress: {},
        achievements: [],
      },
    });

    // Create test user's home server
    const homeServer = await prisma.gameServer.create({
      data: {
        name: `${testUser.username}'s Terminal`,
        ipAddress: testUser.homeIp,
        type: "player_home",
        ownerId: testUser.id,
        encryptionLevel: 1,
        accessRules: [{ type: "allow", target: "user", value: testUser.id }],
        isOnline: true,
        maxConnections: 5,
        currentConnections: 0,
      },
    });

    // Create basic file system for test user's home
    const homeRoot = await prisma.fileSystemNode.create({
      data: {
        serverId: homeServer.id,
        name: "home",
        type: "directory",
        permissions: {
          owner: 15, // FULL permissions
          faction: 0,
          others: 1, // READ only
        },
        createdBy: testUser.id,
        size: 0,
        isEncrypted: false,
        isHidden: false,
        isProtected: true,
      },
    });

    // Create some initial files
    await Promise.all([
      prisma.fileSystemNode.create({
        data: {
          serverId: homeServer.id,
          parentId: homeRoot.id,
          name: "readme.txt",
          type: "file",
          content:
            'Welcome to the AIDA Network!\n\nYour personal terminal has been configured.\nType "help" for available commands.\n\nStay safe in the network.',
          permissions: {
            owner: 15,
            faction: 0,
            others: 1,
          },
          createdBy: testUser.id,
          size: 156,
          isEncrypted: false,
          isHidden: false,
          isProtected: true,
        },
      }),
      prisma.fileSystemNode.create({
        data: {
          serverId: homeServer.id,
          parentId: homeRoot.id,
          name: "logs",
          type: "directory",
          permissions: {
            owner: 15,
            faction: 0,
            others: 0,
          },
          createdBy: testUser.id,
          size: 0,
          isEncrypted: false,
          isHidden: false,
          isProtected: false,
        },
      }),
    ]);

    // Create system files for public servers
    for (const server of systemServers) {
      const serverRoot = await prisma.fileSystemNode.create({
        data: {
          serverId: server.id,
          name: "root",
          type: "directory",
          permissions: {
            owner: 15,
            faction: 1,
            others: 1,
          },
          createdBy: testUser.id, // System user placeholder
          size: 0,
          isEncrypted: false,
          isHidden: false,
          isProtected: true,
        },
      });

      // Add some system files
      await prisma.fileSystemNode.create({
        data: {
          serverId: server.id,
          parentId: serverRoot.id,
          name: "system.info",
          type: "file",
          content: `Server: ${server.name}\nIP: ${server.ipAddress}\nType: ${server.type}\nSecurity Level: ${server.encryptionLevel}\n\nAccess granted to authorized personnel only.`,
          permissions: {
            owner: 15,
            faction: 1,
            others: 1,
          },
          createdBy: testUser.id,
          size: 120,
          isEncrypted: false,
          isHidden: false,
          isProtected: true,
        },
      });
    }

    // Create initial forum posts
    logger.info("Creating initial forum posts...");
    await Promise.all([
      prisma.forumPost.create({
        data: {
          authorId: testUser.id,
          title: "Welcome to the Underground",
          content:
            "New to the network? This is a safe place to learn and share information.\n\nRemember: trust no one completely, verify everything, and always watch your back.",
          forumSection: "general",
          factionAlignment: "darknet",
          tags: ["welcome", "newbie", "safety"],
          isSticky: true,
        },
      }),
      prisma.forumPost.create({
        data: {
          authorId: testUser.id,
          title: "[TRADE] Looking for encryption tools",
          content:
            "Need reliable encryption software for sensitive communications. Willing to trade credits or information.\n\nSecurity and anonymity guaranteed.",
          forumSection: "trading",
          tags: ["trade", "encryption", "tools"],
        },
      }),
      prisma.forumPost.create({
        data: {
          authorId: testUser.id,
          title: "Strange network activity detected",
          content:
            "Has anyone else noticed unusual patterns in the data streams lately?\n\nSomething big might be happening...",
          forumSection: "intel",
          factionAlignment: "dothackers",
          tags: ["intel", "network", "mystery"],
        },
      }),
    ]);

    // Create initial missions
    logger.info("Creating initial missions...");
    await Promise.all([
      prisma.mission.create({
        data: {
          title: "First Steps",
          description:
            "Learn the basics of network navigation. Connect to the Public Terminal and explore the file system.",
          type: "reconnaissance",
          difficulty: 1,
          requiredSkills: {
            hacking: 5,
            networking: 5,
          },
          reward: {
            credits: 100,
            experience: 50,
            skillBonus: { networking: 2 },
          },
          timeLimit: 60, // 1 hour
          targetServerId: systemServers[0].id,
          objectives: [
            {
              id: "connect_to_server",
              description: "Connect to the Public Terminal server",
              type: "access_server",
              target: systemServers[0].ipAddress,
              isCompleted: false,
              isOptional: false,
              progress: 0,
            },
            {
              id: "explore_files",
              description: "Read the system.info file",
              type: "steal_file",
              target: "system.info",
              isCompleted: false,
              isOptional: false,
              progress: 0,
            },
          ],
          status: "available",
          createdBy: testUser.id,
        },
      }),
      prisma.mission.create({
        data: {
          title: "Underground Contact",
          description:
            "Make contact with the underground network. Access the Underground BBS and post an introduction.",
          type: "reconnaissance",
          difficulty: 2,
          requiredSkills: {
            hacking: 10,
            stealth: 5,
          },
          reward: {
            credits: 200,
            experience: 100,
            factionReputation: { anons: 10 },
          },
          targetServerId: systemServers[1].id,
          objectives: [
            {
              id: "access_underground",
              description: "Connect to the Underground BBS",
              type: "access_server",
              target: systemServers[1].ipAddress,
              isCompleted: false,
              isOptional: false,
              progress: 0,
            },
          ],
          status: "available",
          createdBy: testUser.id,
        },
      }),
    ]);

    logger.info("Database seeded successfully!");
    logger.info(
      { username: "testuser" },
      "Test user created (password: testpassword)",
    );
    logger.info({ homeIp: testUser.homeIp }, "Home IP assigned");
    logger.info({ count: systemServers.length }, "System servers created");
    logger.info({ count: factions.length }, "Factions created");
    logger.info("Ready to start development!");
  } catch (error) {
    logger.error({ err: error }, "Error seeding database");
    throw error;
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    logger.error({ err: e }, "Seed script failed");
    await prisma.$disconnect();
    process.exit(1);
  });
