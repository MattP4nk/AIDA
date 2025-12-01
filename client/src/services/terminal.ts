/**
 * Terminal Service - Single Command Execution Interface
 *
 * This service provides a single entry point for executing commands
 * on the backend. The server is the console, the client is a dumb terminal.
 *
 * Architecture: Terminal-First
 * - All commands go through POST /api/command/execute
 * - No client-side command logic or handlers
 * - Server returns formatted output ready for display
 */

import { apiClient } from "./api";
import type { CommandResult } from "../../../shared/types";

// ==================== TYPES ====================

export interface CommandRequest {
  command: string;
  serverId?: string;
}

// ==================== TERMINAL SERVICE ====================

export class TerminalService {
  /**
   * Execute a command on the server
   *
   * @param command - The full command string (e.g., "help", "status", "hack 192.168.1.1")
   * @param serverId - Optional server ID for context-aware commands
   * @returns Promise<CommandResult> - The command execution result
   *
   * @example
   * ```typescript
   * const result = await terminal.executeCommand("help");
   * console.log(result.output); // Array of output lines
   * ```
   *
   * @example
   * ```typescript
   * const result = await terminal.executeCommand("hack 192.168.1.1");
   * if (result.success) {
   *   console.log("Hack succeeded!");
   * }
   * ```
   */
  async executeCommand(
    command: string,
    serverId?: string,
  ): Promise<CommandResult> {
    try {
      // Validate input
      if (!command || !command.trim()) {
        return {
          success: false,
          output: ["Error: Empty command"],
          exitCode: 1,
          timestamp: new Date(),
          error: "Empty command",
        };
      }

      // Prepare request
      const request: CommandRequest = {
        command: command.trim(),
      };

      if (serverId) {
        request.serverId = serverId;
      }

      // Execute command via API
      const response = await apiClient.executeCommand(
        request.command,
        request.serverId,
      );

      // The response is the CommandResult directly (not wrapped in ApiResponse)
      // But timestamp comes as string over JSON, so we need to handle it
      const rawResult = response as unknown as any;

      // Normalize output to array for consistent handling
      const normalizedOutput = this.normalizeOutput(rawResult.output);

      return {
        ...rawResult,
        output: normalizedOutput,
        timestamp: rawResult.timestamp
          ? new Date(rawResult.timestamp)
          : new Date(),
        exitCode: rawResult.exitCode ?? (rawResult.success ? 0 : 1),
      };
    } catch (error: any) {
      // Handle API errors
      const errorMessage = this.extractErrorMessage(error);

      return {
        success: false,
        output: ["Command execution failed", errorMessage],
        exitCode: error.status || 1,
        timestamp: new Date(),
        error: errorMessage,
      };
    }
  }

  /**
   * Normalize output to always be an array of strings
   * This makes rendering consistent in the terminal component
   */
  private normalizeOutput(output: string | string[]): string[] {
    if (Array.isArray(output)) {
      return output;
    }

    if (typeof output === "string") {
      // Split on newlines but preserve empty lines
      return output.split("\n");
    }

    // Fallback for unexpected types
    return [String(output)];
  }

  /**
   * Extract a user-friendly error message from various error types
   */
  private extractErrorMessage(error: any): string {
    // API Error with message
    if (error.message) {
      return error.message;
    }

    // API Error with details
    if (error.details?.error) {
      return error.details.error;
    }

    // HTTP status errors
    if (error.status) {
      switch (error.status) {
        case 401:
          return "Authentication required. Please login.";
        case 403:
          return "Permission denied.";
        case 404:
          return "Command or resource not found.";
        case 429:
          return "Rate limit exceeded. Please slow down.";
        case 500:
          return "Server error. Please try again later.";
        default:
          return `HTTP ${error.status}: ${error.statusText || "Unknown error"}`;
      }
    }

    // Network errors
    if (error.name === "NetworkError" || !navigator.onLine) {
      return "Network error. Check your connection.";
    }

    // Generic fallback
    return "An unexpected error occurred";
  }

  /**
   * Check if the user is authenticated
   * Commands require authentication to execute
   */
  isAuthenticated(): boolean {
    return apiClient.isAuthenticated();
  }

  /**
   * Get the current auth token (for debugging)
   */
  getToken(): string | null {
    return apiClient.getToken();
  }
}

// ==================== SINGLETON INSTANCE ====================

/**
 * Singleton instance of the terminal service
 * Use this throughout the application
 *
 * @example
 * ```typescript
 * import { terminalService } from './services/terminal';
 *
 * const result = await terminalService.executeCommand('help');
 * ```
 */
export const terminalService = new TerminalService();

// ==================== CONVENIENCE EXPORTS ====================

/**
 * Execute a command (convenience function)
 *
 * @example
 * ```typescript
 * import { executeCommand } from './services/terminal';
 *
 * const result = await executeCommand('status');
 * ```
 */
export async function executeCommand(
  command: string,
  serverId?: string,
): Promise<CommandResult> {
  return terminalService.executeCommand(command, serverId);
}

// Export types (CommandRequest is already exported above as interface)

// Default export
export default terminalService;
