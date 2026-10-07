/**
 * FileService - Virtual File System Management
 *
 * Handles all file system operations including:
 * - CRUD operations for files and directories
 * - Permission management and validation
 * - File encryption/decryption
 * - Path resolution and navigation
 * - File discovery and access control
 *
 * Phase 2, Day 8
 */

import { Logger } from "pino";
import { prisma, Prisma } from "../database/client";
import { Server as SocketIOServer } from "socket.io";
import crypto from "crypto";
import { sanitizePath } from "../utils/pathSanitizer";
import { injectable, inject } from "tsyringe";
import {
  LOGGER,
  SOCKET_IO,
  CACHE_SERVICE,
  MISSION_INTEGRATION_SERVICE,
  FACTION_KNOWLEDGE_SERVICE,
  NETWORK_TOPOLOGY_SERVICE,
  PLAYER_PROGRESS_REPOSITORY,
  EVENT_SERVICE, DYNAMIC_CONTENT_SERVICE } from "../di/tokens";
import { EventType, EventSeverity } from "../../../shared/types";
import type PlayerProgressRepository from "../repositories/playerProgressRepository";
import type { CacheService } from "./cacheService";
import type MissionIntegrationService from "./missionIntegration";
import type { FactionKnowledgeService } from "./factionKnowledgeService";
import type { NetworkTopologyService } from "./networkTopologyService";
import { isPathSafe, isValidFilename } from "../utils/pathSanitizer";
import { FilePermissions, PermissionLevel } from "../../../shared/types";

import {
  encryptContent as encryptPayload,
  decryptContent as decryptPayload,
} from "../utils/contentCrypto";
// ==================== TYPES ====================

export interface FileNode {
  id: string;
  serverId: string;
  parentId: string | null;
  name: string;
  type: "file" | "directory";
  content: string | null;
  permissions: FilePermissions;
  createdBy: string;
  createdAt: Date;
  modifiedAt: Date;
  lastAccessedAt: Date | null;
  lastAccessedBy: string | null;
  size: number;
  isEncrypted: boolean;
  encryptionKey: string | null;
  isHidden: boolean;
  isProtected: boolean;
  metadata: Record<string, unknown> | null;
}

// FilePermissions and PermissionLevel are imported from shared/types
export type { FilePermissions } from "../../../shared/types";
export { PermissionLevel } from "../../../shared/types";

export interface FileSystemEntry {
  name: string;
  type: "file" | "directory";
  size: number;
  modified: Date;
  permissions: string; // Unix-style display (e.g., "rwxr-xr--")
  isEncrypted: boolean;
  isHidden: boolean;
  isProtected: boolean;
  childCount?: number | undefined; // Number of items inside (directories only)
}

export interface FileOperationResult {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
}

export interface PathResolution {
  nodeId: string | null;
  path: string;
  exists: boolean;
  isDirectory: boolean;
  node?: FileNode;
}

// ==================== FILE SERVICE CLASS ====================

@injectable()
export class FileService {
  private missionIntegration: MissionIntegrationService | null = null;
  private factionKnowledge: FactionKnowledgeService | null = null;
  private networkTopology: NetworkTopologyService | null = null;
  private accessKeyCache: { data: Array<{ id: string; name: string; accessKey: string }>; expiresAt: number } | null =
    null;
  private static readonly ACCESS_KEY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(
    @inject(LOGGER) private logger: Logger,
    @inject(SOCKET_IO) _io: SocketIOServer,
    @inject(CACHE_SERVICE) private cacheService: CacheService,
    @inject(PLAYER_PROGRESS_REPOSITORY)
    private playerProgress: PlayerProgressRepository,
    @inject(MISSION_INTEGRATION_SERVICE)
    missionIntegrationService?: MissionIntegrationService,
    @inject(FACTION_KNOWLEDGE_SERVICE)
    factionKnowledgeService?: FactionKnowledgeService,
    @inject(NETWORK_TOPOLOGY_SERVICE)
    networkTopologyService?: NetworkTopologyService,
  ) {
    // io parameter kept for DI initialization, will be used for future real-time features
    this.missionIntegration = missionIntegrationService || null;
    this.factionKnowledge = factionKnowledgeService || null;
    this.networkTopology = networkTopologyService || null;
  }

  /**
   * A honeypot alert, routed so it actually reaches the owner.
   *
   * ORPHAN AUDIT 2026-09-24: both call sites used to `prisma.gameEvent.create`
   * directly, which skips `createEvent` and therefore skips `broadcastEvent`
   * entirely. The row was written and nothing was ever sent — and this file
   * has no other emit of any kind, so that row was the ONLY signal a player
   * got that someone had tripped their decoy. Going through eventService is
   * what makes it a notification instead of a database entry.
   *
   * `EVENT_SERVICE` is resolved lazily: the DI container imports every
   * service, so a static import of it here would close a require cycle.
   *
   * Non-throwing on purpose — the caller is in the middle of a file operation
   * whose result must not depend on whether the owner's alert went out.
   */
  private async alertHoneypot(
    ownerId: string,
    serverId: string,
    fileName: string,
    attackerId: string,
    action: "read" | "delete",
  ): Promise<void> {
    try {
      const { getService } = await import("../di/container");
      const eventService = getService<import("./eventService").EventService>(EVENT_SERVICE);
      await eventService.createEvent(
        EventType.HONEYPOT_TRIGGERED,
        action === "delete" ? "Honeypot Alert — File Deleted" : "Honeypot Alert",
        action === "delete"
          ? `Intruder deleted decoy file '${fileName}' from your home server.`
          : `Intruder accessed decoy file '${fileName}' on your home server.`,
        // `targetUserId` is what makes a PLAYER tap match. Matching used to
        // short-circuit on serverId, so only a server tap ever worked; now
        // that it compares every candidate, naming the victim here is what
        // gives `tap <username>` something to deliver. Safe to include: a
        // watcher receives this metadata SCRUBBED of identifiers, only the
        // named owner sees the raw ids.
        { serverId, targetUserId: ownerId, fileName, attackerId, action },
        EventSeverity.WARNING,
        [ownerId],
        false,
      );
    } catch (err) {
      this.logger.warn({ err, ownerId, serverId, fileName }, "Failed to raise honeypot alert");
    }

    // The hidden /var/log/honeypot.log trap entry. dynamicContentService's
    // `honeypot:triggered` hook reads exactly { serverId, fileName, attackerId }
    // — FILE honeypots — and was never fed; the only event of that name was
    // the FORUM honeypot's, whose payload matched none of it. Separate try:
    // a log failure must not read as a failed alert.
    try {
      const { getService } = await import("../di/container");
      const dynamicContent = getService<import("./dynamicContentService").DynamicContentService>(DYNAMIC_CONTENT_SERVICE);
      await dynamicContent.processEvent("honeypot:triggered", { serverId, fileName, attackerId, action });
    } catch (err) {
      this.logger.warn({ err, serverId, fileName }, "Failed to write honeypot trap log");
    }
  }

  // ==================== FILE OPERATIONS ====================

  /**
   * List directory contents (ls)
   */
  async listDirectory(
    serverId: string,
    userId: string,
    path: string = "/",
    showHidden: boolean = false,
    revealedFileIds: string[] = [],
  ): Promise<FileOperationResult> {
    try {
      // Validate path for security
      if (!isPathSafe(path)) {
        return {
          success: false,
          message: `Invalid path: ${path}`,
          error: "INVALID_PATH",
        };
      }
      const resolution = await this.resolvePath(serverId, path);

      if (!resolution.exists) {
        return {
          success: false,
          message: `Directory not found: ${path}`,
          error: "NOT_FOUND",
        };
      }

      if (!resolution.isDirectory) {
        return {
          success: false,
          message: `${path} is not a directory`,
          error: "NOT_DIRECTORY",
        };
      }

      // Get user's access level on this server
      const accessLevel = await this.getUserAccessLevel(userId, serverId);

      // Fetch children (include user-revealed hidden files from sweep)
      const hiddenFilter = showHidden
        ? {}
        : revealedFileIds.length > 0
          ? { OR: [{ isHidden: false }, { id: { in: revealedFileIds } }] }
          : { isHidden: false };
      const children = await prisma.fileSystemNode.findMany({
        where: {
          serverId,
          parentId: resolution.nodeId,
          ...hiddenFilter,
        },
        orderBy: [
          { type: "desc" }, // directories first
          { name: "asc" },
        ],
      });

      // Filter by permissions and count children for directories
      const visibleEntries: FileSystemEntry[] = [];
      const dirIds = children.filter(c => c.type === "directory").map(c => c.id);

      // Batch-count children for all directories in one query
      const childCounts = dirIds.length > 0
        ? await prisma.fileSystemNode.groupBy({
            by: ["parentId"],
            where: { parentId: { in: dirIds }, ...(showHidden ? {} : { isHidden: false }) },
            _count: { _all: true },
          })
        : [];
      const countMap = new Map(childCounts.map(c => [c.parentId, c._count._all]));

      for (const child of children) {
        const permissions = child.permissions as unknown as FilePermissions;
        // Pass the already-loaded row, not its id. canRead() re-fetches when
        // given a string, which made every `ls` cost one extra findUnique per
        // entry — the N+1 that made listing (and therefore `cd`) slow.
        if (
          await this.canRead(
            userId,
            child as unknown as FileNode,
            accessLevel,
          )
        ) {
          visibleEntries.push({
            name: child.name,
            type: child.type as "file" | "directory",
            size: child.size,
            modified: child.modifiedAt,
            permissions: this.formatPermissions(permissions),
            isEncrypted: child.isEncrypted,
            isHidden: child.isHidden,
            isProtected: child.isProtected,
            childCount: child.type === "directory" ? (countMap.get(child.id) ?? 0) : undefined,
          });
        }
      }

      return {
        success: true,
        message: `Listed ${visibleEntries.length} items in ${path}`,
        data: {
          path,
          entries: visibleEntries,
          total: visibleEntries.length,
        },
      };
    } catch (error: any) {
      this.logger.error({ err: error }, "List directory error");
      return {
        success: false,
        message: "Failed to list directory",
        error: error.message,
      };
    }
  }

  /**
   * Cheap existence + type + readability check for a single path.
   *
   * `cd` used to validate its target by calling listDirectory(), which fetches
   * every child, batch-counts grandchildren, and permission-checks each entry —
   * all to answer "does this directory exist and may I enter it?". That made
   * navigation cost scale with the size of the directory being entered, which
   * is exactly backwards. This does the same job in O(path depth).
   */
  async statPath(
    serverId: string,
    userId: string,
    path: string,
  ): Promise<FileOperationResult> {
    try {
      if (!isPathSafe(path)) {
        return {
          success: false,
          message: `Invalid path: ${path}`,
          error: "INVALID_PATH",
        };
      }

      const resolution = await this.resolvePath(serverId, path);
      if (!resolution.exists || !resolution.nodeId) {
        return {
          success: false,
          message: `Directory not found: ${path}`,
          error: "NOT_FOUND",
        };
      }

      // resolvePath already carries the node on the common path; only fetch if
      // it didn't, so the usual case stays at zero extra queries.
      let node = resolution.node;
      if (!node) {
        const fetched = await prisma.fileSystemNode.findUnique({
          where: { id: resolution.nodeId },
        });
        if (!fetched) {
          return {
            success: false,
            message: `Directory not found: ${path}`,
            error: "NOT_FOUND",
          };
        }
        node = fetched as unknown as FileNode;
      }

      const accessLevel = await this.getUserAccessLevel(userId, serverId);
      if (!(await this.canRead(userId, node, accessLevel))) {
        return {
          success: false,
          message: `Permission denied: ${path}`,
          error: "PERMISSION_DENIED",
        };
      }

      return {
        success: true,
        message: "OK",
        data: {
          path: resolution.path,
          isDirectory: resolution.isDirectory,
          nodeId: resolution.nodeId,
        },
      };
    } catch (error: any) {
      this.logger.error({ err: error }, "Stat path error");
      return {
        success: false,
        message: "Failed to stat path",
        error: error.message,
      };
    }
  }

  /**
   * Read file contents (cat)
   */
  async readFile(
    serverId: string,
    userId: string,
    path: string,
    decryptionKey?: string,
  ): Promise<FileOperationResult> {
    try {
      // Validate path for security
      if (!isPathSafe(path)) {
        return {
          success: false,
          message: `Invalid path: ${path}`,
          error: "INVALID_PATH",
        };
      }
      const resolution = await this.resolvePath(serverId, path);

      if (!resolution.exists || !resolution.node) {
        return {
          success: false,
          message: `File not found: ${path}`,
          error: "NOT_FOUND",
        };
      }

      if (resolution.isDirectory) {
        return {
          success: false,
          message: `${path} is a directory`,
          error: "IS_DIRECTORY",
        };
      }

      const file = resolution.node;
      const accessLevel = await this.getUserAccessLevel(userId, serverId);

      // Check read permission on the file AND on every directory leading to
      // it. R11: the ancestor half was missing, so a permissive file inside a
      // restricted directory was readable by anyone who knew the path.
      if (
        !(await this.canRead(userId, file as unknown as FileNode, accessLevel)) ||
        !(await this.canReadAncestors(userId, file.id, accessLevel))
      ) {
        return {
          success: false,
          message: `Permission denied: ${path}`,
          error: "PERMISSION_DENIED",
        };
      }

      let content = file.content || "";

      // Handle encryption
      if (file.isEncrypted) {
        // R9: a file marked encrypted with NO key is LOCKED, not corrupt.
        //
        // World provisioning writes story files with `isEncrypted: true` and
        // plaintext content and no key — 85 of 85 encrypted files in the dev
        // database were in this state. The old code fell through to
        // `decryptContent(plaintext, null)`, which throws "Invalid encrypted
        // content format", so `cat` answered DECRYPTION_FAILED. Worse, the
        // crack router keys on `error === "ENCRYPTED"`, so those files were
        // ALSO uncrackable and the content was unreachable by any means.
        //
        // Reporting ENCRYPTED for both shapes is what makes them crackable,
        // and is honest: from the player's side they are the same thing — a
        // file you cannot read yet.
        // A LOCKED file has no stored key, so there is no key that can open
        // it — only the crack flow can. Returning it whenever a key was
        // merely SUPPLIED was a hole introduced by the first draft of this
        // fix: the ternary below read as a null-guard, so any non-empty
        // argument (`decrypt story.enc x`) skipped straight past validation
        // and handed back the plaintext, bypassing the very crack minigame
        // this change exists to make reachable.
        if (!file.encryptionKey) {
          return {
            success: false,
            message: "File is encrypted. Crack it to reveal the contents.",
            error: "ENCRYPTED",
            data: {
              isEncrypted: true,
              hint: `Use 'crack ${file.name}' — this file has no key to supply.`,
            },
          };
        }

        if (!decryptionKey) {
          return {
            success: false,
            message: "File is encrypted. Decryption key required.",
            error: "ENCRYPTED",
            data: {
              isEncrypted: true,
              // `cat` takes no key argument — only `decrypt` does. The first
              // draft of this hint named a `--key=` flag that nothing parses,
              // so following it led nowhere.
              hint: `Use 'decrypt ${file.name} <key>' or crack the encryption.`,
            },
          };
        }

        try {
          // Both are non-null here: a stored key to check against, and a
          // supplied key to check.
          content = await this.decryptContent(content, decryptionKey);
        } catch (err) {
          return {
            success: false,
            message: "Failed to decrypt file. Invalid key.",
            error: "DECRYPTION_FAILED",
          };
        }
      }

      // Log file access
      await this.logFileAccess(userId, serverId, file.id, "read");

      // Increment filesAccessed stat (fire-and-forget)
      // Fire-and-forget telemetry. `updateMany` inside the repository means a
      // player with no progress row is a no-op rather than a swallowed P2025.
      this.playerProgress
        .incrementCounter(userId, "filesAccessed")
        .catch(() => {});

      // Track for mission objectives
      if (this.missionIntegration) {
        await this.missionIntegration.onFileOperation(
          userId,
          "read",
          file.id,
          serverId,
        );
      }

      // Track file discovery for faction knowledge (non-home servers only)
      if (this.factionKnowledge) {
        this.factionKnowledge
          .getPlayerFactionId(userId)
          .then((factionId) => {
            if (factionId) {
              this.factionKnowledge!.addEntry(factionId, {
                assetType: "file",
                assetId: file.id,
                assetMeta: {
                  name: file.name,
                  serverId,
                  isEncrypted: file.isEncrypted,
                  isHidden: file.isHidden,
                  size: file.size,
                },
                source: "server_discovery",
                confidence: 0.85,
                discoveredBy: userId,
              });
            }
          })
          .catch((err) =>
            this.logger.error({ err }, "Faction knowledge file discovery error"),
          );
      }

      // NOTE: Access key detection moved to download command.
      // cat/read shows content but doesn't extract keys — must download to keep intel.

      // ── Honeypot detection: if attacker reads a decoy file, alert the owner ──
      const fileMeta = file.metadata as Record<string, unknown> | null;
      if (fileMeta?.isDecoy === true) {
        // Find the server owner
        const ownerServer = await prisma.gameServer.findUnique({
          where: { id: serverId },
          select: { ownerId: true, isPlayerHome: true },
        });
        if (ownerServer?.isPlayerHome && ownerServer.ownerId && ownerServer.ownerId !== userId) {
          this.logger.info({ userId, serverId, fileName: file.name }, "Honeypot triggered: attacker read decoy file");
          await this.alertHoneypot(ownerServer.ownerId, serverId, file.name, userId, "read");
        }
      }

      return {
        success: true,
        message: `File read: ${path}`,
        data: {
          // The node id is needed by callers that report the read/download to
          // mission tracking: `steal`, `delete_file` and `exfiltrate_data`
          // objectives are bound to `metadata.fileId`. Both `download` call
          // sites previously had no way to obtain it and passed an empty
          // string, so those objectives could never be credited (M12).
          nodeId: file.id,
          path,
          content,
          size: file.size,
          isEncrypted: file.isEncrypted,
          permissions: file.permissions as FilePermissions,
        },
      };
    } catch (error: any) {
      this.logger.error({ err: error }, "Read file error");
      return {
        success: false,
        message: "Failed to read file",
        error: error.message,
      };
    }
  }

  /**
   * Create new file (touch)
   */
  async createFile(
    serverId: string,
    userId: string,
    path: string,
    content: string = "",
    encrypt: boolean = false,
    encryptionKey?: string,
  ): Promise<FileOperationResult> {
    try {
      // Validate path for security
      if (!isPathSafe(path)) {
        return {
          success: false,
          message: `Invalid path: ${path}`,
          error: "INVALID_PATH",
        };
      }

      const { directory, filename } = this.splitPath(path);

      // Validate filename
      if (!isValidFilename(filename)) {
        return {
          success: false,
          message: `Invalid filename: ${filename}`,
          error: "INVALID_FILENAME",
        };
      }
      const dirResolution = await this.resolvePath(serverId, directory);

      if (!dirResolution.exists) {
        return {
          success: false,
          message: `Directory not found: ${directory}`,
          error: "DIRECTORY_NOT_FOUND",
        };
      }

      const accessLevel = await this.getUserAccessLevel(userId, serverId);

      // Check write permission on parent directory
      // We need to fetch parent node to pass it, or just pass ID and let it fetch
      // Since we have dirResolution.nodeId, but not the full node object with permissions in resolution (it has node property but type is FileNode | undefined)
      // resolvePath returns node property.
      if (
        !(await this.canWrite(
          userId,
          dirResolution.node as unknown as FileNode,
          accessLevel,
        ))
      ) {
        return {
          success: false,
          message: `Permission denied: cannot create file in ${directory}`,
          error: "PERMISSION_DENIED",
        };
      }

      // Check if file already exists
      const existing = await prisma.fileSystemNode.findFirst({
        where: {
          serverId,
          parentId: dirResolution.nodeId,
          name: filename,
        },
      });

      if (existing) {
        return {
          success: false,
          message: `File already exists: ${path}`,
          error: "FILE_EXISTS",
        };
      }

      // Handle encryption
      let finalContent = content;
      let finalEncryptionKey: string | null = null;
      if (encrypt) {
        const key = encryptionKey || this.generateEncryptionKey();
        finalContent = await this.encryptContent(content, key);
        finalEncryptionKey = key;
      }

      // Create file
      const file = await prisma.fileSystemNode.create({
        data: {
          serverId,
          parentId: dirResolution.nodeId,
          name: filename,
          type: "file",
          content: finalContent,
          size: content.length,
          createdBy: userId,
          isEncrypted: encrypt,
          encryptionKey: finalEncryptionKey,
          isHidden: filename.startsWith("."),
          isProtected: false,
          permissions:
            this.getDefaultPermissions() as unknown as Prisma.JsonObject,
        },
      });

      await this.logFileAccess(userId, serverId, file.id, "create");

      // Track for mission objectives (file upload/creation)
      if (this.missionIntegration) {
        await this.missionIntegration.onFileOperation(
          userId,
          "upload",
          file.id,
          serverId,
        );
      }
      return {
        success: true,
        message: `Created file: ${path}`,
        data: {
          id: file.id,
          path,
          size: file.size,
          isEncrypted: encrypt,
          encryptionKey: encrypt ? finalEncryptionKey : undefined,
        },
      };
    } catch (error: any) {
      // D7: losing the race to `@@unique([serverId, parentId, name])` means the
      // file exists — the same answer the check above gives, so report it the
      // same way instead of a generic failure. Deliberately NOT an upsert: two
      // players racing `touch` must not silently overwrite each other's file.
      if (error?.code === "P2002") {
        return {
          success: false,
          message: `File already exists: ${path}`,
          error: "FILE_EXISTS",
        };
      }
      this.logger.error({ err: error }, "Create file error");
      return {
        success: false,
        message: "Failed to create file",
        error: error.message,
      };
    }
  }

  /**
   * Update file content (write/append)
   */
  async updateFileContent(
    serverId: string,
    userId: string,
    path: string,
    content: string,
    append: boolean = false,
  ): Promise<FileOperationResult> {
    try {
      // Validate path for security
      if (!isPathSafe(path)) {
        return {
          success: false,
          message: `Invalid path: ${path}`,
          error: "INVALID_PATH",
        };
      }
      const resolution = await this.resolvePath(serverId, path);

      if (!resolution.exists || !resolution.node) {
        return {
          success: false,
          message: `File not found: ${path}`,
          error: "NOT_FOUND",
        };
      }

      const file = resolution.node;
      const accessLevel = await this.getUserAccessLevel(userId, serverId);

      // Check write permission
      if (
        !(await this.canWrite(userId, file as unknown as FileNode, accessLevel))
      ) {
        return {
          success: false,
          message: `Permission denied: ${path}`,
          error: "PERMISSION_DENIED",
        };
      }

      if (file.type === "directory") {
        return {
          success: false,
          message: `${path} is a directory`,
          error: "IS_DIRECTORY",
        };
      }

      let newContent = content;
      if (append && file.content) {
        // If encrypted, we'd need to decrypt first, append, then re-encrypt
        // For now, assume simple append for non-encrypted or raw append
        if (file.isEncrypted) {
          return {
            success: false,
            message: "Cannot append to encrypted file directly",
            error: "ENCRYPTED_APPEND_NOT_SUPPORTED",
          };
        }
        newContent = file.content + "\n" + content;
      } else if (file.isEncrypted) {
        // Overwriting encrypted file - re-encrypt if needed or keep as is?
        // For simplicity, let's say we just update the content and keep encryption status if we had the key,
        // but here we are just writing raw string.
        // If the file was encrypted, we should probably reset encryption unless we handle it.
        // Let's just update content and set isEncrypted to false for now as we are writing plain text.
        // Realistically we should ask for encryption key or flag.
      }

      await prisma.fileSystemNode.update({
        where: { id: file.id },
        data: {
          content: newContent,
          size: newContent.length,
          modifiedAt: new Date(),
          isEncrypted: false, // Reset encryption on overwrite/append for now
          encryptionKey: null,
        },
      });

      await this.logFileAccess(userId, serverId, file.id, "write");

      return {
        success: true,
        message: `Updated file: ${path}`,
        data: {
          path,
          size: newContent.length,
        },
      };
    } catch (error: any) {
      this.logger.error({ err: error }, "Update file error");
      return {
        success: false,
        message: "Failed to update file",
        error: error.message,
      };
    }
  }

  /**
   * Create new directory (mkdir)
   */
  async createDirectory(
    serverId: string,
    userId: string,
    path: string,
  ): Promise<FileOperationResult> {
    try {
      // Validate path for security
      if (!isPathSafe(path)) {
        return {
          success: false,
          message: `Invalid path: ${path}`,
          error: "INVALID_PATH",
        };
      }

      const { directory, filename: dirName } = this.splitPath(path);

      // Validate directory name
      if (!isValidFilename(dirName)) {
        return {
          success: false,
          message: `Invalid directory name: ${dirName}`,
          error: "INVALID_DIRNAME",
        };
      }
      const parentResolution = await this.resolvePath(serverId, directory);

      if (!parentResolution.exists) {
        return {
          success: false,
          message: `Parent directory not found: ${directory}`,
          error: "PARENT_NOT_FOUND",
        };
      }

      const accessLevel = await this.getUserAccessLevel(userId, serverId);

      // Check write permission
      if (
        !(await this.canWrite(
          userId,
          parentResolution.node as unknown as FileNode,
          accessLevel,
        ))
      ) {
        return {
          success: false,
          message: `Permission denied: cannot create directory in ${directory}`,
          error: "PERMISSION_DENIED",
        };
      }

      // Check if directory already exists
      const existing = await prisma.fileSystemNode.findFirst({
        where: {
          serverId,
          parentId: parentResolution.nodeId,
          name: dirName,
        },
      });

      if (existing) {
        return {
          success: false,
          message: `Directory already exists: ${path}`,
          error: "DIRECTORY_EXISTS",
        };
      }

      // Create directory
      const dir = await prisma.fileSystemNode.create({
        data: {
          serverId,
          parentId: parentResolution.nodeId,
          name: dirName,
          type: "directory",
          content: null,
          size: 0,
          createdBy: userId,
          isEncrypted: false,
          encryptionKey: null,
          isHidden: dirName.startsWith("."),
          isProtected: false,
          permissions:
            this.getDefaultPermissions() as unknown as Prisma.JsonObject,
        },
      });

      await this.logFileAccess(userId, serverId, dir.id, "create");

      return {
        success: true,
        message: `Created directory: ${path}`,
        data: {
          id: dir.id,
          path,
        },
      };
    } catch (error: any) {
      // D7: see createFile — a lost race means it already exists.
      if (error?.code === "P2002") {
        return {
          success: false,
          message: `Directory already exists: ${path}`,
          error: "DIRECTORY_EXISTS",
        };
      }
      this.logger.error({ err: error }, "Create directory error");
      return {
        success: false,
        message: "Failed to create directory",
        error: error.message,
      };
    }
  }

  /**
   * Delete file or directory (rm)
   */
  async deleteNode(
    serverId: string,
    userId: string,
    path: string,
    recursive: boolean = false,
  ): Promise<FileOperationResult> {
    try {
      // Validate path for security
      if (!isPathSafe(path)) {
        return {
          success: false,
          message: `Invalid path: ${path}`,
          error: "INVALID_PATH",
        };
      }
      const resolution = await this.resolvePath(serverId, path);

      if (!resolution.exists || !resolution.node) {
        return {
          success: false,
          message: `Not found: ${path}`,
          error: "NOT_FOUND",
        };
      }

      const node = resolution.node;
      const accessLevel = await this.getUserAccessLevel(userId, serverId);

      // Check if protected
      if (node.isProtected) {
        return {
          success: false,
          message: `Cannot delete protected item: ${path}`,
          error: "PROTECTED",
        };
      }

      // Check write permission
      if (
        !(await this.canWrite(userId, node as unknown as FileNode, accessLevel))
      ) {
        return {
          success: false,
          message: `Permission denied: ${path}`,
          error: "PERMISSION_DENIED",
        };
      }

      // Check if directory has children
      if (node.type === "directory") {
        const children = await prisma.fileSystemNode.count({
          where: { parentId: node.id },
        });

        if (children > 0 && !recursive) {
          return {
            success: false,
            message: `Directory not empty: ${path}. Use --recursive to force delete.`,
            error: "DIRECTORY_NOT_EMPTY",
          };
        }

        // R11: protection has to hold for DESCENDANTS too.
        //
        // `isProtected` was checked on the target only, and the recursive
        // delete is performed by the database — `parent ... onDelete: Cascade`
        // on the self-relation — which consults no application flags. So
        // `rm -r` on an unprotected parent destroyed protected children
        // inside it. World provisioning marks story files `isProtected: true`,
        // so deleting one directory could take authored content with it.
        if (recursive && children > 0) {
          const protectedChild = await this.findProtectedDescendant(node.id);
          if (protectedChild) {
            return {
              success: false,
              message:
                `Cannot delete ${path}: it contains a protected item ` +
                `(${protectedChild})`,
              error: "PROTECTED",
            };
          }
        }


      }

      // ── Before deletion: check for access key revocation + honeypot ──
      const nodeMeta = node.metadata as Record<string, unknown> | null;

      // If this is a downloaded file, revoke any access keys it granted
      if (node.type === "file" && nodeMeta?.isDownloaded === true) {
        const revokeResult = await prisma.serverAccessKey.deleteMany({
          where: { sourceFileId: node.id },
        });
        if (revokeResult.count > 0) {
          this.logger.info(
            { userId, fileId: node.id, keysRevoked: revokeResult.count },
            "Access keys revoked due to downloaded file deletion",
          );
        }
      }

      // If this is a honeypot decoy and deleted by someone other than the owner, alert
      if (node.type === "file" && nodeMeta?.isDecoy === true) {
        const ownerServer = await prisma.gameServer.findUnique({
          where: { id: serverId },
          select: { ownerId: true, isPlayerHome: true },
        });
        if (ownerServer?.isPlayerHome && ownerServer.ownerId && ownerServer.ownerId !== userId) {
          await this.alertHoneypot(ownerServer.ownerId, serverId, node.name, userId, "delete");
        }
      }

      // Delete node (cascade delete handles children)
      await prisma.fileSystemNode.delete({
        where: { id: node.id },
      });

      await this.logFileAccess(userId, serverId, node.id, "delete");

      // Track for mission objectives
      if (this.missionIntegration) {
        await this.missionIntegration.onFileOperation(
          userId,
          "delete",
          node.id,
          serverId,
        );
      }

      return {
        success: true,
        message: `Deleted: ${path}`,
        data: { path, type: node.type },
      };
    } catch (error: any) {
      this.logger.error({ err: error }, "Delete node error");
      return {
        success: false,
        message: "Failed to delete",
        error: error.message,
      };
    }
  }

  /**
   * Copy file or directory (cp)
   */
  async copyNode(
    serverId: string,
    userId: string,
    sourcePath: string,
    destPath: string,
  ): Promise<FileOperationResult> {
    try {
      // Validate paths for security
      if (!isPathSafe(sourcePath) || !isPathSafe(destPath)) {
        return {
          success: false,
          message: `Invalid path`,
          error: "INVALID_PATH",
        };
      }
      const sourceResolution = await this.resolvePath(serverId, sourcePath);

      if (!sourceResolution.exists || !sourceResolution.node) {
        return {
          success: false,
          message: `Source not found: ${sourcePath}`,
          error: "SOURCE_NOT_FOUND",
        };
      }

      const accessLevel = await this.getUserAccessLevel(userId, serverId);

      // Check read permission on source
      if (
        !(await this.canRead(
          userId,
          sourceResolution.node as unknown as FileNode,
          accessLevel,
        ))
      ) {
        return {
          success: false,
          message: `Permission denied: cannot read ${sourcePath}`,
          error: "PERMISSION_DENIED",
        };
      }

      const { directory: destDir, filename: destName } =
        this.splitPath(destPath);
      const destDirResolution = await this.resolvePath(serverId, destDir);

      if (!destDirResolution.exists) {
        return {
          success: false,
          message: `Destination directory not found: ${destDir}`,
          error: "DEST_NOT_FOUND",
        };
      }

      // Check write permission on destination
      if (
        !(await this.canWrite(
          userId,
          destDirResolution.node as unknown as FileNode,
          accessLevel,
        ))
      ) {
        return {
          success: false,
          message: `Permission denied: cannot write to ${destDir}`,
          error: "PERMISSION_DENIED",
        };
      }

      // REVIEW FIX: refuse copying a directory into its own subtree.
      //
      // R11 added this guard to `moveNode` and not to `copyNode`, where the
      // consequence is worse: `cp /data /data/backup` recursed without bound,
      // creating rows until the database or the heap gave out while the
      // request never returned. `mv` at least only corrupts the tree.
      if (
        sourceResolution.node!.type === "directory" &&
        destDirResolution.nodeId &&
        (await this.isDescendantOf(
          destDirResolution.nodeId,
          sourceResolution.node!.id,
        ))
      ) {
        return {
          success: false,
          message: `Cannot copy ${sourcePath} into its own subdirectory`,
          error: "INVALID_COPY",
        };
      }

      // Copy the node
      const copiedNode = await this.duplicateNode(
        sourceResolution.node,
        destDirResolution.nodeId!,
        destName,
        userId,
      );

      await this.logFileAccess(userId, serverId, copiedNode.id, "copy");

      return {
        success: true,
        message: `Copied ${sourcePath} to ${destPath}`,
        data: {
          sourcePath,
          destPath,
          id: copiedNode.id,
        },
      };
    } catch (error: any) {
      // D7: `copyNode` validates the source, the destination DIRECTORY and the
      // permissions, but never that the destination NAME is free — so `cp` onto
      // an existing path used to create a silent duplicate and now hits the
      // unique. Deliberately reported, not merged: `cp` must not clobber a file
      // the player did not ask to overwrite.
      if (error?.code === "P2002") {
        return {
          success: false,
          message: `Destination already exists: ${destPath}`,
          error: "DESTINATION_EXISTS",
        };
      }
      this.logger.error({ err: error }, "Copy node error");
      return {
        success: false,
        message: "Failed to copy",
        error: error.message,
      };
    }
  }

  /**
   * Move/rename file or directory (mv)
   */
  async moveNode(
    serverId: string,
    userId: string,
    sourcePath: string,
    destPath: string,
  ): Promise<FileOperationResult> {
    try {
      // Validate paths for security
      if (!isPathSafe(sourcePath) || !isPathSafe(destPath)) {
        return {
          success: false,
          message: `Invalid path`,
          error: "INVALID_PATH",
        };
      }
      const sourceResolution = await this.resolvePath(serverId, sourcePath);

      if (!sourceResolution.exists || !sourceResolution.node) {
        return {
          success: false,
          message: `Source not found: ${sourcePath}`,
          error: "SOURCE_NOT_FOUND",
        };
      }

      const sourceNode = sourceResolution.node;
      const accessLevel = await this.getUserAccessLevel(userId, serverId);

      // Check if protected
      if (sourceNode.isProtected) {
        return {
          success: false,
          message: `Cannot move protected item: ${sourcePath}`,
          error: "PROTECTED",
        };
      }

      // Check write permission on source
      if (
        !(await this.canWrite(
          userId,
          sourceNode as unknown as FileNode,
          accessLevel,
        ))
      ) {
        return {
          success: false,
          message: `Permission denied: ${sourcePath}`,
          error: "PERMISSION_DENIED",
        };
      }

      const { directory: destDir, filename: destName } =
        this.splitPath(destPath);
      const destDirResolution = await this.resolvePath(serverId, destDir);

      if (!destDirResolution.exists) {
        return {
          success: false,
          message: `Destination directory not found: ${destDir}`,
          error: "DEST_NOT_FOUND",
        };
      }

      // Check write permission on destination
      if (
        !(await this.canWrite(
          userId,
          destDirResolution.node as unknown as FileNode,
          accessLevel,
        ))
      ) {
        return {
          success: false,
          message: `Permission denied: cannot write to ${destDir}`,
          error: "PERMISSION_DENIED",
        };
      }

      // R11: refuse to move a directory into its own subtree.
      //
      // There was no such check, so `mv /a /a/b` simply set `/a`'s parent to a
      // node beneath it. The result is a cycle that is unreachable from the
      // root, which silently orphans the whole subtree — every file under it
      // becomes invisible to `ls`/`cd` while still occupying rows, and
      // `onDelete: Cascade` on the self-relation makes the cleanup semantics
      // of that loop anyone's guess.
      if (
        sourceNode.type === "directory" &&
        destDirResolution.nodeId &&
        (await this.isDescendantOf(destDirResolution.nodeId, sourceNode.id))
      ) {
        return {
          success: false,
          message: `Cannot move ${sourcePath} into its own subdirectory`,
          error: "INVALID_MOVE",
        };
      }

      // Update the node
      await prisma.fileSystemNode.update({
        where: { id: sourceNode.id },
        data: {
          parentId: destDirResolution.nodeId,
          name: destName,
        },
      });

      await this.logFileAccess(userId, serverId, sourceNode.id, "move");

      return {
        success: true,
        message: `Moved ${sourcePath} to ${destPath}`,
        data: {
          sourcePath,
          destPath,
          id: sourceNode.id,
        },
      };
    } catch (error: any) {
      // D7: `mv` has the same collision semantics as `cp` and needs the same
      // answer. `moveNode` never checks the destination NAME is free, so before
      // the unique existed it silently created a duplicate, and after it the raw
      // Prisma string ("Unique constraint failed on the fields: …") was handed
      // straight to the player's terminal.
      if (error?.code === "P2002") {
        return {
          success: false,
          message: `Destination already exists: ${destPath}`,
          error: "DESTINATION_EXISTS",
        };
      }
      this.logger.error({ err: error }, "Move node error");
      return {
        success: false,
        message: "Failed to move",
        error: error.message,
      };
    }
  }

  // ==================== PERMISSION HELPERS ====================

  /**
   * Check if user can read a file/directory
   */
  /**
   * S10 — may this user read this file, by id?
   *
   * Public because command modules need the question answered without being
   * handed `canRead`/`getUserAccessLevel`, which are internals. Added for
   * `report file`, which looked a file up by a CLIENT-SUPPLIED id with no
   * permission check at all: any player could report any file in the game and
   * leak its name, server, hidden and encrypted flags into faction knowledge.
   */
  public async canUserReadFile(
    userId: string,
    fileId: string,
    currentServerId?: string,
  ): Promise<boolean> {
    const node = await prisma.fileSystemNode.findUnique({ where: { id: fileId } });
    if (!node) return false;
    const accessLevel = await this.getUserAccessLevel(userId, node.serverId);

    // REACHABILITY. `canRead` alone does not deliver the "servers they have
    // never reached" property the callers claim, because world content is
    // seeded with `others: 5` (READ|EXECUTE) and `requiredAccessLevel: 0` —
    // see serverContentService/contentDraftService. Every such file therefore
    // returns true from `canRead` for ANY user on ANY server, so an id alone
    // was still enough to report a file the player has never been near.
    //
    // `getUserAccessLevel` is >0 only for a server you own or have
    // successfully hacked, so pair it with "or you are standing on it".
    const reachable = accessLevel > 0 || (!!currentServerId && node.serverId === currentServerId);
    if (!reachable) return false;

    return this.canRead(userId, node as unknown as FileNode, accessLevel);
  }

  private async canRead(
    userId: string,
    nodeOrId: string | FileNode,
    accessLevel: number,
  ): Promise<boolean> {
    let node: FileNode | null = null;

    if (typeof nodeOrId === "string") {
      const fetched = await prisma.fileSystemNode.findUnique({
        where: { id: nodeOrId },
      });
      node = fetched as unknown as FileNode;
    } else {
      node = nodeOrId;
    }

    if (!node) return false;

    const permissions = node.permissions as unknown as FilePermissions;

    // Owner always gets owner-level permissions
    if (node.createdBy === userId) {
      return (permissions.owner & PermissionLevel.READ) !== 0;
    }

    // Game mechanic: file requires a minimum hack access level
    if (
      permissions.requiredAccessLevel &&
      accessLevel < permissions.requiredAccessLevel
    ) {
      // Connected players (accessLevel >= 0) can always read non-restricted directories
      // Only block if requiredAccessLevel > 1 (i.e., needs actual hacking)
      if (permissions.requiredAccessLevel > 1) {
        return false;
      }
    }

    // If others permission allows read, allow it
    if ((permissions.others & PermissionLevel.READ) !== 0) {
      return true;
    }

    // Connected player with any access can read basic filesystem structure
    // (directories with requiredAccessLevel <= 1 are navigable)
    if (node.type === "directory" && (!permissions.requiredAccessLevel || permissions.requiredAccessLevel <= 1)) {
      return true;
    }

    return false;
  }

  /**
   * Check if user can write to a file/directory
   */
  private async canWrite(
    userId: string,
    nodeOrId: string | FileNode,
    accessLevel: number,
  ): Promise<boolean> {
    let node: FileNode | null = null;

    if (typeof nodeOrId === "string") {
      const fetched = await prisma.fileSystemNode.findUnique({
        where: { id: nodeOrId },
      });
      node = fetched as unknown as FileNode;
    } else {
      node = nodeOrId;
    }

    if (!node) return false;

    const permissions = node.permissions as unknown as FilePermissions;

    // Root-level access + owner bypasses protected flag
    if (accessLevel >= 10 && node.createdBy === userId) {
      return true;
    }

    // Protected files cannot be modified by non-owners
    if (node.isProtected) return false;

    // Game mechanic: file requires a minimum hack access level
    if (
      permissions.requiredAccessLevel &&
      accessLevel < permissions.requiredAccessLevel
    ) {
      return false;
    }

    if (node.createdBy === userId) {
      return (permissions.owner & PermissionLevel.WRITE) !== 0;
    }

    return (permissions.others & PermissionLevel.WRITE) !== 0;
  }

  /**
   * Get user's access level on a server (from hack logs or server ownership)
   */
  private async getUserAccessLevel(
    userId: string,
    serverId: string,
  ): Promise<number> {
    // Check cache
    const cacheKey = `access_level:${userId}:${serverId}`;
    const cached = this.cacheService.get<number>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    // Check if user owns the server
    const server = await prisma.gameServer.findUnique({
      where: { id: serverId },
    });

    if (server?.ownerId === userId) {
      return 10; // Full access
    }

    // Check latest successful hack
    const latestHack = await prisma.hackLog.findFirst({
      where: {
        attackerId: userId,
        targetServerId: serverId,
        success: true,
      },
      orderBy: { timestamp: "desc" },
    });

    const level = latestHack?.accessLevel || 0;

    // Cache result (short TTL as access level can change)
    this.cacheService.set(cacheKey, level, 60);

    return level;
  }

  // ==================== PATH RESOLUTION ====================

  /**
   * Resolve a path to a node ID
   */
  async resolvePath(
    serverId: string,
    path: string,
  ): Promise<PathResolution> {
    try {
      // Normalize path
      const normalizedPath = this.normalizePath(path);

      if (normalizedPath === "/") {
        // Root directory
        const root = await prisma.fileSystemNode.findFirst({
          where: {
            serverId,
            parentId: null,
            type: "directory",
          },
        });

        return {
          nodeId: root?.id || null,
          path: "/",
          exists: !!root,
          isDirectory: true,
          node: root ? (root as unknown as FileNode) : (undefined as any),
        };
      }

      // Split path into components
      const components = normalizedPath.split("/").filter((c) => c.length > 0);

      // Start from root
      let currentNode = await prisma.fileSystemNode.findFirst({
        where: {
          serverId,
          parentId: null,
          type: "directory",
        },
      });

      if (!currentNode) {
        return {
          nodeId: null,
          path: normalizedPath,
          exists: false,
          isDirectory: false,
        };
      }

      // Traverse path
      for (const component of components) {
        if (!currentNode) break;

        const child: any = await prisma.fileSystemNode.findFirst({
          where: {
            serverId,
            parentId: currentNode.id,
            name: component,
          },
        });

        if (!child) {
          return {
            nodeId: null,
            path: normalizedPath,
            exists: false,
            isDirectory: false,
          };
        }

        currentNode = child;
      }

      if (!currentNode) {
        return {
          nodeId: null,
          path: normalizedPath,
          exists: false,
          isDirectory: false,
        };
      }

      return {
        nodeId: currentNode.id,
        path: normalizedPath,
        exists: true,
        isDirectory: currentNode.type === "directory",
        node: currentNode as unknown as FileNode,
      };
    } catch (error) {
      this.logger.error({ err: error }, "Path resolution error");
      return {
        nodeId: null,
        path,
        exists: false,
        isDirectory: false,
      };
    }
  }

  /**
   * Normalize a path (remove .., ., multiple slashes)
   */
  private normalizePath(path: string): string {
    // Use the central path sanitizer for security. Statically imported —
    // pathSanitizer is a dependency-free leaf module, so there is no cycle to
    // break, and this sits in the hot path for every file operation.
    return sanitizePath(path);
  }

  /**
   * Split path into directory and filename
   */
  private splitPath(path: string): { directory: string; filename: string } {
    const normalized = this.normalizePath(path);
    const lastSlash = normalized.lastIndexOf("/");

    if (lastSlash === 0) {
      return {
        directory: "/",
        filename: normalized.substring(1),
      };
    }

    return {
      directory: normalized.substring(0, lastSlash) || "/",
      filename: normalized.substring(lastSlash + 1),
    };
  }

  // ==================== ENCRYPTION ====================

  /**
   * R10: delegates to `utils/contentCrypto`. This file and
   * `messageEncryptionService` each carried a byte-identical copy of the same
   * CBC + blocking-scrypt implementation.
   */
  private async encryptContent(content: string, key: string): Promise<string> {
    return encryptPayload(content, key);
  }

  private async decryptContent(
    encryptedContent: string,
    key: string,
  ): Promise<string> {
    return decryptPayload(encryptedContent, key);
  }

  /**
   * R9 — turn a cracked file into readable plaintext, atomically.
   *
   * The crack flow used to do `{ isEncrypted: false, encryptionKey: null }`
   * and nothing else: it destroyed the only key to content it left encrypted,
   * then labelled that ciphertext as plaintext. A "successful" crack was the
   * operation that made the file permanently unreadable.
   *
   * Lives here, not in the command module, so the decrypt-then-clear sequence
   * has ONE implementation that the verification harness exercises directly.
   *
   * Returns false without touching the row if decryption fails, because a
   * half-converted file is what made the original bug unrecoverable.
   */
  public async unlockCrackedFile(fileId: string): Promise<boolean> {
    const node = await prisma.fileSystemNode.findUnique({
      where: { id: fileId },
      select: { content: true, encryptionKey: true },
    });
    if (!node) return false;

    let plaintext = node.content ?? "";
    if (node.encryptionKey) {
      try {
        plaintext = await this.decryptContent(plaintext, node.encryptionKey);
      } catch (err) {
        this.logger.error(
          { err, fileId },
          "Crack succeeded but decryption failed — file left untouched",
        );
        return false;
      }
    }

    await prisma.fileSystemNode.update({
      where: { id: fileId },
      data: {
        content: plaintext,
        size: plaintext.length,
        isEncrypted: false,
        encryptionKey: null,
      },
    });
    return true;
  }


  /**
   * Set a node's protection / visibility flags as a SYSTEM action — no access
   * check, because the callers are game mechanics that have already decided
   * (a spent Quantum charge, a won crack.storm, a vault the owner configured).
   * A4: these were direct fileSystemNode.update calls in the command modules.
   */
  public async setNodeFlags(
    nodeId: string,
    flags: { isProtected?: boolean; isHidden?: boolean },
  ): Promise<void> {
    await prisma.fileSystemNode.update({ where: { id: nodeId }, data: flags });
  }

  /**
   * Delete a node as a SYSTEM action, revoking every access key it granted —
   * a key whose source file is gone would otherwise outlive it (the user-facing
   * delete above does the same revocation). Used by bounty completion to purge
   * a target's stolen files. Idempotent: an already-deleted node reports
   * `deleted: false` instead of throwing.
   */
  public async purgeNode(nodeId: string): Promise<{ deleted: boolean; keysRevoked: number }> {
    const revoked = await prisma.serverAccessKey.deleteMany({ where: { sourceFileId: nodeId } });
    const gone = await prisma.fileSystemNode.deleteMany({ where: { id: nodeId } });
    return { deleted: gone.count === 1, keysRevoked: revoked.count };
  }

  /**
   * Generate random encryption key
   */
  private generateEncryptionKey(): string {
    return crypto.randomBytes(32).toString("hex");
  }

  // ==================== HELPERS ====================

  /**
   * Get default permissions for new files/directories
   */
  private getDefaultPermissions(): FilePermissions {
    return {
      owner: PermissionLevel.FULL, // owner can read/write/execute/delete
      faction: PermissionLevel.READ, // faction members can read
      others: PermissionLevel.READ, // connected players can read
      requiredAccessLevel: 0, // no hack required for basic access
    };
  }

  /**
   * Format permissions as Unix-style string (e.g., "rwxr-xr--")
   */
  private formatPermissions(permissions: FilePermissions): string {
    const decode = (level: number): string =>
      [
        level & PermissionLevel.READ ? "r" : "-",
        level & PermissionLevel.WRITE ? "w" : "-",
        level & PermissionLevel.EXECUTE ? "x" : "-",
      ].join("");
    return (
      decode(permissions.owner) +
      decode(permissions.faction) +
      decode(permissions.others)
    );
  }

  /**
   * Duplicate a node (for copy operation)
   */
  /**
   * R11 — may this user read every directory on the way to `nodeId`?
   *
   * Permissions were checked on the TARGET only, so a file could be read
   * through a directory the player had no business entering: a file with
   * `requiredAccessLevel: 0` sitting inside a directory with
   * `requiredAccessLevel: 5` was readable by anyone who knew the path, and
   * hacking the server to raise your access level was optional.
   *
   * Note this is not as strict as it could be: `canRead` deliberately lets any
   * connected player read a directory whose `requiredAccessLevel` is 0 or 1
   * (that is what makes `ls`/`cd` work at all), so this enforces the
   * high-security directories rather than every `others` bit. Tightening
   * further would need the permission model revisited, not a stricter walk.
   */
  private async canReadAncestors(
    userId: string,
    nodeId: string,
    accessLevel: number,
  ): Promise<boolean> {
    const start = await prisma.fileSystemNode.findUnique({
      where: { id: nodeId },
      select: { parentId: true },
    });

    let currentId = start?.parentId ?? null;
    const seen = new Set<string>();

    while (currentId) {
      if (seen.has(currentId)) break; // pre-existing cycle; see `isDescendantOf`
      seen.add(currentId);

      const dir = await prisma.fileSystemNode.findUnique({
        where: { id: currentId },
      });
      if (!dir) break;

      if (!(await this.canRead(userId, dir as unknown as FileNode, accessLevel))) {
        return false;
      }
      currentId = dir.parentId;
    }
    return true;
  }

  /**
   * R11 — find a protected node anywhere beneath `rootId`, or null.
   *
   * Breadth-first over the subtree, because the delete it guards is performed
   * by a database cascade that cannot consult application flags. Returns the
   * offending NAME so the refusal can say which file it is protecting rather
   * than just refusing.
   */
  private async findProtectedDescendant(
    rootId: string,
  ): Promise<string | null> {
    let frontier = [rootId];
    const seen = new Set<string>([rootId]);

    while (frontier.length > 0) {
      const children = await prisma.fileSystemNode.findMany({
        where: { parentId: { in: frontier } },
        select: { id: true, name: true, isProtected: true },
      });
      if (children.length === 0) return null;

      const hit = children.find((c) => c.isProtected);
      if (hit) return hit.name;

      frontier = [];
      for (const c of children) {
        // Guard against a pre-existing cycle in the data; see `isDescendantOf`.
        if (!seen.has(c.id)) {
          seen.add(c.id);
          frontier.push(c.id);
        }
      }
    }
    return null;
  }

  /**
   * R11 — is `candidateId` inside the subtree rooted at `ancestorId`?
   *
   * Walks parents rather than descendants: a path to the root is bounded by
   * depth, while enumerating a subtree is bounded by size. The visited set is
   * not paranoia — if a cycle already exists in the data (this check is new,
   * so some may), walking parents would otherwise never terminate.
   */
  private async isDescendantOf(
    candidateId: string,
    ancestorId: string,
  ): Promise<boolean> {
    const seen = new Set<string>();
    let currentId: string | null = candidateId;

    while (currentId) {
      if (currentId === ancestorId) return true;
      if (seen.has(currentId)) break; // pre-existing cycle; stop rather than hang
      seen.add(currentId);

      const row: { parentId: string | null } | null =
        await prisma.fileSystemNode.findUnique({
          where: { id: currentId },
          select: { parentId: true },
        });
      currentId = row?.parentId ?? null;
    }
    return false;
  }

  private async duplicateNode(
    sourceNode: FileNode,
    newParentId: string,
    newName: string,
    userId: string,
  ): Promise<any> {
    // REVIEW FIX: read the child list BEFORE creating the copy.
    //
    // `create` ran first, so when a directory is copied INTO ITSELF the fresh
    // copy appears in its own `findMany({ parentId: sourceNode.id })` result
    // and the recursion never terminates. R11's naming fix is what exposed
    // this: while every child was (wrongly) named after the destination, the
    // second one hit `@@unique([serverId, parentId, name])` and P2002 aborted
    // the copy — an accidental brake that the correct naming removed.
    const children =
      sourceNode.type === "directory"
        ? await prisma.fileSystemNode.findMany({
            where: { parentId: sourceNode.id },
          })
        : [];

    const newNode = await prisma.fileSystemNode.create({
      data: {
        serverId: sourceNode.serverId,
        parentId: newParentId,
        name: newName,
        type: sourceNode.type,
        content: sourceNode.content,
        size: sourceNode.size,
        createdBy: userId,
        isEncrypted: sourceNode.isEncrypted,
        encryptionKey: sourceNode.encryptionKey,
        isHidden: sourceNode.isHidden,
        isProtected: false,
        permissions: sourceNode.permissions as unknown as Prisma.JsonObject,
      },
    });

    // If directory, recursively copy children
    if (sourceNode.type === "directory") {
      for (const child of children) {
        await this.duplicateNode(
          child as unknown as FileNode,
          newNode.id,
          // R11: the CHILD's own name. This passed `newName` — the top-level
          // destination name — to every descendant, so `cp -r /data /backup`
          // tried to name every child "backup". Before the Phase 3
          // `@@unique([serverId, parentId, name])` that silently produced N
          // identically-named siblings; after it, the second child raises
          // P2002 and the copy fails partway, leaving a half-written tree.
          child.name,
          userId,
        );
      }
    }

    return newNode as unknown as FileNode;
  }

  /**
   * Log file access for audit trail
   */
  private async logFileAccess(
    userId: string,
    serverId: string,
    fileId: string,
    action: string,
  ): Promise<void> {
    try {
      // Create audit log entry
      await prisma.auditLog.create({
        data: {
          userId,
          action: `file_${action}`,
          resource: "file_system",
          resourceId: fileId,
          metadata: {
            serverId,
            fileId,
            action,
          },
        },
      });

      // Update file access tracking (for read operations primarily)
      if (action === "read" || action === "access") {
        await prisma.fileSystemNode.update({
          where: { id: fileId },
          data: {
            lastAccessedAt: new Date(),
            lastAccessedBy: userId,
          },
        });
      }
    } catch (error) {
      this.logger.error({ err: error }, "Failed to log file access");
    }
  }

  // ==================== INITIALIZATION ====================

  /**
   * Initialize root file system for a server
   */
  async initializeFileSystem(serverId: string, ownerId: string): Promise<void> {
    try {
      // Validate ownerId is a real user — use null if not (system/dungeon servers)
      let validOwnerId: string | null = ownerId || null;
      if (validOwnerId) {
        const ownerExists = await prisma.user.findUnique({
          where: { id: validOwnerId },
          select: { id: true },
        });
        if (!ownerExists) validOwnerId = null;
      }

      // Check if root already exists
      let root = await prisma.fileSystemNode.findFirst({
        where: {
          serverId,
          parentId: null,
          type: "directory",
        },
      });

      if (!root) {
        // D7: a DETERMINISTIC id makes the primary key close this race.
        // `@@unique([serverId, parentId, name])` does not cover roots —
        // `parentId` is null and Postgres treats NULLs as distinct — so the
        // `findFirst` above is a check-then-create with an await before the
        // write, and two concurrent initialisations both saw no root. That is
        // how one AI-provisioned server ended up with two `/home` directories.
        // Upserting on `root_<serverId>` means the loser collides on the PK and
        // resolves to the winner's row instead of minting a second tree.
        // The `findFirst` is kept because roots created before this have cuids.
        root = await prisma.fileSystemNode.upsert({
          where: { id: `root_${serverId}` },
          update: {},
          create: {
            id: `root_${serverId}`,
            serverId,
            parentId: null,
            name: "/",
            type: "directory",
            content: null,
            size: 0,
            createdBy: validOwnerId,
            isEncrypted: false,
            encryptionKey: null,
            isHidden: false,
            isProtected: true,
            permissions: {
              owner: PermissionLevel.FULL,
              faction: PermissionLevel.READ | PermissionLevel.EXECUTE,
              others: PermissionLevel.READ | PermissionLevel.EXECUTE,
              requiredAccessLevel: 0,
            } as unknown as Prisma.JsonObject,
          },
        });
        this.logger.info({ serverId }, "Created root directory for server");
      }

      // Check which common directories already exist
      const commonDirs = ["home", "bin", "etc", "var", "tmp", "logs"];
      const existingDirs = await prisma.fileSystemNode.findMany({
        where: {
          serverId,
          parentId: root.id,
          type: "directory",
          name: {
            in: commonDirs,
          },
        },
        select: {
          name: true,
        },
      });

      const existingDirNames = existingDirs.map((d) => d.name);
      const missingDirs = commonDirs.filter(
        (d) => !existingDirNames.includes(d),
      );

      // Create only missing directories.
      // D7: upsert, because `missingDirs` was computed before this loop and a
      // concurrent initialiser can create the same directory in between —
      // children ARE covered by the unique, so this now merges instead of
      // throwing P2002.
      for (const dirName of missingDirs) {
        await prisma.fileSystemNode.upsert({
          where: {
            serverId_parentId_name: { serverId, parentId: root.id, name: dirName },
          },
          update: {},
          create: {
            serverId,
            parentId: root.id,
            name: dirName,
            type: "directory",
            content: null,
            size: 0,
            createdBy: validOwnerId,
            isEncrypted: false,
            encryptionKey: null,
            isHidden: false,
            isProtected: dirName === "bin" || dirName === "etc",
            permissions:
              this.getDefaultPermissions() as unknown as Prisma.JsonObject,
          },
        });
      }

      this.logger.info({ serverId }, "File system initialized for server");
    } catch (error) {
      this.logger.error({ err: error }, "Failed to initialize file system");
      throw error;
    }
  }

  // ==================== ACCESS KEY DETECTION ====================

  /**
   * Returns servers with access keys, cached for 5 minutes to avoid
   * unbounded queries on every file download.
   */
  private async getAccessKeyServers(excludeServerId: string) {
    if (this.accessKeyCache && this.accessKeyCache.expiresAt > Date.now()) {
      return this.accessKeyCache.data.filter((s) => s.id !== excludeServerId);
    }

    const servers = await prisma.gameServer.findMany({
      where: { accessKey: { not: null } },
      select: { id: true, name: true, accessKey: true },
    });

    this.accessKeyCache = {
      data: servers as Array<{ id: string; name: string; accessKey: string }>,
      expiresAt: Date.now() + FileService.ACCESS_KEY_CACHE_TTL,
    };

    return servers.filter((s) => s.id !== excludeServerId);
  }

  /**
   * Scan file content for access keys that match other servers' accessKey fields.
   * When found, automatically grants the player access to those servers.
   *
   * Detects patterns like:
   * - ACCESS_KEY=XYZ or accessKey: XYZ
   * - PASS=XYZ or password: XYZ in context of a server IP
   * - Explicit key tokens like GRN-*, FW-*, CL-* (Garrison), or vault keys
   */
  /**
   * Scan file content for access keys without granting them.
   * Returns server names whose keys appear in the content.
   * Used by `cat` to show a hint that downloading would grant access.
   */
  async scanForAccessKeys(
    content: string,
    serverId: string,
  ): Promise<string[]> {
    if (!this.networkTopology) return [];

    const serversWithKeys = await this.getAccessKeyServers(serverId);
    const found: string[] = [];

    for (const server of serversWithKeys) {
      if (!server.accessKey) continue;
      if (content.includes(server.accessKey)) {
        found.push(server.name);
      }
    }

    return found;
  }

  /**
   * Scan file content for access keys and grant access when found.
   * Returns names of servers whose keys were newly granted.
   */
  async detectAndGrantAccessKeys(
    userId: string,
    content: string,
    serverId: string,
    filePath: string,
    sourceFileId?: string,
  ): Promise<string[]> {
    if (!this.networkTopology) return [];

    const serversWithKeys = await this.getAccessKeyServers(serverId);
    const granted: string[] = [];

    for (const server of serversWithKeys) {
      if (!server.accessKey) continue;

      if (content.includes(server.accessKey)) {
        const alreadyHas = await this.networkTopology.playerHasAccessKey(userId, server.id);
        if (!alreadyHas) {
          await this.networkTopology.grantAccessKey(
            userId,
            server.id,
            server.accessKey,
            "file_download",
            `${serverId}:${filePath}`,
            sourceFileId,
          );

          granted.push(server.name);

          this.logger.info(
            { userId, serverId: server.id, serverName: server.name, sourceFile: filePath, sourceFileId },
            "Access key auto-discovered from downloaded file",
          );
        }
      }
    }

    return granted;
  }
}

export default FileService;
