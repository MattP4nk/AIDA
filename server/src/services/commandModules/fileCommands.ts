import { Command, CommandResult } from "../../../../shared/types";
import { CommandModule, CommandContext } from "./interface";

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
        examples: ["upload script.sh 'echo hello'", "upload data.txt important info"],
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
        description: "Encrypt a file for security",
        usage: "encrypt <filename>",
        examples: ["encrypt passwords.txt", "encrypt /data/secrets.db"],
      },
      {
        command: "decrypt",
        category: "file",
        description: "Decrypt an encrypted file",
        usage: "decrypt <filename>",
        examples: ["decrypt passwords.txt.enc", "decrypt secrets.db.enc"],
      },
      {
        command: "analyze",
        category: "file",
        description: "Analyze a file for vulnerabilities or information",
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
    // Usage: download <filename>
    if (command.args.length === 0) {
      return {
        success: false,
        output: "Usage: download <filename>",
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
      const result = await context.fileService.readFile(
        serverId,
        context.userId,
        path,
      );

      if (!result.success) {
        return {
          success: false,
          output: `Download failed: ${result.message}`,
          timestamp: new Date(),
        };
      }

      return {
        success: true,
        output: `Downloaded ${filename}`,
        data: {
          filename,
          content: result.data?.content,
          mimeType: "text/plain", // Default for now
        },
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

      // 2. Delete original file
      await context.fileService.deleteNode(serverId, context.userId, path);

      // 3. Create new encrypted file
      const createResult = await context.fileService.createFile(
        serverId,
        context.userId,
        path,
        content,
        true, // encrypt
        password,
      );

      if (!createResult.success) {
        // Try to restore original if create failed?
        // For now just return error
        return {
          success: false,
          output: `Encryption failed: ${createResult.message}`,
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
    // Usage: decrypt <filename> [password]
    if (command.args.length === 0) {
      return {
        success: false,
        output: "Usage: decrypt <filename> [password]",
        timestamp: new Date(),
      };
    }

    const filename = command.args[0]!;
    const password = command.args[1];
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
      // 1. Read encrypted content (will fail if key is wrong/missing)
      const readResult = await context.fileService.readFile(
        serverId,
        context.userId,
        path,
        password,
      );

      if (!readResult.success || !readResult.data) {
        return {
          success: false,
          output: `Cannot decrypt: ${readResult.message}`,
          timestamp: new Date(),
        };
      }

      if (!readResult.data.isEncrypted) {
        return {
          success: true,
          output: "File is not encrypted",
          timestamp: new Date(),
        };
      }

      const content = readResult.data.content;

      // 2. Delete encrypted file
      await context.fileService.deleteNode(serverId, context.userId, path);

      // 3. Create decrypted file
      const createResult = await context.fileService.createFile(
        serverId,
        context.userId,
        path,
        content,
        false, // not encrypted
      );

      if (!createResult.success) {
        return {
          success: false,
          output: `Decryption failed during write: ${createResult.message}`,
          timestamp: new Date(),
        };
      }

      return {
        success: true,
        output: `File decrypted: ${filename}`,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: "Decryption failed",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
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

      const output = [
        `Analysis Report: ${filename}`,
        `---------------------------`,
        `Type: ${entry.type}`,
        `Size: ${entry.size} bytes`,
        `Encrypted: ${entry.isEncrypted ? "Yes" : "No"}`,
        `Permissions: ${entry.permissions || "N/A"}`,
        `Modified: ${new Date(entry.modified).toLocaleString()}`,
      ].join("\n");

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
