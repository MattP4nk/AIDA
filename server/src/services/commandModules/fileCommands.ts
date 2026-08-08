import { Command, CommandResult } from "../../../../shared/types";
import { CommandModule, CommandContext } from "./interface";
import { infoBox, render } from "./asciiBox";
import {
  resolvePath,
  getSession,
  getServerId,
  spawnBackgroundProcess,
  successResult,
  errorResult,
} from "./helpers";

export class FileCommandsModule implements CommandModule {
  public category = "file";
  public commands: Set<string> = new Set([
    "upload",
    "download",
    "encrypt",
    "decrypt",
    "analyze",
  ]);

  public async execute(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    switch (command.command) {
      case "upload":
        return await this.handleUpload(command, context);
      case "download":
        return await this.handleDownload(command, context);
      case "encrypt":
        return await this.handleEncrypt(command, context);
      case "decrypt":
        return await this.handleDecrypt(command, context);
      case "analyze":
        return await this.handleAnalyze(command, context);
      default:
        return errorResult(`File command not implemented: ${command.command}`);
    }
  }

  public getCommandInfo(): import("./interface").CommandInfo[] {
    return [
      {
        command: "upload",
        category: "file",
        description: "Upload a file to the current server",
        usage: "upload <filename> <content>",
        examples: [
          "upload script.sh 'echo hello'",
          "upload data.txt important info",
        ],
      },
      {
        command: "download",
        category: "file",
        description: "Download a file from the current server",
        usage: "download <filename>",
        examples: ["download secrets.txt", "download /etc/passwd"],
      },
      {
        command: "encrypt",
        category: "file",
        description: "[Crypto 10] Encrypt a file for security",
        usage: "encrypt <filename>",
        examples: ["encrypt passwords.txt", "encrypt /data/secrets.db"],
      },
      {
        command: "decrypt",
        category: "file",
        description: "[Crypto 15] Decrypt an encrypted file",
        usage: "decrypt <filename>",
        examples: ["decrypt passwords.txt.enc", "decrypt secrets.db.enc"],
      },
      {
        command: "analyze",
        category: "file",
        description:
          "[Forensics 10] Analyze a file for vulnerabilities or information",
        usage: "analyze <filename>",
        examples: ["analyze system.log", "analyze firewall.conf"],
      },
    ];
  }

  // getSession(), getServerId(), resolvePath() now imported from helpers.ts

  private async handleUpload(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    // Usage: upload <filename> <content>
    if (command.args.length < 2) {
      return errorResult("Usage: upload <filename> <content>");
    }

    const filename = command.args[0]!;
    const content = command.args.slice(1).join(" ");
    const serverId = getServerId(context);

    if (!serverId) {
      return errorResult("No file system context");
    }

    const path = resolvePath(filename, getSession(context)?.currentDirectory || "/");

    try {
      const result = await context.fileService.createFile(
        serverId,
        context.userId,
        path,
        content,
        false,
      );

      if (!result.success) {
        return errorResult(`Upload failed: ${result.message}`);
      }

      return successResult(`File uploaded: ${filename}`);
    } catch (error) {
      return errorResult("Upload failed", error instanceof Error ? error.message : "Unknown error");
    }
  }

  private async handleDownload(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    if (command.args.length === 0) {
      return errorResult("Usage: download <filename>\nCopies file to your home server's /home/{user}/downloads/");
    }

    const filename = command.args[0]!;
    const serverId = getServerId(context);
    if (!serverId) {
      return errorResult("No file system context");
    }

    const session = context.gameStateManager.getSession(context.userId);
    if (!session?.homeServerId) {
      return errorResult("No home server available.");
    }

    // Can't download from your own home server
    if (serverId === session.homeServerId) {
      return errorResult("Already on your home server. Files are already local.");
    }

    const path = resolvePath(filename, getSession(context)?.currentDirectory || "/");

    // Verify file exists and is readable first
    const readCheck = await context.fileService.readFile(serverId, context.userId, path);
    if (!readCheck.success || !readCheck.data) {
      return errorResult(`Cannot download: ${readCheck.message}`);
    }

    const fileContent = readCheck.data.content;
    const fileIsEncrypted = readCheck.data.isEncrypted;
    const memoryService = context.services.memoryService;

    // ── Spawn download as a background process ──
    if (memoryService) {
      const sourceServerId = serverId;
      const homeServerId = session.homeServerId;
      const userId = context.userId;

      const spawn = await spawnBackgroundProcess({
        context,
        processType: "download",
        skillKey: "networking",
        label: filename,
        targetServerId: sourceServerId,
        onComplete: async () => {
          // ── On completion: copy file to home server ──
          try {
            // Track download for mission objectives FIRST (before file copy which can fail)
            const missionIntegration = context.services.missionIntegrationService;
            if (missionIntegration) {
              try {
                await (missionIntegration as any).onFileOperation(userId, "download", "", sourceServerId);
              } catch { /* non-critical */ }
            }

            // Get or create downloads directory on home server
            const user = await context.db.client.user.findUnique({
              where: { id: userId },
              select: { username: true },
            });
            const downloadDir = `/home/${user?.username || "user"}/downloads`;

            // Ensure downloads directory exists
            await context.fileService.createDirectory(homeServerId, userId, downloadDir).catch(() => {});

            // Create the downloaded copy with source metadata
            const downloadPath = `${downloadDir}/${filename.split("/").pop() || filename}`;
            const result = await context.fileService.createFile(
              homeServerId,
              userId,
              downloadPath,
              fileContent,
              fileIsEncrypted,
            );

            if (result.success) {
              // Mark the file with source metadata for tracking
              const node = await context.db.client.fileSystemNode.findFirst({
                where: { serverId: homeServerId, name: filename.split("/").pop()! },
                orderBy: { createdAt: "desc" },
              });
              if (node) {
                await context.db.client.fileSystemNode.update({
                  where: { id: node.id },
                  data: {
                    metadata: {
                      sourceServerId,
                      sourcePath: path,
                      downloadedAt: new Date().toISOString(),
                      isDownloaded: true,
                    } as any,
                  },
                });
              }

              // ── Access key detection happens HERE (on download, not on cat) ──
              if (context.services.networkTopologyService && fileContent) {
                await context.fileService.detectAndGrantAccessKeys(
                  userId,
                  fileContent,
                  sourceServerId,
                  path,
                  node?.id,
                );
              }

            }

            // Push result to player
            if (context.io) {
              context.io.to(`player:${userId}`).emit("command:result", {
                success: true,
                output: `Downloaded ${filename} → ${downloadDir}/\n${fileIsEncrypted ? "[ENCRYPTED] " : ""}File saved to home server.`,
                timestamp: new Date(),
              });
            }
          } catch (err) {
            if (context.io) {
              context.io.to(`player:${userId}`).emit("command:result", {
                success: false,
                output: `Download failed: could not save to home server.`,
                timestamp: new Date(),
              });
            }
          }
        },
      });

      if (spawn) return spawn.result;
    }

    // Fallback: no process system available — direct copy
    try {
      // Track download for mission objectives FIRST
      const missionIntegration = context.services.missionIntegrationService;
      if (missionIntegration) {
        try {
          await (missionIntegration as any).onFileOperation(context.userId, "download", "", serverId);
        } catch { /* non-critical */ }
      }

      const user = await context.db.client.user.findUnique({
        where: { id: context.userId },
        select: { username: true },
      });
      const downloadDir = `/home/${user?.username || "user"}/downloads`;
      await context.fileService.createDirectory(session.homeServerId, context.userId, downloadDir).catch(() => {});

      const downloadPath = `${downloadDir}/${filename.split("/").pop() || filename}`;
      const result = await context.fileService.createFile(
        session.homeServerId,
        context.userId,
        downloadPath,
        fileContent,
        fileIsEncrypted,
      );

      if (!result.success) {
        return errorResult(`Download failed: ${result.message}`);
      }

      // Mark with source metadata
      const node = await context.db.client.fileSystemNode.findFirst({
        where: { serverId: session.homeServerId, name: filename.split("/").pop()! },
        orderBy: { createdAt: "desc" },
      });
      if (node) {
        await context.db.client.fileSystemNode.update({
          where: { id: node.id },
          data: {
            metadata: {
              sourceServerId: serverId,
              sourcePath: path,
              downloadedAt: new Date().toISOString(),
              isDownloaded: true,
            } as any,
          },
        });
      }

      // Access key detection on download
      if (context.services.networkTopologyService && fileContent) {
        await context.fileService.detectAndGrantAccessKeys(
          context.userId,
          fileContent,
          serverId,
          path,
          node?.id,
        );
      }

      return successResult(`Downloaded ${filename} → ~/downloads/\n${fileIsEncrypted ? "[ENCRYPTED] " : ""}File saved to home server.`);
    } catch (error) {
      return errorResult("Download failed", error instanceof Error ? error.message : "Unknown error");
    }
  }

  private async handleEncrypt(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    // Usage: encrypt <filename> [password]
    if (command.args.length === 0) {
      return errorResult("Usage: encrypt <filename> [password]");
    }

    const filename = command.args[0]!;
    const password = command.args[1]; // Optional
    const serverId = getServerId(context);

    if (!serverId) {
      return errorResult("No file system context");
    }

    const path = resolvePath(filename, getSession(context)?.currentDirectory || "/");

    try {
      // 1. Read existing content
      const readResult = await context.fileService.readFile(
        serverId,
        context.userId,
        path,
      );

      if (!readResult.success || !readResult.data) {
        return errorResult(`Cannot encrypt: ${readResult.message || "File not found"}`);
      }

      if (readResult.data.isEncrypted) {
        return errorResult("File is already encrypted");
      }

      const content = readResult.data.content;

      // 2. Create encrypted file at a temp path first to avoid data loss
      const tempPath = `${path}.__encrypting__`;
      const createResult = await context.fileService.createFile(
        serverId,
        context.userId,
        tempPath,
        content,
        true, // encrypt
        password,
      );

      if (!createResult.success) {
        // Clean up temp file if it was partially created
        try {
          await context.fileService.deleteNode(
            serverId,
            context.userId,
            tempPath,
          );
        } catch {
          // Ignore cleanup errors
        }
        return errorResult(`Encryption failed: ${createResult.message}`);
      }

      // 3. Delete original and rename temp to original path
      await context.fileService.deleteNode(serverId, context.userId, path);
      // Move temp file to original path by creating final and deleting temp
      const finalResult = await context.fileService.createFile(
        serverId,
        context.userId,
        path,
        content,
        true,
        password,
      );
      // Clean up temp file
      try {
        await context.fileService.deleteNode(
          serverId,
          context.userId,
          tempPath,
        );
      } catch {
        // Ignore - temp file cleanup is best-effort
      }

      if (!finalResult.success) {
        return errorResult(`Encryption partially failed - check file: ${path}`);
      }

      return successResult(`File encrypted: ${filename}`);
    } catch (error) {
      return errorResult("Encryption failed", error instanceof Error ? error.message : "Unknown error");
    }
  }

  private async handleDecrypt(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    if (command.args.length === 0) {
      return errorResult("Usage: decrypt <filename> [password]");
    }

    const filename = command.args[0]!;
    const password = command.args[1];
    const serverId = getServerId(context);
    if (!serverId) {
      return errorResult("No file system context");
    }

    const path = resolvePath(filename, getSession(context)?.currentDirectory || "/");
    const memoryService = context.services.memoryService;

    // ── Resource check: spawn decrypt as background process ──
    if (memoryService) {
      // With key → faster (use skill override). Without → brute force at actual skill.
      const cryptoProgress = await context.db.client.playerProgress.findUnique({
        where: { userId: context.userId },
        select: { cryptography: true },
      });
      const cryptoSkill = cryptoProgress?.cryptography ?? 1;
      const effectiveSkill = password ? Math.max(cryptoSkill, 30) : undefined;

      const spawn = await spawnBackgroundProcess({
        context,
        processType: "decrypt",
        skillKey: "cryptography",
        label: filename,
        effectiveSkillOverride: effectiveSkill,
        onComplete: async () => {
          try {
            const readResult = await context.fileService.readFile(serverId, context.userId, path, password);
            if (!readResult.success || !readResult.data) {
              context.io?.to(`player:${context.userId}`).emit("command:result", {
                success: false, output: `Decryption failed: ${readResult.message}`, timestamp: new Date(),
              });
              return;
            }
            if (!readResult.data.isEncrypted) {
              context.io?.to(`player:${context.userId}`).emit("command:result", {
                success: true, output: "File is not encrypted.", timestamp: new Date(),
              });
              return;
            }

            const content = readResult.data.content;
            await context.fileService.deleteNode(serverId, context.userId, path);
            await context.fileService.createFile(serverId, context.userId, path, content, false);

            context.io?.to(`player:${context.userId}`).emit("command:result", {
              success: true, output: `File decrypted: ${filename}`, timestamp: new Date(),
            });
          } catch {
            context.io?.to(`player:${context.userId}`).emit("command:result", {
              success: false, output: "Decryption process failed.", timestamp: new Date(),
            });
          }
        },
      });

      if (spawn) return spawn.result;
    }

    // ── Fallback: instant decrypt (no resource system) ──
    try {
      const readResult = await context.fileService.readFile(serverId, context.userId, path, password);
      if (!readResult.success || !readResult.data) {
        return errorResult(`Cannot decrypt: ${readResult.message}`);
      }
      if (!readResult.data.isEncrypted) {
        return successResult("File is not encrypted");
      }
      await context.fileService.deleteNode(serverId, context.userId, path);
      await context.fileService.createFile(serverId, context.userId, path, readResult.data.content, false);
      return successResult(`File decrypted: ${filename}`);
    } catch (error) {
      return errorResult("Decryption failed", error instanceof Error ? error.message : "Unknown error");
    }
  }

  private async handleAnalyze(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    // Usage: analyze <filename>
    if (command.args.length === 0) {
      return errorResult("Usage: analyze <filename>");
    }

    const filename = command.args[0]!;
    const serverId = getServerId(context);

    if (!serverId) {
      return errorResult("No file system context");
    }

    const path = resolvePath(filename, getSession(context)?.currentDirectory || "/");

    try {
      // Use listDirectory to find the node without reading content
      const dir = path.substring(0, path.lastIndexOf("/")) || "/";
      const name = path.substring(path.lastIndexOf("/") + 1);

      const listResult = await context.fileService.listDirectory(
        serverId,
        context.userId,
        dir,
        true, // show hidden
      );

      if (!listResult.success || !listResult.data) {
        return errorResult(`Analyze failed: ${listResult.message}`);
      }

      const entry = listResult.data.entries.find((e: any) => e.name === name);

      if (!entry) {
        return errorResult(`File not found: ${filename}`);
      }

      const labelWidth = 14;
      const output = render(
        infoBox(
          `ANALYSIS REPORT: ${filename}`,
          [
            { label: "Type:".padEnd(labelWidth), value: entry.type },
            { label: "Size:".padEnd(labelWidth), value: `${entry.size} bytes` },
            {
              label: "Encrypted:".padEnd(labelWidth),
              value: entry.isEncrypted ? "Yes" : "No",
            },
            {
              label: "Permissions:".padEnd(labelWidth),
              value: entry.permissions || "N/A",
            },
            {
              label: "Modified:".padEnd(labelWidth),
              value: new Date(entry.modified).toLocaleString(),
            },
          ],
          40,
        ),
      );

      return successResult(output, { entry });
    } catch (error) {
      return errorResult("Analysis failed", error instanceof Error ? error.message : "Unknown error");
    }
  }
}
