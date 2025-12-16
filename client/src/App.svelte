<script lang="ts">
    import { onMount } from "svelte";
    import Terminal from "./components/Terminal.svelte";
    import AuthDialog from "./components/AuthDialog.svelte";
    import { apiClient } from "./services/api";
    import { socketService } from "./services/socket";
    import { terminalTabsStore } from "./services/terminalTabs";

    let isAuthenticated = false;
    let isCheckingAuth = true;
    let user: any = null;
    let isTerminalReady = false;

    onMount(async () => {
        await checkAuthentication();
    });

    async function checkAuthentication() {
        isCheckingAuth = true;

        try {
            // Check if we have a token
            if (apiClient.isAuthenticated()) {
                // Verify the token is still valid
                const response = await apiClient.verifyToken();
                if (response.success) {
                    isAuthenticated = true;
                    user = response.user;
                    // Initialize socket connection and wait for it to be ready
                    await initializeSocketAndTerminals();
                } else {
                    isAuthenticated = false;
                }
            } else {
                isAuthenticated = false;
            }
        } catch (error) {
            console.error("Auth check failed:", error);
            isAuthenticated = false;
        } finally {
            isCheckingAuth = false;
        }
    }

    async function initializeSocketAndTerminals() {
        try {
            // Ensure we have a fresh socket connection with auth token
            socketService.reconnect();

            // Wait for authentication to complete on the server using acknowledgment pattern
            const socket = (socketService as any).socket;
            if (socket) {
                await new Promise<void>((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        reject(new Error("Authentication timeout (10s)"));
                    }, 10000);

                    // Use acknowledgment pattern to avoid race condition
                    // This ensures we don't miss the authentication event
                    socket.emit("authenticate:request", (response: any) => {
                        clearTimeout(timeout);
                        if (response && response.success) {
                            resolve();
                        } else {
                            reject(
                                new Error(
                                    `Authentication failed: ${response?.error || "Unknown error"}`,
                                ),
                            );
                        }
                    });

                    // Also handle connection errors (remove old listener first)
                    socket.off("connect_error");
                    socket.once("connect_error", (error: any) => {
                        clearTimeout(timeout);
                        reject(error);
                    });
                });
            }

            // Now initialize terminal tabs (server session is ready)
            await terminalTabsStore.initialize();

            isTerminalReady = true;
        } catch (error) {
            console.error("Failed to initialize socket and terminals:", error);
            // Still show terminal even if tabs failed to load
            isTerminalReady = true;
        }
    }

    function handleAuthenticated(event: CustomEvent) {
        user = event.detail;
        isAuthenticated = true;
        // Initialize socket connection and terminals after successful authentication
        initializeSocketAndTerminals();
    }
</script>

{#if isCheckingAuth}
    <div class="loading-screen">
        <div class="loading-content">
            <div class="spinner"></div>
            <p>Initializing AIDA Terminal...</p>
        </div>
    </div>
{:else if !isAuthenticated}
    <AuthDialog on:authenticated={handleAuthenticated} />
{:else if !isTerminalReady}
    <div class="loading-screen">
        <div class="loading-content">
            <div class="spinner"></div>
            <p>Connecting to terminal...</p>
        </div>
    </div>
{:else}
    <Terminal {user} />
{/if}

<style>
    :global(body) {
        margin: 0;
        padding: 0;
        overflow: hidden;
    }

    .loading-screen {
        width: 100vw;
        height: 100vh;
        background: #0a0e14;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .loading-content {
        text-align: center;
        color: #00ff41;
        font-family: "Courier New", monospace;
    }

    .spinner {
        width: 50px;
        height: 50px;
        border: 3px solid #00ff41;
        border-top-color: transparent;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin: 0 auto 20px;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    .loading-content p {
        font-size: 16px;
        margin: 0;
        letter-spacing: 2px;
    }
</style>
