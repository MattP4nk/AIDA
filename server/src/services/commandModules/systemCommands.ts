import { Command, CommandResult } from "../../../../shared/types";
import { parseArgs, hasFlag } from "../../../../shared/shell";
import { CommandModule, CommandContext } from "./interface";
import { table, render, columns, Column } from "./asciiBox";
import {
  resolvePath,
  getSession,
  getServerId,
  successResult,
  errorResult,
} from "./helpers";
import { VAULT_PAYLOAD_FILENAME, AIDA_FILE_PREFIX } from "../../config/gameBalance";
import { redactSensitiveContent } from "../../utils/contentRedaction";

export class SystemCommandsModule implements CommandModule {
  public category = "system";
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
    const session = getSession(context);
    if (!session) {
      return errorResult("No active session");
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
          return errorResult(`System command not implemented: ${command.command}`);
      }
    } catch (error) {
      return errorResult("System command failed", error instanceof Error ? error.message : "Unknown error");
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
        examples: [
          "echo hello",
          "echo 'test' > file.txt",
          "echo 'more' >> file.txt",
        ],
      },
      {
        command: "write",
        category: "system",
        description: "Write content to a file",
        usage: "write <filename> <content>",
        examples: [
          "write notes.txt This is my note",
          "write /tmp/data.txt Important information",
        ],
      },
    ];
  }

  // getSession() and getServerId() now imported from helpers.ts

  private async handleListDirectory(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    try {
      const serverId = getServerId(context);
      if (!serverId) {
        return errorResult("No file system context available");
      }

      const session = getSession(context);
      const currentDir = session?.currentDirectory || "/";

      // Flags must be separated from positionals BEFORE resolving the path.
      // Previously `args[0]` was taken as the path unconditionally, so `ls -l`
      // resolved "/-l" and failed with "Directory not found" — only a bare `ls`
      // ever worked. (Plan item G8.)
      const parsed = parseArgs(command.args);
      const path = resolvePath(parsed.positionals[0] || currentDir, currentDir);

      const showHidden = hasFlag(parsed, "a", "all");
      const gameSession = context.gameStateManager.getSession(context.userId);
      const revealedFileIds = (gameSession as any)?.revealedFileIds as string[] || [];
      const result = await context.fileService.listDirectory(
        serverId,
        context.userId,
        path,
        showHidden,
        revealedFileIds,
      );

      if (!result.success) {
        return errorResult(`ls: ${result.message}`);
      }

      // Format output
      const entries = result.data?.entries || [];
      let output = "";

      if (hasFlag(parsed, "l", "long")) {
        // Long format — table with box-drawing borders
        const columns: Column[] = [
          { header: "TYPE", width: 4 },
          { header: "PERMS", width: 9 },
          { header: "SIZE", width: 10, align: "right" },
          { header: "DATE", width: 20 },
          { header: "NAME", width: 30 },
        ];
        const rows = entries.map((entry: any) => {
          let name = entry.name;
          if (entry.type === "directory") {
            const count = entry.childCount ?? 0;
            name = `${entry.name}/ (${count})`;
          }
          if (entry.isEncrypted) name += " [ENC]";
          if (entry.isProtected) name += " [PROT]";
          return [
            entry.type === "directory" ? "d" : "-",
            entry.permissions || "rwxr-xr-x",
            entry.type === "directory" ? `${entry.childCount ?? 0} items` : entry.size.toString(),
            new Date(entry.modified).toLocaleString(),
            name,
          ];
        });
        output = render(table(columns, rows, undefined, context.terminalWidth));
      } else {
        // Short format — dense, multi-column, like a real `ls`. Suffix markers
        // follow `ls -F` convention so they cost one character instead of a
        // bracketed tag that would inflate every column. (N7.)
        const items = entries.map((entry: any) => {
          let suffix = "";
          if (entry.type === "directory") suffix += "/";
          if (entry.isEncrypted) suffix += "*";
          if (entry.isProtected) suffix += "+";
          return `${entry.name}${suffix}`;
        });

        const lines: string[] = [];
        // The prompt already shows the cwd, so only name the path when the
        // player asked for a different one.
        if (parsed.positionals[0]) lines.push(`${path}:`);
        lines.push(...columns(items, context.terminalWidth || undefined));
        output = lines.join("\n");
      }

      // Summary line, plus a legend only when a marker actually appears.
      const dirCount = entries.filter((e: any) => e.type === "directory").length;
      const fileCount = entries.filter((e: any) => e.type === "file").length;
      if (entries.length > 0) {
        const legend: string[] = [];
        if (entries.some((e: any) => e.isEncrypted)) legend.push("* encrypted");
        if (entries.some((e: any) => e.isProtected)) legend.push("+ protected");
        const legendText = legend.length > 0 ? `  (${legend.join(", ")})` : "";
        output += `\n\n${dirCount} director${dirCount !== 1 ? "ies" : "y"}, ${fileCount} file${fileCount !== 1 ? "s" : ""}${legendText}`;
      } else {
        output = output || "(empty)";
      }

      return successResult(output);
    } catch (error) {
      return errorResult("Failed to list directory", error instanceof Error ? error.message : "Unknown error");
    }
  }

  private async handleChangeDirectory(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    try {
      const serverId = getServerId(context);
      if (!serverId) {
        return errorResult("No file system context available");
      }

      const session = getSession(context);
      const currentDir = session?.currentDirectory || "/";
      const parsed = parseArgs(command.args);

      // Bare `cd` goes home, like every shell on earth — not to `/`. (N5.)
      let targetDir = parsed.positionals[0] ?? "~";

      if (targetDir === "-") {
        // `cd -` returns to the previous directory. (N9.)
        const prev = session?.previousDirectory;
        if (!prev) return errorResult("cd: no previous directory");
        targetDir = prev;
      } else if (targetDir === "~" || targetDir.startsWith("~/")) {
        // `~` means the player's home directory ON THEIR OWN HOME SERVER. On a
        // remote box you have no account, so it has no meaning there — refusing
        // is both correct shell behaviour and good fiction.
        //
        // Previously this expanded to `/home/${session.userId}` (a cuid) while
        // real home dirs are `/home/{username}`, so `cd ~` could never resolve.
        // A third, conflicting expansion (`~` → `/`) also lives in
        // helpers.resolvePath. (N3/N4.)
        const isHomeServer =
          !!session?.homeServerId && serverId === session.homeServerId;
        if (!isHomeServer) {
          return errorResult("cd: no home directory on this host");
        }
        const user = await context.db.client.user.findUnique({
          where: { id: context.userId },
          select: { username: true },
        });
        if (!user?.username) {
          return errorResult("cd: could not resolve home directory");
        }
        const homeDir = `/home/${user.username}`;
        targetDir = targetDir === "~" ? homeDir : homeDir + targetDir.slice(1);
      }

      // Resolve relative path and sanitize
      targetDir = resolvePath(targetDir, currentDir);

      // Cheap stat instead of a full listing. Validating with listDirectory
      // cost one query per file in the target directory, so entering a large
      // directory was slow in proportion to how interesting it was. (N2.)
      const result = await context.fileService.statPath(
        serverId,
        context.userId,
        targetDir,
      );

      if (!result.success) {
        return errorResult(`cd: ${result.message}`);
      }

      if (!result.data.isDirectory) {
        return errorResult(`cd: not a directory: ${targetDir}`);
      }

      // Update session, remembering where we came from for `cd -`.
      if (session) {
        session.previousDirectory = session.currentDirectory;
        session.currentDirectory = result.data.path; // resolved path from service
      }

      // Silent on success. Real shells print nothing, and with the typewriter
      // effect every navigation was costing a line of scrollback and a beat of
      // time. The prompt already shows the cwd, so the confirmation was pure
      // noise. (N6.) The path still rides along in `data` for the client.
      return successResult("", { currentDirectory: result.data.path });
    } catch (error) {
      return errorResult("Failed to change directory", error instanceof Error ? error.message : "Unknown error");
    }
  }

  private async handlePrintWorkingDirectory(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const session = getSession(context);
    const currentDir = session?.currentDirectory || "/";

    return successResult(currentDir);
  }

  private async handleReadFile(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    try {
      if (command.args.length === 0) {
        return errorResult("cat: missing file argument");
      }

      const filename = command.args[0]!;
      const serverId = getServerId(context);
      if (!serverId) {
        return errorResult("No file system context available");
      }

      const session = getSession(context);
      const currentDir = session?.currentDirectory || "/";
      const filePath = resolvePath(filename, currentDir);

      const result = await context.fileService.readFile(
        serverId,
        context.userId,
        filePath,
      );

      if (!result.success) {
        return errorResult(`cat: ${filename}: ${result.message}`);
      }

      let output = result.data?.content || "";

      // ── Content redaction: garble AIDA mentions, emails, classified terms ──
      // Skip redaction on the player's home server (downloaded/decrypted copies are clean)
      {
      const currentSession = getSession(context);
      const isHomeServer = serverId === currentSession?.homeServerId;

      if (!isHomeServer) {
        // Get player's crypto skill for partial reveals
        let cryptoSkill = 0;
        try {
          const progress = await context.db.client.playerProgress.findUnique({
            where: { userId: context.userId },
            select: { cryptography: true },
          });
          cryptoSkill = progress?.cryptography ?? 0;
        } catch { /* non-critical */ }

        output = redactSensitiveContent(output, {
          skipRedaction: false,
          cryptoSkill,
        });
      }
      } // end redaction block

      // DarkNet vault conquest: reading vault payload triggers reward
      if (filename === VAULT_PAYLOAD_FILENAME) {
        try {
          const dungeonService = context.services.darknetDungeonService;
          if (!dungeonService) throw new Error("not available");
          const conquest = await dungeonService.conquerVault(
            context.userId,
            serverId,
          );
          if (conquest.conquered && conquest.reward) {
            const rewardLines = [
              "",
              "╔══════════════════════════════════════════╗",
              "║        ⚡ VAULT CONQUERED ⚡             ║",
              "╠══════════════════════════════════════════╣",
              `║  Reward: ${String(conquest.reward.type).replace(/_/g, " ").toUpperCase().padEnd(30)}║`,
              "║                                          ║",
              "║  The signal shifts. This network will    ║",
              "║  collapse. A new path will emerge...     ║",
              "║                                          ║",
              "║           — The Architect                ║",
              "╚══════════════════════════════════════════╝",
            ];
            output += "\n" + rewardLines.join("\n");
          }
        } catch {
          /* DarkNet dungeon service not available */
        }
      }

      // DarkNet discovery: reading AIDA-related files triggers discovery check
      if (filename.startsWith(AIDA_FILE_PREFIX) || filename.endsWith(AIDA_FILE_PREFIX)) {
        try {
          const darknetService = context.services.darknetDiscoveryService;
          if (!darknetService) throw new Error("not available");
          const discovered = await darknetService.checkDiscoveryTrigger(
            context.userId,
            {
              type: "hidden_file",
              metadata: { filename, serverId },
            },
          );
          if (discovered) {
            output +=
              "\n\n[SYSTEM] Something shifted in the network. A new faction has appeared in your faction list...";
          }
        } catch {
          /* DarkNet service not available */
        }
      }

      // Key fragment discovery: check if this server contains a fragment
      try {
        const keyFragmentService = context.services.keyFragmentService;
        if (!keyFragmentService) throw new Error("not available");
        const fragmentResult = await keyFragmentService.checkServerFragment(
          context.userId,
          serverId,
        );
        if (fragmentResult.claimed && fragmentResult.fragment) {
          const frag = fragmentResult.fragment;
          output +=
            "\n\n" +
            "╔══════════════════════════════════════════╗\n" +
            "║       ◆ FRAGMENT CLAIMED ◆              ║\n" +
            "╠══════════════════════════════════════════╣\n" +
            `║  ${String(frag.name).padEnd(38)}║\n` +
            `║  Type: ${String(frag.keyType).toUpperCase().padEnd(33)}║\n` +
            "║                                          ║\n" +
            "║  You now hold this piece of AIDA.        ║\n" +
            "║  Use 'fragments' to view your holdings.  ║\n" +
            "╚══════════════════════════════════════════╝";
        } else if (!fragmentResult.claimed && fragmentResult.currentHolder) {
          output +=
            "\n\n[INTEL] This server contains an AIDA fragment, but it is already held by " +
            fragmentResult.currentHolder +
            ". Hack their home server to steal it, or negotiate a trade.";
        }
      } catch {
        /* Key fragment service not available */
      }

      // Access key hint: tell the player this file contains credentials
      try {
        const keyServers = await context.fileService.scanForAccessKeys(
          result.data?.content || "",
          serverId,
        );
        if (keyServers.length > 0) {
          const serverList = keyServers.join(", ");
          output +=
            "\n\n" +
            "┌──────────────────────────────────────────┐\n" +
            "│  [!] CREDENTIALS DETECTED                │\n" +
            "│                                          │\n" +
            `│  This file contains access keys for:     │\n` +
            `│    ${serverList.padEnd(38)}│\n` +
            "│                                          │\n" +
            "│  Use 'download " + filename.split("/").pop()?.padEnd(25, " ") + "' │\n" +
            "│  to save and unlock access.              │\n" +
            "└──────────────────────────────────────────┘";
        }
      } catch {
        /* Access key scan not available */
      }

      // Apply censorship filtering to file content on faction-owned servers
      try {
        const { getService } = await import("../../di/container");
        const censorshipService =
          getService<import("../censorshipService").default>(
            "CensorshipService",
          );
        output = await censorshipService.filterAndAlert(output, {
          userId: context.userId,
          serverId,
        });
      } catch {
        /* Censorship service not available */
      }

      return successResult(output);
    } catch (error) {
      return errorResult("Failed to read file", error instanceof Error ? error.message : "Unknown error");
    }
  }

  private async handleMakeDirectory(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    try {
      if (command.args.length === 0) {
        return errorResult("mkdir: missing directory name");
      }

      const dirName = command.args[0]!;
      const serverId = getServerId(context);
      if (!serverId) {
        return errorResult("No file system context available");
      }

      const session = getSession(context);
      const currentDir = session?.currentDirectory || "/";
      const dirPath = resolvePath(dirName, currentDir);

      const result = await context.fileService.createDirectory(
        serverId,
        context.userId,
        dirPath,
      );

      if (!result.success) {
        return errorResult(`mkdir: ${result.message}`);
      }

      return successResult(`Directory created: ${dirName}`);
    } catch (error) {
      return errorResult("Failed to create directory", error instanceof Error ? error.message : "Unknown error");
    }
  }

  private async handleCreateFile(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    try {
      if (command.args.length === 0) {
        return errorResult("touch: missing file name");
      }

      const fileName = command.args[0]!;
      const serverId = getServerId(context);
      if (!serverId) {
        return errorResult("No file system context available");
      }

      const session = getSession(context);
      const currentDir = session?.currentDirectory || "/";
      const filePath = resolvePath(fileName, currentDir);

      const result = await context.fileService.createFile(
        serverId,
        context.userId,
        filePath,
        "",
        false,
      );

      if (!result.success) {
        return errorResult(`touch: ${result.message}`);
      }

      return successResult(`File created: ${fileName}`);
    } catch (error) {
      return errorResult("Failed to create file", error instanceof Error ? error.message : "Unknown error");
    }
  }

  private async handleRemoveFile(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    try {
      // Flags separated before the path — `rm -r dir` previously took "-r" as
      // the filename. (G8.)
      const parsed = parseArgs(command.args);
      const fileName = parsed.positionals[0];
      if (!fileName) {
        return errorResult("rm: missing file name");
      }

      const recursive = hasFlag(parsed, "r", "R", "recursive");
      const serverId = getServerId(context);
      if (!serverId) {
        return errorResult("No file system context available");
      }

      const session = getSession(context);
      const currentDir = session?.currentDirectory || "/";
      const filePath = resolvePath(fileName, currentDir);

      const result = await context.fileService.deleteNode(
        serverId,
        context.userId,
        filePath,
        recursive,
      );

      if (!result.success) {
        return errorResult(`rm: ${result.message}`);
      }

      return successResult(`Removed: ${fileName}`);
    } catch (error) {
      return errorResult("Failed to remove file", error instanceof Error ? error.message : "Unknown error");
    }
  }

  private async handleCopyFile(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    try {
      // `cp -r a b` previously took "-r" as the source. (G8.)
      const parsed = parseArgs(command.args);
      const source = parsed.positionals[0];
      const dest = parsed.positionals[1];
      if (!source || !dest) {
        return errorResult("cp: missing source or destination");
      }
      const serverId = getServerId(context);
      if (!serverId) {
        return errorResult("No file system context available");
      }

      const session = getSession(context);
      const currentDir = session?.currentDirectory || "/";
      const sourcePath = resolvePath(source, currentDir);
      const destPath = resolvePath(dest, currentDir);

      const result = await context.fileService.copyNode(
        serverId,
        context.userId,
        sourcePath,
        destPath,
      );

      if (!result.success) {
        return errorResult(`cp: ${result.message}`);
      }

      return successResult(`Copied ${source} to ${dest}`);
    } catch (error) {
      return errorResult("Failed to copy file", error instanceof Error ? error.message : "Unknown error");
    }
  }

  private async handleMoveFile(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    try {
      // `mv -f a b` previously took "-f" as the source. (G8.)
      const parsed = parseArgs(command.args);
      const source = parsed.positionals[0];
      const dest = parsed.positionals[1];
      if (!source || !dest) {
        return errorResult("mv: missing source or destination");
      }
      const serverId = getServerId(context);
      if (!serverId) {
        return errorResult("No file system context available");
      }

      const session = getSession(context);
      const currentDir = session?.currentDirectory || "/";
      const sourcePath = resolvePath(source, currentDir);
      const destPath = resolvePath(dest, currentDir);

      const result = await context.fileService.moveNode(
        serverId,
        context.userId,
        sourcePath,
        destPath,
      );

      if (!result.success) {
        return errorResult(`mv: ${result.message}`);
      }

      return successResult(`Moved ${source} to ${dest}`);
    } catch (error) {
      return errorResult("Failed to move file", error instanceof Error ? error.message : "Unknown error");
    }
  }

  private async handleEcho(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const fullCommand = command.rawInput || command.args.join(" ");

    // Check for output redirection (append first since >> contains >)
    const appendMatch = fullCommand.match(/echo\s+(.+?)\s+>>\s+(.+)/);
    const writeMatch = fullCommand.match(/echo\s+(.+?)\s+>\s+([^>].+)/);

    if (appendMatch || writeMatch) {
      const content = (appendMatch ? appendMatch[1] : writeMatch![1])!.replace(
        /^["']|["']$/g,
        "",
      );
      const filename = (appendMatch ? appendMatch[2] : writeMatch![2])!.trim();
      const append = !!appendMatch;

      const serverId = getServerId(context);
      if (!serverId) {
        return errorResult("No file system context available for write operation");
      }

      const session = getSession(context);
      const currentDir = session?.currentDirectory || "/";
      const filePath = resolvePath(filename, currentDir);

      // Use updateFileContent if file exists, or create if not
      // Actually updateFileContent handles both? No, I implemented it to check existence.
      // If it's a write (overwrite) or append, we need to handle creation if it doesn't exist.

      // Try to update first
      let result = await context.fileService.updateFileContent(
        serverId,
        context.userId,
        filePath,
        content,
        append,
      );

      // If not found and we are writing (or appending to new file), create it
      if (!result.success && result.error === "NOT_FOUND") {
        result = await context.fileService.createFile(
          serverId,
          context.userId,
          filePath,
          content,
          false,
        );
      }

      if (!result.success) {
        return errorResult(`echo: ${result.message}`);
      }

      return successResult(`Wrote to ${filename}`);
    } else {
      // Just echo to stdout
      const text = command.args.join(" ").replace(/^["']|["']$/g, "");
      return successResult(text);
    }
  }

  private async handleWriteFile(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    if (command.args.length === 0) {
      return errorResult("write: missing file name\nUsage: write <filename> <content>");
    }

    if (command.args.length === 1) {
      return errorResult("write: missing content\nUsage: write <filename> <content>");
    }

    const filename = command.args[0]!;
    const content = command.args
      .slice(1)
      .join(" ")
      .replace(/^["']|["']$/g, "");

    const serverId = getServerId(context);
    if (!serverId) {
      return errorResult("No file system context available");
    }

    const session = getSession(context);
    const currentDir = session?.currentDirectory || "/";
    const filePath = resolvePath(filename, currentDir);

    // Try to update (overwrite)
    let result = await context.fileService.updateFileContent(
      serverId,
      context.userId,
      filePath,
      content,
      false, // overwrite
    );

    // If not found, create
    if (!result.success && result.error === "NOT_FOUND") {
      result = await context.fileService.createFile(
        serverId,
        context.userId,
        filePath,
        content,
        false,
      );
    }

    if (!result.success) {
      return errorResult(`write: ${result.message}`);
    }

    return successResult([
      `Writing to ${filename}...`,
      `Content: ${content}`,
      `✓ File written successfully`,
    ], { filename, content, bytes: content.length });
  }
}
