/**
 * Check and Fix User Sessions Script
 *
 * This script checks all active user sessions and fixes any that still
 * point to the old /home/user directory instead of /home/{username}
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function checkAndFixSessions() {
  console.log("\n" + "=".repeat(60));
  console.log("Session Check and Fix Script");
  console.log("=".repeat(60) + "\n");

  try {
    // Get all users
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        homeIp: true,
      },
    });

    console.log(`Found ${users.length} users\n`);

    // Check sessions for each user
    for (const user of users) {
      console.log(`\nChecking sessions for ${user.username}:`);

      // Get all sessions for this user
      const sessions = await prisma.userSession.findMany({
        where: {
          userId: user.id,
        },
        select: {
          id: true,
          currentDirectory: true,
          isActive: true,
          createdAt: true,
        },
      });

      if (sessions.length === 0) {
        console.log(`  No sessions found`);
        continue;
      }

      // Check for sessions with wrong directory
      const wrongDirSessions = sessions.filter(
        (s) => s.currentDirectory === "/home/user"
      );

      if (wrongDirSessions.length > 0) {
        console.log(`  ⚠️  Found ${wrongDirSessions.length} sessions with wrong directory`);

        const correctDir = `/home/${user.username}`;

        // Update all wrong sessions
        const result = await prisma.userSession.updateMany({
          where: {
            userId: user.id,
            currentDirectory: "/home/user",
          },
          data: {
            currentDirectory: correctDir,
          },
        });

        console.log(`  ✅ Updated ${result.count} sessions to ${correctDir}`);
      } else {
        console.log(`  ✓ All ${sessions.length} sessions have correct directory`);

        // Show what directory they have
        const dirs = [...new Set(sessions.map(s => s.currentDirectory))];
        dirs.forEach(dir => {
          const count = sessions.filter(s => s.currentDirectory === dir).length;
          console.log(`     ${count} session(s): ${dir}`);
        });
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log("Session check complete!");
    console.log("=".repeat(60) + "\n");

  } catch (error) {
    console.error("Error:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
checkAndFixSessions()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Script failed:", error);
    process.exit(1);
  });
