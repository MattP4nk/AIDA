import { Command, CommandResult } from "../../../../shared/types";
import { CommandModule, CommandContext } from "./interface";

export class SystemCommandsModule implements CommandModule {
  public commands: Set<string> = new Set([
    "ls",
    "cd",
    "pwd",
    "cat",
    "mkdir",
    "touch",
    "rm",
    "cp",
    "mv",
    "echo",
    "write",
  ]);

  public async execute(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const session = this.getSession(context);
    if (!session) {
      return {
        success: false,
        output: "No active session",
        timestamp: new Date(),
      };
    }

    try {
      switch (command.command) {
        case "ls":
          return await this.handleListDirectory(command, context);

        case "cd":
          return await this.handleChangeDirectory(command, context);

        case "pwd":
          return await this.handlePrintWorkingDirectory(command, context);

        case "cat":
          return await this.handleReadFile(command, context);

        case "mkdir":
          return await this.handleMakeDirectory(command, context);

        case "touch":
          return await this.handleCreateFile(command, context);

        case "rm":
          return await this.handleRemoveFile(command, context);

        case "cp":
          return await this.handleCopyFile(command, context);

        case "mv":
          return await this.handleMoveFile(command, context);

        case "echo":
          return await this.handleEcho(command, context);

        case "write":
          return await this.handleWriteFile(command, context);

        default:
          return {
            success: false,
            output: `System command not implemented: ${command.command}`,
            timestamp: new Date(),
          };
      }
    } catch (error) {
      return {
        success: false,
        output: "System command failed",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  public getCommandInfo(): import("./interface").CommandInfo[] {
    return [
      {
        command: "ls",
        category: "system",
        description: "List directory contents",
        usage: "ls [options] [path]",
        examples: ["ls", "ls -l", "ls -a /home"],
      },
      {
        command: "cd",
        category: "system",
        description: "Change current directory",
        usage: "cd <path>",
        examples: ["cd /home", "cd ..", "cd documents"],
      },
      {
        command: "pwd",
        category: "system",
        description: "Print working directory",
        usage: "pwd",
        examples: ["pwd"],
      },
      {
        command: "cat",
        category: "system",
        description: "Display file contents",
        usage: "cat <filename>",
        examples: ["cat readme.txt", "cat /etc/passwd"],
      },
      {
        command: "mkdir",
        category: "system",
        description: "Create a new directory",
        usage: "mkdir <directory>",
        examples: ["mkdir newdir", "mkdir /home/user/docs"],
      },
      {
        command: "touch",
        category: "system",
        description: "Create an empty file",
        usage: "touch <filename>",
        examples: ["touch newfile.txt", "touch /tmp/test"],
      },
      {
        command: "rm",
        category: "system",
        description: "Remove files or directories",
        usage: "rm [-r] <path>",
        examples: ["rm file.txt", "rm -r directory"],
      },
      {
        command: "cp",
        category: "system",
        description: "Copy files or directories",
        usage: "cp <source> <destination>",
        examples: ["cp file.txt backup.txt", "cp /home/data.txt /backup/"],
      },
      {
        command: "mv",
        category: "system",
        description: "Move or rename files",
        usage: "mv <source> <destination>",
        examples: ["mv old.txt new.txt", "mv file.txt /home/user/"],
      },
      {
        command: "echo",
        category: "system",
        description: "Display text or write to file",
        usage: "echo <text> [> | >>] [file]",
        examples: ["echo hello", "echo 'test' > file.txt", "echo 'more' >> file.txt"],
      },
      {
        command: "write",
        category: "system",
        description: "Write content to a file",
        usage: "write <filename> <content>",
        examples: ["write notes.txt This is my note", "write /tmp/data.txt Important information"],
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

  private async handleListDirectory(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    try {
      const serverId = this.getServerId(context);
      if (!serverId) {
        return {
          success: false,
          output: "No file system context available",
          timestamp: new Date(),
        };
      }

      const session = this.getSession(context);
      const currentDir = session?.currentDirectory || "/";
      
      // Resolve path (absolute or relative)
      let path = command.args[0] || currentDir;
      if (!path.startsWith("/")) {
        path =
          currentDir === "/" ? `/${path}` : `${currentDir}/${path}`;
      }

      const showHidden = command.args.includes("-a");
      const result = await context.fileService.listDirectory(
        serverId,
        context.userId,
        path,
        showHidden,
      );

      if (!result.success) {
        return {
          success: false,
          output: `ls: ${result.message}`,
          timestamp: new Date(),
        };
      }

      // Format output
      const entries = result.data?.entries || [];
      let output: string | string[] = "";

      if (command.args.includes("-l")) {
        // Long format
        output = entries.map((entry: any) => {
          const type = entry.type === "directory" ? "d" : "-";
          const perms = entry.permissions || "rwxr-xr-x";
          const size = entry.size.toString().padStart(8);
          const date = new Date(entry.modified).toLocaleString();
          const name = entry.name;
          return `${type}${perms} ${size} ${date} ${name}`;
        });
      } else {
        // Short format
        output = entries.map((entry: any) => {
          const name =
            entry.type === "directory" ? `${entry.name}/` : entry.name;
          const encrypted = entry.isEncrypted ? " 🔒" : "";
          return `${name}${encrypted}`;
        });
      }

      return {
        success: true,
        output: Array.isArray(output) ? output.join("\n") : output,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: "Failed to list directory",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  private async handleChangeDirectory(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    try {
      const serverId = this.getServerId(context);
      if (!serverId) {
        return {
          success: false,
          output: "No file system context available",
          timestamp: new Date(),
        };
      }

      const session = this.getSession(context);
      const currentDir = session?.currentDirectory || "/";
      let targetDir = command.args[0] || "/";

      // Handle relative paths
      if (!targetDir.startsWith("/")) {
        targetDir =
          currentDir === "/" ? `/${targetDir}` : `${currentDir}/${targetDir}`;
      }

      // Verify directory exists using listDirectory (hacky but effective if resolvePath isn't public)
      // Actually, we should expose resolvePath or just try to list it.
      // Better: use listDirectory to check existence.
      const result = await context.fileService.listDirectory(
        serverId,
        context.userId,
        targetDir,
      );

      if (!result.success) {
        return {
          success: false,
          output: `cd: ${result.message}`,
          timestamp: new Date(),
        };
      }

      // Update session
      if (session) {
        session.currentDirectory = result.data.path; // Use resolved path from service
      }

      return {
        success: true,
        output: `Changed directory to ${result.data.path}`,
        data: { currentDirectory: result.data.path },
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: "Failed to change directory",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  private async handlePrintWorkingDirectory(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const session = this.getSession(context);
    const currentDir = session?.currentDirectory || "/";

    return {
      success: true,
      output: currentDir,
      timestamp: new Date(),
    };
  }

  private async handleReadFile(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    try {
      if (command.args.length === 0) {
        return {
          success: false,
          output: "cat: missing file argument",
          timestamp: new Date(),
        };
      }

      const filename = command.args[0]!;
      const serverId = this.getServerId(context);
      if (!serverId) {
        return {
          success: false,
          output: "No file system context available",
          timestamp: new Date(),
        };
      }

      const session = this.getSession(context);
      const currentDir = session?.currentDirectory || "/";
      let filePath = filename;
      if (!filePath.startsWith("/")) {
        filePath =
          currentDir === "/" ? `/${filePath}` : `${currentDir}/${filePath}`;
      }

      const result = await context.fileService.readFile(
        serverId,
        context.userId,
        filePath,
      );

      if (!result.success) {
        return {
          success: false,
          output: `cat: ${filename}: ${result.message}`,
          timestamp: new Date(),
        };
      }

      return {
        success: true,
        output: result.data?.content || "",
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: "Failed to read file",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  private async handleMakeDirectory(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    try {
      if (command.args.length === 0) {
        return {
          success: false,
          output: "mkdir: missing directory name",
          timestamp: new Date(),
        };
      }

      const dirName = command.args[0]!;
      const serverId = this.getServerId(context);
      if (!serverId) {
        return {
          success: false,
          output: "No file system context available",
          timestamp: new Date(),
        };
      }

      const session = this.getSession(context);
      const currentDir = session?.currentDirectory || "/";
      let dirPath = dirName;
      if (!dirPath.startsWith("/")) {
        dirPath =
          currentDir === "/" ? `/${dirPath}` : `${currentDir}/${dirPath}`;
      }

      const result = await context.fileService.createDirectory(
        serverId,
        context.userId,
        dirPath,
      );

      if (!result.success) {
        return {
          success: false,
          output: `mkdir: ${result.message}`,
          timestamp: new Date(),
        };
      }

      return {
        success: true,
        output: `Directory created: ${dirName}`,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: "Failed to create directory",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  private async handleCreateFile(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    try {
      if (command.args.length === 0) {
        return {
          success: false,
          output: "touch: missing file name",
          timestamp: new Date(),
        };
      }

      const fileName = command.args[0]!;
      const serverId = this.getServerId(context);
      if (!serverId) {
        return {
          success: false,
          output: "No file system context available",
          timestamp: new Date(),
        };
      }

      const session = this.getSession(context);
      const currentDir = session?.currentDirectory || "/";
      let filePath = fileName;
      if (!filePath.startsWith("/")) {
        filePath =
          currentDir === "/" ? `/${filePath}` : `${currentDir}/${filePath}`;
      }

      const result = await context.fileService.createFile(
        serverId,
        context.userId,
        filePath,
        "",
        false,
      );

      if (!result.success) {
        return {
          success: false,
          output: `touch: ${result.message}`,
          timestamp: new Date(),
        };
      }

      return {
        success: true,
        output: `File created: ${fileName}`,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: "Failed to create file",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  private async handleRemoveFile(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    try {
      if (command.args.length === 0) {
        return {
          success: false,
          output: "rm: missing file name",
          timestamp: new Date(),
        };
      }

      const fileName = command.args[0]!;
      const recursive = command.args.includes("-r") || command.args.includes("-R");
      const serverId = this.getServerId(context);
      if (!serverId) {
        return {
          success: false,
          output: "No file system context available",
          timestamp: new Date(),
        };
      }

      const session = this.getSession(context);
      const currentDir = session?.currentDirectory || "/";
      let filePath = fileName;
      if (!filePath.startsWith("/")) {
        filePath =
          currentDir === "/" ? `/${filePath}` : `${currentDir}/${filePath}`;
      }

      const result = await context.fileService.deleteNode(
        serverId,
        context.userId,
        filePath,
        recursive,
      );

      if (!result.success) {
        return {
          success: false,
          output: `rm: ${result.message}`,
          timestamp: new Date(),
        };
      }

      return {
        success: true,
        output: `Removed: ${fileName}`,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: "Failed to remove file",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  private async handleCopyFile(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    try {
      if (command.args.length < 2) {
        return {
          success: false,
          output: "cp: missing source or destination",
          timestamp: new Date(),
        };
      }

      const source = command.args[0]!;
      const dest = command.args[1]!;
      const serverId = this.getServerId(context);
      if (!serverId) {
        return {
          success: false,
          output: "No file system context available",
          timestamp: new Date(),
        };
      }

      const session = this.getSession(context);
      const currentDir = session?.currentDirectory || "/";
      
      let sourcePath = source;
      if (!sourcePath.startsWith("/")) {
        sourcePath =
          currentDir === "/" ? `/${sourcePath}` : `${currentDir}/${sourcePath}`;
      }

      let destPath = dest;
      if (!destPath.startsWith("/")) {
        destPath =
          currentDir === "/" ? `/${destPath}` : `${currentDir}/${destPath}`;
      }

      const result = await context.fileService.copyNode(
        serverId,
        context.userId,
        sourcePath,
        destPath,
      );

      if (!result.success) {
        return {
          success: false,
          output: `cp: ${result.message}`,
          timestamp: new Date(),
        };
      }

      return {
        success: true,
        output: `Copied ${source} to ${dest}`,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: "Failed to copy file",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  private async handleMoveFile(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    try {
      if (command.args.length < 2) {
        return {
          success: false,
          output: "mv: missing source or destination",
          timestamp: new Date(),
        };
      }

      const source = command.args[0]!;
      const dest = command.args[1]!;
      const serverId = this.getServerId(context);
      if (!serverId) {
        return {
          success: false,
          output: "No file system context available",
          timestamp: new Date(),
        };
      }

      const session = this.getSession(context);
      const currentDir = session?.currentDirectory || "/";
      
      let sourcePath = source;
      if (!sourcePath.startsWith("/")) {
        sourcePath =
          currentDir === "/" ? `/${sourcePath}` : `${currentDir}/${sourcePath}`;
      }

      let destPath = dest;
      if (!destPath.startsWith("/")) {
        destPath =
          currentDir === "/" ? `/${destPath}` : `${currentDir}/${destPath}`;
      }

      const result = await context.fileService.moveNode(
        serverId,
        context.userId,
        sourcePath,
        destPath,
      );

      if (!result.success) {
        return {
          success: false,
          output: `mv: ${result.message}`,
          timestamp: new Date(),
        };
      }

      return {
        success: true,
        output: `Moved ${source} to ${dest}`,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: "Failed to move file",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  private async handleEcho(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const fullCommand = command.rawInput || command.args.join(" ");

    // Check for output redirection (append first since >> contains >)
    const appendMatch = fullCommand.match(/echo\s+(.+?)\s+>>\s+(.+)/);
    const writeMatch = fullCommand.match(/echo\s+(.+?)\s+>\s+([^\>].+)/);

    if (appendMatch || writeMatch) {
      const content = (appendMatch ? appendMatch[1] : writeMatch![1])!.replace(/^["']|["']$/g, "");
      const filename = (appendMatch ? appendMatch[2] : writeMatch![2])!.trim();
      const append = !!appendMatch;

      const serverId = this.getServerId(context);
      if (!serverId) {
        return {
          success: false,
          output: "No file system context available for write operation",
          timestamp: new Date(),
        };
      }

      const session = this.getSession(context);
      const currentDir = session?.currentDirectory || "/";
      let filePath = filename;
      if (!filePath.startsWith("/")) {
        filePath =
          currentDir === "/" ? `/${filePath}` : `${currentDir}/${filePath}`;
      }

      // Use updateFileContent if file exists, or create if not
      // Actually updateFileContent handles both? No, I implemented it to check existence.
      // If it's a write (overwrite) or append, we need to handle creation if it doesn't exist.
      
      // Try to update first
      let result = await context.fileService.updateFileContent(
        serverId,
        context.userId,
        filePath,
        content,
        append
      );

      // If not found and we are writing (or appending to new file), create it
      if (!result.success && result.error === "NOT_FOUND") {
        result = await context.fileService.createFile(
          serverId,
          context.userId,
          filePath,
          content,
          false
        );
      }

      if (!result.success) {
        return {
          success: false,
          output: `echo: ${result.message}`,
          timestamp: new Date(),
        };
      }

      return {
        success: true,
        output: `Wrote to ${filename}`,
        timestamp: new Date(),
      };
    } else {
      // Just echo to stdout
      const text = command.args.join(" ").replace(/^["']|["']$/g, "");
      return {
        success: true,
        output: text,
        timestamp: new Date(),
      };
    }
  }

  private async handleWriteFile(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    if (command.args.length === 0) {
      return {
        success: false,
        output: "write: missing file name\nUsage: write <filename> <content>",
        timestamp: new Date(),
      };
    }

    if (command.args.length === 1) {
      return {
        success: false,
        output: "write: missing content\nUsage: write <filename> <content>",
        timestamp: new Date(),
      };
    }

    const filename = command.args[0]!;
    const content = command.args
      .slice(1)
      .join(" ")
      .replace(/^["']|["']$/g, "");

    const serverId = this.getServerId(context);
    if (!serverId) {
      return {
        success: false,
        output: "No file system context available",
        timestamp: new Date(),
      };
    }

    const session = this.getSession(context);
    const currentDir = session?.currentDirectory || "/";
    let filePath = filename;
    if (!filePath.startsWith("/")) {
      filePath =
        currentDir === "/" ? `/${filePath}` : `${currentDir}/${filePath}`;
    }

    // Try to update (overwrite)
    let result = await context.fileService.updateFileContent(
      serverId,
      context.userId,
      filePath,
      content,
      false // overwrite
    );

    // If not found, create
    if (!result.success && result.error === "NOT_FOUND") {
      result = await context.fileService.createFile(
        serverId,
        context.userId,
        filePath,
        content,
        false
      );
    }

    if (!result.success) {
      return {
        success: false,
        output: `write: ${result.message}`,
        timestamp: new Date(),
      };
    }

    return {
      success: true,
      output: [
        `Writing to ${filename}...`,
        `Content: ${content}`,
        `✓ File written successfully`,
      ],
      data: { filename, content, bytes: content.length },
      timestamp: new Date(),
    };
  }
}
