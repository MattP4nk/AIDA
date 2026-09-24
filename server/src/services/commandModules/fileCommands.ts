import { Command, CommandResult } from "../../../../shared/types";
import { CommandModule, CommandContext } from "./interface";
import { infoBox, render } from "./asciiBox";
import { getSkillShortfall } from "./skillRequirements";
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

    // ── Spawn upload as a background process ──
    const memoryService = context.services.memoryService;
    if (memoryService) {
      const spawn = await spawnBackgroundProcess({
        context,
        processType: "upload",
        skillKey: "networking",
        label: filename,
        targetServerId: serverId,
        onComplete: async () => {
          try {
            const result = await context.fileService.createFile(
              serverId,
              context.userId,
              path,
              content,
              false,
            );

            if (context.io) {
              context.io.to(`player:${context.userId}`).emit("command:result", {
                success: result.success,
                output: result.success
                  ? `File uploaded: ${filename}`
                  : `Upload failed: ${result.message}`,
                timestamp: new Date(),
              });
            }
          } catch (err) {
            if (context.io) {
              context.io.to(`player:${context.userId}`).emit("command:result", {
                success: false,
                output: "Upload failed",
                timestamp: new Date(),
              });
            }
          }
        },
      });
      if (spawn) return spawn.result;
    }

    // Fallback: instant operation (no resource system)
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
    // Source file's node id, for mission crediting. `steal`/`exfiltrate_data`
    // objectives are bound to `metadata.fileId`; both download paths used to
    // pass "" here, so they could never be credited (M12).
    const sourceFileId: string = readCheck.data.nodeId ?? "";
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
          const accessKeysGranted: string[] = [];
          try {
            // Track download for mission objectives FIRST (before file copy which can fail)
            const missionIntegration = context.services.missionIntegrationService as
              | import("../missionIntegration").MissionIntegrationService
              | undefined;
            if (missionIntegration) {
              try {
                await missionIntegration.onFileOperation(userId, "download", sourceFileId, sourceServerId);
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
                const granted = await context.fileService.detectAndGrantAccessKeys(
                  userId,
                  fileContent,
                  sourceServerId,
                  path,
                  node?.id,
                );
                if (granted.length > 0) accessKeysGranted.push(...granted);
              }

            }

            // Push result to player
            if (context.io) {
              let downloadOutput = `Downloaded ${filename} → ${downloadDir}/\n${fileIsEncrypted ? "[ENCRYPTED] " : ""}File saved to home server.`;

              if (accessKeysGranted.length > 0) {
                downloadOutput += "\n\n" +
                  "╔══════════════════════════════════════════╗\n" +
                  "║     [!] ACCESS KEY DISCOVERED            ║\n" +
                  "╠══════════════════════════════════════════╣\n";
                for (const name of accessKeysGranted) {
                  downloadOutput += `║  ► ${name.padEnd(37)}║\n`;
                }
                downloadOutput +=
                  "║                                          ║\n" +
                  "║  Access granted. Use 'connect' to enter. ║\n" +
                  "╚══════════════════════════════════════════╝";
              }

              context.io.to(`player:${userId}`).emit("command:result", {
                success: true,
                output: downloadOutput,
                soundEvent: accessKeysGranted.length > 0 ? "success" : undefined,
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
      const missionIntegration = context.services.missionIntegrationService as
              | import("../missionIntegration").MissionIntegrationService
              | undefined;
      if (missionIntegration) {
        try {
          await missionIntegration.onFileOperation(context.userId, "download", sourceFileId, serverId);
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
      let grantedServers: string[] = [];
      if (context.services.networkTopologyService && fileContent) {
        grantedServers = await context.fileService.detectAndGrantAccessKeys(
          context.userId,
          fileContent,
          serverId,
          path,
          node?.id,
        );
      }

      let downloadOutput = `Downloaded ${filename} → ~/downloads/\n${fileIsEncrypted ? "[ENCRYPTED] " : ""}File saved to home server.`;
      if (grantedServers.length > 0) {
        downloadOutput += "\n\n" +
          "╔══════════════════════════════════════════╗\n" +
          "║     [!] ACCESS KEY DISCOVERED            ║\n" +
          "╠══════════════════════════════════════════╣\n";
        for (const name of grantedServers) {
          downloadOutput += `║  ► ${name.padEnd(37)}║\n`;
        }
        downloadOutput +=
          "║                                          ║\n" +
          "║  Access granted. Use 'connect' to enter. ║\n" +
          "╚══════════════════════════════════════════╝";
      }

      return successResult(downloadOutput);
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

      // 3. Replace the original with the encrypted copy.
      //
      // R9: the temp file is the ONLY surviving copy between the delete below
      // and a successful re-create, and it used to be deleted BEFORE
      // `finalResult.success` was checked. If the final write failed, the
      // original was already gone and the staging copy went with it — the file
      // was destroyed by the command meant to protect it. Verify first, and
      // keep the staging copy as a recovery point when the write fails.
      // REVIEW FIX: check the delete. `deleteNode` refuses `isProtected`
      // nodes, and every account is created with a protected
      // `/home/<user>/welcome.txt` — so `encrypt welcome.txt` silently failed
      // to remove the original, the re-create hit FILE_EXISTS, and the player
      // was told "Your data is NOT lost — the encrypted copy is at
      // <path>.__encrypting__". Nothing had been at risk, the suggested `mv`
      // would fail against the still-present original, and the orphan left
      // behind was encrypted under a fresh random key that is never surfaced
      // (the key-printing block only runs on the success path).
      const removed = await context.fileService.deleteNode(
        serverId,
        context.userId,
        path,
      );
      if (!removed.success) {
        // Clean up the staging copy: it is unreachable anyway, since its key
        // was never shown to anyone.
        try {
          await context.fileService.deleteNode(serverId, context.userId, tempPath);
        } catch { /* best effort */ }
        return errorResult(
          `Cannot encrypt ${path}: ${removed.message ?? "the original could not be replaced"}`,
        );
      }

      const finalResult = await context.fileService.createFile(
        serverId,
        context.userId,
        path,
        content,
        true,
        password,
      );

      if (!finalResult.success) {
        return errorResult(
          `Encryption failed while writing ${path}. Your data is NOT lost — ` +
            `the encrypted copy is at ${tempPath}. Rename it back with ` +
            `'mv ${tempPath} ${path}'.`,
        );
      }

      // Only now is the staging copy redundant.
      try {
        await context.fileService.deleteNode(
          serverId,
          context.userId,
          tempPath,
        );
      } catch {
        // Best-effort: a leftover temp file is untidy, not harmful.
      }

      // R9: SURFACE THE KEY.
      //
      // With no password the service generates a random key and stores it on
      // the row — and `readFile` refuses to decrypt unless the caller supplies
      // one. So encrypting without a password used to make the file unreadable
      // to its own owner, who was never told the key and could only get the
      // content back by cracking their own file.
      const issuedKey = finalResult.data?.encryptionKey;
      if (!password && issuedKey) {
        return successResult(
          [
            `File encrypted: ${filename}`,
            "",
            `  KEY: ${issuedKey}`,
            "",
            "  Store this key. It is required to read the file back:",
            // `decrypt`, not `cat --key=`: nothing parses a `--key` flag.
            // The first draft of this message named one, so a player who
            // followed it verbatim could never open their own file.
            `    decrypt ${filename} ${issuedKey}`,
          ].join("\n"),
        );
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

            // REVIEW FIX: same unchecked delete-then-recreate as the
            // fallback below. This path was worse — it emitted
            // `success: true` to the client after destroying the file.
            const content = readResult.data.content;
            const removed = await context.fileService.deleteNode(serverId, context.userId, path);
            if (!removed.success) {
              context.io?.to(`player:${context.userId}`).emit("command:result", {
                success: false,
                output: `Cannot decrypt: ${removed.message ?? "the original could not be replaced"}`,
                timestamp: new Date(),
              });
              return;
            }

            const rewritten = await context.fileService.createFile(serverId, context.userId, path, content, false);
            if (!rewritten.success) {
              context.io?.to(`player:${context.userId}`).emit("command:result", {
                success: false,
                output:
                  `Decryption failed while rewriting ${path}: ${rewritten.message}. ` +
                  `The file has been removed — its decrypted contents were:\n\n${content}`,
                timestamp: new Date(),
              });
              return;
            }

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
      // REVIEW FIX: this is the same delete-then-recreate hazard R9 fixed in
      // `handleEncrypt` — left intact in the function directly below it.
      // Neither result was checked, and the two calls use DIFFERENT permission
      // rules: `deleteNode` checks write on the NODE, `createFile` checks write
      // on the PARENT DIRECTORY. A player with write on the file but not on
      // its directory therefore deleted it, failed to recreate it, and was
      // told "File decrypted".
      const removed = await context.fileService.deleteNode(
        serverId,
        context.userId,
        path,
      );
      if (!removed.success) {
        return errorResult(
          `Cannot decrypt: ${removed.message ?? "the original could not be replaced"}`,
        );
      }

      const rewritten = await context.fileService.createFile(
        serverId,
        context.userId,
        path,
        readResult.data.content,
        false,
      );
      if (!rewritten.success) {
        return errorResult(
          `Decryption failed while rewriting ${path}: ${rewritten.message}. ` +
            `The file has been removed — its decrypted contents were:\n\n` +
            `${readResult.data.content}`,
        );
      }

      return successResult(`File decrypted: ${filename}`);
    } catch (error) {
      return errorResult("Decryption failed", error instanceof Error ? error.message : "Unknown error");
    }
  }

  /**
   * Build the ANALYSIS REPORT, degraded by an under-skilled forensic read.
   *
   * U3c penalty currency for `analyze`: **conclusiveness**, not speed or noise.
   * A weak analyst still gets the report, but the fields that take real forensic
   * skill to establish come back inconclusive. Type and Size are never withheld —
   * they are trivially observable from a directory listing the player can already
   * run, so hiding them would be arbitrary rather than a degraded analysis.
   *
   * Shared by the process path and the no-resource-system fallback so the two
   * cannot drift.
   */
  private buildAnalysisReport(
    filename: string,
    entry: any,
    severity: number,
  ): string {
    const labelWidth = 14;
    const inconclusive = "-- inconclusive --";

    // Fields ordered by how much skill they take to establish. At full severity
    // all three of these are lost; at zero, none are.
    const skilled = [
      {
        label: "Encrypted:",
        value: entry.isEncrypted ? "Yes" : "No",
      },
      {
        label: "Permissions:",
        value: entry.permissions || "N/A",
      },
      {
        label: "Modified:",
        value: new Date(entry.modified).toLocaleString(),
      },
    ];
    const lost = Math.min(skilled.length, Math.round(severity * skilled.length));
    // Lose the hardest first — Modified, then Permissions, then Encrypted.
    const keptCount = skilled.length - lost;

    const rows = [
      { label: "Type:".padEnd(labelWidth), value: entry.type },
      { label: "Size:".padEnd(labelWidth), value: `${entry.size} bytes` },
      ...skilled.map((f, i) => ({
        label: f.label.padEnd(labelWidth),
        value: i < keptCount ? f.value : inconclusive,
      })),
    ];

    if (lost > 0) {
      rows.push({
        label: "".padEnd(labelWidth),
        value: `(forensics too low for a full read)`,
      });
    }

    return render(infoBox(`ANALYSIS REPORT: ${filename}`, rows, 40));
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

    // U3c soft gate: `analyze` has a baseline of Forensics 10 but a new player
    // starts at 5, so it was refused outright. Now it runs and degrades — see
    // buildAnalysisReport for the currency.
    const progress = await context.db.client.playerProgress.findUnique({
      where: { userId: context.userId },
      select: { forensics: true },
    });
    const shortfall = getSkillShortfall(
      command.command,
      command.args,
      (progress ?? {}) as unknown as Record<string, unknown>,
    );
    const severity = shortfall?.severity ?? 0;

    // ── Spawn analyze as a background process ──
    const memoryService = context.services.memoryService;
    if (memoryService) {
      const spawn = await spawnBackgroundProcess({
        context,
        processType: "analyze",
        skillKey: "forensics",
        label: filename,
        targetServerId: serverId,
        onComplete: async () => {
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
              if (context.io) {
                context.io.to(`player:${context.userId}`).emit("command:result", {
                  success: false,
                  output: `Analyze failed: ${listResult.message}`,
                  timestamp: new Date(),
                });
              }
              return;
            }

            const entry = listResult.data.entries.find((e: any) => e.name === name);

            if (!entry) {
              if (context.io) {
                context.io.to(`player:${context.userId}`).emit("command:result", {
                  success: false,
                  output: `File not found: ${filename}`,
                  timestamp: new Date(),
                });
              }
              return;
            }

            const resultOutput = this.buildAnalysisReport(
              filename,
              entry,
              severity,
            );

            if (context.io) {
              context.io.to(`player:${context.userId}`).emit("command:result", {
                success: true,
                output: resultOutput,
                timestamp: new Date(),
              });
            }
          } catch (err) {
            if (context.io) {
              context.io.to(`player:${context.userId}`).emit("command:result", {
                success: false,
                output: "Analysis failed",
                timestamp: new Date(),
              });
            }
          }
        },
      });
      if (spawn) return spawn.result;
    }

    // Fallback: instant operation (no resource system)
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

      const output = this.buildAnalysisReport(filename, entry, severity);

      return successResult(output, { entry });
    } catch (error) {
      return errorResult("Analysis failed", error instanceof Error ? error.message : "Unknown error");
    }
  }
}
