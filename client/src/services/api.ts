import type {
  AuthRequest,
  AuthResponse,
  ApiResponse,
} from "../../../shared/types";

// API configuration — override via VITE_API_URL / VITE_SOCKET_URL env vars
const API_BASE_URL =
  (import.meta.env.VITE_API_URL as string) || "http://localhost:3001/api";
const SOCKET_URL =
  (import.meta.env.VITE_SOCKET_URL as string) || "http://localhost:3001";

// Token management — JWT is stored in httpOnly cookie (not accessible to JS).
// We keep a lightweight in-memory flag + token for Socket.IO auth only.
// The token is returned in the JSON response body alongside the cookie.
let authToken: string | null = null;
let csrfToken: string | null = null;
// Track whether we *believe* we're authenticated (confirmed on verify)
let authenticated = false;

class ApiClient {
  private baseURL: string;

  constructor(baseURL: string = API_BASE_URL) {
    this.baseURL = baseURL;
    // Migrate: clear any legacy localStorage token
    if (typeof window !== "undefined") {
      const legacy = localStorage.getItem("aida_auth_token");
      if (legacy) {
        authToken = legacy; // Keep in memory for this session
        authenticated = true;
        localStorage.removeItem("aida_auth_token"); // Don't persist in localStorage anymore
      }
    }
  }

  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly REFRESH_INTERVAL_MS = 20 * 60 * 60 * 1000; // 20 hours (refresh before 24h expiry)

  private setToken(token: string): void {
    authToken = token;
    authenticated = true;
    this.scheduleRefresh();
  }

  private clearToken(): void {
    authToken = null;
    csrfToken = null;
    authenticated = false;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refreshToken(), this.REFRESH_INTERVAL_MS);
  }

  private async refreshToken(): Promise<void> {
    if (!authenticated) return;
    try {
      const response = await this.post("/auth/refresh");
      const data = response as any;
      if (data.success && data.token) {
        authToken = data.token;
        await this.fetchCsrfToken();
        this.scheduleRefresh();
      }
    } catch {
      // Refresh failed — session will expire naturally, user re-authenticates
      console.warn("Token refresh failed — session may expire");
    }
  }

  /** Returns the in-memory token (for Socket.IO auth handshake). */
  public getToken(): string | null {
    return authToken;
  }

  public isAuthenticated(): boolean {
    return authenticated;
  }

  // CSRF token management
  private async fetchCsrfToken(): Promise<string | null> {
    if (!authenticated) return null;

    try {
      const headers: HeadersInit = {};
      // Include Bearer token if available (for Socket.IO-initiated requests)
      if (authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
      }

      const response = await fetch(`${this.baseURL}/csrf-token`, {
        credentials: "include", // Send httpOnly cookie
        headers,
      });

      if (response.ok) {
        const data = await response.json();
        csrfToken = data.csrfToken;
        return csrfToken;
      }
    } catch (error) {
      console.error("Failed to fetch CSRF token:", error);
    }

    return null;
  }

  public async ensureCsrfToken(): Promise<void> {
    if (!csrfToken && authenticated) {
      await this.fetchCsrfToken();
    }
  }

  public hasCsrfToken(): boolean {
    return !!csrfToken;
  }

  // HTTP request helper
  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseURL}${endpoint}`;

    // Default headers
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      ...options.headers,
    };

    // Add auth token if available
    if (authToken) {
      (headers as any)["Authorization"] = `Bearer ${authToken}`;
    }

    // Add CSRF token for state-changing operations
    if (
      csrfToken &&
      options.method &&
      !["GET", "HEAD", "OPTIONS"].includes(options.method)
    ) {
      (headers as any)["X-CSRF-Token"] = csrfToken;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        credentials: "include", // Send httpOnly cookie with every request
      });

      // Parse JSON response
      const data = await response.json();

      // Handle CSRF token errors — auto-refresh and retry once
      if (
        response.status === 403 &&
        data.error &&
        typeof data.error === "string" &&
        data.error.toLowerCase().includes("csrf") &&
        authToken
      ) {
        const newToken = await this.fetchCsrfToken();
        if (newToken) {
          // Retry the request with the fresh CSRF token
          (headers as any)["X-CSRF-Token"] = newToken;
          const retryResponse = await fetch(url, { ...options, headers, credentials: "include" });
          const retryData = await retryResponse.json();
          if (!retryResponse.ok) {
            throw new ApiError(
              retryData.error ||
                `HTTP ${retryResponse.status}: ${retryResponse.statusText}`,
              retryResponse.status,
              retryData,
            );
          }
          return retryData;
        }
      }

      // Handle HTTP errors
      if (!response.ok) {
        throw new ApiError(
          data.error || `HTTP ${response.status}: ${response.statusText}`,
          response.status,
          data,
        );
      }

      return data;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }

      // Handle network errors
      throw new ApiError("Network error: Unable to connect to server", 0, {
        originalError: error,
      });
    }
  }

  // HTTP method helpers
  private async get<T>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: "GET" });
  }

  private async post<T>(endpoint: string, data?: any): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: "POST",
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  private async put<T>(endpoint: string, data?: any): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: "PUT",
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  private async delete<T>(
    endpoint: string,
    data?: any,
  ): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: "DELETE",
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  // ==================== AUTHENTICATION METHODS ====================

  async register(userData: AuthRequest): Promise<AuthResponse> {
    try {
      const response = await this.post("/auth/register", userData);
      const authResponse = response as unknown as AuthResponse;

      if (authResponse.success && authResponse.token) {
        // Keep token in memory for Socket.IO auth; cookie handles persistence
        this.setToken(authResponse.token);
        await this.fetchCsrfToken();
      }

      return authResponse;
    } catch (error) {
      throw this.handleAuthError(error);
    }
  }

  async login(credentials: AuthRequest): Promise<AuthResponse> {
    try {
      const response = await this.post("/auth/login", credentials);
      const authResponse = response as unknown as AuthResponse;

      if (authResponse.success && authResponse.token) {
        // Keep token in memory for Socket.IO auth; cookie handles persistence
        this.setToken(authResponse.token);
        await this.fetchCsrfToken();
      }

      return authResponse;
    } catch (error) {
      throw this.handleAuthError(error);
    }
  }

  async logout(): Promise<void> {
    try {
      await this.post("/auth/logout");
    } catch (error) {
      // Continue with logout even if API call fails
      console.warn("Logout API call failed:", error);
    } finally {
      this.clearToken();
    }
  }

  async verifyToken(): Promise<AuthResponse> {
    try {
      // Cookie is sent automatically via credentials:'include'
      const response = await this.get("/auth/verify");
      const authResponse = response as unknown as AuthResponse;
      if (authResponse.success) {
        // Token came from cookie — mark as authenticated
        // The token is also in the response for Socket.IO auth
        if (authResponse.token) {
          this.setToken(authResponse.token);
        } else {
          authenticated = true;
        }
      }
      return authResponse;
    } catch (error) {
      this.clearToken();
      throw this.handleAuthError(error);
    }
  }

  private handleAuthError(error: any): AuthError {
    if (error instanceof ApiError) {
      return new AuthError(error.message, error.status, error.details);
    }
    return new AuthError("Authentication failed", 0, { originalError: error });
  }

  // ==================== USER METHODS ====================

  async getCurrentUser(): Promise<any> {
    try {
      const response = await this.get("/users/profile");
      return response.data || response;
    } catch (error) {
      console.warn("getCurrentUser not implemented yet");
      return null;
    }
  }

  async updateProfile(userData: any): Promise<any> {
    try {
      const response = await this.put("/users/profile", userData);
      return response.data || response;
    } catch (error) {
      console.warn("updateProfile not implemented yet");
      return null;
    }
  }

  async getUserStats(): Promise<any> {
    try {
      const response = await this.get("/users/stats");
      return response.data || response;
    } catch (error) {
      console.warn("getUserStats not implemented yet");
      return null;
    }
  }

  // ==================== SERVER METHODS ====================

  async getKnownServers(): Promise<any[]> {
    try {
      const response = await this.get<any[]>("/servers");
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      console.warn("getKnownServers not implemented yet");
      return [];
    }
  }

  async getServerDetails(serverId: string): Promise<any> {
    const response = await this.get(`/servers/${serverId}`);
    return response.data;
  }

  async connectToServer(serverId: string): Promise<any> {
    const response = await this.post(`/servers/${serverId}/connect`);
    return response.data;
  }

  async disconnectFromServer(serverId: string): Promise<any> {
    const response = await this.post(`/servers/${serverId}/disconnect`);
    return response.data;
  }

  // ==================== FILE SYSTEM METHODS ====================

  async getFiles(serverId: string, directoryId?: string): Promise<any[]> {
    try {
      const endpoint = directoryId
        ? `/files?serverId=${serverId}&directoryId=${directoryId}`
        : `/files?serverId=${serverId}`;
      const response = await this.get<any[]>(endpoint);
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      console.warn("getFiles not implemented yet");
      return [];
    }
  }

  async createFile(
    serverId: string,
    parentId: string,
    name: string,
    content?: string,
  ): Promise<any> {
    try {
      const response = await this.post("/files", {
        serverId,
        parentId,
        name,
        type: "file",
        content: content || "",
      });
      return response.data || response;
    } catch (error) {
      console.warn("createFile not implemented yet");
      throw error;
    }
  }

  async createDirectory(
    serverId: string,
    parentId: string,
    name: string,
  ): Promise<any> {
    try {
      const response = await this.post("/files", {
        serverId,
        parentId,
        name,
        type: "directory",
      });
      return response.data || response;
    } catch (error) {
      console.warn("createDirectory not implemented yet");
      throw error;
    }
  }

  async readFile(fileId: string): Promise<any> {
    try {
      const response = await this.get(`/files/${fileId}`);
      return response.data || response;
    } catch (error) {
      console.warn("readFile not implemented yet");
      throw error;
    }
  }

  async writeFile(fileId: string, content: string): Promise<any> {
    try {
      const response = await this.put(`/files/${fileId}`, { content });
      return response.data || response;
    } catch (error) {
      console.warn("writeFile not implemented yet");
      throw error;
    }
  }

  async deleteFile(fileId: string): Promise<void> {
    await this.delete(`/files/${fileId}`);
  }

  // ==================== MESSAGING METHODS ====================

  async getMessages(page: number = 1, limit: number = 20): Promise<any> {
    const response = await this.get(`/messages?page=${page}&limit=${limit}`);
    return response.data;
  }

  async sendMessage(
    recipientId: string,
    subject: string,
    content: string,
  ): Promise<any> {
    const response = await this.post("/messages", {
      recipientId,
      subject,
      content,
    });
    return response.data;
  }

  async markMessageAsRead(messageId: string): Promise<void> {
    await this.put(`/messages/${messageId}/read`);
  }

  // ==================== FORUM METHODS ====================

  async getForumPosts(
    section?: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<any> {
    try {
      const endpoint = section
        ? `/forum?section=${section}&page=${page}&limit=${limit}`
        : `/forum?page=${page}&limit=${limit}`;
      const response = await this.get(endpoint);
      return response.data;
    } catch (error) {
      console.warn("getForumPosts not implemented yet");
      return [];
    }
  }

  async createForumPost(
    title: string,
    content: string,
    section: string,
    tags?: string[],
  ): Promise<any> {
    const response = await this.post("/forum", {
      title,
      content,
      section,
      tags: tags || [],
    });
    return response.data;
  }

  // ==================== MISSION METHODS ====================

  async getMissions(status?: string): Promise<any[]> {
    try {
      const endpoint = status ? `/missions?status=${status}` : "/missions";
      const response = await this.get<any[]>(endpoint);
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      console.warn("getMissions not implemented yet");
      return [];
    }
  }

  async acceptMission(missionId: string): Promise<any> {
    const response = await this.post(`/missions/${missionId}/accept`);
    return response.data;
  }

  // ==================== HACKING METHODS ====================

  async attemptHack(
    targetUserId: string,
    targetServerId: string,
    method: string,
    tools: string[],
  ): Promise<any> {
    const response = await this.post("/hack/attempt", {
      targetUserId,
      targetServerId,
      method,
      tools,
    });
    return response.data;
  }

  async getHackHistory(page: number = 1, limit: number = 20): Promise<any> {
    const response = await this.get(
      `/hack/history?page=${page}&limit=${limit}`,
    );
    return response.data;
  }

  async getHackAlerts(): Promise<any[]> {
    try {
      const response = await this.get<any[]>("/hack/alerts");
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      console.warn("getHackAlerts not implemented yet");
      return [];
    }
  }

  // ==================== EVENT SYSTEM ====================

  async subscribeToEvent(
    eventType: string,
    method: string,
    targetId?: string,
    quality: number = 50,
    durationMinutes?: number,
  ): Promise<any> {
    const response = await this.post("/events/subscribe", {
      eventType,
      method,
      targetId,
      quality,
      durationMinutes,
    });
    return response.data;
  }

  async getEventSubscriptions(): Promise<any[]> {
    const response = await this.get<any[]>("/events/subscriptions");
    return Array.isArray(response.data) ? response.data : [];
  }

  async unsubscribeFromEvent(
    eventType: string,
    targetId?: string,
  ): Promise<void> {
    await this.delete("/events/subscribe", {
      eventType,
      targetId,
    });
  }

  async getEvents(limit: number = 50): Promise<any[]> {
    const response = await this.get<any[]>(`/events?limit=${limit}`);
    return Array.isArray(response.data) ? response.data : [];
  }

  async getEventsByType(eventType: string, limit: number = 50): Promise<any[]> {
    const response = await this.get<any[]>(
      `/events/type/${eventType}?limit=${limit}`,
    );
    return Array.isArray(response.data) ? response.data : [];
  }

  async getGlobalEvents(limit: number = 20): Promise<any[]> {
    const response = await this.get<any[]>(`/events/global?limit=${limit}`);
    return Array.isArray(response.data) ? response.data : [];
  }

  async createSystemAnnouncement(
    title: string,
    message: string,
    severity: string = "info",
  ): Promise<any> {
    const response = await this.post("/events/announce", {
      title,
      message,
      severity,
    });
    return response.data;
  }

  // ==================== COMMAND EXECUTION ====================

  async executeCommand(command: string, serverId?: string): Promise<any> {
    const response = await this.post("/command/execute", {
      command,
      ...(serverId ? { serverId } : {}),
    });
    return response;
  }

  // ==================== HEALTH CHECK ====================

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.baseURL.replace("/api", "")}/health`,
      );
      const data = await response.json();
      return data.status === "healthy";
    } catch (error) {
      return false;
    }
  }
}

// Custom error classes
export class ApiError extends Error {
  public status: number;
  public details: any;

  constructor(message: string, status: number = 0, details: any = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export class AuthError extends ApiError {
  constructor(message: string, status: number = 401, details: any = {}) {
    super(message, status, details);
    this.name = "AuthError";
  }
}

// Create and export singleton instance
export const apiClient = new ApiClient();
export default apiClient;

// Export types for convenience
export type { AuthRequest, AuthResponse, ApiResponse };
