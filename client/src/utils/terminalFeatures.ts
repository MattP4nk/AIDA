import { addOutput } from "../stores/gameState";
import { TerminalCommands } from "../commands/terminalCommands";
import { TerminalUtils } from "./terminalUtils";
import { globalCommandHistory } from "./commandHistory";

export interface ParsedCommand {
  command: string;
  args: string[];
  pipes: Array<{ command: string; args: string[] }>;
  redirect?: {
    type: "file" | "append" | "null";
    target: string;
  };
  background: boolean;
}

export class TerminalFeatures {
  private static historyIndex: number = -1;

  /**
   * Parse command line with pipes, redirects, and special operators
   */
  static parseCommandLine(input: string): ParsedCommand {
    const trimmed = input.trim();
    let command = trimmed;
    let background = false;
    let redirect: ParsedCommand["redirect"] | undefined;
    const pipes: Array<{ command: string; args: string[] }> = [];

    // Check for background execution
    if (command.endsWith(" &")) {
      background = true;
      command = command.slice(0, -2).trim();
    }

    // Check for output redirection
    const redirectMatch = command.match(
      /(.+?)\s*(>>?|2>&1|&>|>\s*\/dev\/null)\s*(.*)$/,
    );
    if (redirectMatch) {
      command = redirectMatch[1].trim();
      const operator = redirectMatch[2].trim();
      const target = redirectMatch[3].trim();

      if (operator === ">>" || operator === ">>>") {
        redirect = { type: "append", target };
      } else if (operator === ">" && target === "/dev/null") {
        redirect = { type: "null", target: "/dev/null" };
      } else {
        redirect = { type: "file", target };
      }
    }

    // Parse pipes
    const pipeSegments = command.split("|");
    if (pipeSegments.length > 1) {
      // First segment is the main command
      const mainParts = TerminalUtils.parseArguments(pipeSegments[0].trim());
      command = mainParts[0] || "";
      const args = mainParts.slice(1);

      // Remaining segments are pipe commands
      for (let i = 1; i < pipeSegments.length; i++) {
        const pipeParts = TerminalUtils.parseArguments(pipeSegments[i].trim());
        if (pipeParts.length > 0) {
          pipes.push({
            command: pipeParts[0],
            args: pipeParts.slice(1),
          });
        }
      }

      return {
        command,
        args,
        pipes,
        redirect,
        background,
      };
    }

    // No pipes, parse normally
    const parts = TerminalUtils.parseArguments(command);
    command = parts[0] || "";
    const args = parts.slice(1);

    return {
      command,
      args,
      pipes,
      redirect,
      background,
    };
  }

  /**
   * Execute piped commands
   */
  static async executePipedCommands(
    parsedCmd: ParsedCommand,
    commandRegistry: any,
    inputData?: string,
  ): Promise<string> {
    let currentOutput = inputData || "";

    // Execute main command if no input data provided
    if (!inputData) {
      const fullCommand = [parsedCmd.command, ...parsedCmd.args].join(" ");
      // This would need integration with the command registry
      // For now, we'll return the command as output for pipe processing
      currentOutput = fullCommand;
    }

    // Process pipe commands
    if (parsedCmd.pipes.length > 0) {
      currentOutput = await TerminalCommands.executePipedCommands(
        parsedCmd.pipes,
        currentOutput,
      );
    }

    return currentOutput;
  }

  /**
   * Capture command output for pipe processing
   */
  private static captureCommandOutput(command: string): string {
    // This would integrate with actual command execution
    // For now, return empty string
    return "";
  }

  /**
   * Get tab completion suggestions
   */
  static getTabCompletions(
    input: string,
    commands: string[],
    files: string[] = [],
  ): string[] {
    const parts = input.split(" ");
    const lastPart = parts[parts.length - 1];

    // If it's the first word, complete commands
    if (parts.length === 1) {
      return commands.filter((cmd) =>
        cmd.toLowerCase().startsWith(lastPart.toLowerCase()),
      );
    }

    // Otherwise, complete file names
    return files.filter((file) =>
      file.toLowerCase().startsWith(lastPart.toLowerCase()),
    );
  }

  /**
   * Expand glob patterns
   */
  static expandGlobs(pattern: string, files: string[]): string[] {
    return TerminalUtils.expandGlobs(pattern, files);
  }

  // Alias management
  private static aliases: Record<string, string> = {};

  static setAlias(name: string, command: string): void {
    this.aliases[name] = command;
  }

  static getAlias(name: string): string | undefined {
    return this.aliases[name];
  }

  static removeAlias(name: string): boolean {
    if (this.aliases[name] !== undefined) {
      delete this.aliases[name];
      return true;
    }
    return false;
  }

  static listAliases(): Record<string, string> {
    return { ...this.aliases };
  }

  // Environment variables
  private static environment: Record<string, string> = {
    HOME: "/home/user",
    PATH: "/bin:/usr/bin:/usr/local/bin",
    USER: "user",
    SHELL: "/bin/bash",
    PWD: "/home/user",
  };

  static setEnv(name: string, value: string): void {
    this.environment[name] = value;
  }

  static getEnv(name: string): string | undefined {
    return this.environment[name];
  }

  static expandVariables(input: string): string {
    return TerminalUtils.expandVariables(input, this.environment);
  }

  // Job control
  private static jobs: Array<{ id: number; command: string; status: string }> =
    [];
  private static nextJobId: number = 1;

  static addJob(command: string): number {
    const jobId = this.nextJobId++;
    this.jobs.push({ id: jobId, command, status: "running" });
    return jobId;
  }

  static getJobs(): Array<{ id: number; command: string; status: string }> {
    return [...this.jobs];
  }

  static completeJob(jobId: number): void {
    const job = this.jobs.find((j) => j.id === jobId);
    if (job) {
      job.status = "completed";
    }
  }

  // Command timing
  static timeCommand<T>(fn: () => T): { result: T; time: number } {
    return TerminalUtils.timeCommand(fn);
  }

  // Output formatting (delegated to utils)
  static formatTable(data: Array<Array<string>>, headers?: string[]): string {
    return TerminalUtils.formatTable(data, headers);
  }

  static formatColumns(items: string[], terminalWidth: number = 80): string {
    return TerminalUtils.formatColumns(items, terminalWidth);
  }

  // Pager simulation
  static paginateOutput(
    content: string,
    pageSize: number = 20,
    currentPage: number = 0,
  ): { content: string; hasMore: boolean; totalPages: number } {
    return TerminalUtils.paginateOutput(content, pageSize, currentPage);
  }

  // History management (delegated to history class)
  static addToHistory(command: string): void {
    globalCommandHistory.add(command);
  }

  static getPreviousCommand(): string | null {
    return globalCommandHistory.previous();
  }

  static getNextCommand(): string | null {
    return globalCommandHistory.next();
  }

  static searchHistory(pattern: string): string[] {
    return globalCommandHistory.search(pattern);
  }

  static getCommandHistory(): string[] {
    return globalCommandHistory.getAll();
  }

  static clearHistory(): void {
    globalCommandHistory.clear();
  }
}
