import { Router, Request, Response } from "express";
import { authenticateToken } from "../middleware/auth";
import { asyncHandler } from "../middleware/setup";
import { getService } from "../di/container";
import { COMMAND_PROCESSOR } from "../di/tokens";
import type CommandProcessor from "../services/commandProcessor";
import { GameError } from "../../../shared/types";
import {
  validateCommandExecution,
  handleValidationErrors,
} from "../middleware/validation";

const router = Router();

// All command routes require authentication
router.use(authenticateToken);

/**
 * POST /api/command/execute
 * Execute a terminal command
 *
 * THIS IS THE ONLY COMMAND ENDPOINT
 * The backend IS a console - all functionality goes through command execution
 *
 * Body: {
 *   command: string,      // Raw command string (e.g., "ls -la", "hack server1", "help")
 *   serverId?: string     // Optional: server context for command
 * }
 *
 * Returns: {
 *   success: boolean,
 *   output: string[],     // Lines of output to display in terminal
 *   exitCode: number,     // 0 = success, non-zero = error (Unix convention)
 *   data?: any,           // Optional: structured data for client processing
 *   timestamp: Date
 * }
 */
router.post(
  "/execute",
  validateCommandExecution(),
  handleValidationErrors,
  asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user?.id;
      if (!userId) throw new GameError("Authentication required", "AUTH_REQUIRED", 401);

      const commandProcessor = getService<CommandProcessor>(COMMAND_PROCESSOR);
      const { command, serverId, terminalCols } = req.body;

      // Parse command
      const parsed = commandProcessor.parseCommand(userId, command, serverId);

      if (!parsed.isValid) {
        res.json({
          success: false,
          output: [parsed.error || "Invalid command"],
          exitCode: 1,
          timestamp: new Date(),
        });
        return;
      }

      // Validate command (permissions, rate limiting, game state)
      const validation = await commandProcessor.validateCommand(
        userId,
        parsed,
        serverId,
      );

      if (!validation.valid) {
        res.json({
          success: false,
          output: [validation.error || "Command validation failed"],
          exitCode: 1,
          timestamp: new Date(),
        });
        return;
      }

      // Execute command
      const result = await commandProcessor.executeCommand(
        userId,
        parsed,
        serverId,
        undefined,
        terminalCols ? Number(terminalCols) : undefined,
      );

      // Determine exit code: use provided exitCode, or derive from success
      const exitCode =
        result.exitCode !== undefined
          ? result.exitCode
          : result.success
            ? 0
            : 1;

      // Normalize output to array format for terminal display
      const output = Array.isArray(result.output)
        ? result.output
        : result.output.split("\n");

      // Return result
      res.json({
        success: exitCode === 0,
        output: output,
        exitCode: exitCode,
        data: result.data, // Optional additional data for client
        openDialog: result.openDialog, // Optional dialog trigger for social features
        timestamp: new Date(),
      });
  }),
);

export default router;
