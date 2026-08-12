// Authentication & Session Types

import type { Command, TerminalTab } from "./game";

export type UserRole = "player" | "moderator" | "admin";

export interface User {
  id: string;
  username: string;
  email: string;
  homeIp: string;
  createdAt: Date;
  lastLogin: Date;
  isActive: boolean;
  isOnline: boolean;
  role?: UserRole;
}

export interface AuthRequest {
  username: string;
  email?: string;
  password: string;
}

export interface AuthResponse {
  success: boolean;
  token?: string;
  user?: User;
  message?: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  timestamp: Date;
}

/** Lightweight avatar data included in Socket.IO payloads and command responses */
export interface AvatarInfo {
  glyph: string;
  color: string;
  compact?: string[];
}

export interface PlayerSession {
  userId: string;
  socketId: string;
  connectedAt: Date;
  lastActivity: Date;
  currentServerId?: string;
  homeServerId?: string;
  currentDirectory: string;
  isActive: boolean;
  ipAddress: string;
  commandQueue: Command[];
  terminals: TerminalTab[];
  activeTerminalId: string;
}

// Session Types
export interface SessionInfo {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
  isActive: boolean;
  ipAddress?: string;
  userAgent?: string;
  currentDirectory: string;
  lastServerId?: string;
}
