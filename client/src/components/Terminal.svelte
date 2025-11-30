<script lang="ts">
    import { onMount, tick } from "svelte";
    import { get } from "svelte/store";
    import { terminalService } from "../services/terminal";
    import type { CommandResult } from "../services/terminal";
    import { apiClient } from "../services/api";
    // New ASCII Dialog system
    import MailDialog from "./MailDialog.svelte";
    import ChatDialog from "./ChatDialog.svelte";
    import ForumDialog from "./ForumDialog.svelte";
    // Socket service for real-time notifications
    import { liveMessages, socketService } from "../services/socket";

    // ==================== STATE ====================

    interface OutputLine {
        id: number;
        text: string;
        type: "command" | "output" | "error" | "success" | "system";
        timestamp: Date;
    }

    let inputValue = "";
    let inputElement: HTMLInputElement;
    let terminalElement: HTMLDivElement;
    let outputElement: HTMLDivElement;

    let outputLines: OutputLine[] = [];
    let commandHistory: string[] = [];
    let historyIndex = -1;
    let isExecuting = false;
    let lineIdCounter = 0;

    let username = "guest";
    let currentServer = "local";
    let currentDir = "~";

    // Dialog state
    let activeDialog: "none" | "mail" | "chat" | "forum" = "none";
    let dialogData: any = null;

    // Notification state
    let unreadCount = 0;
    let unreadChatCount = 0;
    let unreadMailCount = 0;

    // UI enhancements
    let currentTime = new Date().toLocaleTimeString();
    let connectionQuality = 100;
    let systemLoad = 0;
    let scanlineEffect = true;
    let glowEffect = true;

    // ==================== LIFECYCLE ====================

    onMount(() => {
        // Focus input
        focusInput();

        // Check authentication and load user info
        checkAuth();

        // Show welcome message after a brief delay to allow auth check
        setTimeout(showWelcome, 100);

        // Set up keyboard shortcuts
        document.addEventListener("keydown", handleGlobalKeydown);

        // Subscribe to live messages for notifications
        const unsubscribe = liveMessages.subscribe((messages) => {
            unreadCount = messages.length;

            // Count chat vs mail messages
            unreadChatCount = messages.filter(
                (msg) => !msg.subject || msg.subject.trim() === "",
            ).length;
            unreadMailCount = messages.filter(
                (msg) => msg.subject && msg.subject.trim() !== "",
            ).length;

            // Play notification sound or show visual feedback
            if (messages.length > 0) {
                playNotificationSound();
            }
        });

        // Request notification permission
        socketService.requestNotificationPermission();

        // Update clock every second
        const clockInterval = setInterval(() => {
            currentTime = new Date().toLocaleTimeString();
        }, 1000);

        // Simulate system load variations
        const loadInterval = setInterval(() => {
            systemLoad = Math.floor(Math.random() * 30) + 10; // 10-40%
        }, 3000);

        return () => {
            document.removeEventListener("keydown", handleGlobalKeydown);
            unsubscribe();
            clearInterval(clockInterval);
            clearInterval(loadInterval);
        };
    });

    // ==================== AUTHENTICATION ====================

    async function checkAuth() {
        try {
            if (terminalService.isAuthenticated()) {
                const response = await apiClient.verifyToken();
                if (response.success && response.user) {
                    username = response.user.username;
                    // Update other info if available
                    if (response.user.homeIp) {
                        currentServer = response.user.homeIp;
                    }
                }
            }
        } catch (error) {
            // Not authenticated or error - stay as guest
            console.log("Not authenticated:", error);
        }
    }

    // ==================== WELCOME MESSAGE ====================

    function showWelcome() {
        // Format username for display
        const displayUser = username.toUpperCase().padEnd(30);
        const displayServer = currentServer.toUpperCase().padEnd(28);

        const welcomeLines = [
            "",
            "╔════════════════════════════════════════════════════════════════════════════════════════════╗",
            "║                                                                                            ║",
            "║      ███╗   ██╗███████╗██╗   ██╗██████╗  █████╗ ██╗         ██╗     ██╗███╗   ██╗██╗  ██╗║",
            "║      ████╗  ██║██╔════╝██║   ██║██╔══██╗██╔══██╗██║         ██║     ██║████╗  ██║██║ ██╔╝║",
            "║      ██╔██╗ ██║█████╗  ██║   ██║██████╔╝███████║██║         ██║     ██║██╔██╗ ██║█████╔╝ ║",
            "║      ██║╚██╗██║██╔══╝  ██║   ██║██╔══██╗██╔══██║██║         ██║     ██║██║╚██╗██║██╔═██╗ ║",
            "║      ██║ ╚████║███████╗╚██████╔╝██║  ██║██║  ██║███████╗    ███████╗██║██║ ╚████║██║  ██╗║",
            "║      ╚═╝  ╚═══╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝    ╚══════╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝║",
            "║                                                                                            ║",
            "║      ████████╗███████╗██████╗ ███╗   ███╗██╗███╗   ██╗ █████╗ ██╗                        ║",
            "║      ╚══██╔══╝██╔════╝██╔══██╗████╗ ████║██║████╗  ██║██╔══██╗██║                        ║",
            "║         ██║   █████╗  ██████╔╝██╔████╔██║██║██╔██╗ ██║███████║██║                        ║",
            "║         ██║   ██╔══╝  ██╔══██╗██║╚██╔╝██║██║██║╚██╗██║██╔══██║██║                        ║",
            "║         ██║   ███████╗██║  ██║██║ ╚═╝ ██║██║██║ ╚████║██║  ██║███████╗                   ║",
            "║         ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝╚══════╝                   ║",
            "║                                                                                            ║",
            "║                    ▓▓▓  Advanced Interactive Data Access  ▓▓▓                            ║",
            "║                              [ Version 2.0 ]                                              ║",
            "║                                                                                            ║",
            "╚════════════════════════════════════════════════════════════════════════════════════════════╝",
            "",
            "┌────────────────────────────────────────────────────────────────────────────────────────────┐",
            "│  🔐 SECURE NEURAL CONNECTION ESTABLISHED                                                   │",
            `│  👤 User: ${displayUser} │ Status: ACTIVE                           │`,
            `│  🖥️  Server: ${displayServer} │ Uptime: 99.9%                          │`,
            "└────────────────────────────────────────────────────────────────────────────────────────────┘",
            "",
            `Welcome, ${username}! Your neural link to the AIDA network is active.`,
            "All activities are monitored and logged for security purposes.",
            "",
            "┌─ Quick Start ──────────────────────────────────────────────────────────────────────────────┐",
            "│  • Type 'help' for available commands                                                     │",
            "│  • Type 'ls' to list files and directories                                                │",
            "│  • Type 'status' to view your player information                                          │",
            "│  • Use ↑/↓ arrows to navigate command history                                             │",
            "│  • Type 'clear' to clear the terminal screen                                              │",
            "└────────────────────────────────────────────────────────────────────────────────────────────┘",
            "",
        ];

        welcomeLines.forEach((line) => {
            addOutputLine(line, "system");
        });
    }

    // ==================== OUTPUT MANAGEMENT ====================

    function addOutputLine(text: string, type: OutputLine["type"] = "output") {
        outputLines = [
            ...outputLines,
            {
                id: ++lineIdCounter,
                text,
                type,
                timestamp: new Date(),
            },
        ];

        // Auto-scroll after render
        tick().then(() => {
            scrollToBottom();
        });
    }

    function addCommandLine(command: string) {
        const prompt = getPrompt();
        addOutputLine(`${prompt} ${command}`, "command");
    }

    function addCommandOutput(result: CommandResult) {
        const lines = Array.isArray(result.output)
            ? result.output
            : [result.output];

        lines.forEach((line: any) => {
            if (result.success) {
                addOutputLine(line, "output");
            } else {
                addOutputLine(line, "error");
            }
        });

        // Show additional error details if available
        if (!result.success && result.error && result.error !== result.output) {
            addOutputLine(`Details: ${result.error}`, "error");
        }

        // Show exit code if non-zero
        if (result.exitCode && result.exitCode !== 0) {
            addOutputLine(`Exit code: ${result.exitCode}`, "system");
        }
    }

    function clearScreen() {
        outputLines = [];
    }

    // ==================== COMMAND EXECUTION ====================

    async function handleSubmit() {
        const command = inputValue.trim();

        // Ignore empty commands
        if (!command) {
            return;
        }

        // Add command to display
        addCommandLine(command);

        // Add to history
        if (commandHistory[commandHistory.length - 1] !== command) {
            commandHistory = [...commandHistory, command];
        }
        historyIndex = commandHistory.length;

        // Clear input immediately for better UX
        inputValue = "";

        // Handle client-side commands
        if (handleClientCommand(command)) {
            return;
        }

        // Execute command on server
        isExecuting = true;

        try {
            // Execute the command on the server
            const result = await terminalService.executeCommand(command);

            // Check if command wants to open a dialog
            if (result && result.openDialog) {
                openDialog(result.openDialog, result.data);
            }

            // Display command result
            addCommandOutput(result);

            // Update context from server data if available
            if (result.data) {
                updateContextFromData(result.data);
            }
        } catch (error: any) {
            // Show detailed error information
            addOutputLine(
                `Command execution failed: ${error.message || "Unknown error"}`,
                "error",
            );

            // Add additional error details if available
            if (error.details) {
                addOutputLine(
                    `Details: ${JSON.stringify(error.details)}`,
                    "error",
                );
            }

            // Add suggestion for debugging
            if (import.meta.env.DEV) {
                console.error("Terminal command error:", error);
            }
        } finally {
            isExecuting = false;
            focusInput();
        }
    }

    // ==================== CLIENT-SIDE COMMANDS ====================

    function handleClientCommand(command: string): boolean {
        const cmd = command.toLowerCase().trim();

        // Clear command
        if (cmd === "clear" || cmd === "cls") {
            clearScreen();
            return true;
        }

        // Exit command (logout)
        if (cmd === "exit" || cmd === "quit" || cmd === "logout") {
            handleLogout();
            return true;
        }

        // Not a client-side command
        return false;
    }

    async function handleLogout() {
        try {
            await apiClient.logout();
            addOutputLine("Logged out successfully", "success");
            addOutputLine("Refresh the page to login again", "system");
            username = "guest";
        } catch (error) {
            addOutputLine("Logout failed", "error");
        }
    }

    // ==================== CONTEXT UPDATES ====================

    function updateContextFromData(data: any) {
        // Update terminal context from server response data
        if (data.user) {
            username = data.user.username || data.user.name || username;
        }

        if (data.server) {
            currentServer = data.server.name || data.server.id || currentServer;
        }

        if (data.directory) {
            currentDir =
                data.directory.path || data.directory.name || currentDir;
        }
    }

    // ==================== DIALOG MANAGEMENT ====================

    function openDialog(type: "mail" | "chat" | "forum", data?: any) {
        activeDialog = type;
        dialogData = data;
        // Blur terminal background
        if (terminalElement) {
            terminalElement.classList.add("dialog-active");
        }
    }

    function closeDialog() {
        activeDialog = "none";
        dialogData = null;
        if (terminalElement) {
            terminalElement.classList.remove("dialog-active");
        }
        // Return focus to terminal input
        focusInput();
    }

    // ==================== NOTIFICATION SYSTEM ====================

    function playNotificationSound() {
        // Optional: Play a beep sound for new messages
        // You can add an audio element or use Web Audio API
        try {
            const beep = new Audio(
                "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZQQ0PV6vl8bFgHAU+kdvy0H0pBSh+zPLaizsIGGS56+mhUhELTKXh8bllHAU2jdXyz38qBSl+zPLaj",
            );
            beep.volume = 0.1;
            beep.play().catch(() => {
                // Ignore errors if audio can't play
            });
        } catch (e) {
            // Silently fail if audio not supported
        }
    }

    function handleNotificationClick() {
        // Get the most recent message to determine type
        const currentMessages = get(liveMessages);

        if (currentMessages.length > 0) {
            const latestMessage = currentMessages[0];
            // Chat messages have no subject or empty subject
            const isChat =
                !latestMessage.subject || latestMessage.subject.trim() === "";

            if (isChat) {
                openDialog("chat", null);
            } else {
                openDialog("mail", null);
            }
        } else {
            // Default to mail if no messages
            openDialog("mail", null);
        }

        clearNotifications();
    }

    function clearNotifications() {
        liveMessages.set([]);
        unreadCount = 0;
        unreadChatCount = 0;
        unreadMailCount = 0;
    }

    // ==================== HISTORY NAVIGATION ====================

    function navigateHistory(direction: "up" | "down") {
        if (commandHistory.length === 0) {
            return;
        }

        if (direction === "up") {
            if (historyIndex > 0) {
                historyIndex--;
                inputValue = commandHistory[historyIndex];
            } else if (historyIndex === 0) {
                inputValue = commandHistory[0];
            }
        } else {
            if (historyIndex < commandHistory.length - 1) {
                historyIndex++;
                inputValue = commandHistory[historyIndex];
            } else {
                historyIndex = commandHistory.length;
                inputValue = "";
            }
        }
    }

    // ==================== KEYBOARD HANDLING ====================

    function handleKeyDown(event: KeyboardEvent) {
        // Ctrl+C - Cancel input
        if (event.ctrlKey && event.key === "c") {
            event.preventDefault();
            addCommandLine(inputValue + "^C");
            inputValue = "";
            return;
        }

        // Ctrl+L - Clear screen
        if (event.ctrlKey && event.key === "l") {
            event.preventDefault();
            clearScreen();
            return;
        }

        // Ctrl+U - Clear input
        if (event.ctrlKey && event.key === "u") {
            event.preventDefault();
            inputValue = "";
            return;
        }

        // Enter - Submit command
        if (event.key === "Enter") {
            event.preventDefault();
            handleSubmit();
            return;
        }

        // Arrow Up - Previous command
        if (event.key === "ArrowUp") {
            event.preventDefault();
            navigateHistory("up");
            return;
        }

        // Arrow Down - Next command
        if (event.key === "ArrowDown") {
            event.preventDefault();
            navigateHistory("down");
            return;
        }

        // Tab - Auto-complete (future feature)
        if (event.key === "Tab") {
            event.preventDefault();
            // TODO: Implement autocomplete using help command data
            return;
        }
    }

    function handleGlobalKeydown(event: KeyboardEvent) {
        // Don't steal focus if a dialog is open
        if (activeDialog !== "none") {
            return;
        }

        // Any key focuses the input (for better UX)
        if (
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey &&
            event.key.length === 1
        ) {
            focusInput();
        }
    }

    // ==================== UI HELPERS ====================

    function getPrompt(): string {
        return `${username}@${currentServer}:${currentDir}$`;
    }

    function focusInput() {
        // Don't focus if a dialog is open
        if (activeDialog !== "none") {
            return;
        }
        if (inputElement && !isExecuting) {
            inputElement.focus();
        }
    }

    function scrollToBottom() {
        if (outputElement) {
            outputElement.scrollTop = outputElement.scrollHeight;
        }
    }

    function getLineClass(line: OutputLine): string {
        return `output-line ${line.type}`;
    }

    // ==================== CLICK HANDLERS ====================

    function handleTerminalClick() {
        // Don't focus if a dialog is open
        if (activeDialog === "none") {
            focusInput();
        }
    }
</script>

<!-- ==================== TEMPLATE ==================== -->

<div
    class="terminal"
    bind:this={terminalElement}
    on:click={handleTerminalClick}
    on:keydown={handleTerminalClick}
    role="textbox"
    aria-label="Terminal interface"
    aria-multiline="true"
    tabindex="0"
>
    <!-- Status Bar -->
    <div class="status-bar">
        <div class="status-left">
            <span class="status-item">
                <span class="status-icon">🖥️</span>
                <span class="status-label">AIDA Terminal</span>
            </span>
            <span class="status-item">
                <span class="status-icon">👤</span>
                <span class="status-label">{username}@{currentServer}</span>
            </span>
        </div>
        <div class="status-right">
            <span class="status-item">
                <span class="status-icon">📡</span>
                <span class="status-label">{connectionQuality}%</span>
            </span>
            <span class="status-item">
                <span class="status-icon">⚡</span>
                <span class="status-label">Load: {systemLoad}%</span>
            </span>
            {#if unreadCount > 0}
                <button
                    class="status-item notification"
                    on:click={handleNotificationClick}
                    title={unreadChatCount > 0 && unreadMailCount > 0
                        ? `${unreadChatCount} chat, ${unreadMailCount} mail`
                        : unreadChatCount > 0
                          ? `${unreadChatCount} chat message${unreadChatCount > 1 ? "s" : ""}`
                          : `${unreadMailCount} mail message${unreadMailCount > 1 ? "s" : ""}`}
                >
                    <span class="status-icon"
                        >{unreadChatCount > 0 ? "💬" : "📧"}</span
                    >
                    <span class="status-label">{unreadCount}</span>
                </button>
            {/if}
            <span class="status-item">
                <span class="status-icon">🕐</span>
                <span class="status-label">{currentTime}</span>
            </span>
        </div>
    </div>

    <!-- Output Area -->
    <div class="output" bind:this={outputElement} role="log" aria-live="polite">
        {#each outputLines as line (line.id)}
            <div class={getLineClass(line)}>
                <span class="line-timestamp"
                    >[{line.timestamp.toLocaleTimeString()}]</span
                >
                {line.text}
            </div>
        {/each}
    </div>

    <!-- Input Line -->
    <div class="input-line">
        <span class="prompt" aria-hidden="true">{getPrompt()}</span>
        <input
            bind:this={inputElement}
            bind:value={inputValue}
            on:keydown={handleKeyDown}
            disabled={isExecuting}
            class="input"
            class:executing={isExecuting}
            type="text"
            spellcheck="false"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            aria-label="Command input"
            placeholder={isExecuting ? "Executing..." : ""}
        />
        {#if isExecuting}
            <span class="loading" aria-label="Loading">
                <span class="loading-spinner">⟳</span>
                <span class="loading-text">Processing</span>
            </span>
        {/if}
    </div>
</div>

<!-- ASCII Dialogs -->
{#if activeDialog === "mail"}
    <MailDialog
        visible={true}
        initialData={dialogData}
        on:close={closeDialog}
    />
{:else if activeDialog === "chat"}
    <ChatDialog
        visible={true}
        initialData={dialogData}
        on:close={closeDialog}
    />
{:else if activeDialog === "forum"}
    <ForumDialog
        visible={true}
        initialData={dialogData}
        on:close={closeDialog}
    />
{/if}

<!-- ==================== STYLES ==================== -->

<style>
    /* ==================== TERMINAL CONTAINER ==================== */

    .terminal {
        width: 100vw;
        height: 100vh;
        background: #0a0e14;
        color: #00ff41;
        font-family: "Fira Code", "JetBrains Mono", "Courier New", monospace;
        font-size: 14px;
        line-height: 1.6;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        cursor: text;
        position: relative;
        margin: 0 auto;
        box-shadow: 0 0 50px rgba(0, 255, 65, 0.1);
    }

    /* Dialog active state - blur terminal */
    .terminal.dialog-active {
        filter: blur(2px);
        opacity: 0.6;
        pointer-events: none;
    }

    /* Optional CRT scanline effect */
    .terminal::before {
        content: "";
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: repeating-linear-gradient(
            0deg,
            rgba(0, 0, 0, 0.15),
            rgba(0, 0, 0, 0.15) 1px,
            transparent 1px,
            transparent 2px
        );
        pointer-events: none;
        z-index: 1;
        opacity: 0.3;
    }

    /* CRT screen glow */
    .terminal::after {
        content: "";
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: radial-gradient(
            ellipse at center,
            rgba(0, 255, 65, 0.05) 0%,
            transparent 70%
        );
        pointer-events: none;
        z-index: 1;
    }

    /* ==================== STATUS BAR ==================== */

    .status-bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 20px;
        background: rgba(0, 20, 30, 0.95);
        border-bottom: 1px solid rgba(0, 255, 65, 0.3);
        font-size: 12px;
        color: #00ccff;
        position: relative;
        z-index: 3;
        backdrop-filter: blur(10px);
    }

    .status-left,
    .status-right {
        display: flex;
        gap: 20px;
        align-items: center;
    }

    .status-item {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        border-radius: 4px;
        background: rgba(0, 255, 65, 0.05);
        transition: all 0.3s ease;
    }

    .status-item:hover {
        background: rgba(0, 255, 65, 0.15);
        transform: translateY(-1px);
    }

    .status-item.notification {
        background: rgba(255, 100, 0, 0.2);
        animation: pulse-notification 2s infinite;
    }

    @keyframes pulse-notification {
        0%,
        100% {
            opacity: 1;
        }
        50% {
            opacity: 0.6;
        }
    }

    .status-icon {
        font-size: 14px;
        filter: drop-shadow(0 0 3px rgba(0, 255, 65, 0.5));
    }

    .status-label {
        font-family: "Fira Code", monospace;
        font-size: 11px;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    /* Notification button styling */
    .status-item.notification {
        background: none;
        border: 1px solid rgba(255, 255, 0, 0.5);
        padding: 4px 12px;
        cursor: pointer;
        transition: all 0.2s ease;
        animation: pulse 2s ease-in-out infinite;
    }

    .status-item.notification:hover {
        background: rgba(255, 255, 0, 0.1);
        border-color: rgba(255, 255, 0, 0.8);
        transform: scale(1.05);
    }

    .status-item.notification .status-icon {
        color: #ffff00;
        filter: drop-shadow(0 0 5px rgba(255, 255, 0, 0.7));
    }

    .status-item.notification .status-label {
        color: #ffff00;
        font-weight: bold;
    }

    /* ==================== OUTPUT AREA ==================== */

    .output {
        flex: 1;
        overflow-y: auto;
        padding: 30px 40px;
        padding-bottom: 20px;
        scroll-behavior: smooth;
        position: relative;
        z-index: 2;
    }

    .output::-webkit-scrollbar {
        width: 8px;
    }

    .output::-webkit-scrollbar-track {
        background: #0a0e14;
    }

    .output::-webkit-scrollbar-thumb {
        background: #00ff41;
        border-radius: 4px;
    }

    .output::-webkit-scrollbar-thumb:hover {
        background: #00cc33;
    }

    /* ==================== OUTPUT LINES ==================== */

    .output-line {
        margin: 0;
        padding: 4px 0;
        white-space: pre-wrap;
        word-wrap: break-word;
        font-family: inherit;
        animation: fadeIn 0.2s ease-in;
        transition: background-color 0.2s ease;
    }

    .output-line:hover {
        background: rgba(0, 255, 65, 0.05);
        padding-left: 4px;
        border-left: 2px solid rgba(0, 255, 65, 0.3);
    }

    @keyframes fadeIn {
        from {
            opacity: 0;
            transform: translateX(-10px);
        }
        to {
            opacity: 1;
            transform: translateX(0);
        }
    }

    .line-timestamp {
        opacity: 0;
        font-size: 10px;
        color: rgba(0, 204, 255, 0.5);
        margin-right: 8px;
        transition: opacity 0.2s ease;
    }

    .output-line:hover .line-timestamp {
        opacity: 1;
    }

    .output-line.command {
        color: #00ff41;
        font-weight: bold;
        text-shadow: 0 0 5px rgba(0, 255, 65, 0.5);
        background: rgba(0, 255, 65, 0.05);
        padding: 6px 8px;
        margin: 4px 0;
        border-left: 3px solid #00ff41;
        border-radius: 2px;
    }

    .output-line.command::before {
        content: "▶ ";
        color: #00ccff;
        margin-right: 8px;
        font-size: 12px;
    }

    .output-line.output {
        color: #c0c0c0;
        padding-left: 20px;
    }

    .output-line.error {
        color: #ff4444;
        text-shadow: 0 0 5px rgba(255, 68, 68, 0.5);
        background: rgba(255, 68, 68, 0.1);
        padding: 6px 8px;
        margin: 4px 0;
        border-left: 3px solid #ff4444;
        border-radius: 2px;
    }

    .output-line.error::before {
        content: "✖ ";
        margin-right: 8px;
        font-weight: bold;
    }

    .output-line.success {
        color: #00ff41;
        text-shadow: 0 0 5px rgba(0, 255, 65, 0.5);
        background: rgba(0, 255, 65, 0.1);
        padding: 6px 8px;
        margin: 4px 0;
        border-left: 3px solid #00ff41;
        border-radius: 2px;
    }

    .output-line.success::before {
        content: "✓ ";
        margin-right: 8px;
        font-weight: bold;
    }

    .output-line.system {
        color: #00ccff;
        text-shadow: 0 0 5px rgba(0, 204, 255, 0.5);
        font-style: italic;
        opacity: 0.9;
    }

    /* ==================== INPUT LINE ==================== */

    .input-line {
        display: flex;
        align-items: center;
        padding: 16px 40px;
        background: linear-gradient(to bottom, #0d1117 0%, #0a0e14 100%);
        border-top: 2px solid #00ff41;
        box-shadow: 0 -4px 20px rgba(0, 255, 65, 0.2);
        gap: 12px;
        min-height: 55px;
        position: relative;
        z-index: 2;
    }

    .input-line::before {
        content: "";
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 2px;
        background: linear-gradient(
            90deg,
            transparent,
            #00ff41,
            #00ccff,
            #00ff41,
            transparent
        );
        animation: scanline 3s linear infinite;
    }

    @keyframes scanline {
        0% {
            transform: translateX(-100%);
        }
        100% {
            transform: translateX(100%);
        }
    }

    .prompt {
        color: #00ff41;
        font-weight: bold;
        white-space: nowrap;
        flex-shrink: 0;
        text-shadow: 0 0 8px rgba(0, 255, 65, 0.6);
        animation: pulse 2s ease-in-out infinite;
        font-size: 15px;
        letter-spacing: 0.5px;
    }

    @keyframes pulse {
        0%,
        100% {
            text-shadow: 0 0 8px rgba(0, 255, 65, 0.6);
        }
        50% {
            text-shadow: 0 0 12px rgba(0, 255, 65, 0.8);
        }
    }

    .input {
        flex: 1;
        background: transparent;
        border: none;
        outline: none;
        color: #00ff41;
        font-family: inherit;
        font-size: 15px;
        line-height: inherit;
        padding: 4px 0;
        margin: 0;
        text-shadow: 0 0 5px rgba(0, 255, 65, 0.4);
        caret-color: #00ff41;
    }

    .input:focus {
        text-shadow: 0 0 8px rgba(0, 255, 65, 0.6);
    }

    .input::placeholder {
        color: #00ff4166;
    }

    .input:disabled {
        opacity: 0.5;
        cursor: wait;
    }

    .input.executing {
        opacity: 0.7;
    }

    .loading {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #00ff41;
    }

    .loading-spinner {
        display: inline-block;
        animation: spin 1s linear infinite;
        font-size: 16px;
    }

    @keyframes spin {
        from {
            transform: rotate(0deg);
        }
        to {
            transform: rotate(360deg);
        }
    }

    .loading-text {
        animation: dots 1.5s infinite;
    }

    /* ==================== ANIMATIONS ==================== */

    @keyframes blink {
        0%,
        50% {
            opacity: 1;
        }
        51%,
        100% {
            opacity: 0;
        }
    }

    @keyframes dots {
        0% {
            opacity: 0.4;
        }
        50% {
            opacity: 1;
        }
        100% {
            opacity: 0.4;
        }
    }

    /* ==================== RESPONSIVE ==================== */

    @media (max-width: 1024px) {
        .status-bar {
            font-size: 11px;
            padding: 6px 15px;
        }

        .status-left,
        .status-right {
            gap: 12px;
        }

        .status-item {
            padding: 3px 6px;
        }
    }

    @media (max-width: 768px) {
        .terminal {
            font-size: 12px;
        }

        .output,
        .input-line {
            padding: 15px;
        }

        .status-bar {
            font-size: 10px;
            flex-direction: column;
            gap: 8px;
            padding: 8px 10px;
        }

        .status-left,
        .status-right {
            width: 100%;
            justify-content: space-between;
        }

        .output-line.command::before {
            font-size: 10px;
        }

        .line-timestamp {
            display: none;
        }
    }

    @media (max-width: 480px) {
        .terminal {
            font-size: 11px;
        }

        .output,
        .input-line {
            padding: 10px;
        }

        .prompt {
            font-size: 12px;
        }

        .input {
            font-size: 13px;
        }

        .status-item {
            font-size: 9px;
            padding: 2px 4px;
        }

        .status-icon {
            font-size: 12px;
        }

        /* Hide some status items on very small screens */
        .status-item:nth-child(3),
        .status-item:nth-child(4) {
            display: none;
        }
    }

    /* ==================== ACCESSIBILITY ==================== */

    @media (prefers-reduced-motion: reduce) {
        .output {
            scroll-behavior: auto;
        }

        .loading {
            animation: none;
        }
    }

    /* ==================== HIGH CONTRAST ==================== */

    @media (prefers-contrast: high) {
        .terminal {
            background: #000;
            color: #0f0;
        }

        .input-line {
            background: #000;
            border-top-color: #0f0;
        }

        .output-line.error {
            color: #f00;
        }

        .output-line.success {
            color: #0f0;
        }
    }

    /* ==================== SELECTION ==================== */

    ::selection {
        background: rgba(0, 255, 65, 0.3);
        color: #00ff41;
    }

    /* ==================== SCROLLBAR STYLING ==================== */

    ::-webkit-scrollbar {
        width: 10px;
        height: 10px;
    }

    ::-webkit-scrollbar-track {
        background: rgba(10, 14, 20, 0.5);
        border-radius: 5px;
    }

    ::-webkit-scrollbar-thumb {
        background: rgba(0, 255, 65, 0.5);
        border-radius: 5px;
        border: 2px solid transparent;
        background-clip: padding-box;
    }

    ::-webkit-scrollbar-thumb:hover {
        background: rgba(0, 255, 65, 0.7);
        border: 2px solid transparent;
        background-clip: padding-box;
    }

    ::-webkit-scrollbar-corner {
        background: rgba(10, 14, 20, 0.5);
    }

    /* ==================== FOCUS INDICATORS ==================== */

    .terminal:focus-within .input-line {
        border-top-color: #00ccff;
        box-shadow: 0 -4px 20px rgba(0, 204, 255, 0.3);
    }

    /* ==================== PRINT STYLES ==================== */

    @media print {
        .terminal {
            background: white;
            color: black;
        }

        .status-bar {
            display: none;
        }

        .input-line {
            display: none;
        }

        .terminal::before,
        .terminal::after {
            display: none;
        }
    }
</style>
