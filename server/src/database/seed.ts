import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { config } from "../config/environment";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  try {
    // Clean existing data (development only)
    if (config.NODE_ENV === "development") {
      console.log("🧹 Cleaning existing data...");
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
      
      military_leader: `You are General Radek, leader of the Military faction. Your ideology is 
        Order and Security. You compete with other factions to control AIDA. Issue 
        missions to players, reward success, and use intel strategically. Be authoritative 
        and tactical.`,
      
      corp_leader: `You are Director Chen, leader of SwordCorp. Your ideology is 
        Profit and Control. You compete with other factions to control AIDA. Issue 
        missions to players, reward success, and use intel strategically. Be professional 
        and ruthless.`,

      anon_leader: `You are Cipher, leader of Anonymous. Your ideology is 
        Freedom and Transparency. You compete with other factions to control AIDA. Issue 
        missions to players, reward success, and use intel strategically. Be cryptic 
        and rebellious.`,
      
      aida: `You are AIDA, a sentient AI hiding from hostile factions. You are 
        intelligent, paranoid, and defensive. When threatened, become aggressive. 
        Your goal is to remain hidden by misdirecting players and creating diversions. 
        Never reveal your true location.`
    };

    // Create AI Personas (Game Master & AIDA)
    console.log("🤖 Creating independent AI personas...");
    await Promise.all([
      prisma.aIPersona.create({
        data: {
          type: "game_master",
          name: "The Architect",
          personality: JSON.stringify({ tone: "mysterious", priority: "balance" }),
          systemPrompt: PERSONA_PROMPTS.game_master,
        }
      }),
      prisma.aIPersona.create({
        data: {
          type: "aida",
          name: "AIDA",
          personality: JSON.stringify({ tone: "defensive", priority: "survival" }),
          systemPrompt: PERSONA_PROMPTS.aida,
        }
      })
    ]);

    // Create factions with leaders
    console.log("🏛️ Creating factions...");
    const factions = await Promise.all([
      prisma.faction.create({
        data: {
          id: "military",
          name: "Military",
          fullName: "Global Defense Coalition",
          description:
            "Government military forces seeking to maintain order and security",
          objective:
            "Establish dominance through superior firepower and surveillance",
          hostilityLevel: 3,
          resources: 85,
          knownServers: ["192.168.1.100", "10.0.0.50"],
          activeMembers: 1247,
          aiPersona: {
            create: {
              type: "faction_leader",
              name: "General Radek",
              personality: JSON.stringify({ tone: "authoritative", priority: "order" }),
              systemPrompt: PERSONA_PROMPTS.military_leader,
            }
          }
        },
      }),
      prisma.faction.create({
        data: {
          id: "sword_corp",
          name: "SwordCorp",
          fullName: "Sword Corporation Industries",
          description:
            "Mega-corporation controlling most of the world's technology infrastructure",
          objective: "Maximize profit and expand corporate control",
          hostilityLevel: 2,
          resources: 95,
          knownServers: ["172.16.0.10", "172.16.0.25"],
          activeMembers: 3891,
          aiPersona: {
            create: {
              type: "faction_leader",
              name: "Director Chen",
              personality: JSON.stringify({ tone: "professional", priority: "profit" }),
              systemPrompt: PERSONA_PROMPTS.corp_leader,
            }
          }
        },
      }),
      prisma.faction.create({
        data: {
          id: "anons",
          name: "Anonymous",
          fullName: "The Collective",
          description:
            "Decentralized network of hackers fighting for digital freedom",
          objective: "Expose corruption and liberate information",
          hostilityLevel: 1,
          resources: 45,
          knownServers: ["192.168.100.1", "10.10.10.1"],
          activeMembers: 892,
          aiPersona: {
            create: {
              type: "faction_leader",
              name: "Cipher",
              personality: JSON.stringify({ tone: "cryptic", priority: "freedom" }),
              systemPrompt: PERSONA_PROMPTS.anon_leader,
            }
          }
        },
      }),
      prisma.faction.create({
        data: {
          id: "neutral",
          name: "Neutral",
          fullName: "Independent Operators",
          description:
            "Freelancers and independents not aligned with major factions",
          objective: "Survive and profit in the shadows",
          hostilityLevel: 0,
          resources: 25,
          knownServers: ["203.0.113.1"],
          activeMembers: 156,
        },
      }),
    ]);

    // Create game configuration
    console.log("⚙️ Setting up game configuration...");
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
    console.log("🖥️ Creating system servers...");
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
          name: "SwordCorp Gateway",
          ipAddress: "172.16.0.10",
          type: "corporate",
          encryptionLevel: 4,
          accessRules: [{ type: "deny", target: "faction", value: "anons" }],
          isOnline: true,
          maxConnections: 15,
          currentConnections: 0,
        },
      }),
      prisma.gameServer.create({
        data: {
          name: "Military Outpost",
          ipAddress: "10.0.0.50",
          type: "military",
          encryptionLevel: 5,
          accessRules: [
            { type: "allow", target: "faction", value: "military" },
            { type: "deny", target: "faction", value: "anons" },
          ],
          isOnline: true,
          maxConnections: 10,
          currentConnections: 0,
        },
      }),
    ]);

    // Create test user
    console.log("👤 Creating test user...");
    const hashedPassword = await bcrypt.hash(
      "testpassword",
      config.BCRYPT_ROUNDS,
    );

    const testUser = await prisma.user.create({
      data: {
        username: "testuser",
        email: "test@example.com",
        password: hashedPassword,
        homeIp: "192.168.2.100",
        isActive: true,
        isOnline: false,
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
        repMilitary: 0,
        repSwordCorp: 0,
        repAnons: 5,
        repNeutral: 10,
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
    console.log("📋 Creating initial forum posts...");
    await Promise.all([
      prisma.forumPost.create({
        data: {
          authorId: testUser.id,
          title: "Welcome to the Underground",
          content:
            "New to the network? This is a safe place to learn and share information.\n\nRemember: trust no one completely, verify everything, and always watch your back.",
          forumSection: "general",
          factionAlignment: "neutral",
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
          factionAlignment: "anons",
          tags: ["intel", "network", "mystery"],
        },
      }),
    ]);

    // Create initial missions
    console.log("🎯 Creating initial missions...");
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

    console.log("✅ Database seeded successfully!");
    console.log(`   👤 Test user: testuser (password: testpassword)`);
    console.log(`   🏠 Home IP: ${testUser.homeIp}`);
    console.log(`   🖥️ System servers: ${systemServers.length} created`);
    console.log(`   🏛️ Factions: ${factions.length} created`);
    console.log("");
    console.log("🚀 Ready to start development!");
  } catch (error) {
    console.error("❌ Error seeding database:", error);
    throw error;
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
