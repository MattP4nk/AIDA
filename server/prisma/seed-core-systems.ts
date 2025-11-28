import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/utils/auth";

const prisma = new PrismaClient();

/**
 * Seed Core Systems - Servers, NPCs, and Starter Data
 *
 * This seed creates the foundational gameplay elements:
 * - Tutorial and progression servers
 * - NPC users for missions and interactions
 * - Starter equipment and data
 */
async function seedCoreSystems() {
  console.log("🌱 Starting Core Systems seed...");

  try {
    // ==================== CREATE NPC USERS ====================
    console.log("👥 Creating NPC users...");

    const hashedPassword = await hashPassword("npc_account");

    const npcs = [
      {
        id: "npc_mentor",
        username: "Cipher",
        email: "cipher@aida.net",
        password: hashedPassword,
        isNPC: true,
        level: 50,
        reputation: 1000,
      },
      {
        id: "npc_vendor",
        username: "Raven",
        email: "raven@darknet.onion",
        password: hashedPassword,
        isNPC: true,
        level: 30,
        reputation: 500,
      },
      {
        id: "npc_rival",
        username: "Specter",
        email: "specter@void.net",
        password: hashedPassword,
        isNPC: true,
        level: 40,
        reputation: 800,
      },
      {
        id: "npc_contact",
        username: "Ghost",
        email: "ghost@shadow.net",
        password: hashedPassword,
        isNPC: true,
        level: 45,
        reputation: 900,
      },
    ];

    for (const npc of npcs) {
      await prisma.user.upsert({
        where: { id: npc.id },
        update: {},
        create: npc,
      });
      console.log(`  ✓ Created NPC: ${npc.username}`);
    }

    // ==================== CREATE GAME SERVERS ====================
    console.log("\n🖥️  Creating game servers...");

    const servers = [
      // Tutorial Servers
      {
        id: "srv_tutorial_01",
        name: "Training Ground Alpha",
        ipAddress: "192.168.1.100",
        type: "TUTORIAL",
        ownerId: "npc_mentor",
        encryptionLevel: 1,
        isOnline: true,
        maxConnections: 100,
        currentConnections: 0,
        accessRules: [
          { rule: "allow_all", description: "Open to all users for training" },
        ],
        metadata: {
          difficulty: "BEGINNER",
          rewards: { xp: 100, credits: 50 },
          description: "Your first target. Low security, perfect for learning.",
          hints: [
            "Use 'scan' to discover open ports",
            "Try 'hack' to gain access",
            "Read files with 'cat filename'",
          ],
        },
      },
      {
        id: "srv_tutorial_02",
        name: "Training Ground Beta",
        ipAddress: "192.168.1.101",
        type: "TUTORIAL",
        ownerId: "npc_mentor",
        encryptionLevel: 2,
        isOnline: true,
        maxConnections: 100,
        currentConnections: 0,
        accessRules: [
          { rule: "level_required", value: 2, description: "Requires level 2" },
        ],
        metadata: {
          difficulty: "BEGINNER",
          rewards: { xp: 200, credits: 100 },
          description: "Slightly harder security. Practice stealth techniques.",
        },
      },

      // Corporate Servers
      {
        id: "srv_corp_01",
        name: "MegaCorp Primary Server",
        ipAddress: "10.0.1.50",
        type: "CORPORATE",
        ownerId: null,
        encryptionLevel: 5,
        isOnline: true,
        maxConnections: 50,
        currentConnections: 0,
        accessRules: [
          { rule: "encryption_required", value: 3 },
          { rule: "skill_required", skill: "hacking", value: 30 },
        ],
        metadata: {
          difficulty: "MEDIUM",
          rewards: { xp: 500, credits: 300 },
          description: "Corporate mainframe. Contains valuable data.",
          security: {
            firewall: 40,
            ids: 35,
            encryption: 50,
          },
        },
      },
      {
        id: "srv_corp_02",
        name: "DataTech Industries",
        ipAddress: "10.0.2.75",
        type: "CORPORATE",
        ownerId: null,
        encryptionLevel: 4,
        isOnline: true,
        maxConnections: 30,
        currentConnections: 0,
        accessRules: [
          { rule: "skill_required", skill: "hacking", value: 25 },
        ],
        metadata: {
          difficulty: "MEDIUM",
          rewards: { xp: 400, credits: 250 },
          description: "Data storage facility. Moderate security.",
        },
      },

      // Government Servers
      {
        id: "srv_gov_01",
        name: "Federal Database",
        ipAddress: "172.16.0.10",
        type: "GOVERNMENT",
        ownerId: null,
        encryptionLevel: 7,
        isOnline: true,
        maxConnections: 20,
        currentConnections: 0,
        accessRules: [
          { rule: "level_required", value: 8 },
          { rule: "skill_required", skill: "hacking", value: 60 },
        ],
        metadata: {
          difficulty: "HARD",
          rewards: { xp: 1000, credits: 800 },
          description: "High-security government system. Extreme risk.",
          security: {
            firewall: 70,
            ids: 80,
            encryption: 75,
          },
          consequences: {
            detectionPenalty: "severe",
            alertsAuthorities: true,
          },
        },
      },

      // Research Servers
      {
        id: "srv_research_01",
        name: "Apex Labs Research Server",
        ipAddress: "10.10.10.50",
        type: "RESEARCH",
        ownerId: null,
        encryptionLevel: 6,
        isOnline: true,
        maxConnections: 25,
        currentConnections: 0,
        accessRules: [
          { rule: "level_required", value: 6 },
          { rule: "skill_required", skill: "hacking", value: 40 },
        ],
        metadata: {
          difficulty: "MEDIUM-HARD",
          rewards: { xp: 700, credits: 500 },
          description: "Scientific research facility. Contains experimental data.",
          security: {
            firewall: 55,
            ids: 50,
            encryption: 60,
          },
        },
      },

      // Underground/Criminal Servers
      {
        id: "srv_underground_01",
        name: "Shadow Market Hub",
        ipAddress: "192.168.13.37",
        type: "UNDERGROUND",
        ownerId: "npc_vendor",
        encryptionLevel: 5,
        isOnline: true,
        maxConnections: 100,
        currentConnections: 0,
        accessRules: [
          { rule: "reputation_required", value: 100 },
        ],
        metadata: {
          difficulty: "MEDIUM",
          rewards: { xp: 300, credits: 400 },
          description: "Black market server. Access to illegal goods and services.",
          services: ["shop", "contracts", "information"],
        },
      },

      // Banking Servers
      {
        id: "srv_bank_01",
        name: "Global Financial Network",
        ipAddress: "10.20.30.100",
        type: "FINANCIAL",
        ownerId: null,
        encryptionLevel: 8,
        isOnline: true,
        maxConnections: 15,
        currentConnections: 0,
        accessRules: [
          { rule: "level_required", value: 10 },
          { rule: "skill_required", skill: "hacking", value: 70 },
          { rule: "encryption_required", value: 5 },
        ],
        metadata: {
          difficulty: "VERY_HARD",
          rewards: { xp: 1500, credits: 2000 },
          description: "International banking system. Maximum security. Highest rewards.",
          security: {
            firewall: 85,
            ids: 90,
            encryption: 88,
          },
          consequences: {
            detectionPenalty: "critical",
            alertsAuthorities: true,
            counterHack: true,
          },
        },
      },

      // Player Home Server
      {
        id: "srv_player_home",
        name: "Personal Server",
        ipAddress: "192.168.0.1",
        type: "PERSONAL",
        ownerId: null, // Will be assigned to each player
        encryptionLevel: 3,
        isOnline: true,
        maxConnections: 10,
        currentConnections: 0,
        accessRules: [
          { rule: "owner_only" },
        ],
        metadata: {
          description: "Your personal secure server. Store files and manage operations.",
          upgradeable: true,
        },
      },

      // Testing/Honeypot Servers
      {
        id: "srv_honeypot_01",
        name: "Vulnerable Test System",
        ipAddress: "203.0.113.42",
        type: "HONEYPOT",
        ownerId: null,
        encryptionLevel: 1,
        isOnline: true,
        maxConnections: 999,
        currentConnections: 0,
        accessRules: [
          { rule: "allow_all" },
        ],
        metadata: {
          difficulty: "TRAP",
          description: "Looks easy... Too easy. Probably a trap.",
          isTrap: true,
          consequences: {
            detectionPenalty: "severe",
            alertsAuthorities: true,
            traceback: true,
          },
        },
      },
    ];

    for (const server of servers) {
      await prisma.gameServer.upsert({
        where: { id: server.id },
        update: {},
        create: server as any,
      });
      console.log(`  ✓ Created server: ${server.name} (${server.ipAddress})`);
    }

    // ==================== CREATE FILE SYSTEM STRUCTURES ====================
    console.log("\n📁 Creating file system structures...");

    // Tutorial server files
    const tutorialFiles = [
      {
        serverId: "srv_tutorial_01",
        name: "welcome.txt",
        path: "/home",
        type: "FILE",
        size: 256,
        content: `Welcome to the AIDA Training System
=====================================

Congratulations on your first successful connection.

This is a secure training environment designed to teach
you the fundamentals of network infiltration.

Your objectives:
1. Explore this system using basic commands (ls, cd, cat)
2. Locate the hidden file containing your first access code
3. Use the 'hack' command to practice exploitation techniques

Remember: Every action leaves a trace. Learn stealth early.

Good luck, operative.

- Cipher`,
        permissions: "r--r--r--",
        ownerId: "npc_mentor",
        isEncrypted: false,
      },
      {
        serverId: "srv_tutorial_01",
        name: "access_code.dat",
        path: "/home/data",
        type: "FILE",
        size: 64,
        content: "ACCESS_CODE: ALPHA-7734-DELTA\nLEVEL_CLEARANCE: 1\nNEXT_TARGET: 192.168.1.101",
        permissions: "r--r-----",
        ownerId: "npc_mentor",
        isEncrypted: false,
      },
      {
        serverId: "srv_tutorial_01",
        name: "readme.txt",
        path: "/home/data",
        type: "FILE",
        size: 128,
        content: "This directory contains sensitive training data.\nAccess restricted to authorized personnel only.",
        permissions: "r--r--r--",
        ownerId: "npc_mentor",
        isEncrypted: false,
      },
    ];

    for (const file of tutorialFiles) {
      await prisma.fileSystemNode.upsert({
        where: {
          serverId_path_name: {
            serverId: file.serverId,
            path: file.path,
            name: file.name,
          },
        },
        update: {},
        create: file as any,
      });
    }
    console.log(`  ✓ Created ${tutorialFiles.length} tutorial files`);

    // Corporate server files
    const corpFiles = [
      {
        serverId: "srv_corp_01",
        name: "employee_data.db",
        path: "/var/db",
        type: "FILE",
        size: 2048000,
        content: "[ENCRYPTED DATABASE - EMPLOYEE RECORDS]",
        permissions: "rw-------",
        ownerId: null,
        isEncrypted: true,
      },
      {
        serverId: "srv_corp_01",
        name: "financial_reports.xlsx",
        path: "/var/data/finance",
        type: "FILE",
        size: 512000,
        content: "[ENCRYPTED SPREADSHEET - Q4 FINANCIAL DATA]",
        permissions: "rw-r-----",
        ownerId: null,
        isEncrypted: true,
      },
    ];

    for (const file of corpFiles) {
      await prisma.fileSystemNode.upsert({
        where: {
          serverId_path_name: {
            serverId: file.serverId,
            path: file.path,
            name: file.name,
          },
        },
        update: {},
        create: file as any,
      });
    }
    console.log(`  ✓ Created ${corpFiles.length} corporate files`);

    // ==================== CREATE STARTER MISSIONS ====================
    console.log("\n🎯 Creating starter missions...");

    const missions = [
      {
        id: "mission_tutorial_01",
        title: "First Steps",
        description: "Connect to the training server and retrieve the access code.",
        type: "TUTORIAL",
        difficulty: "EASY",
        reward: 100,
        experienceReward: 50,
        status: "AVAILABLE",
        objectives: [
          {
            id: "obj_1",
            description: "Connect to 192.168.1.100",
            isCompleted: false,
            type: "connect",
            target: "srv_tutorial_01",
          },
          {
            id: "obj_2",
            description: "Find and read access_code.dat",
            isCompleted: false,
            type: "read_file",
            target: "access_code.dat",
          },
        ],
        metadata: {
          tips: [
            "Use 'servers' to see available targets",
            "Use 'connect <ip>' to connect to a server",
            "Navigate with 'ls' and 'cd'",
            "Read files with 'cat <filename>'",
          ],
        },
      },
      {
        id: "mission_tutorial_02",
        title: "Hack the Planet",
        description: "Use your hacking skills to compromise a low-security target.",
        type: "TUTORIAL",
        difficulty: "EASY",
        reward: 200,
        experienceReward: 100,
        status: "AVAILABLE",
        prerequisites: ["mission_tutorial_01"],
        objectives: [
          {
            id: "obj_1",
            description: "Successfully hack Training Ground Beta",
            isCompleted: false,
            type: "hack",
            target: "srv_tutorial_02",
          },
        ],
      },
      {
        id: "mission_data_theft_01",
        title: "Corporate Espionage",
        description: "A client needs employee data from MegaCorp. Infiltrate and extract.",
        type: "DATA_THEFT",
        difficulty: "MEDIUM",
        reward: 500,
        experienceReward: 300,
        status: "AVAILABLE",
        prerequisites: ["mission_tutorial_02"],
        objectives: [
          {
            id: "obj_1",
            description: "Hack into MegaCorp Primary Server",
            isCompleted: false,
            type: "hack",
            target: "srv_corp_01",
          },
          {
            id: "obj_2",
            description: "Download employee_data.db",
            isCompleted: false,
            type: "download_file",
            target: "employee_data.db",
          },
        ],
      },
      {
        id: "mission_explore_01",
        title: "Network Reconnaissance",
        description: "Scan the network and discover at least 5 different servers.",
        type: "EXPLORATION",
        difficulty: "EASY",
        reward: 150,
        experienceReward: 75,
        status: "AVAILABLE",
        objectives: [
          {
            id: "obj_1",
            description: "Discover 5 unique servers",
            isCompleted: false,
            type: "discover_servers",
            requiredCount: 5,
          },
        ],
      },
    ];

    for (const mission of missions) {
      await prisma.mission.upsert({
        where: { id: mission.id },
        update: {},
        create: mission as any,
      });
      console.log(`  ✓ Created mission: ${mission.title}`);
    }

    // ==================== CREATE GAME EVENTS ====================
    console.log("\n📢 Creating game events...");

    const events = [
      {
        id: "event_welcome",
        type: "SYSTEM",
        title: "Welcome to AIDA",
        description: "Neural interface initialized. All systems operational.",
        severity: "INFO",
        isGlobal: true,
        metadata: {
          category: "welcome",
        },
      },
      {
        id: "event_tutorial_start",
        type: "MISSION",
        title: "Training Available",
        description: "Cipher has prepared a training program for you.",
        severity: "INFO",
        isGlobal: false,
        metadata: {
          missionId: "mission_tutorial_01",
        },
      },
    ];

    for (const event of events) {
      await prisma.gameEvent.upsert({
        where: { id: event.id },
        update: {},
        create: event as any,
      });
    }
    console.log(`  ✓ Created ${events.length} game events`);

    // ==================== SUMMARY ====================
    console.log("\n✅ Core Systems seed completed successfully!");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`📊 Summary:`);
    console.log(`   • ${npcs.length} NPC users created`);
    console.log(`   • ${servers.length} game servers created`);
    console.log(`   • ${tutorialFiles.length + corpFiles.length} files created`);
    console.log(`   • ${missions.length} missions created`);
    console.log(`   • ${events.length} events created`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("\n🎮 Ready for gameplay!");
  } catch (error) {
    console.error("❌ Error seeding core systems:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  seedCoreSystems()
    .then(() => {
      console.log("✨ Seed script completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("💥 Seed script failed:", error);
      process.exit(1);
    });
}

export default seedCoreSystems;
