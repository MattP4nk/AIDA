/**
 * Fix Incomplete Filesystems Script
 *
 * This script checks all game servers and ensures they have the proper
 * directory structure (/home, /bin, /etc, /var, /tmp, /logs)
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function fixFilesystems() {
  console.log("\n" + "=".repeat(60));
  console.log("Fix Incomplete Filesystems Script");
  console.log("=".repeat(60) + "\n");

  try {
    // Get all game servers
    const servers = await prisma.gameServer.findMany({
      select: {
        id: true,
        name: true,
        ipAddress: true,
        type: true,
        ownerId: true,
      },
    });

    console.log(`Found ${servers.length} game servers\n`);

    const commonDirs = ["home", "bin", "etc", "var", "tmp", "logs"];

    for (const server of servers) {
      console.log(`\n📦 Processing server: ${server.name} (${server.id})`);
      console.log("-".repeat(60));

      // Find root directory
      const root = await prisma.fileSystemNode.findFirst({
        where: {
          serverId: server.id,
          parentId: null,
          type: "directory",
        },
      });

      if (!root) {
        console.log(`  ❌ No root directory found - skipping`);
        continue;
      }

      console.log(`  ✓ Root directory exists (ID: ${root.id})`);

      // Check which common directories exist
      const existingDirs = await prisma.fileSystemNode.findMany({
        where: {
          serverId: server.id,
          parentId: root.id,
          type: "directory",
          name: {
            in: commonDirs,
          },
        },
        select: {
          name: true,
        },
      });

      const existingDirNames = existingDirs.map((d) => d.name);
      const missingDirs = commonDirs.filter(
        (d) => !existingDirNames.includes(d)
      );

      if (missingDirs.length === 0) {
        console.log(`  ✓ All common directories exist`);
        continue;
      }

      console.log(`  ⚠️  Missing directories: ${missingDirs.join(", ")}`);

      // Create missing directories
      for (const dirName of missingDirs) {
        const isProtected = dirName === "bin" || dirName === "etc";

        await prisma.fileSystemNode.create({
          data: {
            serverId: server.id,
            parentId: root.id,
            name: dirName,
            type: "directory",
            content: null,
            size: 0,
            createdBy: server.ownerId,
            isEncrypted: false,
            encryptionKey: null,
            isHidden: false,
            isProtected,
            permissions: {
              owner: server.ownerId,
              ownerRead: true,
              ownerWrite: true,
              ownerExecute: true,
              groupRead: true,
              groupWrite: false,
              groupExecute: true,
              otherRead: false,
              otherWrite: false,
              otherExecute: false,
              requiredAccessLevel: 0,
            } as any,
          },
        });

        console.log(`  ✓ Created /${dirName}`);
      }

      console.log(`  ✅ Fixed filesystem for ${server.name}`);
    }

    console.log("\n" + "=".repeat(60));
    console.log("Filesystem Fix Complete!");
    console.log("=".repeat(60) + "\n");
  } catch (error) {
    console.error("Error:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
fixFilesystems()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Script failed:", error);
    process.exit(1);
  });
