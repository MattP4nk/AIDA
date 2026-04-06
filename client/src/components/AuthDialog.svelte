<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { apiClient } from "../services/api";

    const dispatch = createEventDispatcher();

    let mode: "login" | "register" = "login";
    let username = "";
    let email = "";
    let password = "";
    let confirmPassword = "";
    let error = "";
    let isLoading = false;

    async function handleSubmit() {
        error = "";

        // Validation
        if (!username.trim() || !password.trim()) {
            error = "Username and password are required";
            return;
        }

        if (mode === "register") {
            if (!email.trim()) {
                error = "Email is required";
                return;
            }
            if (password !== confirmPassword) {
                error = "Passwords do not match";
                return;
            }
            if (password.length < 8) {
                error = "Password must be at least 8 characters";
                return;
            }
        }

        isLoading = true;

        try {
            if (mode === "login") {
                const result = await apiClient.login({
                    username: username.trim(),
                    password,
                });

                if (result.success) {
                    dispatch("authenticated", result.user);
                } else {
                    error = result.message || "Login failed";
                }
            } else {
                const result = await apiClient.register({
                    username: username.trim(),
                    email: email.trim(),
                    password,
                });

                if (result.success) {
                    dispatch("authenticated", result.user);
                } else {
                    error = result.message || "Registration failed";
                }
            }
        } catch (err: any) {
            error = err.message || "An error occurred";
        } finally {
            isLoading = false;
        }
    }

    function toggleMode() {
        mode = mode === "login" ? "register" : "login";
        error = "";
        password = "";
        confirmPassword = "";
    }

    function handleKeyDown(event: KeyboardEvent) {
        if (event.key === "Enter" && !isLoading) {
            handleSubmit();
        }
    }
</script>

<div class="auth-overlay" on:click|self={() => {}}>
    <div class="auth-dialog">
        <div class="auth-header">
            <h2>
                {mode === "login" ? "Login to AIDA" : "Register for AIDA"}
            </h2>
            <p class="auth-subtitle">
                {mode === "login"
                    ? "Access your hacking terminal"
                    : "Create your hacker account"}
            </p>
        </div>

        <form class="auth-form" on:submit|preventDefault={handleSubmit}>
            {#if error}
                <div class="auth-error">
                    ⚠️ {error}
                </div>
            {/if}

            <div class="form-group">
                <label for="username">Username</label>
                <input
                    type="text"
                    id="username"
                    bind:value={username}
                    on:keydown={handleKeyDown}
                    disabled={isLoading}
                    placeholder="Enter username"
                    autocomplete="username"
                    required
                />
            </div>

            {#if mode === "register"}
                <div class="form-group">
                    <label for="email">Email</label>
                    <input
                        type="email"
                        id="email"
                        bind:value={email}
                        on:keydown={handleKeyDown}
                        disabled={isLoading}
                        placeholder="Enter email"
                        autocomplete="email"
                        required
                    />
                </div>
            {/if}

            <div class="form-group">
                <label for="password">Password</label>
                <input
                    type="password"
                    id="password"
                    bind:value={password}
                    on:keydown={handleKeyDown}
                    disabled={isLoading}
                    placeholder="Enter password"
                    autocomplete={mode === "login"
                        ? "current-password"
                        : "new-password"}
                    required
                />
                {#if mode === "register"}
                    <span class="field-hint"
                        >Min 8 characters, include uppercase, lowercase, and
                        number</span
                    >
                {/if}
            </div>

            {#if mode === "register"}
                <div class="form-group">
                    <label for="confirmPassword">Confirm Password</label>
                    <input
                        type="password"
                        id="confirmPassword"
                        bind:value={confirmPassword}
                        on:keydown={handleKeyDown}
                        disabled={isLoading}
                        placeholder="Confirm password"
                        autocomplete="new-password"
                        required
                    />
                </div>
            {/if}

            <button
                type="submit"
                class="auth-button"
                disabled={isLoading}
                class:loading={isLoading}
            >
                {#if isLoading}
                    <span class="spinner"></span>
                    {mode === "login" ? "Logging in..." : "Registering..."}
                {:else}
                    {mode === "login" ? "Login" : "Register"}
                {/if}
            </button>

            <button
                type="button"
                class="toggle-mode-button"
                on:click={toggleMode}
                disabled={isLoading}
            >
                {mode === "login"
                    ? "Don't have an account? Register"
                    : "Already have an account? Login"}
            </button>
        </form>
    </div>
</div>

<style>
    .auth-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.95);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        backdrop-filter: blur(4px);
    }

    .auth-dialog {
        background: #0a0e14;
        border: 2px solid #00ff41;
        border-radius: 8px;
        padding: 40px;
        max-width: 450px;
        width: 90%;
        box-shadow: 0 0 40px rgba(0, 255, 65, 0.3);
        animation: slideIn 0.3s ease-out;
    }

    @keyframes slideIn {
        from {
            opacity: 0;
            transform: translateY(-20px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    .auth-header {
        text-align: center;
        margin-bottom: 30px;
    }

    .auth-header h2 {
        color: #00ff41;
        font-family: "Courier New", monospace;
        font-size: 24px;
        margin: 0 0 10px 0;
        text-transform: uppercase;
        letter-spacing: 2px;
    }

    .auth-subtitle {
        color: #00ccff;
        font-family: "Courier New", monospace;
        font-size: 14px;
        margin: 0;
    }

    .auth-form {
        display: flex;
        flex-direction: column;
        gap: 20px;
    }

    .auth-error {
        background: rgba(255, 68, 68, 0.2);
        border: 1px solid #ff4444;
        color: #ff4444;
        padding: 12px;
        border-radius: 4px;
        font-family: "Courier New", monospace;
        font-size: 13px;
        text-align: center;
    }

    .form-group {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .form-group label {
        color: #00ff41;
        font-family: "Courier New", monospace;
        font-size: 14px;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 1px;
    }

    .form-group input {
        background: #0d1117;
        border: 1px solid #00ff41;
        color: #00ff41;
        padding: 12px;
        font-family: "Courier New", monospace;
        font-size: 14px;
        border-radius: 4px;
        outline: none;
        transition: all 0.2s;
    }

    .form-group input:focus {
        border-color: #00ccff;
        box-shadow: 0 0 10px rgba(0, 255, 65, 0.3);
    }

    .form-group input:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .form-group input::placeholder {
        color: #00ff4166;
    }

    .field-hint {
        color: #00ccff;
        font-family: "Courier New", monospace;
        font-size: 11px;
        margin-top: -4px;
    }

    .auth-button {
        background: #00ff41;
        color: #0a0e14;
        border: none;
        padding: 14px;
        font-family: "Courier New", monospace;
        font-size: 16px;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 2px;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
    }

    .auth-button:hover:not(:disabled) {
        background: #00ccff;
        box-shadow: 0 0 20px rgba(0, 255, 65, 0.5);
        transform: translateY(-2px);
    }

    .auth-button:active:not(:disabled) {
        transform: translateY(0);
    }

    .auth-button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .toggle-mode-button {
        background: transparent;
        color: #00ccff;
        border: 1px solid #00ccff;
        padding: 12px;
        font-family: "Courier New", monospace;
        font-size: 13px;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
    }

    .toggle-mode-button:hover:not(:disabled) {
        background: rgba(0, 204, 255, 0.1);
        border-color: #00ff41;
        color: #00ff41;
    }

    .toggle-mode-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .spinner {
        width: 16px;
        height: 16px;
        border: 2px solid #0a0e14;
        border-top-color: transparent;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    /* Responsive */
    @media (max-width: 500px) {
        .auth-dialog {
            padding: 30px 20px;
        }

        .auth-header h2 {
            font-size: 20px;
        }

        .auth-subtitle {
            font-size: 12px;
        }
    }
</style>
