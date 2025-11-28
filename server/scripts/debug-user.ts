/**
 * Debug User Script
 *
 * Check the state of a specific user's home directory and server
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function debugUser(username: string) {
  console.log("\n" + "=".repeat(60));
  console.log(`Debug User: ${username}`);
  console.log("=".repeat(60) + "\n");

  try {
    // Get user info
    const user = await prisma.user.findFirst({
      where: { username },
      select: {
        id: true,
        username: true,
        homeIp: true,
        homeServerId: true,
        isOnline: true,
      },
    });

    if (!user) {
      console.log(`❌ User "${username}" not found`);
      return;
    }

    console.log("User Info:");
    console.log(`  ID: ${user.id}`);
    console.log(`  Username: ${user.username}`);
    console.log(`  Home IP: ${user.homeIp}`);
    console.log(`  Home Server ID: ${user.homeServerId || "(not set)"}`);
    console.log(`  Is Online: ${user.isOnline}`);
    console.log();

    // Check if home server exists
    if (user.homeServerId) {
      const homeServer = await prisma.gameServer.findUnique({
        where: { id: user.homeServerId },
        select: {
          id: true,
          name: true,
          ipAddress: true,
          type: true,
          isPlayerHome: true,
        },
      });

      if (homeServer) {
        console.log("Home Server:");
        console.log(`  ✓ Exists`);
        console.log(`  ID: ${homeServer.id}`);
        console.log(`  Name: ${homeServer.name}`);
        console.log(`  IP: ${homeServer.ipAddress}`);
        console.log(`  Type: ${homeServer.type}`);
        console.log();
      } else {
        console.log("Home Server:");
        console.log(`  ❌ NOT FOUND (ID: ${user.homeServerId})`);
        console.log();
      }

      // Check filesystem root
      const rootNode = await prisma.fileSystemNode.findFirst({
        where: {
          serverId: user.homeServerId,
          parentId: null,
          type: "directory",
        },
      });

      if (rootNode) {
        console.log("Filesystem Root:");
        console.log(`  ✓ Exists (ID: ${rootNode.id})`);
        console.log();

        // Check for /home directory
        const homeDir = await prisma.fileSystemNode.findFirst({
          where: {
            serverId: user.homeServerId,
            parentId: rootNode.id,
            name: "home",
            type: "directory",
          },
        });

        if (homeDir) {
          console.log("/home Directory:");
          console.log(`  ✓ Exists (ID: ${homeDir.id})`);
          console.log();

          // Check for user's home directory
          const userHomeDir = await prisma.fileSystemNode.findFirst({
            where: {
              serverId: user.homeServerId,
              parentId: homeDir.id,
              name: user.username,
              type: "directory",
            },
          });

          if (userHomeDir) {
            console.log(`/home/${user.username} Directory:`);
            console.log(`  ✓ Exists (ID: ${userHomeDir.id})`);
            console.log();

            // List files in user's home directory
            const files = await prisma.fileSystemNode.findMany({
              where: {
                serverId: user.homeServerId,
                parentId: userHomeDir.id,
              },
              select: {
                name: true,
                type: true,
                size: true,
                createdAt: true,
              },
            });

            console.log(`Files in /home/${user.username}:`);
            if (files.length === 0) {
              console.log(`  (empty)`);
            } else {
              files.forEach((file) => {
                const icon = file.type === "directory" ? "📁" : "📄";
                console.log(`  ${icon} ${file.name} (${file.size} bytes)`);
              });
            }
            console.log();
          } else {
            console.log(`/home/${user.username} Directory:`);
            console.log(`  ❌ NOT FOUND`);
            console.log();
          }
        } else {
          console.log("/home Directory:");
          console.log(`  ❌ NOT FOUND`);
          console.log();
        }

        // Show all directories at root level
        const rootDirs = await prisma.fileSystemNode.findMany({
          where: {
            serverId: user.homeServerId,
            parentId: rootNode.id,
            type: "directory",
          },
          select: {
            name: true,
          },
        });

        console.log("Directories at root level:");
        if (rootDirs.length === 0) {
          console.log(`  (none)`);
        } else {
          rootDirs.forEach((dir) => {
            console.log(`  📁 /${dir.name}`);
          });
        }
        console.log();
      } else {
        console.log("Filesystem Root:");
        console.log(`  ❌ NOT FOUND for server ${user.homeServerId}`);
        console.log();
      }
    } else {
      console.log("Home Server:");
      console.log(`  ❌ No homeServerId set for user`);
      console.log();
    }

    // Check active sessions
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
      orderBy: {
        createdAt: "desc",
      },
      take: 5,
    });

    console.log("Recent Sessions:");
    if (sessions.length === 0) {
      console.log(`  (none)`);
    } else {
      sessions.forEach((session, i) => {
        const status = session.isActive ? "🟢 Active" : "⚪ Inactive";
        console.log(`  ${i + 1}. ${status}`);
        console.log(`     Directory: ${session.currentDirectory}`);
        console.log(`     Created: ${session.createdAt.toISOString()}`);
      });
    }
    console.log();

    console.log("=".repeat(60));
    console.log("Debug Complete");
    console.log("=".repeat(60) + "\n");
  } catch (error) {
    console.error("Error:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Get username from command line or default to M4TT
const username = process.argv[2] || "M4TT";

debugUser(username)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Script failed:", error);
    process.exit(1);
  });
