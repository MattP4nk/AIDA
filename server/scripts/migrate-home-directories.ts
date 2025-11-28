/**
 * Migration Script: Fix Home Directories for Existing Users
 *
 * This script migrates existing users from the old hardcoded /home/user
 * directory structure to the new /home/{username} structure.
 *
 * What it does:
 * 1. Finds all existing users in the database
 * 2. Creates /home/{username} directory for each user
 * 3. Creates starter files in the new location
 * 4. Updates active sessions to point to correct directory
 * 5. Updates user session records in database
 *
 * Usage:
 *   npm run migrate:home-dirs
 *
 * Or directly:
 *   npx tsx server/scripts/migrate-home-directories.ts
 */

import { PrismaClient } from "@prisma/client";
import { Server as SocketIOServer } from "socket.io";
import { createServer } from "http";

const prisma = new PrismaClient();

interface MigrationResult {
  userId: string;
  username: string;
  success: boolean;
  actions: string[];
  errors: string[];
}

interface MigrationSummary {
  totalUsers: number;
  successful: number;
  failed: number;
  skipped: number;
  results: MigrationResult[];
}

// Create a dummy Socket.IO instance for FileService
const httpServer = createServer();
const io = new SocketIOServer(httpServer);

async function migrateUserHomeDirectory(
  userId: string,
  username: string,
  homeServerId: string,
  dryRun: boolean = false,
): Promise<MigrationResult> {
  const result: MigrationResult = {
    userId,
    username,
    success: true,
    actions: [],
    errors: [],
  };

  try {
    // Dynamic import to avoid circular dependencies
    const { fileService, initializeFileService } = await import(
      "../src/services/fileService"
    );

    // Initialize file service if not already done
    if (!fileService) {
      initializeFileService(io);
    }

    const userHomeDir = `/home/${username}`;
    result.actions.push(`Target directory: ${userHomeDir}`);

    // Check if home server exists
    const homeServer = await prisma.gameServer.findUnique({
      where: { id: homeServerId },
    });

    if (!homeServer && !dryRun) {
      result.errors.push(`Home server ${homeServerId} not found`);
      result.success = false;
      return result;
    }

    if (!homeServer && dryRun) {
      result.actions.push(
        `[DRY RUN] Home server ${homeServerId} would be created`,
      );
      // In dry-run mode, we can't proceed with file operations since server doesn't exist yet
      // But we can report what would happen
      result.actions.push(
        `[DRY RUN] Would create home directory: ${userHomeDir}`,
      );
      result.actions.push(`[DRY RUN] Would create welcome.txt`);
      result.actions.push(`[DRY RUN] Would create readme.txt`);

      // Check for sessions that would be updated
      const sessionsToUpdate = await prisma.userSession.count({
        where: {
          userId,
          currentDirectory: "/home/user",
        },
      });
      if (sessionsToUpdate > 0) {
        result.actions.push(
          `[DRY RUN] Would update ${sessionsToUpdate} session record(s)`,
        );
      }

      return result;
    }

    // Check if user's home directory already exists
    const { fileService: fs } = await import("../src/services/fileService");
    const existingDir = await prisma.fileSystemNode.findFirst({
      where: {
        serverId: homeServerId,
        name: username,
        type: "directory",
        parentId: {
          not: null,
        },
      },
      include: {
        parent: true,
      },
    });

    if (existingDir && existingDir.parent?.name === "home") {
      result.actions.push(`✓ Home directory already exists: ${userHomeDir}`);

      // Check if starter files exist
      const starterFiles = await prisma.fileSystemNode.findMany({
        where: {
          serverId: homeServerId,
          parentId: existingDir.id,
          name: {
            in: ["welcome.txt", "readme.txt"],
          },
        },
      });

      if (starterFiles.length === 2) {
        result.actions.push(`✓ Starter files already exist`);
      } else {
        result.actions.push(
          `⚠ Missing starter files (${starterFiles.length}/2 found)`,
        );

        if (!dryRun) {
          // Create missing starter files
          if (!starterFiles.find((f) => f.name === "welcome.txt")) {
            await createWelcomeFile(homeServerId, userId, userHomeDir, fs);
            result.actions.push(`✓ Created welcome.txt`);
          }
          if (!starterFiles.find((f) => f.name === "readme.txt")) {
            await createReadmeFile(
              homeServerId,
              userId,
              userHomeDir,
              username,
              fs,
            );
            result.actions.push(`✓ Created readme.txt`);
          }
        } else {
          result.actions.push(`[DRY RUN] Would create missing starter files`);
        }
      }
    } else {
      result.actions.push(`⚠ Home directory does not exist: ${userHomeDir}`);

      if (!dryRun) {
        // First ensure /home exists
        const homeExists = await prisma.fileSystemNode.findFirst({
          where: {
            serverId: homeServerId,
            name: "home",
            type: "directory",
          },
          include: {
            parent: true,
          },
        });

        if (!homeExists || homeExists.parent?.name !== "/") {
          // /home directory doesn't exist or isn't in root, create it
          const rootNode = await prisma.fileSystemNode.findFirst({
            where: {
              serverId: homeServerId,
              parentId: null,
              type: "directory",
            },
          });

          if (rootNode) {
            await prisma.fileSystemNode.create({
              data: {
                serverId: homeServerId,
                parentId: rootNode.id,
                name: "home",
                type: "directory",
                content: null,
                size: 0,
                createdBy: userId,
                isEncrypted: false,
                encryptionKey: null,
                isHidden: false,
                isProtected: false,
                permissions: {
                  owner: userId,
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
            result.actions.push(`✓ Created /home directory`);
          } else {
            result.errors.push("Root filesystem not found");
            result.success = false;
            return result;
          }
        }

        // Create home directory
        const createResult = await fs.createDirectory(
          homeServerId,
          userId,
          userHomeDir,
        );

        if (createResult.success) {
          result.actions.push(`✓ Created home directory: ${userHomeDir}`);

          // Create starter files
          await createWelcomeFile(homeServerId, userId, userHomeDir, fs);
          result.actions.push(`✓ Created welcome.txt`);

          await createReadmeFile(
            homeServerId,
            userId,
            userHomeDir,
            username,
            fs,
          );
          result.actions.push(`✓ Created readme.txt`);
        } else {
          result.errors.push(
            `Failed to create directory: ${createResult.message}`,
          );
          result.success = false;
          return result;
        }
      } else {
        result.actions.push(
          `[DRY RUN] Would create home directory and starter files`,
        );
      }
    }

    // Update active sessions
    if (!dryRun) {
      const updatedSessions = await prisma.userSession.updateMany({
        where: {
          userId,
          currentDirectory: "/home/user",
        },
        data: {
          currentDirectory: userHomeDir,
        },
      });

      if (updatedSessions.count > 0) {
        result.actions.push(
          `✓ Updated ${updatedSessions.count} session record(s)`,
        );
      }
    } else {
      const sessionsToUpdate = await prisma.userSession.count({
        where: {
          userId,
          currentDirectory: "/home/user",
        },
      });
      if (sessionsToUpdate > 0) {
        result.actions.push(
          `[DRY RUN] Would update ${sessionsToUpdate} session record(s)`,
        );
      }
    }
  } catch (error) {
    result.success = false;
    result.errors.push(
      `Error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return result;
}

async function createWelcomeFile(
  homeServerId: string,
  userId: string,
  userHomeDir: string,
  fileService: any,
): Promise<void> {
  const content = `Welcome to AIDA - AI-Driven Interactive Adventure

You are now connected to your home terminal system.

Basic Commands:
  help           - Show available commands
  ls             - List files and directories
  cd <path>      - Change directory
  pwd            - Print working directory
  cat <file>     - Read file contents
  status         - View your player status
  missions       - View available missions
  scan           - Scan for nearby servers
  connect <ip>   - Connect to a remote server

Type 'help' for a complete list of commands.
Type 'man <command>' for detailed information about a specific command.

Good luck, hacker.
`;

  await fileService.createFile(
    homeServerId,
    userId,
    `${userHomeDir}/welcome.txt`,
    content,
    false,
  );
}

async function createReadmeFile(
  homeServerId: string,
  userId: string,
  userHomeDir: string,
  username: string,
  fileService: any,
): Promise<void> {
  const content = `AIDA System Information

Your home directory: ${userHomeDir}

File System Structure:
  ${userHomeDir}     - Your personal files
  /bin              - System binaries (protected)
  /etc              - Configuration files (protected)
  /var              - Variable data
  /tmp              - Temporary files
  /logs             - System logs

Tips:
- Use 'scan' to discover servers you can hack
- Complete missions to gain experience and credits
- Visit the shop to buy tools and upgrades
- Use 'forum scan' to discover underground forums
`;

  await fileService.createFile(
    homeServerId,
    userId,
    `${userHomeDir}/readme.txt`,
    content,
    false,
  );
}

async function runMigration(
  dryRun: boolean = false,
): Promise<MigrationSummary> {
  const summary: MigrationSummary = {
    totalUsers: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    results: [],
  };

  console.log("\n" + "=".repeat(60));
  console.log("Home Directory Migration Script");
  console.log("=".repeat(60));
  console.log(
    `Mode: ${dryRun ? "DRY RUN (no changes will be made)" : "LIVE MIGRATION"}`,
  );
  console.log("=".repeat(60) + "\n");

  try {
    // Get all users
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        homeServerId: true,
        homeIp: true,
      },
    });

    summary.totalUsers = users.length;
    console.log(`Found ${users.length} users to process\n`);

    for (const user of users) {
      console.log(`\n📦 Processing user: ${user.username} (${user.id})`);
      console.log("-".repeat(60));

      // Ensure home server ID exists
      let homeServerId = user.homeServerId;
      if (!homeServerId) {
        homeServerId = `home_${user.homeIp.replace(/\./g, "_")}`;
        console.log(`⚠ No homeServerId, using: ${homeServerId}`);

        if (!dryRun) {
          await prisma.user.update({
            where: { id: user.id },
            data: { homeServerId },
          });
          console.log(`✓ Updated user record with homeServerId`);
        } else {
          console.log(`[DRY RUN] Would update user record with homeServerId`);
        }
      }

      // Ensure home server exists
      let homeServer = await prisma.gameServer.findUnique({
        where: { id: homeServerId },
      });

      if (!homeServer) {
        console.log(`⚠ Home server does not exist: ${homeServerId}`);

        if (!dryRun) {
          // Check if a server with this IP already exists
          const existingServerWithIp = await prisma.gameServer.findUnique({
            where: { ipAddress: user.homeIp },
          });

          if (existingServerWithIp) {
            console.log(
              `⚠ Server with IP ${user.homeIp} already exists (${existingServerWithIp.id})`,
            );
            console.log(`  Using existing server instead of creating new one`);
            homeServer = existingServerWithIp;

            // Update the user's homeServerId to point to the existing server
            await prisma.user.update({
              where: { id: user.id },
              data: { homeServerId: existingServerWithIp.id },
            });
            homeServerId = existingServerWithIp.id;
          } else {
            homeServer = await prisma.gameServer.create({
              data: {
                id: homeServerId,
                name: `${user.username}'s Home System`,
                ipAddress: user.homeIp,
                type: "player_home",
                ownerId: user.id,
                securityLevel: 1,
                firewallLevel: 1,
                encryptionLevel: 1,
                discoveryLevel: 0,
                isPlayerHome: true,
                isOnline: true,
                maxConnections: 1,
                currentConnections: 0,
              },
            });
            console.log(`✓ Created home server: ${homeServerId}`);
          }

          // Initialize file system for the server if needed
          const rootExists = await prisma.fileSystemNode.findFirst({
            where: {
              serverId: homeServerId,
              parentId: null,
              type: "directory",
            },
          });

          if (!rootExists) {
            const { fileService, initializeFileService } = await import(
              "../src/services/fileService"
            );
            if (!fileService) {
              initializeFileService(io);
            }
            const { fileService: fs } = await import(
              "../src/services/fileService"
            );
            await fs.initializeFileSystem(homeServerId, user.id);
            console.log(`✓ Initialized file system for home server`);
          } else {
            console.log(
              `✓ File system already initialized for ${homeServerId}`,
            );
          }
        } else {
          console.log(
            `[DRY RUN] Would create home server and initialize file system`,
          );
        }
      }

      // Migrate user's home directory
      const result = await migrateUserHomeDirectory(
        user.id,
        user.username,
        homeServerId,
        dryRun,
      );
      summary.results.push(result);

      // Print result
      result.actions.forEach((action) => console.log(`  ${action}`));
      result.errors.forEach((error) => console.log(`  ❌ ${error}`));

      if (result.success) {
        summary.successful++;
        console.log(`✅ Migration successful for ${user.username}`);
      } else {
        summary.failed++;
        console.log(`❌ Migration failed for ${user.username}`);
      }
    }
  } catch (error) {
    console.error("\n❌ Fatal error during migration:", error);
    throw error;
  }

  return summary;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run") || args.includes("-d");
  const forceRun = args.includes("--force") || args.includes("-f");

  if (!dryRun && !forceRun) {
    console.log("\n⚠️  WARNING: This will make changes to the database!");
    console.log(
      "Run with --dry-run to see what would happen without making changes.",
    );
    console.log("Run with --force to proceed with live migration.\n");
    process.exit(0);
  }

  const summary = await runMigration(dryRun);

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log("Migration Summary");
  console.log("=".repeat(60));
  console.log(`Total users:     ${summary.totalUsers}`);
  console.log(`Successful:      ${summary.successful} ✅`);
  console.log(`Failed:          ${summary.failed} ❌`);
  console.log(`Skipped:         ${summary.skipped} ⏭️`);
  console.log("=".repeat(60) + "\n");

  if (dryRun) {
    console.log("🔍 DRY RUN COMPLETE - No changes were made");
    console.log("Run with --force to apply these changes\n");
  } else {
    console.log("✅ MIGRATION COMPLETE\n");
  }

  await prisma.$disconnect();
  process.exit(summary.failed > 0 ? 1 : 0);
}

// Run migration
main().catch((error) => {
  console.error("💥 Migration failed:", error);
  prisma.$disconnect();
  process.exit(1);
});
