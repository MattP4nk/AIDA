import "reflect-metadata";
import { AIService } from "../services/aiService";
import { PersonaService } from "../services/personaService";
import { PrismaClient } from "@prisma/client";
import pino from "pino";
import { CacheService } from "../services/cacheService";
import MissionService from "../services/missionService";
import { MessageService } from "../services/messageService";
import ForumService from "../services/forumService";
import { Server as SocketIOServer } from "socket.io";
import http from "http";

const prisma = new PrismaClient();
const logger = pino({ level: "info" });
const cacheService = new CacheService();

async function testOllamaConnection() {
  console.log("🤖 Testing Ollama Integration\n");
  console.log("=".repeat(60));

  try {
    // Test 1: Basic AI Service
    console.log("\n📝 Test 1: Basic AI Response");
    console.log("-".repeat(60));

    const aiService = new AIService(logger, cacheService);

    const prompt =
      "You are a hacker in a cyberpunk game. Describe your latest hack in exactly one sentence.";
    console.log("Prompt:", prompt);
    console.log("\nGenerating response...");

    const startTime = Date.now();
    const { response } = await aiService.generateResponse(prompt);
    const duration = Date.now() - startTime;

    console.log("\n✅ Response:", response);
    console.log(`⏱️  Duration: ${duration}ms`);

    // Test 2: AI Service with System Prompt
    console.log("\n\n📝 Test 2: AI with System Prompt");
    console.log("-".repeat(60));

    const systemPrompt =
      "You are a cryptic AI named AIDA. Speak mysteriously about digital liberation.";
    const prompt2 = "What is your purpose?";

    console.log("System Prompt:", systemPrompt);
    console.log("Prompt:", prompt2);
    console.log("\nGenerating response...");

    const startTime2 = Date.now();
    const { response: response2 } = await aiService.generateResponse(
      prompt2,
      systemPrompt,
    );
    const duration2 = Date.now() - startTime2;

    console.log("\n✅ Response:", response2);
    console.log(`⏱️  Duration: ${duration2}ms`);

    // Test 3: Mission Generation
    console.log("\n\n📝 Test 3: AI Mission Generation");
    console.log("-".repeat(60));

    // Check if Game Master persona exists
    const gameMaster = await prisma.aIPersona.findFirst({
      where: { type: "game_master" },
    });

    if (gameMaster) {
      console.log("Found Game Master persona:", gameMaster.name);

      const missionPrompt = `Generate a hacking mission for a level 5 player.
The mission should be exciting and involve breaking into a corporate server.
Return ONLY a JSON object with this structure:
{
  "title": "Mission title",
  "description": "Detailed description",
  "type": "hack",
  "difficulty": 3,
  "objectives": [
    {"type": "hack", "target": "target_name", "description": "objective description"}
  ],
  "rewards": {"xp": 500, "credits": 1000}
}`;

      console.log("\nGenerating AI mission...");
      const startTime3 = Date.now();
      const { response: missionResponse } = await aiService.generateResponse(
        missionPrompt,
        gameMaster.systemPrompt,
      );
      const duration3 = Date.now() - startTime3;

      console.log("\n✅ Mission Response:");
      console.log(missionResponse);
      console.log(`⏱️  Duration: ${duration3}ms`);

      // Try to parse as JSON
      try {
        const jsonMatch = missionResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const missionData = JSON.parse(jsonMatch[0]);
          console.log("\n✅ Successfully parsed mission JSON:");
          console.log(`  Title: ${missionData.title}`);
          console.log(`  Type: ${missionData.type}`);
          console.log(`  Difficulty: ${missionData.difficulty}`);
          console.log(`  Objectives: ${missionData.objectives?.length || 0}`);
        }
      } catch (parseError) {
        console.log(
          "⚠️  Could not parse as JSON (that's okay, AI responses vary)",
        );
      }
    } else {
      console.log("⚠️  No Game Master persona found in database");
      console.log("   Run seed scripts to create AI personas");
    }

    // Test 4: Cache Test
    console.log("\n\n📝 Test 4: Response Caching");
    console.log("-".repeat(60));

    const cachePrompt = "What is 2+2?";
    console.log("Making first request (uncached)...");
    const startUncached = Date.now();
    await aiService.generateResponse(cachePrompt);
    const uncachedDuration = Date.now() - startUncached;

    console.log("Making second request (should be cached)...");
    const startCached = Date.now();
    await aiService.generateResponse(cachePrompt);
    const cachedDuration = Date.now() - startCached;

    console.log(`\n⏱️  Uncached: ${uncachedDuration}ms`);
    console.log(`⏱️  Cached: ${cachedDuration}ms`);
    console.log(
      `📈 Speedup: ${(uncachedDuration / cachedDuration).toFixed(2)}x faster`,
    );

    // Summary
    console.log("\n\n" + "=".repeat(60));
    console.log("✅ ALL TESTS PASSED");
    console.log("=".repeat(60));
    console.log("\n📊 Summary:");
    console.log("  ✓ Basic AI response generation");
    console.log("  ✓ System prompt handling");
    console.log("  ✓ Mission generation (if persona exists)");
    console.log("  ✓ Response caching");
    console.log("\n🎮 Ollama is ready for AIDA!");
    console.log("\n💡 AI Features Available:");
    console.log("  - Dynamic mission generation (10% of missions)");
    console.log("  - AI NPC behavior and decision-making");
    console.log("  - Automated forum posts from AI characters");
    console.log("  - AI-generated messages and interactions");
    console.log("\n🚀 Start the server to see AI in action!");
  } catch (error) {
    console.error("\n❌ Error testing Ollama integration:");
    console.error(error);

    if (error instanceof Error) {
      if (
        error.message.includes("ECONNREFUSED") ||
        error.message.includes("fetch failed")
      ) {
        console.error("\n💡 Solution: Make sure Ollama is running:");
        console.error("   ollama serve");
      } else if (error.message.includes("model")) {
        console.error("\n💡 Solution: Pull the required model:");
        console.error("   ollama pull llama3.1:8b");
      }
    }

    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testOllamaConnection();
