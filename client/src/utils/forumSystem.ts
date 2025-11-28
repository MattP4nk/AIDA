import { writable } from "svelte/store";

/**
 * Client-side Forum UI State Management
 * 
 * This is a MINIMAL UI-only file. All game logic is server-side in forumService.ts
 * and accessible via the `forum` command.
 * 
 * This file ONLY manages UI state for the ForumDialog component.
 */

// Forum data structures (UI representation only)
export interface ForumPost {
  id: string;
  username: string;
  title: string;
  content: string;
  timestamp: Date;
  replies?: ForumReply[];
  tags: string[];
  reputation: number;
  views: number;
  encrypted?: boolean;
  storyRelevant?: boolean;
  keyFragmentId?: string;
}

export interface ForumReply {
  id: string;
  username: string;
  content: string;
  timestamp: Date;
  reputation: number;
}

export interface Forum {
  id: string;
  name: string;
  description: string;
  url: string;
  securityLevel: number;
  requiresProxy: boolean;
  isHoneypot: boolean;
  memberCount?: number;
  postCount?: number;
  faction?: string;
}

export interface ForumAccessData {
  forum: Forum;
  posts: ForumPost[];
  isMember: boolean;
  requiresProxy: boolean;
  isHoneypot: boolean;
  canPost: boolean;
}

// UI State Stores
export const currentForum = writable<ForumAccessData | null>(null);
export const discoveredForums = writable<Forum[]>([]);
export const currentPost = writable<ForumPost | null>(null);

// UI State Management
export class ForumUIState {
  private static instance: ForumUIState;

  static getInstance(): ForumUIState {
    if (!ForumUIState.instance) {
      ForumUIState.instance = new ForumUIState();
    }
    return ForumUIState.instance;
  }

  /**
   * Update UI state when receiving forum data from server command
   */
  setCurrentForum(forumData: ForumAccessData): void {
    currentForum.set(forumData);
  }

  /**
   * Update discovered forums list
   */
  setDiscoveredForums(forums: Forum[]): void {
    discoveredForums.set(forums);
  }

  /**
   * Set currently viewed post
   */
  setCurrentPost(post: ForumPost | null): void {
    currentPost.set(post);
  }

  /**
   * Clear all forum UI state
   */
  clearState(): void {
    currentForum.set(null);
    currentPost.set(null);
  }
}

// Export singleton instance
export const forumUI = ForumUIState.getInstance();
