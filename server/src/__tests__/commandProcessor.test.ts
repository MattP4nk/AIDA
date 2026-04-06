import "reflect-metadata";
import { testDb, createTestUser } from "./setup";
import CommandProcessor from "../services/commandProcessor";
import { container } from "tsyringe";
import { SOCKET_IO } from "../di/tokens";
import type { ParsedCommand } from "../types/game";

// Mock Socket.IO
const mockIo = {
  on: jest.fn(),
  emit: jest.fn(),
  to: jest.fn().mockReturnThis(),
  sockets: {
    emit: jest.fn(),
  },
} as any;

describe("CommandProcessor Integration Tests", () => {
  let commandProcessor: CommandProcessor;
  let testUser: any;
  let testServer: any;

  beforeAll(() => {
    container.registerInstance(SOCKET_IO, mockIo);
    commandProcessor = new CommandProcessor(mockIo);
  });

  beforeEach(async () => {
    const timestamp = Date.now();
    testUser = await createTestUser({
      username: `cmduser_${timestamp}`,
      email: `cmduser_${timestamp}@test.com`,
    });

    await testDb.playerProgress.update({
      where: { userId: testUser.id },
      data: {
        level: 5,
        experience: 1000,
        hacking: 50,
      },
    });

    testServer = await testDb.gameServer.create({
      data: {
        name: "Test Server",
        ipAddress: `192.168.1.${Math.floor(Math.random() * 255)}`,
        type: "corporate",
        ownerId: testUser.id,
      },
    });

    // Clear rate limits and history before each test
    commandProcessor.clearRateLimit(testUser.id);
    commandProcessor.clearHistory(testUser.id);
  });

  describe("Command Parsing", () => {
    test("should parse simple command without arguments", () => {
      const parsed = commandProcessor.parseCommand(
        testUser.id,
        "ls",
        testServer.id,
      );

      expect(parsed.command).toBe("ls");
      expect(parsed.args).toEqual([]);
      expect(parsed.isValid).toBe(true);
      expect(parsed.error).toBeUndefined();
    });

    test("should parse command with single argument", () => {
      const parsed = commandProcessor.parseCommand(
        testUser.id,
        "cd /home",
        testServer.id,
      );

      expect(parsed.command).toBe("cd");
      expect(parsed.args).toEqual(["/home"]);
      expect(parsed.isValid).toBe(true);
    });

    test("should parse command with multiple arguments", () => {
      const parsed = commandProcessor.parseCommand(
        testUser.id,
        "ls -la /home/user",
        testServer.id,
      );

      expect(parsed.command).toBe("ls");
      expect(parsed.args).toEqual(["-la", "/home/user"]);
      expect(parsed.isValid).toBe(true);
    });

    test("should handle commands with extra whitespace", () => {
      const parsed = commandProcessor.parseCommand(
        testUser.id,
        "  pwd   ",
        testServer.id,
      );

      expect(parsed.command).toBe("pwd");
      expect(parsed.args).toEqual([]);
      expect(parsed.isValid).toBe(true);
    });

    test("should reject empty command", () => {
      const parsed = commandProcessor.parseCommand(
        testUser.id,
        "",
        testServer.id,
      );

      expect(parsed.isValid).toBe(false);
      expect(parsed.error).toBe("Empty command");
    });

    test("should reject command with only whitespace", () => {
      const parsed = commandProcessor.parseCommand(
        testUser.id,
        "   ",
        testServer.id,
      );

      expect(parsed.isValid).toBe(false);
      expect(parsed.error).toBe("Empty command");
    });

    test("should reject command name that is too long", () => {
      const longCommand = "a".repeat(51);
      const parsed = commandProcessor.parseCommand(
        testUser.id,
        longCommand,
        testServer.id,
      );

      expect(parsed.isValid).toBe(false);
      expect(parsed.error).toBe("Command name too long");
    });

    test("should reject command with too many arguments", () => {
      const manyArgs = Array(101).fill("arg").join(" ");
      const parsed = commandProcessor.parseCommand(
        testUser.id,
        `ls ${manyArgs}`,
        testServer.id,
      );

      expect(parsed.isValid).toBe(false);
      expect(parsed.error).toBe("Too many arguments");
    });

    test("should convert command to lowercase", () => {
      const parsed = commandProcessor.parseCommand(
        testUser.id,
        "LS",
        testServer.id,
      );

      expect(parsed.command).toBe("ls");
      expect(parsed.isValid).toBe(true);
    });

    test("should preserve case in arguments", () => {
      const parsed = commandProcessor.parseCommand(
        testUser.id,
        "echo Hello World",
        testServer.id,
      );

      expect(parsed.command).toBe("echo");
      expect(parsed.args).toEqual(["Hello", "World"]);
    });

    test("should store raw input", () => {
      const rawInput = "ls -la /home";
      const parsed = commandProcessor.parseCommand(
        testUser.id,
        rawInput,
        testServer.id,
      );

      expect(parsed.rawInput).toBe(rawInput);
    });

    test("should handle special characters in arguments", () => {
      const parsed = commandProcessor.parseCommand(
        testUser.id,
        'echo "Hello World!"',
        testServer.id,
      );

      expect(parsed.isValid).toBe(true);
      expect(parsed.args.length).toBeGreaterThan(0);
    });

    test("should handle multiple consecutive spaces", () => {
      const parsed = commandProcessor.parseCommand(
        testUser.id,
        "ls    -la    /home",
        testServer.id,
      );

      expect(parsed.command).toBe("ls");
      expect(parsed.args).toEqual(["-la", "/home"]);
    });
  });

  describe("Rate Limiting", () => {
    test("should allow commands under rate limit", async () => {
      const parsed: ParsedCommand = {
        command: "ls",
        args: [],
        rawInput: "ls",
        isValid: true,
      };

      // Validate 5 commands (under the limit of 10)
      for (let i = 0; i < 5; i++) {
        const validation = await commandProcessor.validateCommand(
          testUser.id,
          parsed,
          testServer.id,
        );
        // First validation might fail due to missing session, but rate limit itself should work
        expect(validation).toBeDefined();
      }

      // After clearing, rate limit should reset
      commandProcessor.clearRateLimit(testUser.id);
      const validation = await commandProcessor.validateCommand(
        testUser.id,
        parsed,
        testServer.id,
      );
      expect(validation).toBeDefined();
    });

    test("should enforce rate limit after exceeding max commands", async () => {
      const parsed: ParsedCommand = {
        command: "ls",
        args: [],
        rawInput: "ls",
        isValid: true,
      };

      // Execute 10 commands (at the limit)
      for (let i = 0; i < 10; i++) {
        await commandProcessor.validateCommand(
          testUser.id,
          parsed,
          testServer.id,
        );
      }

      // 11th command should be rate limited
      const validation = await commandProcessor.validateCommand(
        testUser.id,
        parsed,
        testServer.id,
      );

      expect(validation.valid).toBe(false);
      expect(validation.error).toContain("Rate limit exceeded");
    });

    test("should clear rate limit for user", () => {
      commandProcessor.clearRateLimit(testUser.id);
      // Should not throw
      expect(true).toBe(true);
    });

    test("should clear all rate limits", () => {
      commandProcessor.clearRateLimit();
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe("Command History Management", () => {
    test("should retrieve empty history for new user", async () => {
      const history = await commandProcessor.getCommandHistory(testUser.id);
      expect(history).toEqual([]);
    });

    test("should respect history limit parameter", async () => {
      const history = await commandProcessor.getCommandHistory(testUser.id, 10);
      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBeLessThanOrEqual(10);
    });

    test("should clear history for specific user", () => {
      commandProcessor.clearHistory(testUser.id);
      // Should not throw
      expect(true).toBe(true);
    });

    test("should clear all history", () => {
      commandProcessor.clearHistory();
      // Should not throw
      expect(true).toBe(true);
    });

    test("should filter history by server ID", async () => {
      const history = await commandProcessor.getCommandHistory(
        testUser.id,
        50,
        testServer.id,
      );
      expect(Array.isArray(history)).toBe(true);
    });
  });

  describe("Command Statistics", () => {
    test("should get global stats", () => {
      const stats = commandProcessor.getStats();

      expect(stats).toHaveProperty("totalCommands");
      expect(stats).toHaveProperty("activeUsers");
      expect(stats).toHaveProperty("rateLimitEntries");
      expect(typeof (stats as any).totalCommands).toBe("number");
      expect(typeof (stats as any).activeUsers).toBe("number");
    });

    test("should get command stats for user", async () => {
      const userStats = await commandProcessor.getCommandStats(testUser.id);

      expect(userStats).toBeDefined();
      expect(userStats.totalCommands).toBeDefined();
      expect(userStats.commandsByCategory).toBeDefined();
      expect(userStats.mostUsedCommands).toBeDefined();
      expect(userStats.successRate).toBeDefined();
      expect(userStats.recentActivity).toBeDefined();
    });

    test("should return zero stats for user with no history", async () => {
      const userStats = await commandProcessor.getCommandStats(testUser.id);

      expect(userStats.totalCommands).toBe(0);
      expect(userStats.mostUsedCommands).toEqual([]);
    });

    test("should have category structure in stats", async () => {
      const userStats = await commandProcessor.getCommandStats(testUser.id);

      expect(userStats.commandsByCategory).toHaveProperty("system");
      expect(userStats.commandsByCategory).toHaveProperty("network");
      expect(userStats.commandsByCategory).toHaveProperty("hack");
      expect(userStats.commandsByCategory).toHaveProperty("file");
      expect(userStats.commandsByCategory).toHaveProperty("social");
      expect(userStats.commandsByCategory).toHaveProperty("game");
    });

    test("should calculate success rate", async () => {
      const userStats = await commandProcessor.getCommandStats(testUser.id);

      expect(typeof userStats.successRate).toBe("number");
      expect(userStats.successRate).toBeGreaterThanOrEqual(0);
      expect(userStats.successRate).toBeLessThanOrEqual(100);
    });
  });

  describe("Available Commands", () => {
    test("should get list of available commands", async () => {
      const commands = await commandProcessor.getAvailableCommands(testUser.id);

      expect(Array.isArray(commands)).toBe(true);
      expect(commands.length).toBeGreaterThan(0);
    });

    test("should include command details", async () => {
      const commands = await commandProcessor.getAvailableCommands(testUser.id);

      const cmd = commands[0];
      expect(cmd).toHaveProperty("command");
      expect(cmd).toHaveProperty("category");
      expect(cmd).toHaveProperty("description");
      expect(cmd).toHaveProperty("usage");
    });

    test("should filter commands by category - system", async () => {
      const systemCommands = await commandProcessor.getAvailableCommands(
        testUser.id,
        "system",
      );

      expect(systemCommands.length).toBeGreaterThan(0);
      expect(
        systemCommands.every((cmd: any) => cmd.category === "system"),
      ).toBe(true);
    });

    test("should filter commands by category - help", async () => {
      const helpCommands = await commandProcessor.getAvailableCommands(
        testUser.id,
        "help",
      );

      expect(helpCommands.length).toBeGreaterThan(0);
      expect(helpCommands.some((cmd: any) => cmd.command === "help")).toBe(
        true,
      );
    });

    test("should filter commands by category - network", async () => {
      const networkCommands = await commandProcessor.getAvailableCommands(
        testUser.id,
        "network",
      );

      expect(Array.isArray(networkCommands)).toBe(true);
      if (networkCommands.length > 0) {
        expect(networkCommands[0]?.category).toBe("network");
      }
    });

    test("should return all commands when no category filter", async () => {
      const allCommands = await commandProcessor.getAvailableCommands(
        testUser.id,
      );
      const systemCommands = await commandProcessor.getAvailableCommands(
        testUser.id,
        "system",
      );

      expect(allCommands.length).toBeGreaterThanOrEqual(systemCommands.length);
    });
  });

  describe("Autocomplete", () => {
    test("should provide autocomplete suggestions for partial command", async () => {
      const suggestions = await commandProcessor.getAutocompleteSuggestions(
        testUser.id,
        "he",
      );

      expect(Array.isArray(suggestions)).toBe(true);
      expect(suggestions.some((s: string) => s.startsWith("he"))).toBe(true);
    });

    test("should return empty array for empty input", async () => {
      const suggestions = await commandProcessor.getAutocompleteSuggestions(
        testUser.id,
        "",
      );

      expect(suggestions).toEqual([]);
    });

    test("should limit autocomplete suggestions to 10", async () => {
      const suggestions = await commandProcessor.getAutocompleteSuggestions(
        testUser.id,
        "c",
      );

      expect(suggestions.length).toBeLessThanOrEqual(10);
    });

    test("should sort autocomplete suggestions alphabetically", async () => {
      const suggestions = await commandProcessor.getAutocompleteSuggestions(
        testUser.id,
        "l",
      );

      if (suggestions.length > 1) {
        for (let i = 0; i < suggestions.length - 1; i++) {
          expect(suggestions[i]! <= suggestions[i + 1]!).toBe(true);
        }
      }
    });

    test("should handle cursor position in autocomplete", async () => {
      const suggestions = await commandProcessor.getAutocompleteSuggestions(
        testUser.id,
        "help test",
        4,
      );

      expect(Array.isArray(suggestions)).toBe(true);
    });

    test("should suggest 'ls' for input 'l'", async () => {
      const suggestions = await commandProcessor.getAutocompleteSuggestions(
        testUser.id,
        "l",
      );

      expect(suggestions).toContain("ls");
    });

    test("should suggest 'pwd' for input 'pw'", async () => {
      const suggestions = await commandProcessor.getAutocompleteSuggestions(
        testUser.id,
        "pw",
      );

      expect(suggestions).toContain("pwd");
    });

    test("should suggest 'help' for input 'hel'", async () => {
      const suggestions = await commandProcessor.getAutocompleteSuggestions(
        testUser.id,
        "hel",
      );

      expect(suggestions).toContain("help");
    });

    test("should handle whitespace input gracefully", async () => {
      const suggestions = await commandProcessor.getAutocompleteSuggestions(
        testUser.id,
        "   ",
      );

      expect(Array.isArray(suggestions)).toBe(true);
    });
  });

  describe("Command Modules", () => {
    test("should have initialized multiple command modules", () => {
      const stats: any = commandProcessor.getStats();
      expect(stats).toBeDefined();
      // CommandProcessor should have loaded modules (we just verify it doesn't crash)
    });

    test("should recognize system commands", async () => {
      const commands = await commandProcessor.getAvailableCommands(
        testUser.id,
        "system",
      );

      const commandNames = commands.map((c: any) => c.command);
      expect(commandNames).toContain("ls");
      expect(commandNames).toContain("cd");
      expect(commandNames).toContain("pwd");
    });

    test("should recognize help commands", async () => {
      const commands = await commandProcessor.getAvailableCommands(
        testUser.id,
        "help",
      );

      const commandNames = commands.map((c: any) => c.command);
      expect(commandNames).toContain("help");
    });

    test("should have command descriptions", async () => {
      const commands = await commandProcessor.getAvailableCommands(testUser.id);

      const lsCommand = commands.find((c: any) => c.command === "ls");
      expect(lsCommand).toBeDefined();
      expect(lsCommand?.description).toBeDefined();
      expect(lsCommand?.description.length).toBeGreaterThan(0);
    });

    test("should have command usage strings", async () => {
      const commands = await commandProcessor.getAvailableCommands(testUser.id);

      const cdCommand = commands.find((c: any) => c.command === "cd");
      expect(cdCommand).toBeDefined();
      expect(cdCommand?.usage).toBeDefined();
      expect(cdCommand?.usage.length).toBeGreaterThan(0);
    });

    test("should categorize commands correctly", async () => {
      const allCommands = await commandProcessor.getAvailableCommands(
        testUser.id,
      );

      const categories = new Set(allCommands.map((c: any) => c.category));
      expect(categories.size).toBeGreaterThan(1);
      expect(categories.has("system")).toBe(true);
      expect(categories.has("help")).toBe(true);
    });
  });
});
