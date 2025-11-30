/**
 * Service Registry - Compatibility Layer
 * 
 * This file provides backward-compatible singleton exports that resolve from the DI container.
 * This allows gradual migration - new code can use DI injection, old code continues to work.
 */

import { container } from "./container";
import * as TOKENS from "./tokens";
import type GameStateManager from "../services/gameStateManager";
import type ProgressService from "../services/progressService";
import type EventService from "../services/eventService";
import type IPService from "../services/ipService";

/**
 * Get service instances from DI container
 * These are lazy-resolved singletons
 */

export function getProgressService(): ProgressService {
  return container.resolve(TOKENS.PROGRESS_SERVICE as any);
}

export function getEventService(): EventService {
  return container.resolve(TOKENS.EVENT_SERVICE as any);
}

export function getIPService(): IPService {
  return container.resolve(TOKENS.IP_SERVICE as any);
}

export function getGameStateManager(): GameStateManager {
  return container.resolve(TOKENS.GAME_STATE_MANAGER as any);
}

// Export lazy getters for compatibility
export const progressService = {
  get instance() {
    return getProgressService();
  }
};

export const eventService = {
  get instance() {
    return getEventService();
  }
};

export const ipService = {
  get instance() {
    return getIPService();
  }
};

export const gameStateManager = {
  get instance() {
    return getGameStateManager();
  }
};
