import type { FileSystemNode } from "../../../shared/types";
import { get } from "svelte/store";
import { currentServer, fileSystemCache } from "../stores/gameState";
import { apiClient } from "../services/api";

/**
 * Utility functions for working with FileSystemNode arrays directly
 * This replaces the adapter pattern with clean utility functions
 */

// ==================== FILE SYSTEM QUERIES ====================

/**
 * Get all files in a directory (by parent ID)
 */
export function getFilesInDirectory(
  files: FileSystemNode[],
  parentId: string | undefined,
): FileSystemNode[] {
  return files.filter((f) => f.parentId === parentId);
}

/**
 * Find a file or directory by name in a specific parent
 */
export function findByName(
  files: FileSystemNode[],
  name: string,
  parentId: string | undefined,
): FileSystemNode | undefined {
  return files.find((f) => f.name === name && f.parentId === parentId);
}

/**
 * Find a file or directory by ID
 */
export function findById(
  files: FileSystemNode[],
  id: string,
): FileSystemNode | undefined {
  return files.find((f) => f.id === id);
}

/**
 * Get only directories in a parent
 */
export function getDirectories(
  files: FileSystemNode[],
  parentId: string | undefined,
): FileSystemNode[] {
  return files.filter((f) => f.type === "directory" && f.parentId === parentId);
}

/**
 * Get only files (not directories) in a parent
 */
export function getFiles(
  files: FileSystemNode[],
  parentId: string | undefined,
): FileSystemNode[] {
  return files.filter((f) => f.type === "file" && f.parentId === parentId);
}

/**
 * Build full path for a node
 */
export function getNodePath(
  files: FileSystemNode[],
  node: FileSystemNode,
): string {
  if (!node.parentId) {
    return node.name;
  }

  const parent = findById(files, node.parentId);
  if (!parent) {
    return node.name;
  }

  return `${getNodePath(files, parent)}/${node.name}`;
}

/**
 * Get parent node
 */
export function getParent(
  files: FileSystemNode[],
  node: FileSystemNode,
): FileSystemNode | undefined {
  if (!node.parentId) return undefined;
  return findById(files, node.parentId);
}

/**
 * Get root directory of current server
 */
export function getRootDirectory(
  files: FileSystemNode[],
): FileSystemNode | undefined {
  return files.find((f) => f.type === "directory" && !f.parentId);
}

/**
 * Navigate to a path (supports relative paths like .. and .)
 */
export function resolvePath(
  files: FileSystemNode[],
  currentDir: FileSystemNode,
  path: string,
): FileSystemNode | undefined {
  if (path === ".") {
    return currentDir;
  }

  if (path === "..") {
    return getParent(files, currentDir);
  }

  // Check if it's an absolute path (starts with /)
  if (path.startsWith("/")) {
    // TODO: Implement absolute path resolution
    const root = getRootDirectory(files);
    if (!root) return undefined;
    // For now, just return root
    return root;
  }

  // Relative path - look for child with this name
  return findByName(files, path, currentDir.id);
}

/**
 * Find files matching a pattern (simple glob support)
 */
export function findFiles(
  files: FileSystemNode[],
  pattern: string,
  searchRoot?: FileSystemNode,
): FileSystemNode[] {
  const regex = new RegExp(
    pattern.replace(/\*/g, ".*").replace(/\?/g, "."),
    "i",
  );

  let searchFiles = files;
  if (searchRoot) {
    // Get all descendants of searchRoot
    searchFiles = getAllDescendants(files, searchRoot);
  }

  return searchFiles.filter((f) => f.type === "file" && regex.test(f.name));
}

/**
 * Get all descendants of a directory (recursive)
 */
export function getAllDescendants(
  files: FileSystemNode[],
  parent: FileSystemNode,
): FileSystemNode[] {
  const children = getFilesInDirectory(files, parent.id);
  const descendants: FileSystemNode[] = [...children];

  for (const child of children) {
    if (child.type === "directory") {
      descendants.push(...getAllDescendants(files, child));
    }
  }

  return descendants;
}

/**
 * Calculate total size of a directory
 */
export function getTotalSize(
  files: FileSystemNode[],
  directory: FileSystemNode,
): number {
  if (directory.type === "file") {
    return directory.size;
  }

  const descendants = getAllDescendants(files, directory);
  return descendants
    .filter((f) => f.type === "file")
    .reduce((total, file) => total + file.size, 0);
}

// ==================== FILE SYSTEM OPERATIONS (API CALLS) ====================

/**
 * Create a new file (calls backend API)
 */
export async function createFile(
  name: string,
  content: string = "",
  parentId?: string,
): Promise<FileSystemNode | null> {
  try {
    const server = get(currentServer);
    if (!server) {
      console.error("No current server");
      return null;
    }

    const response = await apiClient.createFile(
      server.id,
      parentId || "",
      name,
      content,
    );

    if (response) {
      // Update cache if response has the file data
      const fileNode = response.data || response;
      if (fileNode && fileNode.id) {
        updateFileCache(fileNode);
        return fileNode;
      }
    }

    return null;
  } catch (error) {
    console.error("Failed to create file:", error);
    return null;
  }
}

/**
 * Create a new directory (calls backend API)
 */
export async function createDirectory(
  name: string,
  parentId?: string,
): Promise<FileSystemNode | null> {
  try {
    const server = get(currentServer);
    if (!server) {
      console.error("No current server");
      return null;
    }

    const response = await apiClient.createDirectory(
      server.id,
      parentId || "",
      name,
    );

    if (response) {
      // Update cache if response has the directory data
      const dirNode = response.data || response;
      if (dirNode && dirNode.id) {
        updateFileCache(dirNode);
        return dirNode;
      }
    }

    return null;
  } catch (error) {
    console.error("Failed to create directory:", error);
    return null;
  }
}

/**
 * Update file content (calls backend API)
 */
export async function updateFileContent(
  fileId: string,
  content: string,
): Promise<boolean> {
  try {
    const server = get(currentServer);
    if (!server) {
      console.error("No current server");
      return false;
    }

    const response = await apiClient.writeFile(fileId, content);

    if (response) {
      // Update cache if response has the updated file data
      const fileNode = response.data || response;
      if (fileNode && fileNode.id) {
        updateFileCache(fileNode);
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error("Failed to update file:", error);
    return false;
  }
}

/**
 * Delete a file or directory (calls backend API)
 */
export async function deleteNode(fileId: string): Promise<boolean> {
  try {
    const server = get(currentServer);
    if (!server) {
      console.error("No current server");
      return false;
    }

    await apiClient.deleteFile(fileId);

    // Remove from cache
    removeFromFileCache(server.id, fileId);
    return true;
  } catch (error) {
    console.error("Failed to delete node:", error);
    return false;
  }
}

// ==================== CACHE MANAGEMENT ====================

/**
 * Update file cache with a new or modified node
 */
function updateFileCache(node: FileSystemNode): void {
  const cache = get(fileSystemCache);
  const files = cache[node.serverId] || [];

  // Find and replace existing node, or add new one
  const index = files.findIndex((f) => f.id === node.id);
  if (index >= 0) {
    files[index] = node;
  } else {
    files.push(node);
  }

  fileSystemCache.set({
    ...cache,
    [node.serverId]: files,
  });
}

/**
 * Remove node from cache
 */
function removeFromFileCache(serverId: string, nodeId: string): void {
  const cache = get(fileSystemCache);
  const files = cache[serverId] || [];

  fileSystemCache.set({
    ...cache,
    [serverId]: files.filter((f) => f.id !== nodeId),
  });
}

/**
 * Get current server files from cache
 */
export function getCurrentServerFiles(): FileSystemNode[] {
  const server = get(currentServer);
  if (!server) return [];

  const cache = get(fileSystemCache);
  return cache[server.id] || [];
}

// ==================== FORMATTING HELPERS ====================

/**
 * Format file size in human-readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Format file permissions as ls-style string
 */
export function formatPermissions(node: FileSystemNode): string {
  const type = node.type === "directory" ? "d" : "-";

  // Simple permission display (could be enhanced based on actual permissions)
  const owner = "rwx";
  const group = "r-x";
  const others = "r-x";

  return `${type}${owner}${group}${others}`;
}

/**
 * Format date for ls-style output
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const sixMonths = 6 * 30 * 24 * 60 * 60 * 1000;

  if (diff < sixMonths) {
    // Recent: "Jan 15 14:30"
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } else {
    // Old: "Jan 15  2023"
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    });
  }
}
