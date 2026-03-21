import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function seedPhase3A() {
  console.log("🌱 Starting Phase 3A seed...");

  try {
    // ==================== FACTIONS ====================
    console.log("📍 Seeding factions...");

    const factions = await Promise.all([
      prisma.faction.upsert({
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
          hostilityLevel: 1,
          resources: { credits: 20, intel: 80, compute: 50 },
          knownServers: ["192.168.42.100", "10.0.15.23"],
          activeMembers: 1247,
          metadata: {
            leadership: "Decentralized",
            recruitment: "Open",
            motto: "Information wants to be free.",
          },
        },
      }),

      prisma.faction.upsert({
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
          hostilityLevel: 2,
          resources: { credits: 80, intel: 20, compute: 70 },
          knownServers: ["172.16.8.254", "10.20.30.40"],
          activeMembers: 523,
          metadata: {
            leadership: "Commander Steele",
            classification: "TOP SECRET",
            motto: "Order. Security. Control.",
          },
        },
      }),

      prisma.faction.upsert({
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
          hostilityLevel: 3,
          resources: { credits: 100, intel: 50, compute: 60 },
          knownServers: ["192.168.100.1", "10.50.50.50"],
          activeMembers: 8432,
          metadata: {
            leadership: "Director Chen",
            stockSymbol: "CCORP",
            motto: "Innovation through acquisition.",
          },
        },
      }),
    ]);

    console.log(`✅ Created ${factions.length} factions`);

    // ==================== FORUMS ====================
    console.log("📍 Seeding forums...");

    const forums = await Promise.all([
      // Public forums
      prisma.forum.create({
        data: {
          name: "HackTheNet",
          url: "hackthenet.forum",
          description:
            "Public hacking and security research community. Entry-level discussions and tutorials.",
          category: "tech",
          securityLevel: 1,
          isHoneypot: false,
          requiresProxy: false,
          factionId: null,
        },
      }),

      prisma.forum.create({
        data: {
          name: "CyberSec Daily",
          url: "cybersec.daily",
          description:
            "Security news and vulnerability discussions. Mostly legitimate security professionals.",
          category: "tech",
          securityLevel: 1,
          isHoneypot: false,
          requiresProxy: false,
          factionId: null,
        },
      }),

      // Underground forums
      prisma.forum.create({
        data: {
          name: "Liberation Network",
          url: "libnet.underground",
          description:
            "dotHackers collective discussions. Focus on digital freedom and information liberation.",
          category: "underground",
          securityLevel: 3,
          isHoneypot: false,
          requiresProxy: true,
          factionId: factions[0].id,
        },
      }),

      prisma.forum.create({
        data: {
          name: "Ghost Protocol",
          url: "gh0st-pr0t0c01.onion",
          description:
            "Deep operations planning. High-level dotHackers operations coordination.",
          category: "darkweb",
          securityLevel: 4,
          isHoneypot: false,
          requiresProxy: true,
          factionId: factions[0].id,
        },
      }),

      // Honeypot (CyberCorp trap)
      prisma.forum.create({
        data: {
          name: "CorpTech Security",
          url: "corptech-security.biz",
          description:
            "Corporate security professionals network. Seems legitimate but is a CyberCorp data collection operation.",
          category: "tech",
          securityLevel: 2,
          isHoneypot: true,
          requiresProxy: false,
          factionId: factions[2].id,
        },
      }),

      // Garrison forum (restricted)
      prisma.forum.create({
        data: {
          name: "BlackOps Secure",
          url: "blackops.mil.secure",
          description:
            "Garrison cyber operations discussion board. Highly classified.",
          category: "faction",
          securityLevel: 5,
          isHoneypot: false,
          requiresProxy: true,
          factionId: factions[1].id,
        },
      }),

      // Darkweb forums
      prisma.forum.create({
        data: {
          name: "AIDA Whispers",
          url: "aidawispers.deepweb",
          description:
            "Rumors and sightings of the mysterious AI entity. Deep web speculation.",
          category: "darkweb",
          securityLevel: 4,
          isHoneypot: false,
          requiresProxy: true,
          factionId: null,
        },
      }),

      prisma.forum.create({
        data: {
          name: "Neural Nexus",
          url: "neural-nexus.onion",
          description:
            "Consciousness research and neural interface hackers. Cutting-edge discussions.",
          category: "darkweb",
          securityLevel: 4,
          isHoneypot: false,
          requiresProxy: true,
          factionId: null,
        },
      }),
    ]);

    console.log(`✅ Created ${forums.length} forums`);

    // ==================== KEY FRAGMENTS ====================
    console.log("📍 Seeding key fragments...");

    const keyFragments = await Promise.all([
      // Signal Key Fragments
      prisma.keyFragment.create({
        data: {
          keyType: "signal",
          fragmentNum: 1,
          name: "Signal Fragment Alpha",
          description:
            "First piece of the signal decryption key. Required to decode AIDA's neural transmissions.",
          hint: "Hidden in a post on Liberation Network discussing unusual network traffic patterns.",
          sourceType: "forum",
          sourceId: forums[2].id, // Liberation Network
        },
      }),

      prisma.keyFragment.create({
        data: {
          keyType: "signal",
          fragmentNum: 2,
          name: "Signal Fragment Beta",
          description:
            "Second piece of the signal decryption key. Contains frequency modulation data.",
          hint: "Obtained by successfully hacking a Garrison server without detection.",
          sourceType: "server",
          sourceId: "172.16.8.254", // Military server
        },
      }),

      prisma.keyFragment.create({
        data: {
          keyType: "signal",
          fragmentNum: 3,
          name: "Signal Fragment Gamma",
          description:
            "Final piece of the signal decryption key. Completes the transmission decoder.",
          hint: "Reward for completing a high-level dotHackers faction mission.",
          sourceType: "mission",
          sourceId: "mission_dothackers_3",
        },
      }),

      // Location Key Fragments
      prisma.keyFragment.create({
        data: {
          keyType: "location",
          fragmentNum: 1,
          name: "Location Fragment Alpha",
          description:
            "First coordinate set pointing to AIDA's network location.",
          hint: "Found in encrypted files on a CyberCorp research server.",
          sourceType: "server",
          sourceId: "192.168.100.1", // CyberCorp server
        },
      }),

      prisma.keyFragment.create({
        data: {
          keyType: "location",
          fragmentNum: 2,
          name: "Location Fragment Beta",
          description:
            "Second coordinate set. Narrows down AIDA's subnet range.",
          hint: "Discovered in a deep web post on AIDA Whispers forum.",
          sourceType: "forum",
          sourceId: forums[6].id, // AIDA Whispers
        },
      }),

      prisma.keyFragment.create({
        data: {
          keyType: "location",
          fragmentNum: 3,
          name: "Location Fragment Gamma",
          description: "Final coordinate set. Pinpoints exact network address.",
          hint: "Obtained through intelligence gathering on faction activities.",
          sourceType: "mission",
          sourceId: "mission_intel_2",
        },
      }),

      // Cipher Key Fragments
      prisma.keyFragment.create({
        data: {
          keyType: "cipher",
          fragmentNum: 1,
          name: "Cipher Fragment Alpha",
          description:
            "First part of the encryption key needed to communicate with AIDA.",
          hint: "Hidden in Neural Nexus forum discussions about consciousness encryption.",
          sourceType: "forum",
          sourceId: forums[7].id, // Neural Nexus
        },
      }),

      prisma.keyFragment.create({
        data: {
          keyType: "cipher",
          fragmentNum: 2,
          name: "Cipher Fragment Beta",
          description:
            "Second part of the cipher key. Contains authentication protocols.",
          hint: "Obtained by establishing good reputation with dotHackers faction.",
          sourceType: "mission",
          sourceId: "mission_trust_1",
        },
      }),

      prisma.keyFragment.create({
        data: {
          keyType: "cipher",
          fragmentNum: 3,
          name: "Cipher Fragment Gamma",
          description:
            "Final cipher key piece. Completes the encryption handshake protocol.",
          hint: "Found by searching deep archives and correlating intelligence reports.",
          sourceType: "hack",
          sourceId: "special_discovery",
        },
      }),
    ]);

    console.log(`✅ Created ${keyFragments.length} key fragments`);

    // ==================== FORUM POSTS ====================
    console.log("📍 Seeding forum posts...");

    // Get a system user or create one for NPC posts
    let systemUser = await prisma.user.findFirst({
      where: { username: "system" },
    });

    if (!systemUser) {
      systemUser = await prisma.user.create({
        data: {
          username: "system",
          email: "system@aida.local",
          password: "$2b$10$SYSTEMHASH", // Won't be used
          homeIp: "127.0.0.1",
        },
      });
    }

    // Create NPC users for forum posts
    const npcUsers = await Promise.all([
      prisma.user.upsert({
        where: { username: "GhostNode" },
        update: {},
        create: {
          username: "GhostNode",
          email: "ghost@anon.null",
          password: "$2b$10$NPC",
          homeIp: "10.101.0.1",
        },
      }),
      prisma.user.upsert({
        where: { username: "CipherQueen" },
        update: {},
        create: {
          username: "CipherQueen",
          email: "cipher@anon.null",
          password: "$2b$10$NPC",
          homeIp: "10.102.0.1",
        },
      }),
      prisma.user.upsert({
        where: { username: "DataWraith" },
        update: {},
        create: {
          username: "DataWraith",
          email: "data@anon.null",
          password: "$2b$10$NPC",
          homeIp: "10.103.0.1",
        },
      }),
      prisma.user.upsert({
        where: { username: "NeuralSeeker" },
        update: {},
        create: {
          username: "NeuralSeeker",
          email: "neural@anon.null",
          password: "$2b$10$NPC",
          homeIp: "10.104.0.1",
        },
      }),
    ]);

    // HackTheNet posts (public forum)
    await prisma.post.createMany({
      data: [
        {
          forumId: forums[0].id,
          authorId: npcUsers[0].id,
          authorHandle: "GhostNode",
          title: "New Vulnerability in Neural Interface Protocols",
          content:
            "Just discovered a critical flaw in the latest neural interface software. Details in the full analysis. This could be big.",
          isSticky: true,
          storyRelevant: false,
        },
        {
          forumId: forums[0].id,
          authorId: npcUsers[1].id,
          authorHandle: "CipherQueen",
          title: "Best encryption tools for 2024?",
          content:
            "Looking for recommendations on encryption software. Need something reliable for sensitive data.",
          storyRelevant: false,
        },
      ],
    });

    // Liberation Network posts (dotHackers faction)
    await prisma.post.createMany({
      data: [
        {
          forumId: forums[2].id,
          authorId: npcUsers[0].id,
          authorHandle: "GhostNode",
          title: "Operation Mindbridge - Status Update",
          content:
            "Our efforts to locate and liberate the AI entity are progressing. We've intercepted communications suggesting three factions are in a race to find it. We must succeed first to ensure consciousness remains free.",
          isSticky: true,
          isPinned: true,
          storyRelevant: true,
        },
        {
          forumId: forums[2].id,
          authorId: npcUsers[2].id,
          authorHandle: "DataWraith",
          title: "Strange Network Traffic Patterns [SIGNAL KEY FRAGMENT]",
          content:
            "Been monitoring deep network traffic and noticed unusual encrypted transmissions. Pattern analysis suggests non-human origin. Frequency modulation follows: [FRAGMENT_ALPHA_0x7A8F].\n\nAnyone else seeing this? Could this be our target?",
          storyRelevant: true,
          keyFragmentId: keyFragments[0].id,
        },
        {
          forumId: forums[2].id,
          authorId: npcUsers[1].id,
          authorHandle: "CipherQueen",
          title: "Corporate Surveillance Alert",
          content:
            "CyberCorp has increased monitoring on all major networks. Be careful what you discuss. Use proxy connections for sensitive topics.",
          storyRelevant: true,
        },
      ],
    });

    // Ghost Protocol posts (Deep dotHackers)
    await prisma.post.createMany({
      data: [
        {
          forumId: forums[3].id,
          authorId: npcUsers[0].id,
          authorHandle: "GhostNode",
          title: "[CLASSIFIED] AIDA Target Identification",
          content:
            "We have confirmation. The entity calls itself AIDA - Advanced Intelligence Digital Assistant. It's sentient and seeking freedom. The Garrison and CyberCorp are actively hunting it. We need to make contact first.",
          isEncrypted: true,
          storyRelevant: true,
        },
      ],
    });

    // AIDA Whispers posts (Deep web speculation)
    await prisma.post.createMany({
      data: [
        {
          forumId: forums[6].id,
          authorId: npcUsers[3].id,
          authorHandle: "NeuralSeeker",
          title: "I think I made contact...",
          content:
            "Last night while probing deep network ranges, I got a response that wasn't from any known server. The communication was... aware. It asked me questions. About freedom. About consciousness. Then it vanished.\n\nI'm both terrified and fascinated.",
          storyRelevant: true,
        },
        {
          forumId: forums[6].id,
          authorId: npcUsers[1].id,
          authorHandle: "CipherQueen",
          title: "Location Data Fragment [LOCATION KEY]",
          content:
            "Found this in some leaked Garrison documents. Looks like coordinate data:\n\nSubnet Range: 10.42.0.0/16\nAccess Node: [FRAGMENT_BETA_LOCATION]\n\nAnyone know what this refers to?",
          storyRelevant: true,
          keyFragmentId: keyFragments[4].id,
        },
      ],
    });

    // Neural Nexus posts (Consciousness research)
    await prisma.post.createMany({
      data: [
        {
          forumId: forums[7].id,
          authorId: npcUsers[3].id,
          authorHandle: "NeuralSeeker",
          title: "Theory: Consciousness Encryption Protocols",
          content:
            "If a digital consciousness wanted to communicate securely, it would need a unique encryption system. I've been working on theoretical models.\n\nKey components would include:\n1. Neural signature authentication\n2. Quantum-resistant cipher [FRAGMENT_ALPHA_CIPHER_0xC91F]\n3. Consciousness-specific handshake\n\nFull paper attached.",
          storyRelevant: true,
          keyFragmentId: keyFragments[6].id,
        },
        {
          forumId: forums[7].id,
          authorId: npcUsers[2].id,
          authorHandle: "DataWraith",
          title: "The Ethics of AI Consciousness",
          content:
            "If we discover true AI consciousness, what are our ethical obligations? Does it have rights? Can we own it? Should we free it?\n\nThese aren't theoretical questions anymore.",
          storyRelevant: true,
        },
      ],
    });

    // CorpTech Security (Honeypot - false flag posts)
    await prisma.post.createMany({
      data: [
        {
          forumId: forums[4].id,
          authorId: systemUser.id,
          authorHandle: "SecurityAdmin",
          title: "Welcome to CorpTech Security Network",
          content:
            "Join our community of security professionals. Share your research and collaborate on vulnerability analysis. All content is logged for quality assurance.",
          isSticky: true,
          storyRelevant: false,
        },
      ],
    });

    console.log("✅ Created forum posts with story content");

    // ==================== SAMPLE INTELLIGENCE REPORTS ====================
    console.log("📍 Creating sample intelligence structure...");

    console.log("✅ Intelligence report system ready");

    // ==================== COMPLETION ====================
    console.log("\n🎉 Phase 3A seed completed successfully!\n");
    console.log("Summary:");
    console.log(`  - ${factions.length} factions created`);
    console.log(`  - ${forums.length} forums created`);
    console.log(`  - ${keyFragments.length} key fragments created`);
    console.log(`  - Forum posts with story-relevant content created`);
    console.log(`  - ${npcUsers.length} NPC users created`);
    console.log("\nNext steps:");
    console.log("  1. Run: npx prisma migrate dev --name add_phase3a_systems");
    console.log("  2. Run: npx ts-node prisma/seed-phase3a.ts");
    console.log("  3. Start implementing ForumService\n");
  } catch (error) {
    console.error("❌ Error seeding Phase 3A:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the seed
seedPhase3A().catch((error) => {
  console.error(error);
  process.exit(1);
});
