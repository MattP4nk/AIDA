/**
 * MessageEncryptionService - Encryption & Decryption Operations
 *
 * Extracted from MessageService. Handles:
 * - AES-256-CBC message encryption
 * - Server-side key decryption
 * - Gameplay "crack encryption" mechanic
 *
 * Phase 2, Day 8 (split)
 */

import { prisma } from "../database/client";
import crypto from "crypto";
import { Logger } from "pino";
import { injectable, inject } from "tsyringe";
import { LOGGER } from "../di/tokens";

import type { MessageOperationResult, EncryptionResult } from "./messageService";

// ==================== MESSAGE ENCRYPTION SERVICE CLASS ====================

@injectable()
export class MessageEncryptionService {
  private encryptionAlgorithm = "aes-256-cbc";

  constructor(@inject(LOGGER) private logger: Logger) {}

  // ==================== ENCRYPTION ====================

  /**
   * Encrypt message content based on skill level
   */
  async encryptMessage(
    content: string,
    encryptionLevel: number,
  ): Promise<EncryptionResult> {
    try {
      // Generate encryption key based on level
      const keyLength = 16 + encryptionLevel * 2; // 16-36 bytes
      const key = crypto.randomBytes(keyLength).toString("hex");

      const iv = crypto.randomBytes(16);
      const keyBuffer = crypto.scryptSync(key, "salt", 32);
      const cipher = crypto.createCipheriv(
        this.encryptionAlgorithm,
        keyBuffer,
        iv,
      );

      let encrypted = cipher.update(content, "utf8", "hex");
      encrypted += cipher.final("hex");

      const encryptedContent = iv.toString("hex") + ":" + encrypted;

      return {
        encryptedContent,
        encryptionLevel,
        key,
      };
    } catch (error) {
      this.logger.error({ err: error }, "Encryption error");
      throw error;
    }
  }

  // ==================== DECRYPTION ====================

  /**
   * Decrypt message content.
   *
   * If `key` is omitted/empty and `messageId` is provided, the stored
   * server-side encryption key will be looked up from the database.
   */
  async decryptMessage(
    encryptedContent: string,
    key: string | undefined,
    userId: string,
    messageId?: string,
  ): Promise<MessageOperationResult> {
    try {
      // If no key was supplied, try to look it up from the database
      let resolvedKey = key;
      if (!resolvedKey && messageId) {
        const dbMessage = await prisma.message.findUnique({
          where: { id: messageId },
          select: { encryptionKey: true, senderId: true, recipientId: true },
        });

        if (!dbMessage) {
          return {
            success: false,
            message: "Message not found",
            error: "NOT_FOUND",
          };
        }
        // Only sender or recipient may use the stored key
        if (dbMessage.senderId !== userId && dbMessage.recipientId !== userId) {
          return {
            success: false,
            message: "Permission denied",
            error: "PERMISSION_DENIED",
          };
        }
        if (!dbMessage.encryptionKey) {
          return {
            success: false,
            message: "No stored encryption key for this message",
            error: "NO_KEY",
          };
        }
        resolvedKey = dbMessage.encryptionKey;
      }

      if (!resolvedKey) {
        return {
          success: false,
          message: "No encryption key provided and no messageId to look it up",
          error: "NO_KEY",
        };
      }

      // Get user's cryptography skill
      const progress = await prisma.playerProgress.findUnique({
        where: { userId },
      });

      if (!progress) {
        return {
          success: false,
          message: "Player progress not found",
          error: "NO_PROGRESS",
        };
      }

      const parts = encryptedContent.split(":");
      if (parts.length !== 2) {
        return {
          success: false,
          message: "Invalid encrypted content format",
          error: "INVALID_FORMAT",
        };
      }

      const iv = Buffer.from(parts[0]!, "hex");
      const encrypted = parts[1]!;
      const keyBuffer = crypto.scryptSync(resolvedKey, "salt", 32);
      const decipher = crypto.createDecipheriv(
        this.encryptionAlgorithm,
        keyBuffer,
        iv,
      );

      let decrypted = decipher.update(encrypted, "hex", "utf8");
      decrypted += decipher.final("utf8");

      return {
        success: true,
        message: "Message decrypted successfully",
        data: { content: decrypted },
      };
    } catch (error: any) {
      this.logger.error({ err: error }, "Decryption error");
      return {
        success: false,
        message: "Failed to decrypt message. Invalid key or corrupted data.",
        error: "DECRYPTION_FAILED",
      };
    }
  }

  /**
   * Decrypt a message by its ID using the server-side stored encryption key.
   *
   * Validates that the requesting user is the sender or recipient before
   * allowing decryption.
   */
  async decryptMessageById(
    messageId: string,
    userId: string,
  ): Promise<MessageOperationResult> {
    try {
      const message = await prisma.message.findUnique({
        where: { id: messageId },
      });

      if (!message) {
        return {
          success: false,
          message: "Message not found",
          error: "NOT_FOUND",
        };
      }

      // Only sender or recipient may decrypt
      if (message.senderId !== userId && message.recipientId !== userId) {
        return {
          success: false,
          message: "Permission denied",
          error: "PERMISSION_DENIED",
        };
      }

      if (!message.isEncrypted) {
        return {
          success: true,
          message: "Message is not encrypted",
          data: { content: message.content },
        };
      }

      if (!message.encryptionKey) {
        return {
          success: false,
          message: "No stored encryption key for this message",
          error: "NO_KEY",
        };
      }

      return await this.decryptMessage(
        message.content,
        message.encryptionKey,
        userId,
        messageId,
      );
    } catch (error: any) {
      this.logger.error({ err: error }, "Decrypt message by ID error");
      return {
        success: false,
        message: "Failed to decrypt message",
        error: error.message,
      };
    }
  }

  // ==================== CRACK ENCRYPTION (GAMEPLAY) ====================

  /**
   * Attempt to crack encrypted message (gameplay mechanic)
   */
  async crackEncryption(
    messageId: string,
    userId: string,
  ): Promise<MessageOperationResult> {
    try {
      const message = await prisma.message.findUnique({
        where: { id: messageId },
      });

      if (!message) {
        return {
          success: false,
          message: "Message not found",
          error: "NOT_FOUND",
        };
      }

      if (!message.isEncrypted) {
        return {
          success: false,
          message: "Message is not encrypted",
          error: "NOT_ENCRYPTED",
        };
      }

      const progress = await prisma.playerProgress.findUnique({
        where: { userId },
      });

      if (!progress) {
        return {
          success: false,
          message: "Player progress not found",
          error: "NO_PROGRESS",
        };
      }

      const cryptoSkill = progress.cryptography;
      const requiredSkill = (message.encryptionLevel || 5) * 10;

      // Success chance based on skill difference
      const skillDiff = cryptoSkill - requiredSkill;
      const baseChance = 50; // 50% at equal skill
      const successChance = Math.max(10, Math.min(90, baseChance + skillDiff));

      const roll = Math.random() * 100;
      const success = roll < successChance;

      if (success) {
        // Award XP for successful crack
        const xpGain = message.encryptionLevel! * 10;
        await prisma.playerProgress.update({
          where: { userId },
          data: {
            experience: { increment: xpGain },
            cryptography: { increment: Math.min(2, message.encryptionLevel!) },
          },
        });

        // Actually decrypt the content using the stored encryption key
        const decryptResult = await this.decryptMessage(
          message.content,
          message.encryptionKey!,
          userId,
          messageId,
        );

        const decryptedContent =
          decryptResult.success && decryptResult.data
            ? decryptResult.data.content
            : message.content; // Fallback to ciphertext if decryption fails unexpectedly

        return {
          success: true,
          message: "Encryption cracked successfully!",
          data: {
            content: decryptedContent,
            xpGained: xpGain,
            skillGained: Math.min(2, message.encryptionLevel!),
          },
        };
      } else {
        return {
          success: false,
          message: `Failed to crack encryption (${successChance.toFixed(0)}% chance)`,
          error: "CRACK_FAILED",
          data: {
            successChance,
            requiredSkill,
            yourSkill: cryptoSkill,
          },
        };
      }
    } catch (error: any) {
      this.logger.error({ err: error }, "Crack encryption error");
      return {
        success: false,
        message: "Failed to crack encryption",
        error: error.message,
      };
    }
  }
}

export default MessageEncryptionService;
