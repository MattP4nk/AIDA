import "reflect-metadata";
import dotenv from "dotenv";
import pino from "pino";
import { PrismaClient } from "@prisma/client";
import { Server as SocketIOServer } from "socket.io";
import { createServer } from "http";

// Load environment variables
dotenv.config();

import { initializeContainer, getService } from "../src/di/container";
import { FORUM_SERVICE, AI_SERVICE } from "../src/di/tokens";
import { db } from "../src/database/client";
import type ForumService from "../src/services/forumService";
import type { AIService } from "../src/services/aiService";

async function runTest() {
  const logger = pino({
    level: "debug",
    transport: {
      target: "pino-pretty",
      options: { colorize: true },
    },
  });

  console.log("🚀 Initializing AI Generation Test...");

  try {
    // 1. Setup minimal infrastructure for DI
    const httpServer = createServer();
    const io = new SocketIOServer(httpServer);

    // Ensure DB is connected
    await db.connect();
    logger.info("✅ Database connected");

    // Initialize DI Container
    initializeContainer(io, db.client, logger);
    logger.info("✅ DI Container initialized");

    // 2. Resolve Services
    const forumService = getService<ForumService>(FORUM_SERVICE);
    const aiService = getService<AIService>(AI_SERVICE);

    // 3. Check AI Health
    const isAiHealthy = await aiService.checkHealth();
    if (!isAiHealthy) {
      logger.error("❌ AIService is not healthy. Check if Ollama is running on " + process.env.AI_API_URL);
      process.exit(1);
    }
    logger.info("✅ AIService is online and responding");

    // 4. Find a forum to populate
    const forum = await db.client.forum.findFirst({
      where: { isActive: true },
      include: { faction: true }
    });

    if (!forum) {
      logger.error("❌ No active forums found in the database. Please seed the database first.");
      process.exit(1);
    }

    logger.info(`🎯 Testing generation for forum: ${forum.name} (ID: ${forum.id})`);

    // 5. Trigger AI Generation
    // We use the internal logic similar to populateForumContent but focused on one forum
    logger.info("🤖 AI is dreaming up posts... (this may take a minute)");

    // We call the public method that triggers the internal generateForumPosts
    // Note: populateForumContent is designed for all forums, let's call it and filter or
    // since we want a specific test, we can call it and see what happens.
    await forumService.content.populateForumContent();

    // 6. Verify Results
    const posts = await db.client.post.findMany({
      where: { forumId: forum.id },
      orderBy: { createdAt: 'desc' },
      take: 5
    });

    logger.info("✨ Generation complete. Latest posts:");
    posts.forEach((p, i) => {
      console.log(`\n[Post #${i+1}] ${p.title}`);
      console.log(`Author: ${p.authorHandle}`);
      console.log(`Content: ${p.content.substring(0, 100)}...`);
      console.log(`-----------------------------------`);
    });

    logger.info("✅ AI Generation Test successful!");

  } catch (error) {
    logger.error({ err: error }, "💥 Test failed");
    process.exit(1);
  } finally {
    await db.disconnect();
    process.exit(0);
  }
}

runTest();
