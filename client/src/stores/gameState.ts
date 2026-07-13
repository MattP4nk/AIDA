import { writable, derived, get } from "svelte/store";
import type { Writable, Readable } from "svelte/store";
import { apiClient, type AuthResponse, AuthError } from "../services/api";
import {
  socketService,
  socketConnected,
  socketError,
} from "../services/socket";
import type {
  User,
  GameServerInfo,
  FileSystemNode,
} from "../../../shared/types";

// Local type – the server endpoint returns an untyped bag; we only rely on
// `discoveryLevel` today, so keep this open with an index signature.
export interface PlayerProgress {
  discoveryLevel?: number;
  [key: string]: any;
}

// Alias so the rest of the file can keep using the short name "GameServer"
type GameServer = GameServerInfo;

// ==================== OUTPUT & TERMINAL ====================

export interface OutputLine {
  text: string;
  id: number;
  timestamp: Date;
  type?: "info" | "error" | "warning" | "success" | "system";
}

let outputIdCounter = 0;
const MAX_OUTPUT_LINES = 1000;

export const outputLines = writable<OutputLine[]>([]);
export const commandHistory = writable<string[]>([]);
export const historyIndex = writable<number>(-1);

// ==================== USER & AUTHENTICATION ====================

export const currentUser = writable<User | null>(null);
export const isAuthenticated = writable<boolean>(false);
export const authLoading = writable<boolean>(false);
export const authError = writable<string | null>(null);

// ==================== GAME STATE ====================

export const networkAccess = writable<boolean>(false);
export const currentServer = writable<GameServer | null>(null);
export const currentDirectory = writable<FileSystemNode | null>(null);
export const playerProgress = writable<PlayerProgress | null>(null);
export const discoveryLevel = writable<number>(0);

// ==================== SERVERS & FILE SYSTEM ====================

export const knownServers = writable<GameServer[]>([]);
export const connectedServers = writable<string[]>([]);
export const fileSystemCache = writable<Record<string, FileSystemNode[]>>({});

// ==================== REAL-TIME DATA ====================

export const onlinePlayerCount = writable<number>(0);
export const recentActivity = writable<any[]>([]);
export const unreadMessages = writable<number>(0);
export const securityAlerts = writable<any[]>([]);

// ==================== CONNECTION STATUS ====================

export const connectionStatus = derived(
  [socketConnected, authLoading],
  ([$socketConnected, $authLoading]) => {
    if ($authLoading) return "connecting";
    if ($socketConnected) return "connected";
    return "disconnected";
  },
);

// ==================== TERMINAL PROMPT ====================

export const terminalPrompt: Readable<string> = derived(
  [currentUser, currentDirectory, currentServer],
  ([$currentUser, $currentDirectory, $currentServer]) => {
    const username = $currentUser?.username || "guest";
    const serverName = $currentServer?.name || "unknown";
    const dirName = $currentDirectory?.name || "~";
    return `${username}@${serverName}:${dirName}$ `;
  },
);

// ==================== OUTPUT HELPERS ====================

export function addOutput(
  text: string,
  type: OutputLine["type"] = "info",
): void {
  outputLines.update((lines) => {
    const updated = [
      ...lines,
      {
        text,
        id: ++outputIdCounter,
        timestamp: new Date(),
        type,
      },
    ];
    // Cap buffer to prevent unbounded memory growth
    if (updated.length > MAX_OUTPUT_LINES) {
      return updated.slice(-MAX_OUTPUT_LINES);
    }
    return updated;
  });
}

export function addSystemOutput(text: string): void {
  addOutput(`[SYSTEM] ${text}`, "system");
}

export function addErrorOutput(text: string): void {
  addOutput(`[ERROR] ${text}`, "error");
}

export function addSuccessOutput(text: string): void {
  addOutput(`[SUCCESS] ${text}`, "success");
}

export function clearOutput(): void {
  outputLines.set([]);
}

// ==================== COMMAND HISTORY ====================

export function addToHistory(command: string): void {
  if (command.trim()) {
    commandHistory.update((history) => {
      const newHistory = [...history, command];
      return newHistory.slice(-100); // Keep last 100 commands
    });
    historyIndex.set(-1);
  }
}

export function navigateHistory(direction: "up" | "down"): string | null {
  const history = get(commandHistory);
  const currentIndex = get(historyIndex);

  if (direction === "up") {
    const newIndex =
      currentIndex < history.length - 1 ? currentIndex + 1 : currentIndex;
    historyIndex.set(newIndex);
    return history[history.length - 1 - newIndex] || null;
  } else {
    const newIndex = currentIndex > -1 ? currentIndex - 1 : -1;
    historyIndex.set(newIndex);
    return newIndex === -1
      ? ""
      : history[history.length - 1 - newIndex] || null;
  }
}

// ==================== AUTHENTICATION ACTIONS ====================

export async function registerUser(
  username: string,
  email: string,
  password: string,
): Promise<boolean> {
  authLoading.set(true);
  authError.set(null);

  try {
    const response = await apiClient.register({ username, password, email });

    if (response.success && response.user) {
      currentUser.set(response.user);
      isAuthenticated.set(true);
      networkAccess.set(true);

      addSystemOutput(">>> NEURAL INTERFACE AUTHENTICATION <<<");
      addSystemOutput("Biometric scan initiated...");
      addSystemOutput("Retinal pattern analysis... VERIFIED");
      addSystemOutput("Neural signature mapping... AUTHENTICATED");
      addSystemOutput("Establishing encrypted connection...");
      addSystemOutput("");
      addSystemOutput(">>> NETWORK ACCESS GRANTED <<<");
      addSystemOutput(`Welcome to the AIDA Network, ${username}`);
      addSystemOutput("Neural interface synchronized | Secure channels active");
      addSystemOutput("Type 'help' for available commands");

      // Initialize socket connection
      socketService.connect();

      // Load initial game data
      await loadInitialGameData();

      return true;
    } else {
      throw new Error(response.message || "Registration failed");
    }
  } catch (error) {
    const errorMessage =
      error instanceof AuthError
        ? error.message
        : "Registration failed. Please try again.";

    authError.set(errorMessage);
    addErrorOutput(errorMessage);
    return false;
  } finally {
    authLoading.set(false);
  }
}

export async function loginUser(
  username: string,
  password: string,
): Promise<boolean> {
  authLoading.set(true);
  authError.set(null);

  try {
    const response = await apiClient.login({ username, password });

    if (response.success && response.user) {
      currentUser.set(response.user);
      isAuthenticated.set(true);
      networkAccess.set(true);

      addSystemOutput(">>> NEURAL INTERFACE AUTHENTICATION <<<");
      addSystemOutput("Identity verification... COMPLETE");
      addSystemOutput("Establishing secure connection...");
      addSystemOutput("");
      addSystemOutput(">>> WELCOME BACK <<<");
      addSystemOutput(`Neural interface synchronized for ${username}`);
      addSystemOutput("Type 'help' for available commands");

      // Initialize socket connection
      socketService.connect();

      // Load initial game data
      await loadInitialGameData();

      return true;
    } else {
      throw new Error(response.message || "Login failed");
    }
  } catch (error) {
    const errorMessage =
      error instanceof AuthError
        ? error.message
        : "Login failed. Please check your credentials.";

    authError.set(errorMessage);
    addErrorOutput(errorMessage);
    return false;
  } finally {
    authLoading.set(false);
  }
}

export async function logoutUser(): Promise<void> {
  try {
    await apiClient.logout();
    socketService.disconnect();

    // Clear all state
    currentUser.set(null);
    isAuthenticated.set(false);
    networkAccess.set(false);
    currentServer.set(null);
    currentDirectory.set(null);
    playerProgress.set(null);
    knownServers.set([]);
    connectedServers.set([]);
    fileSystemCache.set({});

    addSystemOutput(">>> DISCONNECTED <<<");
    addSystemOutput("Neural interface terminated");
    addSystemOutput("All secure channels closed");
  } catch (error) {
    console.error("Logout error:", error);
  }
}

export async function verifyAuthentication(): Promise<boolean> {
  authLoading.set(true);

  try {
    // Always call the server — httpOnly cookie is sent automatically
    // via credentials:'include', even when in-memory token is gone after reload.
    const response = await apiClient.verifyToken();

    if (response.success && response.user) {
      currentUser.set(response.user);
      isAuthenticated.set(true);
      networkAccess.set(true);

      // Reconnect socket if needed
      if (!socketService.isConnected()) {
        socketService.connect();
      }

      // Load initial game data
      await loadInitialGameData();

      return true;
    } else {
      await logoutUser();
      return false;
    }
  } catch (error) {
    await logoutUser();
    return false;
  } finally {
    authLoading.set(false);
  }
}

// ==================== GAME DATA LOADING ====================

async function loadInitialGameData(): Promise<void> {
  try {
    // Load known servers
    const servers = await apiClient.getKnownServers();
    knownServers.set(servers);

    // Load player progress
    const stats = await apiClient.getUserStats();
    if (stats) {
      playerProgress.set(stats);
      discoveryLevel.set(stats.discoveryLevel || 0);
    }

    // Connect to user's home server
    const user = get(currentUser);
    if (user?.homeIp) {
      const homeServer = servers.find((s) => s.ipAddress === user.homeIp);
      if (homeServer) {
        await connectToServerInternal(homeServer);
      }
    }
  } catch (error) {
    console.error("Error loading initial game data:", error);
    addErrorOutput(
      "Failed to load game data. Some features may not work properly.",
    );
  }
}

// ==================== SERVER ACTIONS ====================

export async function connectToServer(server: GameServer): Promise<boolean> {
  try {
    await connectToServerInternal(server);
    addSuccessOutput(`Connected to ${server.name} (${server.ipAddress})`);
    return true;
  } catch (error) {
    addErrorOutput(
      `Failed to connect to ${server.name}: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
    return false;
  }
}

async function connectToServerInternal(server: GameServer): Promise<void> {
  // Connect via API
  await apiClient.connectToServer(server.id);

  // Update state
  currentServer.set(server);

  // Update connected servers list
  connectedServers.update((servers) =>
    servers.includes(server.id) ? servers : [...servers, server.id],
  );

  // Emit socket event for real-time updates
  socketService.emitServerConnect(server.id);

  // Load server file system
  await loadServerFileSystem(server.id);
}

export async function disconnectFromServer(server: GameServer): Promise<void> {
  try {
    await apiClient.disconnectFromServer(server.id);

    // Update state
    if (get(currentServer)?.id === server.id) {
      currentServer.set(null);
      currentDirectory.set(null);
    }

    connectedServers.update((servers) =>
      servers.filter((id) => id !== server.id),
    );

    // Emit socket event
    socketService.emitServerDisconnect(server.id);

    addSystemOutput(`Disconnected from ${server.name}`);
  } catch (error) {
    console.error("Error disconnecting from server:", error);
  }
}

// ==================== FILE SYSTEM ACTIONS ====================

async function loadServerFileSystem(serverId: string): Promise<void> {
  try {
    const files = await apiClient.getFiles(serverId);

    fileSystemCache.update((cache) => ({
      ...cache,
      [serverId]: files,
    }));

    // Set current directory to root/home
    const rootDir = files.find((f) => f.type === "directory" && !f.parentId);
    if (rootDir) {
      currentDirectory.set(rootDir);
    }
  } catch (error) {
    console.error("Error loading file system:", error);
    addErrorOutput("Failed to load server file system");
  }
}

export function getServerFiles(serverId: string): FileSystemNode[] {
  const cache = get(fileSystemCache);
  return cache[serverId] || [];
}

export function getCurrentServerFiles(): FileSystemNode[] {
  const server = get(currentServer);
  if (!server) return [];
  return getServerFiles(server.id);
}

export function getCurrentDirectoryFiles(): FileSystemNode[] {
  const server = get(currentServer);
  const dir = get(currentDirectory);

  if (!server || !dir) return [];

  return getServerFiles(server.id).filter((f) => f.parentId === dir.id);
}

/**
 * Find a file or directory by name in the current directory
 */
export function findInCurrentDirectory(
  name: string,
): FileSystemNode | undefined {
  const dir = get(currentDirectory);
  if (!dir) return undefined;

  const files = getCurrentDirectoryFiles();
  return files.find((f) => f.name === name);
}

/**
 * Get all files in current directory (excluding directories)
 */
export function getCurrentFiles(): FileSystemNode[] {
  return getCurrentDirectoryFiles().filter((f) => f.type === "file");
}

/**
 * Get all directories in current directory
 */
export function getCurrentDirectories(): FileSystemNode[] {
  return getCurrentDirectoryFiles().filter((f) => f.type === "directory");
}

/**
 * Build full path for current directory
 */
export function getCurrentPath(): string {
  const dir = get(currentDirectory);
  const server = get(currentServer);

  if (!dir || !server) return "/";

  const files = getServerFiles(server.id);
  return buildPath(files, dir);
}

function buildPath(files: FileSystemNode[], node: FileSystemNode): string {
  if (!node.parentId) {
    return node.name;
  }

  const parent = files.find((f) => f.id === node.parentId);
  if (!parent) {
    return node.name;
  }

  return `${buildPath(files, parent)}/${node.name}`;
}

export async function createFile(
  name: string,
  content: string = "",
): Promise<boolean> {
  const server = get(currentServer);
  const directory = get(currentDirectory);

  if (!server || !directory) {
    addErrorOutput("No server or directory selected");
    return false;
  }

  try {
    const newFile = await apiClient.createFile(
      server.id,
      directory.id,
      name,
      content,
    );

    // Update cache
    fileSystemCache.update((cache) => ({
      ...cache,
      [server.id]: [...(cache[server.id] || []), newFile],
    }));

    addSuccessOutput(`File '${name}' created successfully`);
    return true;
  } catch (error) {
    addErrorOutput(
      `Failed to create file '${name}': ${error instanceof Error ? error.message : "Unknown error"}`,
    );
    return false;
  }
}

export async function createDirectory(name: string): Promise<boolean> {
  const server = get(currentServer);
  const directory = get(currentDirectory);

  if (!server || !directory) {
    addErrorOutput("No server or directory selected");
    return false;
  }

  try {
    const newDir = await apiClient.createDirectory(
      server.id,
      directory.id,
      name,
    );

    // Update cache
    fileSystemCache.update((cache) => ({
      ...cache,
      [server.id]: [...(cache[server.id] || []), newDir],
    }));

    addSuccessOutput(`Directory '${name}' created successfully`);
    return true;
  } catch (error) {
    addErrorOutput(
      `Failed to create directory '${name}': ${error instanceof Error ? error.message : "Unknown error"}`,
    );
    return false;
  }
}

export function changeDirectory(targetDir: FileSystemNode): void {
  if (targetDir.type !== "directory") {
    addErrorOutput("Target is not a directory");
    return;
  }

  currentDirectory.set(targetDir);
  addOutput(`Changed directory to ${targetDir.name}`);
}

// ==================== MESSAGING ACTIONS ====================

export async function sendMessage(
  recipientId: string,
  subject: string,
  content: string,
): Promise<boolean> {
  try {
    await apiClient.sendMessage(recipientId, subject, content);

    // Also emit via socket for real-time delivery
    socketService.emitSendMessage({ recipientId, subject, content });

    addSuccessOutput("Message sent successfully");
    return true;
  } catch (error) {
    addErrorOutput(
      `Failed to send message: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
    return false;
  }
}

// ==================== HACKING ACTIONS ====================

export async function attemptHack(
  targetUserId: string,
  targetServerId: string,
  method: string,
  tools: string[],
): Promise<any> {
  try {
    addOutput(`Initiating hack attempt using ${method}...`);

    const result = await apiClient.attemptHack(
      targetUserId,
      targetServerId,
      method,
      tools,
    );

    // Also emit via socket for real-time updates
    socketService.emitHackAttempt({
      targetUserId,
      targetServerId,
      method,
      tools,
    });

    if (result.success) {
      addSuccessOutput("Hack successful!");
    } else {
      addErrorOutput("Hack failed");
    }

    return result;
  } catch (error) {
    addErrorOutput(
      `Hack attempt failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
    return { success: false, detected: true };
  }
}

// ==================== INITIALIZATION ====================

export async function initializeGameState(): Promise<void> {
  // Clear any existing socket errors
  socketError.set(null);

  // Request notification permission
  socketService.requestNotificationPermission();

  // Always attempt session restore — httpOnly cookie is sent automatically
  // via credentials:'include', even after page reload when in-memory token is gone.
  const restored = await verifyAuthentication();
  if (!restored) {
    addSystemOutput(">>> AIDA NEURAL INTERFACE <<<");
    addSystemOutput("Connection established to neural network");
    addSystemOutput("Authentication required for network access");
    addSystemOutput("");
    addSystemOutput(
      "Type 'register <username> <email> <password>' to create account",
    );
    addSystemOutput("Type 'login <username> <password>' to authenticate");
    addSystemOutput("Type 'help' for available commands");
  }
}

// ==================== ERROR HANDLING ====================

// Listen to socket errors and display them
socketError.subscribe((error) => {
  if (error) {
    addErrorOutput(`Connection error: ${error}`);
  }
});

// ==================== TEMPORARY ALIASES FOR OLD EXPORTS ====================

// These are temporary aliases to fix build errors while we migrate commands
export const user = currentUser;
export const setUser = loginUser; // This will need to be updated in commands
export const servers = knownServers;
export const getKnownServers = () => get(knownServers);
export const findServerByIP = (ip: string) =>
  get(knownServers).find((s) => s.ipAddress === ip);

// Compatibility exports for old commands
// getCurrentDirectoryAdapter is imported from adapters/fileSystemAdapter.ts

// ==================== EXPORTS ====================

export { socketConnected, socketError, socketService };
