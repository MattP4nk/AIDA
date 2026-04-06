import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { AIService } from "../services/aiService";
import { PersonaService } from "../services/personaService";
import { MessageService } from "../services/messageService";
import pino from "pino";
import { CacheService } from "../services/cacheService";
import MissionService from "../services/missionService";
import { Server as SocketIOServer } from "socket.io";
import http from "http";

const prisma = new PrismaClient();
const logger = pino({ level: "info" });
const cacheService = new CacheService(logger);

async function testAIIntegration() {
  console.log("🧪 Testing AI Integration...\n");

  // 1. Test AIService
  console.log("1️⃣ Testing AIService...");
  const aiService = new AIService(logger, cacheService);

  try {
    const health = await aiService.checkHealth();
    console.log(`   Ollama health: ${health ? "✅ Connected" : "❌ Offline"}`);

    if (health) {
      // Test generation
      const { response } = await aiService.generateResponse(
        "Say hello in one word",
        "You are a friendly AI assistant",
      );
      console.log(`   AI Response: "${response.substring(0, 50)}..."`);

      // Test caching
      const { response: cached } = await aiService.generateResponse(
        "Say hello in one word",
        "You are a friendly AI assistant",
      );
      console.log(`   Cache test: "${cached.substring(0, 50)}..."`);

      const metrics = aiService.getMetrics();
      console.log(`   Metrics: ${JSON.stringify(metrics)}`);
    }
  } catch (error) {
    console.error("   ❌ AIService test failed:", error);
  }

  // 2. Test PersonaService with real persona
  console.log("\n2️⃣ Testing PersonaService...");
  const missionService = new MissionService(logger, cacheService);

  // Create minimal SocketIO instance for MessageService and ForumService
  const httpServer = http.createServer();
  const io = new SocketIOServer(httpServer);
  const messageService = new MessageService(logger, io);
  const forumService = new (await import("../services/forumService")).default(
    io,
    logger,
  );

  const { FactionService } = await import("../services/factionService");
  const factionService = new FactionService(prisma, logger);
  const EventService = (await import("../services/eventService")).default;
  const eventService = new EventService(logger, io);
  const personaService = new PersonaService(
    prisma,
    logger,
    missionService,
    aiService,
    messageService,
    forumService,
    factionService,
    eventService,
  );

  try {
    // Get Game Master persona
    const gm = await personaService.getPersonaByType("game_master");
    if (!gm) {
      console.log("   ⚠️ No Game Master found - run seed first");
      return;
    }
    console.log(`   Found persona: ${gm.name} (${gm.type})`);

    // Add some test knowledge
    await personaService.addKnowledge(gm.id, {
      source: "test_script",
      type: "server_location",
      content: { ip: "192.168.1.99", security: "high" },
      confidence: 0.9,
    });
    console.log("   ✅ Added test knowledge");

    // Test AI decision making
    console.log("   🤖 Asking AI to decide on an action...");
    const action = await personaService.decideAction(gm.id);

    if (action) {
      console.log(`   ✅ AI decided: ${action.type}`);
      console.log(`   Input: ${JSON.stringify(action.input, null, 2)}`);

      // Test action execution
      console.log("   ⚙️ Executing action...");
      await personaService.executeAction(action.id);

      // Check result
      const executed = await prisma.aIAction.findUnique({
        where: { id: action.id },
      });
      console.log(`   Status: ${executed?.status}`);
      if (executed?.output) {
        console.log(`   Output: ${JSON.stringify(executed.output, null, 2)}`);
      }
    } else {
      console.log("   ℹ️ AI decided no action needed");
    }
  } catch (error) {
    console.error("   ❌ PersonaService test failed:", error);
  }

  await prisma.$disconnect();
  console.log("\n✅ Test complete!");
}

testAIIntegration().catch(console.error);
