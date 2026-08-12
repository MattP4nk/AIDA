import { writable, get } from "svelte/store";
import { socketService } from "./socket";
import type { TerminalTab } from "../../../shared/types";

interface TabState {
  tabs: TerminalTab[];
  activeTabId: string;
  outputLines: Map<string, OutputLine[]>;
  commandHistories: Map<string, string[]>;
  historyIndices: Map<string, number>;
}

interface OutputLine {
  id: number;
  text: string;
  type: "command" | "output" | "error" | "success" | "system";
  timestamp: Date;
}

// Create the main store
const createTerminalTabsStore = () => {
  const initialState: TabState = {
    tabs: [],
    activeTabId: "",
    outputLines: new Map(),
    commandHistories: new Map(),
    historyIndices: new Map(),
  };

  const { subscribe, set, update } = writable<TabState>(initialState);

  let lineIdCounter = 0;

  return {
    subscribe,

    // Initialize tabs from server
    initialize: async () => {
      try {
        const socket = socketService.getSocket();

        // Wait for socket to be connected if it's not already
        if (!socket || !socket.connected) {
          // Return a promise that resolves when connected
          return new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error("Socket connection timeout"));
            }, 10000); // 10 second timeout

            const attemptInitialize = () => {
              const currentSocket = socketService.getSocket();

              if (currentSocket && currentSocket.connected) {
                clearTimeout(timeout);

                // Register listener BEFORE emitting to avoid race
                currentSocket.off("terminal:list");
                currentSocket.once(
                  "terminal:list",
                  (data: {
                    terminals: TerminalTab[];
                    activeTerminalId: string;
                  }) => {
                    update((state) => {
                      state.tabs = data.terminals;
                      state.activeTabId = data.activeTerminalId;

                      // Initialize output and history for each tab
                      data.terminals.forEach((tab) => {
                        if (!state.outputLines.has(tab.id)) {
                          state.outputLines.set(tab.id, []);
                        }
                        if (!state.commandHistories.has(tab.id)) {
                          state.commandHistories.set(tab.id, []);
                        }
                        if (!state.historyIndices.has(tab.id)) {
                          state.historyIndices.set(tab.id, -1);
                        }
                      });

                      return state;
                    });

                    resolve();
                  },
                );

                // Emit AFTER listener is registered
                currentSocket.emit("terminal:list");
              } else {
                // Retry after a short delay
                setTimeout(attemptInitialize, 100);
              }
            };

            attemptInitialize();
          });
        }

        // Socket is already connected — register listener BEFORE emitting to avoid race
        return new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("Terminal list response timeout"));
          }, 10000);

          socket.off("terminal:list");
          socket.once(
            "terminal:list",
            (data: { terminals: TerminalTab[]; activeTerminalId: string }) => {
              clearTimeout(timeout);

              update((state) => {
                state.tabs = data.terminals;
                state.activeTabId = data.activeTerminalId;

                // Initialize output and history for each tab
                data.terminals.forEach((tab) => {
                  if (!state.outputLines.has(tab.id)) {
                    state.outputLines.set(tab.id, []);
                  }
                  if (!state.commandHistories.has(tab.id)) {
                    state.commandHistories.set(tab.id, []);
                  }
                  if (!state.historyIndices.has(tab.id)) {
                    state.historyIndices.set(tab.id, -1);
                  }
                });

                return state;
              });

              resolve();
            },
          );

          // Emit AFTER listener is registered
          socket.emit("terminal:list");
        });
      } catch (error) {
        console.error("Failed to initialize terminals:", error);
        throw error;
      }
    },

    // Create new terminal tab
    createTab: async (label?: string) => {
      try {
        const socket = socketService.getSocket();
        if (socket && socket.connected) {
          socket.emit("terminal:create", { label });

          // Listen for response (remove old listener first to prevent leaks)
          socket.off("terminal:created");
          socket.once("terminal:created", (terminal: TerminalTab) => {
            update((state) => {
              state.tabs.push(terminal);
              state.outputLines.set(terminal.id, []);
              state.commandHistories.set(terminal.id, []);
              state.historyIndices.set(terminal.id, -1);
              state.activeTabId = terminal.id; // Auto-switch to new tab
              return state;
            });
          });
        }
      } catch (error) {
        console.error("Failed to create terminal:", error);
      }
    },

    // Close terminal tab
    closeTab: async (terminalId: string) => {
      try {
        const socket = socketService.getSocket();
        if (socket && socket.connected) {
          socket.emit("terminal:close", { terminalId });

          // Listen for response (remove old listener first to prevent leaks)
          socket.off("terminal:closed");
          socket.once("terminal:closed", (data: { terminalId: string }) => {
            update((state) => {
              const index = state.tabs.findIndex(
                (t) => t.id === data.terminalId,
              );
              if (index !== -1) {
                state.tabs.splice(index, 1);

                // Clean up associated data
                state.outputLines.delete(data.terminalId);
                state.commandHistories.delete(data.terminalId);
                state.historyIndices.delete(data.terminalId);

                // Switch to first tab if we closed the active one
                if (
                  state.activeTabId === data.terminalId &&
                  state.tabs.length > 0
                ) {
                  state.activeTabId = state.tabs[0].id;
                }
              }
              return state;
            });
          });
        }
      } catch (error) {
        console.error("Failed to close terminal:", error);
      }
    },

    // Switch active terminal
    switchTab: async (terminalId: string) => {
      try {
        const socket = socketService.getSocket();
        if (socket && socket.connected) {
          socket.emit("terminal:switch", { terminalId });

          // Listen for response (remove old listener first to prevent leaks)
          socket.off("terminal:switched");
          socket.once("terminal:switched", (data: { terminalId: string }) => {
            update((state) => {
              state.activeTabId = data.terminalId;
              return state;
            });
          });
        }
      } catch (error) {
        console.error("Failed to switch terminal:", error);
      }
    },

    // Add output line to specific terminal
    addOutputLine: (
      terminalId: string,
      text: string,
      type: OutputLine["type"],
    ) => {
      const MAX_OUTPUT_LINES = 1000;
      update((state) => {
        const existing = state.outputLines.get(terminalId) || [];
        const newLines = [
          ...existing,
          {
            id: lineIdCounter++,
            text,
            type,
            timestamp: new Date(),
          },
        ];
        // Cap buffer to prevent unbounded memory growth
        const cappedLines = newLines.length > MAX_OUTPUT_LINES
          ? newLines.slice(-MAX_OUTPUT_LINES)
          : newLines;
        const newOutputLines = new Map(state.outputLines);
        newOutputLines.set(terminalId, cappedLines);
        return { ...state, outputLines: newOutputLines };
      });
    },

    // Add command to history (immutable update)
    addToHistory: (terminalId: string, command: string) => {
      update((state) => {
        const history = state.commandHistories.get(terminalId) || [];
        const newHistories = new Map(state.commandHistories);
        if (
          command.trim() &&
          (history.length === 0 || history[history.length - 1] !== command)
        ) {
          newHistories.set(terminalId, [...history, command]);
        }
        const newIndices = new Map(state.historyIndices);
        newIndices.set(terminalId, -1);
        return { ...state, commandHistories: newHistories, historyIndices: newIndices };
      });
    },

    // Navigate command history (immutable update)
    navigateHistory: (
      terminalId: string,
      direction: "up" | "down",
    ): string | null => {
      let result: string | null = null;

      update((state) => {
        const history = state.commandHistories.get(terminalId) || [];
        let index = state.historyIndices.get(terminalId) ?? -1;

        if (direction === "up") {
          if (index < history.length - 1) {
            index++;
            const cmd = history[history.length - 1 - index];
            result = cmd || null;
          }
        } else {
          if (index > 0) {
            index--;
            const cmd = history[history.length - 1 - index];
            result = cmd || null;
          } else if (index === 0) {
            index = -1;
            result = "";
          }
        }

        const newIndices = new Map(state.historyIndices);
        newIndices.set(terminalId, index);
        return { ...state, historyIndices: newIndices };
      });

      return result;
    },

    // Clear output for specific terminal (immutable update)
    clearOutput: (terminalId: string) => {
      update((state) => {
        const newOutputLines = new Map(state.outputLines);
        newOutputLines.set(terminalId, []);
        return { ...state, outputLines: newOutputLines };
      });
    },

    // Get active terminal
    getActiveTerminal: (): TerminalTab | null => {
      const state = get({ subscribe });
      return state.tabs.find((t) => t.id === state.activeTabId) || null;
    },

    // Get output lines for specific terminal
    getOutputLines: (terminalId: string): OutputLine[] => {
      const state = get({ subscribe });
      return state.outputLines.get(terminalId) || [];
    },

    // Get command history for specific terminal
    getCommandHistory: (terminalId: string): string[] => {
      const state = get({ subscribe });
      return state.commandHistories.get(terminalId) || [];
    },

    // Update terminal processing state (immutable update)
    updateProcessingState: (
      terminalId: string,
      isProcessing: boolean,
      command?: string,
    ) => {
      update((state) => {
        const newTabs = state.tabs.map((t) =>
          t.id === terminalId
            ? { ...t, isProcessing, processingCommand: command, lastActivity: new Date() }
            : t,
        );
        return { ...state, tabs: newTabs };
      });
    },

    // Cleanup all socket listeners (prevents memory leaks)
    cleanup: () => {
      const socket = socketService.getSocket();
      if (socket) {
        socket.off("terminal:list");
        socket.off("terminal:created");
        socket.off("terminal:closed");
        socket.off("terminal:switched");
      }
    },

    // Reset store (for logout, etc.)
    reset: () => {
      // Clean up listeners first
      const socket = socketService.getSocket();
      if (socket) {
        socket.off("terminal:list");
        socket.off("terminal:created");
        socket.off("terminal:closed");
        socket.off("terminal:switched");
      }

      set({
        tabs: [],
        activeTabId: "",
        outputLines: new Map(),
        commandHistories: new Map(),
        historyIndices: new Map(),
      });
      lineIdCounter = 0;
    },
  };
};

export const terminalTabsStore = createTerminalTabsStore();

// Export type for use in components
export type { OutputLine };
