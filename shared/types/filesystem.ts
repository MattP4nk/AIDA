// File System Types

export interface FileSystemNode {
  id: string;
  serverId: string;
  parentId?: string;
  name: string;
  type: "file" | "directory";
  content?: string;
  permissions: FilePermissions;
  size: number;
  isEncrypted: boolean;
  isHidden: boolean;
  isProtected: boolean;
  createdAt: Date;
  modifiedAt: Date;
  lastAccessedAt?: Date;
  lastAccessedBy?: string;
}

/** Bitmask values for file/directory permissions. */
export enum PermissionLevel {
  NONE = 0,
  READ = 1,
  WRITE = 2,
  EXECUTE = 4,
  DELETE = 8,
  FULL = 15,
}

/** Per-user override (e.g. shared access that expires). */
export interface SpecialAccess {
  userId: string;
  permissions: PermissionLevel;
  expiresAt?: Date;
}

/**
 * Permissions stored as three bitmask levels:
 *   owner   → applies when node.createdBy === userId
 *   faction → applies when the user is in the owning faction
 *   others  → applies to everyone else
 *
 * requiredAccessLevel is an optional game mechanic gate (hack level 0-10).
 */
export interface FilePermissions {
  owner: PermissionLevel;
  faction: PermissionLevel;
  others: PermissionLevel;
  requiredAccessLevel?: number;
  specialAccess?: SpecialAccess[];
}

export interface FileOperation {
  type: FileOperationType;
  fileId?: string;
  serverId: string;
  parentId?: string;
  name?: string;
  content?: string;
  newName?: string;
  targetPath?: string;
}

export enum FileOperationType {
  READ = "read",
  WRITE = "write",
  CREATE = "create",
  DELETE = "delete",
  RENAME = "rename",
  MOVE = "move",
  COPY = "copy",
  CHMOD = "chmod",
  ACCESS = "access",
}

export interface FileAccessRecord {
  fileId: string;
  userId: string;
  serverId: string;
  action: FileOperationType;
  timestamp: Date;
  success: boolean;
}

export interface FileAccessSummary {
  fileId: string;
  fileName: string;
  totalAccesses: number;
  lastAccessedAt?: Date;
  lastAccessedBy?: string;
  accessedByUsers: string[];
}
