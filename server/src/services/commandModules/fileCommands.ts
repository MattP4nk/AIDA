import { Command, CommandResult } from "../../../../shared/types";
import { CommandModule, CommandContext } from "./interface";
import { infoBox, render } from "./asciiBox";

export class FileCommandsModule implements CommandModule {
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
        return {
          success: false,
          output: `File command not implemented: ${command.command}`,
          timestamp: new Date(),
        };
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

  private getSession(context: CommandContext) {
    return context.gameStateManager?.getSession(context.userId);
  }

  private getServerId(context: CommandContext): string | undefined {
    const session = this.getSession(context);
    return session?.currentServerId || session?.homeServerId;
  }

  private resolvePath(filename: string, context: CommandContext): string {
    const session = this.getSession(context);
    const currentDir = session?.currentDirectory || "/";
    if (filename.startsWith("/")) {
      return filename;
    }
    return currentDir === "/" ? `/${filename}` : `${currentDir}/${filename}`;
  }

  private async handleUpload(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    // Usage: upload <filename> <content>
    if (command.args.length < 2) {
      return {
        success: false,
        output: "Usage: upload <filename> <content>",
        timestamp: new Date(),
      };
    }

    const filename = command.args[0]!;
    const content = command.args.slice(1).join(" ");
    const serverId = this.getServerId(context);

    if (!serverId) {
      return {
        success: false,
        output: "No file system context",
        timestamp: new Date(),
      };
    }

    const path = this.resolvePath(filename, context);

    try {
      const result = await context.fileService.createFile(
        serverId,
        context.userId,
        path,
        content,
        false,
      );

      if (!result.success) {
        return {
          success: false,
          output: `Upload failed: ${result.message}`,
          timestamp: new Date(),
        };
      }

      return {
        success: true,
        output: `File uploaded: ${filename}`,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: "Upload failed",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  private async handleDownload(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    if (command.args.length === 0) {
      return { success: false, output: "Usage: download <filename>\nCopies file to your home server's /home/{user}/downloads/", timestamp: new Date() };
    }

    const filename = command.args[0]!;
    const serverId = this.getServerId(context);
    if (!serverId) {
      return { success: false, output: "No file system context", timestamp: new Date() };
    }

    const session = context.gameStateManager.getSession(context.userId);
    if (!session?.homeServerId) {
      return { success: false, output: "No home server available.", timestamp: new Date() };
    }

    // Can't download from your own home server
    if (serverId === session.homeServerId) {
      return { success: false, output: "Already on your home server. Files are already local.", timestamp: new Date() };
    }

    const path = this.resolvePath(filename, context);

    // Verify file exists and is readable first
    const readCheck = await context.fileService.readFile(serverId, context.userId, path);
    if (!readCheck.success || !readCheck.data) {
      return { success: false, output: `Cannot download: ${readCheck.message}`, timestamp: new Date() };
    }

    const fileContent = readCheck.data.content;
    const fileIsEncrypted = readCheck.data.isEncrypted;
    const memoryService = context.services.memoryService;

    // ── Spawn download as a background process ──
    if (memoryService) {
      const progress = await context.db.client.playerProgress.findUnique({
        where: { userId: context.userId },
        select: { networking: true, level: true },
      });
      memoryService.initComputerSpec(context.userId, progress?.level ?? 1);

      const check = memoryService.canSpawnProcess(context.userId, "download");
      if (!check.allowed) {
        return { success: false, output: `Download failed: ${check.reason}`, timestamp: new Date() };
      }

      const networkingSkill = progress?.networking ?? 1;
      const sourceServerId = serverId;
      const homeServerId = session.homeServerId;
      const userId = context.userId;

      const proc = memoryService.spawnGameProcess(
        userId,
        session.socketId || userId,
        "download",
        networkingSkill,
        filename,
        sourceServerId,
        async () => {
          // ── On completion: copy file to home server ──
          try {
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
      );

      if (!proc) {
        return { success: false, output: "Failed to start download process.", timestamp: new Date() };
      }

      const etaSec = Math.ceil(proc.duration / 1000);
      return {
        success: true,
        output: `Downloading ${filename}... ETA ${etaSec}s [PID ${proc.pid}]\nFile will be saved to ~/downloads/ on your home server.\nUse 'ps' to monitor progress.`,
        timestamp: new Date(),
      };
    }

    // Fallback: no process system available — direct copy
    try {
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
        return { success: false, output: `Download failed: ${result.message}`, timestamp: new Date() };
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

      return {
        success: true,
        output: `Downloaded ${filename} → ~/downloads/\n${fileIsEncrypted ? "[ENCRYPTED] " : ""}File saved to home server.`,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: "Download failed",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  private async handleEncrypt(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    // Usage: encrypt <filename> [password]
    if (command.args.length === 0) {
      return {
        success: false,
        output: "Usage: encrypt <filename> [password]",
        timestamp: new Date(),
      };
    }

    const filename = command.args[0]!;
    const password = command.args[1]; // Optional
    const serverId = this.getServerId(context);

    if (!serverId) {
      return {
        success: false,
        output: "No file system context",
        timestamp: new Date(),
      };
    }

    const path = this.resolvePath(filename, context);

    try {
      // 1. Read existing content
      const readResult = await context.fileService.readFile(
        serverId,
        context.userId,
        path,
      );

      if (!readResult.success || !readResult.data) {
        return {
          success: false,
          output: `Cannot encrypt: ${readResult.message || "File not found"}`,
          timestamp: new Date(),
        };
      }

      if (readResult.data.isEncrypted) {
        return {
          success: false,
          output: "File is already encrypted",
          timestamp: new Date(),
        };
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
        return {
          success: false,
          output: `Encryption failed: ${createResult.message}`,
          timestamp: new Date(),
        };
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
        return {
          success: false,
          output: `Encryption partially failed - check file: ${path}`,
          timestamp: new Date(),
        };
      }

      return {
        success: true,
        output: `File encrypted: ${filename}`,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: "Encryption failed",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  private async handleDecrypt(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    if (command.args.length === 0) {
      return { success: false, output: "Usage: decrypt <filename> [password]", timestamp: new Date() };
    }

    const filename = command.args[0]!;
    const password = command.args[1];
    const serverId = this.getServerId(context);
    if (!serverId) {
      return { success: false, output: "No file system context", timestamp: new Date() };
    }

    const path = this.resolvePath(filename, context);
    const memoryService = context.services.memoryService;

    // ── Resource check: spawn decrypt as background process ──
    if (memoryService) {
      const progress = await context.db.client.playerProgress.findUnique({
        where: { userId: context.userId },
        select: { cryptography: true, level: true },
      });
      memoryService.initComputerSpec(context.userId, progress?.level ?? 1);

      const check = memoryService.canSpawnProcess(context.userId, "decrypt");
      if (!check.allowed) {
        return { success: false, output: `Decrypt failed: ${check.reason}`, timestamp: new Date() };
      }

      const session = context.gameStateManager.getSession(context.userId);
      const cryptoSkill = progress?.cryptography ?? 1;
      // With key → faster (use skill * 3 for much shorter duration). Without → brute force.
      const effectiveSkill = password ? Math.max(cryptoSkill, 30) : cryptoSkill;

      const proc = memoryService.spawnGameProcess(
        context.userId,
        session?.socketId || context.userId,
        "decrypt",
        effectiveSkill,
        filename,
        undefined,
        async () => {
          // ── On completion: perform the actual decryption ──
          try {
            const readResult = await context.fileService.readFile(serverId, context.userId, path, password);
            if (!readResult.success || !readResult.data) {
              if (context.io) {
                context.io.to(`player:${context.userId}`).emit("command:result", {
                  success: false, output: `Decryption failed: ${readResult.message}`, timestamp: new Date(),
                });
              }
              return;
            }
            if (!readResult.data.isEncrypted) {
              if (context.io) {
                context.io.to(`player:${context.userId}`).emit("command:result", {
                  success: true, output: "File is not encrypted.", timestamp: new Date(),
                });
              }
              return;
            }

            const content = readResult.data.content;
            await context.fileService.deleteNode(serverId, context.userId, path);
            await context.fileService.createFile(serverId, context.userId, path, content, false);

            if (context.io) {
              context.io.to(`player:${context.userId}`).emit("command:result", {
                success: true, output: `File decrypted: ${filename}`, timestamp: new Date(),
              });
            }
          } catch {
            // Player is notified of failure via emit below
            if (context.io) {
              context.io.to(`player:${context.userId}`).emit("command:result", {
                success: false, output: "Decryption process failed.", timestamp: new Date(),
              });
            }
          }
        },
      );

      if (!proc) {
        return { success: false, output: "Failed to start decrypt process.", timestamp: new Date() };
      }

      const etaSec = Math.ceil(proc.duration / 1000);
      const modeLabel = password ? "key-based" : "brute force";
      return {
        success: true,
        output: `Decrypting ${filename} (${modeLabel})... ETA ${etaSec}s [PID ${proc.pid}]\nUse 'ps' to monitor progress.`,
        timestamp: new Date(),
      };
    }

    // ── Fallback: instant decrypt (no resource system) ──
    try {
      const readResult = await context.fileService.readFile(serverId, context.userId, path, password);
      if (!readResult.success || !readResult.data) {
        return { success: false, output: `Cannot decrypt: ${readResult.message}`, timestamp: new Date() };
      }
      if (!readResult.data.isEncrypted) {
        return { success: true, output: "File is not encrypted", timestamp: new Date() };
      }
      await context.fileService.deleteNode(serverId, context.userId, path);
      await context.fileService.createFile(serverId, context.userId, path, readResult.data.content, false);
      return { success: true, output: `File decrypted: ${filename}`, timestamp: new Date() };
    } catch (error) {
      return { success: false, output: "Decryption failed", error: error instanceof Error ? error.message : "Unknown error", timestamp: new Date() };
    }
  }

  private async handleAnalyze(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    // Usage: analyze <filename>
    if (command.args.length === 0) {
      return {
        success: false,
        output: "Usage: analyze <filename>",
        timestamp: new Date(),
      };
    }

    const filename = command.args[0]!;
    const serverId = this.getServerId(context);

    if (!serverId) {
      return {
        success: false,
        output: "No file system context",
        timestamp: new Date(),
      };
    }

    const path = this.resolvePath(filename, context);

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
        return {
          success: false,
          output: `Analyze failed: ${listResult.message}`,
          timestamp: new Date(),
        };
      }

      const entry = listResult.data.entries.find((e: any) => e.name === name);

      if (!entry) {
        return {
          success: false,
          output: `File not found: ${filename}`,
          timestamp: new Date(),
        };
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

      return {
        success: true,
        output,
        data: { entry },
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: "Analysis failed",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }
}
