/**
 * Terminal Utilities - Formatting, timing, and helper functions for terminal operations
 * Extracted from terminalFeatures.ts for better separation of concerns
 */

export interface RedirectTarget {
  type: "file" | "append" | "null";
  target: string;
}

export class TerminalUtils {
  /**
   * Command timing utility
   */
  static timeCommand<T>(fn: () => T): { result: T; time: number } {
    const start = performance.now();
    const result = fn();
    const end = performance.now();
    return { result, time: end - start };
  }

  /**
   * Format data as a table
   */
  static formatTable(data: Array<Array<string>>, headers?: string[]): string {
    if (data.length === 0) return "";

    const allRows = headers ? [headers, ...data] : data;
    const columnWidths = allRows[0].map((_, colIndex) =>
      Math.max(...allRows.map((row) => (row[colIndex] || "").length))
    );

    return allRows
      .map((row) =>
        row
          .map((cell, index) => (cell || "").padEnd(columnWidths[index]))
          .join(" ")
      )
      .join("\n");
  }

  /**
   * Format items in columns (like ls output)
   */
  static formatColumns(items: string[], terminalWidth: number = 80): string {
    if (items.length === 0) return "";

    const maxLength = Math.max(...items.map((item) => item.length));
    const columnWidth = maxLength + 2;
    const columns = Math.floor(terminalWidth / columnWidth) || 1;

    const result: string[] = [];
    for (let i = 0; i < items.length; i += columns) {
      const row = items
        .slice(i, i + columns)
        .map((item) => item.padEnd(columnWidth))
        .join("")
        .trimEnd();
      result.push(row);
    }

    return result.join("\n");
  }

  /**
   * Paginate output (like less/more command)
   */
  static paginateOutput(
    content: string,
    pageSize: number = 20,
    currentPage: number = 0
  ): { content: string; hasMore: boolean; totalPages: number } {
    const lines = content.split("\n");
    const totalPages = Math.ceil(lines.length / pageSize);
    const startIndex = currentPage * pageSize;
    const endIndex = startIndex + pageSize;

    const pageContent = lines.slice(startIndex, endIndex).join("\n");
    const hasMore = endIndex < lines.length;

    return {
      content: pageContent,
      hasMore,
      totalPages
    };
  }

  /**
   * Expand glob patterns in file paths
   */
  static expandGlobs(pattern: string, files: string[]): string[] {
    const regex = this.globToRegex(pattern);
    return files.filter(file => regex.test(file));
  }

  /**
   * Convert glob pattern to regex
   */
  private static globToRegex(pattern: string): RegExp {
    const regexPattern = pattern
      .replace(/\./g, "\\.")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    return new RegExp(`^${regexPattern}$`);
  }

  /**
   * Expand environment variables in a string
   */
  static expandVariables(input: string, environment: Record<string, string>): string {
    return input.replace(/\$(\w+)/g, (match, varName) => {
      return environment[varName] || match;
    });
  }

  /**
   * Parse command line arguments with proper quote handling
   */
  static parseArguments(input: string): string[] {
    const args: string[] = [];
    let current = "";
    let inQuotes = false;
    let quoteChar = "";

    for (let i = 0; i < input.length; i++) {
      const char = input[i];

      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else if (char === quoteChar && inQuotes) {
        inQuotes = false;
        quoteChar = "";
      } else if (char === " " && !inQuotes) {
        if (current) {
          args.push(current);
          current = "";
        }
      } else {
        current += char;
      }
    }

    if (current) {
      args.push(current);
    }

    return args;
  }

  /**
   * Format file permissions (like ls -l)
   */
  static formatPermissions(permissions: number): string {
    const owner = (permissions >> 6) & 7;
    const group = (permissions >> 3) & 7;
    const other = permissions & 7;

    const formatTriple = (perm: number): string => {
      return [
        perm & 4 ? "r" : "-",
        perm & 2 ? "w" : "-",
        perm & 1 ? "x" : "-"
      ].join("");
    };

    return formatTriple(owner) + formatTriple(group) + formatTriple(other);
  }

  /**
   * Format file size in human readable format
   */
  static formatFileSize(bytes: number): string {
    const sizes = ["B", "K", "M", "G", "T"];
    let size = bytes;
    let unit = 0;

    while (size >= 1024 && unit < sizes.length - 1) {
      size /= 1024;
      unit++;
    }

    return `${Math.round(size * 10) / 10}${sizes[unit]}`;
  }

  /**
   * Format date for ls command
   */
  static formatDate(date: Date): string {
    const now = new Date();
    const isThisYear = date.getFullYear() === now.getFullYear();

    const month = date.toLocaleDateString("en", { month: "short" });
    const day = date.getDate().toString().padStart(2, " ");

    if (isThisYear) {
      const time = date.toTimeString().slice(0, 5);
      return `${month} ${day} ${time}`;
    } else {
      const year = date.getFullYear();
      return `${month} ${day}  ${year}`;
    }
  }

  /**
   * Escape string for shell usage
   */
  static escapeShell(str: string): string {
    return str.replace(/[|&;$`\\"\s]/g, "\\$&");
  }

  /**
   * Color terminal output
   */
  static colorText(text: string, color: string): string {
    const colors: Record<string, string> = {
      red: "\x1b[31m",
      green: "\x1b[32m",
      yellow: "\x1b[33m",
      blue: "\x1b[34m",
      magenta: "\x1b[35m",
      cyan: "\x1b[36m",
      white: "\x1b[37m",
      gray: "\x1b[90m",
      reset: "\x1b[0m"
    };

    const colorCode = colors[color.toLowerCase()];
    if (!colorCode) return text;

    return `${colorCode}${text}${colors.reset}`;
  }

  /**
   * Create progress bar
   */
  static createProgressBar(progress: number, width: number = 20): string {
    const filled = Math.round(progress * width);
    const empty = width - filled;

    return `[${"=".repeat(filled)}${" ".repeat(empty)}] ${Math.round(progress * 100)}%`;
  }

  /**
   * Truncate text to fit terminal width
   */
  static truncateText(text: string, maxWidth: number, ellipsis: string = "..."): string {
    if (text.length <= maxWidth) return text;
    return text.slice(0, maxWidth - ellipsis.length) + ellipsis;
  }
}

/**
 * Buffer for storing command output with size limits
 */
export class OutputBuffer {
  private buffer: string[] = [];
  private maxLines: number;

  constructor(maxLines: number = 1000) {
    this.maxLines = maxLines;
  }

  add(line: string): void {
    this.buffer.push(line);
    if (this.buffer.length > this.maxLines) {
      this.buffer.shift();
    }
  }

  getLines(start?: number, count?: number): string[] {
    if (start === undefined) return [...this.buffer];

    const startIndex = Math.max(0, start);
    const endIndex = count ? startIndex + count : undefined;

    return this.buffer.slice(startIndex, endIndex);
  }

  search(pattern: string, caseSensitive: boolean = false): number[] {
    const regex = new RegExp(
      pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      caseSensitive ? "g" : "gi"
    );

    const matches: number[] = [];
    this.buffer.forEach((line, index) => {
      if (regex.test(line)) {
        matches.push(index);
      }
    });

    return matches;
  }

  clear(): void {
    this.buffer = [];
  }

  getSize(): number {
    return this.buffer.length;
  }
}
