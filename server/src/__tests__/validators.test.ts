/**
 * Unit tests for Validator Utilities
 * Pure functions - no database or external dependencies needed
 */

import { describe, it, expect } from "@jest/globals";
import {
  isValidUUID,
  isValidCUID,
  validateServerId,
  validateUserId,
  validateUsername,
  validateIPAddress,
  validateCommand,
  validateArgs,
  sanitizeMessageContent,
  validateMessageContent,
  validateEmail,
  validatePassword,
  validateNumberInRange,
  sanitizeSearchQuery,
  validatePort,
  validateSkillLevel,
} from "../utils/validators";

describe("Validator Utilities", () => {
  describe("isValidUUID", () => {
    it("should validate correct UUID v4", () => {
      expect(isValidUUID("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
      expect(isValidUUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe(false); // v1
      expect(isValidUUID("123e4567-e89b-42d3-a456-426614174000")).toBe(true);
    });

    it("should reject invalid UUIDs", () => {
      expect(isValidUUID("not-a-uuid")).toBe(false);
      expect(isValidUUID("123")).toBe(false);
      expect(isValidUUID("")).toBe(false);
      expect(isValidUUID("550e8400-e29b-41d4-a716")).toBe(false); // Too short
    });

    it("should handle edge cases", () => {
      expect(isValidUUID(null as any)).toBe(false);
      expect(isValidUUID(undefined as any)).toBe(false);
      expect(isValidUUID(123 as any)).toBe(false);
      expect(isValidUUID({} as any)).toBe(false);
    });

    it("should be case insensitive", () => {
      expect(isValidUUID("550E8400-E29B-41D4-A716-446655440000")).toBe(true);
      expect(isValidUUID("550e8400-E29B-41d4-A716-446655440000")).toBe(true);
    });
  });

  describe("isValidCUID", () => {
    it("should validate correct CUIDs", () => {
      expect(isValidCUID("cjld2cjxh0000qzrmn831i7rn")).toBe(true);
      expect(isValidCUID("ckr2n3w4k0000j8o7g5b8x9q1")).toBe(true);
      expect(isValidCUID("cl9qz8b7d0000l3h4m2v1p5k6")).toBe(true);
    });

    it("should reject invalid CUIDs", () => {
      expect(isValidCUID("not-a-cuid")).toBe(false);
      expect(isValidCUID("123456789")).toBe(false);
      expect(isValidCUID("")).toBe(false);
      expect(isValidCUID("ajld2cjxh0000qzrmn831i7rn")).toBe(false); // Doesn't start with 'c'
    });

    it("should handle edge cases", () => {
      expect(isValidCUID(null as any)).toBe(false);
      expect(isValidCUID(undefined as any)).toBe(false);
      expect(isValidCUID(123 as any)).toBe(false);
    });

    it("should reject CUIDs with uppercase letters", () => {
      expect(isValidCUID("CJLD2CJXH0000QZRMN831I7RN")).toBe(false);
    });
  });

  describe("validateServerId", () => {
    it("should accept valid UUIDs", () => {
      expect(validateServerId("550e8400-e29b-41d4-a716-446655440000")).toBe(
        true,
      );
    });

    it("should accept valid CUIDs", () => {
      expect(validateServerId("cjld2cjxh0000qzrmn831i7rn")).toBe(true);
    });

    it("should reject invalid IDs", () => {
      expect(validateServerId("invalid-id")).toBe(false);
      expect(validateServerId("")).toBe(false);
      expect(validateServerId("12345")).toBe(false);
    });
  });

  describe("validateUserId", () => {
    it("should accept valid UUIDs", () => {
      expect(validateUserId("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    });

    it("should accept valid CUIDs", () => {
      expect(validateUserId("cjld2cjxh0000qzrmn831i7rn")).toBe(true);
    });

    it("should reject invalid IDs", () => {
      expect(validateUserId("invalid-id")).toBe(false);
      expect(validateUserId("")).toBe(false);
    });
  });

  describe("validateUsername", () => {
    it("should validate correct usernames", () => {
      expect(validateUsername("alice").isValid).toBe(true);
      expect(validateUsername("bob123").isValid).toBe(true);
      expect(validateUsername("user_name").isValid).toBe(true);
      expect(validateUsername("user-name").isValid).toBe(true);
      expect(validateUsername("test").isValid).toBe(true);
    });

    it("should reject usernames that are too short", () => {
      const result = validateUsername("ab");
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("at least 3 characters");
    });

    it("should reject usernames that are too long", () => {
      const result = validateUsername("a".repeat(21));
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("at most 20 characters");
    });

    it("should reject usernames with invalid characters", () => {
      expect(validateUsername("user@name").isValid).toBe(false);
      expect(validateUsername("user name").isValid).toBe(false);
      expect(validateUsername("user!name").isValid).toBe(false);
      expect(validateUsername("user#name").isValid).toBe(false);
    });

    it("should reject usernames that don't start with a letter", () => {
      const result = validateUsername("123user");
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("must start with a letter");
    });

    it("should handle empty/null usernames", () => {
      expect(validateUsername("").isValid).toBe(false);
      expect(validateUsername(null as any).isValid).toBe(false);
      expect(validateUsername(undefined as any).isValid).toBe(false);
    });
  });

  describe("validateIPAddress", () => {
    it("should validate correct IPv4 addresses", () => {
      expect(validateIPAddress("192.168.1.1")).toBe(true);
      expect(validateIPAddress("10.0.0.1")).toBe(true);
      expect(validateIPAddress("255.255.255.255")).toBe(true);
      expect(validateIPAddress("0.0.0.0")).toBe(true);
      expect(validateIPAddress("127.0.0.1")).toBe(true);
    });

    it("should reject invalid IPv4 addresses", () => {
      expect(validateIPAddress("256.1.1.1")).toBe(false); // > 255
      expect(validateIPAddress("1.1.1")).toBe(false); // Too few octets
      expect(validateIPAddress("1.1.1.1.1")).toBe(false); // Too many octets
      expect(validateIPAddress("abc.def.ghi.jkl")).toBe(false); // Not numbers
      expect(validateIPAddress("192.168.1")).toBe(false); // Incomplete
    });

    it("should reject IPs with leading zeros", () => {
      expect(validateIPAddress("192.168.001.1")).toBe(false);
      expect(validateIPAddress("01.02.03.04")).toBe(false);
    });

    it("should handle edge cases", () => {
      expect(validateIPAddress("")).toBe(false);
      expect(validateIPAddress(null as any)).toBe(false);
      expect(validateIPAddress(undefined as any)).toBe(false);
      expect(validateIPAddress("...")).toBe(false);
    });
  });

  describe("validateCommand", () => {
    it("should validate safe commands", () => {
      expect(validateCommand("ls").isValid).toBe(true);
      expect(validateCommand("cd /home").isValid).toBe(true);
      expect(validateCommand("echo hello").isValid).toBe(true);
      expect(validateCommand("scan --port 80").isValid).toBe(true);
    });

    it("should reject commands that are too long", () => {
      const longCommand = "x".repeat(1001);
      const result = validateCommand(longCommand);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("too long");
    });

    it("should reject command injection attempts", () => {
      expect(validateCommand("; rm -rf /").isValid).toBe(false);
      expect(validateCommand("| rm -rf /").isValid).toBe(false);
      expect(validateCommand("&& rm -rf /").isValid).toBe(false);
      expect(validateCommand("$(rm -rf /)").isValid).toBe(false);
      expect(validateCommand("`rm -rf /`").isValid).toBe(false);
    });

    it("should handle empty commands", () => {
      const result = validateCommand("");
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("required");
    });

    it("should handle null/undefined", () => {
      expect(validateCommand(null as any).isValid).toBe(false);
      expect(validateCommand(undefined as any).isValid).toBe(false);
    });
  });

  describe("validateArgs", () => {
    it("should validate correct arguments", () => {
      expect(validateArgs([]).isValid).toBe(true);
      expect(validateArgs(["arg1", "arg2"]).isValid).toBe(true);
      expect(validateArgs(["--flag", "value"]).isValid).toBe(true);
    });

    it("should reject too many arguments", () => {
      const manyArgs = Array(51).fill("arg");
      const result = validateArgs(manyArgs);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("Too many arguments");
    });

    it("should reject arguments that are too long", () => {
      const longArg = "x".repeat(501);
      const result = validateArgs([longArg]);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("too long");
    });

    it("should reject arguments with null bytes", () => {
      const result = validateArgs(["test\0malicious"]);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("null bytes");
    });

    it("should reject non-string arguments", () => {
      const result = validateArgs([123 as any]);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("must be a string");
    });

    it("should reject non-array input", () => {
      const result = validateArgs("not an array" as any);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("must be an array");
    });
  });

  describe("sanitizeMessageContent", () => {
    it("should preserve clean messages", () => {
      expect(sanitizeMessageContent("Hello, world!")).toBe("Hello, world!");
      expect(sanitizeMessageContent("Test message 123")).toBe(
        "Test message 123",
      );
    });

    it("should remove null bytes", () => {
      expect(sanitizeMessageContent("Hello\0World")).toBe("HelloWorld");
    });

    it("should remove control characters", () => {
      expect(sanitizeMessageContent("Hello\x01World")).toBe("HelloWorld");
      expect(sanitizeMessageContent("Test\x1FMessage")).toBe("TestMessage");
    });

    it("should preserve newlines and tabs", () => {
      expect(sanitizeMessageContent("Line1\nLine2")).toBe("Line1\nLine2");
      expect(sanitizeMessageContent("Col1\tCol2")).toBe("Col1\tCol2");
    });

    it("should truncate long messages", () => {
      const longMessage = "x".repeat(6000);
      const sanitized = sanitizeMessageContent(longMessage);
      expect(sanitized.length).toBe(5000);
    });

    it("should handle empty/null input", () => {
      expect(sanitizeMessageContent("")).toBe("");
      expect(sanitizeMessageContent(null as any)).toBe("");
      expect(sanitizeMessageContent(undefined as any)).toBe("");
    });
  });

  describe("validateMessageContent", () => {
    it("should validate correct messages", () => {
      expect(validateMessageContent("Hello!").isValid).toBe(true);
      expect(validateMessageContent("Test message 123").isValid).toBe(true);
      expect(validateMessageContent("A".repeat(5000)).isValid).toBe(true);
    });

    it("should reject empty messages", () => {
      const result = validateMessageContent("");
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("required");
    });

    it("should reject messages that are too long", () => {
      const longMessage = "x".repeat(5001);
      const result = validateMessageContent(longMessage);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("too long");
    });

    it("should reject messages with null bytes", () => {
      const result = validateMessageContent("Hello\0World");
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("invalid characters");
    });

    it("should handle null/undefined", () => {
      expect(validateMessageContent(null as any).isValid).toBe(false);
      expect(validateMessageContent(undefined as any).isValid).toBe(false);
    });
  });

  describe("validateEmail", () => {
    it("should validate correct email addresses", () => {
      expect(validateEmail("user@example.com")).toBe(true);
      expect(validateEmail("test.user@domain.co.uk")).toBe(true);
      expect(validateEmail("name+tag@example.org")).toBe(true);
    });

    it("should reject invalid email addresses", () => {
      expect(validateEmail("notanemail")).toBe(false);
      expect(validateEmail("@example.com")).toBe(false);
      expect(validateEmail("user@")).toBe(false);
      expect(validateEmail("user@domain")).toBe(false);
      expect(validateEmail("user @example.com")).toBe(false);
    });

    it("should handle edge cases", () => {
      expect(validateEmail("")).toBe(false);
      expect(validateEmail(null as any)).toBe(false);
      expect(validateEmail(undefined as any)).toBe(false);
    });
  });

  describe("validatePassword", () => {
    it("should validate strong passwords", () => {
      expect(validatePassword("password123").isValid).toBe(true);
      expect(validatePassword("Secure1Pass").isValid).toBe(true);
      expect(validatePassword("test1234").isValid).toBe(true);
    });

    it("should reject passwords that are too short", () => {
      const result = validatePassword("pass1");
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("at least 8 characters");
    });

    it("should reject passwords that are too long", () => {
      const longPass = "a".repeat(129) + "1";
      const result = validatePassword(longPass);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("too long");
    });

    it("should require at least one letter", () => {
      const result = validatePassword("12345678");
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("at least one letter");
    });

    it("should require at least one number", () => {
      const result = validatePassword("password");
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("at least one number");
    });

    it("should handle empty/null passwords", () => {
      expect(validatePassword("").isValid).toBe(false);
      expect(validatePassword(null as any).isValid).toBe(false);
      expect(validatePassword(undefined as any).isValid).toBe(false);
    });
  });

  describe("validateNumberInRange", () => {
    it("should validate numbers within range", () => {
      expect(validateNumberInRange(5, 0, 10)).toBe(true);
      expect(validateNumberInRange(0, 0, 10)).toBe(true);
      expect(validateNumberInRange(10, 0, 10)).toBe(true);
      expect(validateNumberInRange(50, 1, 100)).toBe(true);
    });

    it("should reject numbers outside range", () => {
      expect(validateNumberInRange(-1, 0, 10)).toBe(false);
      expect(validateNumberInRange(11, 0, 10)).toBe(false);
      expect(validateNumberInRange(0, 1, 10)).toBe(false);
    });

    it("should handle string numbers", () => {
      expect(validateNumberInRange("5", 0, 10)).toBe(true);
      expect(validateNumberInRange("0", 0, 10)).toBe(true);
    });

    it("should reject non-numeric values", () => {
      expect(validateNumberInRange("abc", 0, 10)).toBe(false);
      expect(validateNumberInRange(NaN, 0, 10)).toBe(false);
      // null converts to 0 which is in range 0-10
      expect(validateNumberInRange(null, 0, 10)).toBe(true);
      expect(validateNumberInRange(undefined, 0, 10)).toBe(false);
    });
  });

  describe("sanitizeSearchQuery", () => {
    it("should preserve clean queries", () => {
      expect(sanitizeSearchQuery("hello world")).toBe("hello world");
      expect(sanitizeSearchQuery("test query")).toBe("test query");
    });

    it("should remove dangerous characters", () => {
      expect(sanitizeSearchQuery("test<script>")).toBe("testscript");
      expect(sanitizeSearchQuery('query"test')).toBe("querytest");
      expect(sanitizeSearchQuery("test;drop")).toBe("testdrop");
    });

    it("should normalize whitespace", () => {
      expect(sanitizeSearchQuery("test   query")).toBe("test query");
      expect(sanitizeSearchQuery("  test  query  ")).toBe("test query");
      expect(sanitizeSearchQuery("test\n\nquery")).toBe("test query");
    });

    it("should truncate long queries", () => {
      const longQuery = "x".repeat(150);
      const sanitized = sanitizeSearchQuery(longQuery);
      expect(sanitized.length).toBe(100);
    });

    it("should handle empty/null input", () => {
      expect(sanitizeSearchQuery("")).toBe("");
      expect(sanitizeSearchQuery(null as any)).toBe("");
      expect(sanitizeSearchQuery(undefined as any)).toBe("");
    });
  });

  describe("validatePort", () => {
    it("should validate valid ports", () => {
      expect(validatePort(80)).toBe(true);
      expect(validatePort(443)).toBe(true);
      expect(validatePort(8080)).toBe(true);
      expect(validatePort(1)).toBe(true);
      expect(validatePort(65535)).toBe(true);
    });

    it("should reject invalid ports", () => {
      expect(validatePort(0)).toBe(false);
      expect(validatePort(-1)).toBe(false);
      expect(validatePort(65536)).toBe(false);
      expect(validatePort(100000)).toBe(false);
    });

    it("should handle string numbers", () => {
      expect(validatePort("80")).toBe(true);
      expect(validatePort("443")).toBe(true);
    });

    it("should reject non-numeric values", () => {
      expect(validatePort("abc")).toBe(false);
      // null converts to 0 which is outside port range (1-65535)
      expect(validatePort(null)).toBe(false);
      expect(validatePort(undefined)).toBe(false);
    });
  });

  describe("validateSkillLevel", () => {
    it("should validate valid skill levels", () => {
      expect(validateSkillLevel(0)).toBe(true);
      expect(validateSkillLevel(50)).toBe(true);
      expect(validateSkillLevel(100)).toBe(true);
      expect(validateSkillLevel(1)).toBe(true);
      expect(validateSkillLevel(99)).toBe(true);
    });

    it("should reject invalid skill levels", () => {
      expect(validateSkillLevel(-1)).toBe(false);
      expect(validateSkillLevel(101)).toBe(false);
      expect(validateSkillLevel(1000)).toBe(false);
    });

    it("should handle string numbers", () => {
      expect(validateSkillLevel("50")).toBe(true);
      expect(validateSkillLevel("100")).toBe(true);
    });

    it("should reject non-numeric values", () => {
      expect(validateSkillLevel("high")).toBe(false);
      // null converts to 0 which is valid (0-100 range)
      expect(validateSkillLevel(null)).toBe(true);
      // undefined converts to NaN which is invalid
      expect(validateSkillLevel(undefined)).toBe(false);
    });
  });

  describe("Edge Cases and Integration", () => {
    it("should handle unicode characters appropriately", () => {
      expect(validateUsername("test用户").isValid).toBe(false);
      expect(validateMessageContent("Hello 世界").isValid).toBe(true);
    });

    it("should handle special characters in search", () => {
      const query = sanitizeSearchQuery("test@#$%query");
      // Only <, >, ;, ", ', \ are removed per implementation
      expect(query).toBe("test@#$%query");
    });

    it("should chain validations correctly", () => {
      const user = "alice";
      const email = "alice@example.com";

      expect(validateUsername(user).isValid).toBe(true);
      expect(validateEmail(email)).toBe(true);
    });

    it("should handle boundary values", () => {
      expect(validateUsername("abc").isValid).toBe(true); // Min length
      expect(validateUsername("a".repeat(20)).isValid).toBe(true); // Max length
      expect(validatePassword("test1234").isValid).toBe(true); // Min password
    });
  });
});
