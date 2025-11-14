<script lang="ts">
    import { onMount } from "svelte";
    import Terminal from "./components/Terminal.svelte";
    import AuthDialog from "./components/AuthDialog.svelte";
    import { apiClient } from "./services/api";
    import { socketService } from "./services/socket";

    let isAuthenticated = false;
    let isCheckingAuth = true;
    let user: any = null;

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
                    // Initialize socket connection after successful authentication
                    socketService.connect();
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

    function handleAuthenticated(event: CustomEvent) {
        user = event.detail;
        isAuthenticated = true;
        // Initialize socket connection after successful authentication
        socketService.connect();
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
{:else}
    <Terminal />
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
