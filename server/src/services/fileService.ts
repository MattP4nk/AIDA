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

import { prisma } from "../database/client";
import { Server as SocketIOServer } from "socket.io";
import crypto from "crypto";

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
}

export interface FilePermissions {
  [key: string]: any; // Allow index signature for Prisma Json compatibility
  owner: string;
  group?: string;
  ownerRead: boolean;
  ownerWrite: boolean;
  ownerExecute: boolean;
  groupRead: boolean;
  groupWrite: boolean;
  groupExecute: boolean;
  otherRead: boolean;
  otherWrite: boolean;
  otherExecute: boolean;
  requiredAccessLevel?: number; // 0-10, based on hack access level
}

export interface FileSystemEntry {
  name: string;
  type: "file" | "directory";
  size: number;
  modified: Date;
  permissions: string; // Unix-style display (e.g., "rwxr-xr--")
  isEncrypted: boolean;
  isHidden: boolean;
  isProtected: boolean;
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

export class FileService {
  private encryptionAlgorithm = "aes-256-cbc";

  constructor(_io: SocketIOServer) {
    // io parameter kept for future real-time features
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
  ): Promise<FileOperationResult> {
    try {
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

      // Fetch children
      const children = await prisma.fileSystemNode.findMany({
        where: {
          serverId,
          parentId: resolution.nodeId,
          ...(showHidden ? {} : { isHidden: false }),
        },
        orderBy: [
          { type: "desc" }, // directories first
          { name: "asc" },
        ],
      });

      // Filter by permissions
      const visibleEntries: FileSystemEntry[] = [];
      for (const child of children) {
        const permissions = child.permissions as unknown as FilePermissions;
        if (await this.canRead(userId, child.id, accessLevel)) {
          visibleEntries.push({
            name: child.name,
            type: child.type as "file" | "directory",
            size: child.size,
            modified: child.modifiedAt,
            permissions: this.formatPermissions(permissions),
            isEncrypted: child.isEncrypted,
            isHidden: child.isHidden,
            isProtected: child.isProtected,
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
      console.error("List directory error:", error);
      return {
        success: false,
        message: "Failed to list directory",
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

      // Check read permission
      if (!(await this.canRead(userId, file.id, accessLevel))) {
        return {
          success: false,
          message: `Permission denied: ${path}`,
          error: "PERMISSION_DENIED",
        };
      }

      let content = file.content || "";

      // Handle encryption
      if (file.isEncrypted) {
        if (!decryptionKey && file.encryptionKey) {
          return {
            success: false,
            message: "File is encrypted. Decryption key required.",
            error: "ENCRYPTED",
            data: {
              isEncrypted: true,
              hint: "Use --key=<key> or crack the encryption",
            },
          };
        }

        try {
          content = await this.decryptContent(
            content,
            decryptionKey || file.encryptionKey!,
          );
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

      // Log file operation for mission tracking (future integration)
      // Note: Mission objective updates require active mission lookup
      console.log(
        `File operation logged: read ${path} on server ${serverId} by ${userId}`,
      );

      return {
        success: true,
        message: `File read: ${path}`,
        data: {
          path,
          content,
          size: file.size,
          isEncrypted: file.isEncrypted,
          permissions: file.permissions as FilePermissions,
        },
      };
    } catch (error: any) {
      console.error("Read file error:", error);
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
      const { directory, filename } = this.splitPath(path);
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
      if (!(await this.canWrite(userId, dirResolution.nodeId!, accessLevel))) {
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
          permissions: this.getDefaultPermissions(userId) as any,
        },
      });

      await this.logFileAccess(userId, serverId, file.id, "create");

      // Log file operation for mission tracking (future integration)
      console.log(
        `File operation logged: create ${path} on server ${serverId} by ${userId}`,
      );
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
      console.error("Create file error:", error);
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
      if (!(await this.canWrite(userId, file.id, accessLevel))) {
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
      console.error("Update file error:", error);
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
      const { directory, filename: dirName } = this.splitPath(path);
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
        !(await this.canWrite(userId, parentResolution.nodeId!, accessLevel))
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
          permissions: this.getDefaultPermissions(userId) as any,
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
      console.error("Create directory error:", error);
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
      if (!(await this.canWrite(userId, node.id, accessLevel))) {
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
      }

      // Delete node (cascade delete handles children)
      await prisma.fileSystemNode.delete({
        where: { id: node.id },
      });

      await this.logFileAccess(userId, serverId, node.id, "delete");

      // Log file operation for mission tracking (future integration)
      console.log(
        `File operation logged: delete ${path} on server ${serverId} by ${userId}`,
      );

      return {
        success: true,
        message: `Deleted: ${path}`,
        data: { path, type: node.type },
      };
    } catch (error: any) {
      console.error("Delete node error:", error);
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
        !(await this.canRead(userId, sourceResolution.node.id, accessLevel))
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
        !(await this.canWrite(userId, destDirResolution.nodeId!, accessLevel))
      ) {
        return {
          success: false,
          message: `Permission denied: cannot write to ${destDir}`,
          error: "PERMISSION_DENIED",
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
      console.error("Copy node error:", error);
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
      if (!(await this.canWrite(userId, sourceNode.id, accessLevel))) {
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
        !(await this.canWrite(userId, destDirResolution.nodeId!, accessLevel))
      ) {
        return {
          success: false,
          message: `Permission denied: cannot write to ${destDir}`,
          error: "PERMISSION_DENIED",
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
      console.error("Move node error:", error);
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
  private async canRead(
    userId: string,
    nodeId: string,
    accessLevel: number,
  ): Promise<boolean> {
    const node = await prisma.fileSystemNode.findUnique({
      where: { id: nodeId },
    });

    if (!node) return false;

    const permissions = node.permissions as unknown as FilePermissions;

    // Check required access level
    if (
      permissions.requiredAccessLevel &&
      accessLevel < permissions.requiredAccessLevel
    ) {
      return false;
    }

    // Owner always has read access
    if (permissions.owner === userId) {
      return permissions.ownerRead;
    }

    // Check other permissions
    return permissions.otherRead;
  }

  /**
   * Check if user can write to a file/directory
   */
  private async canWrite(
    userId: string,
    nodeId: string,
    accessLevel: number,
  ): Promise<boolean> {
    const node = await prisma.fileSystemNode.findUnique({
      where: { id: nodeId },
    });

    if (!node) return false;
    if (node.isProtected) return false;

    const permissions = node.permissions as unknown as FilePermissions;

    // Check required access level
    if (
      permissions.requiredAccessLevel &&
      accessLevel < permissions.requiredAccessLevel
    ) {
      return false;
    }

    // Owner
    if (permissions.owner === userId) {
      return permissions.ownerWrite;
    }

    // Check other permissions
    return permissions.otherWrite;
  }

  /**
   * Get user's access level on a server (from hack logs or server ownership)
   */
  private async getUserAccessLevel(
    userId: string,
    serverId: string,
  ): Promise<number> {
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

    return latestHack?.accessLevel || 0;
  }

  // ==================== PATH RESOLUTION ====================

  /**
   * Resolve a path to a node ID
   */
  private async resolvePath(
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
      console.error("Path resolution error:", error);
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
    const parts = path.split("/").filter((p) => p.length > 0 && p !== ".");
    const normalized: string[] = [];

    for (const part of parts) {
      if (part === "..") {
        normalized.pop();
      } else {
        normalized.push(part);
      }
    }

    return "/" + normalized.join("/");
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
   * Encrypt content using AES-256-CBC
   */
  private async encryptContent(content: string, key: string): Promise<string> {
    const iv = crypto.randomBytes(16);
    const keyBuffer = crypto.scryptSync(key, "salt", 32);
    const cipher = crypto.createCipheriv(
      this.encryptionAlgorithm,
      keyBuffer,
      iv,
    );

    let encrypted = cipher.update(content, "utf8", "hex");
    encrypted += cipher.final("hex");

    return iv.toString("hex") + ":" + encrypted;
  }

  /**
   * Decrypt content using AES-256-CBC
   */
  private async decryptContent(
    encryptedContent: string,
    key: string,
  ): Promise<string> {
    const parts = encryptedContent.split(":");
    if (parts.length !== 2) {
      throw new Error("Invalid encrypted content format");
    }

    const iv = Buffer.from(parts[0]!, "hex");
    const encrypted = parts[1]!;
    const keyBuffer = crypto.scryptSync(key, "salt", 32);
    const decipher = crypto.createDecipheriv(
      this.encryptionAlgorithm,
      keyBuffer,
      iv,
    );

    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
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
  private getDefaultPermissions(ownerId: string): FilePermissions {
    return {
      owner: ownerId,
      ownerRead: true,
      ownerWrite: true,
      ownerExecute: true,
      groupRead: true,
      groupWrite: false,
      groupExecute: false,
      otherRead: false,
      otherWrite: false,
      otherExecute: false,
      requiredAccessLevel: 1,
    };
  }

  /**
   * Format permissions as Unix-style string (e.g., "rwxr-xr--")
   */
  private formatPermissions(permissions: FilePermissions): string {
    const owner = [
      permissions.ownerRead ? "r" : "-",
      permissions.ownerWrite ? "w" : "-",
      permissions.ownerExecute ? "x" : "-",
    ].join("");

    const group = [
      permissions.groupRead ? "r" : "-",
      permissions.groupWrite ? "w" : "-",
      permissions.groupExecute ? "x" : "-",
    ].join("");

    const other = [
      permissions.otherRead ? "r" : "-",
      permissions.otherWrite ? "w" : "-",
      permissions.otherExecute ? "x" : "-",
    ].join("");

    return owner + group + other;
  }

  /**
   * Duplicate a node (for copy operation)
   */
  private async duplicateNode(
    sourceNode: FileNode,
    newParentId: string,
    newName: string,
    userId: string,
  ): Promise<any> {
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
        permissions: sourceNode.permissions,
      },
    });

    // If directory, recursively copy children
    if (sourceNode.type === "directory") {
      const children = await prisma.fileSystemNode.findMany({
        where: { parentId: sourceNode.id },
      });

      for (const child of children) {
        await this.duplicateNode(
          child as FileNode,
          newNode.id,
          newName,
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
      console.error("Failed to log file access:", error);
    }
  }

  // ==================== INITIALIZATION ====================

  /**
   * Initialize root file system for a server
   */
  async initializeFileSystem(serverId: string, ownerId: string): Promise<void> {
    try {
      // Check if root already exists
      let root = await prisma.fileSystemNode.findFirst({
        where: {
          serverId,
          parentId: null,
          type: "directory",
        },
      });

      if (!root) {
        // Create root directory
        root = await prisma.fileSystemNode.create({
          data: {
            serverId,
            parentId: null,
            name: "/",
            type: "directory",
            content: null,
            size: 0,
            createdBy: ownerId,
            isEncrypted: false,
            encryptionKey: null,
            isHidden: false,
            isProtected: true,
            permissions: {
              owner: ownerId,
              ownerRead: true,
              ownerWrite: true,
              ownerExecute: true,
              groupRead: true,
              groupWrite: false,
              groupExecute: true,
              otherRead: false,
              otherWrite: false,
              otherExecute: false,
              requiredAccessLevel: 0,
            } as any,
          },
        });
        console.log(`Created root directory for server ${serverId}`);
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

      // Create only missing directories
      for (const dirName of missingDirs) {
        await prisma.fileSystemNode.create({
          data: {
            serverId,
            parentId: root.id,
            name: dirName,
            type: "directory",
            content: null,
            size: 0,
            createdBy: ownerId,
            isEncrypted: false,
            encryptionKey: null,
            isHidden: false,
            isProtected: dirName === "bin" || dirName === "etc",
            permissions: this.getDefaultPermissions(ownerId) as any,
          },
        });
      }

      console.log(`File system initialized for server ${serverId}`);
    } catch (error) {
      console.error("Failed to initialize file system:", error);
      throw error;
    }
  }
}

// Export singleton instance (will be initialized with io in server setup)
export let fileService: FileService;

export const initializeFileService = (io: SocketIOServer): FileService => {
  fileService = new FileService(io);
  return fileService;
};
