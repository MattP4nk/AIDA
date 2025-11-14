/**
 * Command History Management
 * Extracted from terminalFeatures.ts for better separation of concerns
 */

export class CommandHistory {
  private history: string[] = [];
  private maxSize: number;
  private currentIndex: number = -1;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
  }

  /**
   * Add a command to history
   */
  add(command: string): void {
    if (!command.trim() || command === this.history[this.history.length - 1]) {
      return;
    }

    this.history.push(command);
    if (this.history.length > this.maxSize) {
      this.history.shift();
    }
    this.currentIndex = -1;
  }

  /**
   * Get previous command in history
   */
  previous(): string | null {
    if (this.history.length === 0) return null;

    if (this.currentIndex === -1) {
      this.currentIndex = this.history.length - 1;
    } else if (this.currentIndex > 0) {
      this.currentIndex--;
    }

    return this.history[this.currentIndex] || null;
  }

  /**
   * Get next command in history
   */
  next(): string | null {
    if (this.currentIndex === -1 || this.currentIndex >= this.history.length - 1) {
      this.currentIndex = -1;
      return "";
    }

    this.currentIndex++;
    return this.history[this.currentIndex] || null;
  }

  /**
   * Search command history
   */
  search(pattern: string): string[] {
    const regex = new RegExp(pattern, "i");
    return this.history.filter(cmd => regex.test(cmd));
  }

  /**
   * Get all history entries
   */
  getAll(): string[] {
    return [...this.history];
  }

  /**
   * Clear command history
   */
  clear(): void {
    this.history = [];
    this.currentIndex = -1;
  }

  /**
   * Get history size
   */
  getSize(): number {
    return this.history.length;
  }

  /**
   * Get command at specific index
   */
  getAt(index: number): string | null {
    if (index < 0 || index >= this.history.length) {
      return null;
    }
    return this.history[index];
  }

  /**
   * Remove command at specific index
   */
  removeAt(index: number): boolean {
    if (index < 0 || index >= this.history.length) {
      return false;
    }
    this.history.splice(index, 1);
    this.currentIndex = -1;
    return true;
  }

  /**
   * Get recent commands (last n)
   */
  getRecent(count: number = 10): string[] {
    return this.history.slice(-count);
  }

  /**
   * Export history as string
   */
  export(): string {
    return this.history.join('\n');
  }

  /**
   * Import history from string
   */
  import(historyData: string): void {
    const commands = historyData.split('\n').filter(cmd => cmd.trim());
    this.history = commands.slice(-this.maxSize);
    this.currentIndex = -1;
  }
}

/**
 * Singleton instance for global command history
 */
export const globalCommandHistory = new CommandHistory();
