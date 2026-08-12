<script lang="ts">
    import { onMount, onDestroy, tick } from "svelte";
    import { get } from "svelte/store";
    import { terminalService } from "../services/terminal";
    import type { CommandResult } from "../../../shared/types";
    // Reserved PIDs for virtual UI processes (mirrored from shared/types.ts)
    const ReservedPID = { HACK_CHALLENGE: -1, CONNECTION_CHALLENGE: -2, FILE_CHALLENGE: -3 } as const;
    import { apiClient } from "../services/api";
    // New ASCII Dialog system
    import MailDialog from "./MailDialog.svelte";
    import ChatDialog from "./ChatDialog.svelte";
    import ForumDialog from "./ForumDialog.svelte";
    import ShopDialog from "./ShopDialog.svelte";
    import EquipmentDialog from "./EquipmentDialog.svelte";
    import NotificationPanel from "./NotificationPanel.svelte";
    import ProcessBar from "./ProcessBar.svelte";
    import TerminalToast from "./TerminalToast.svelte";
    import { sound } from "../services/sound";
    import { settings, setSetting } from "../stores/settings";
    import CommandPalette from "./CommandPalette.svelte";
    // Socket service for real-time notifications
    import { liveMessages, socketService, activeProcesses } from "../services/socket";
    import {
        playerResources,
        activeHackSession,
        activeConnectionSession,
        activeFileChallenge,
    } from "../services/socketStores";
    // Notification service
    import {
        unreadCounts,
        notificationService,
    } from "../services/notifications";
    // Terminal tabs service
    import {
        terminalTabsStore,
        type OutputLine as TabOutputLine,
    } from "../services/terminalTabs";
    import type { TerminalTab } from "../../../shared/types";

    // ==================== PROPS ====================

    export let user: any = null;

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

    // Autocomplete state
    const KNOWN_COMMANDS = [
        "ls",
        "cd",
        "pwd",
        "cat",
        "rm",
        "mkdir",
        "touch",
        "cp",
        "mv",
        "echo",
        "write",
        "scan",
        "servers",
        "connect",
        "disconnect",
        "traceroute",
        "probe",
        "netmap",
        "hack",
        "crack",
        "exploit",
        "backdoor",
        "rootkit",
        "firewall.knock",
        "memory.extract",
        "hack.hint",
        "hack.status",
        "hack.abort",
        "crack.submit",
        "backdoor.list",
        "backdoor.use",
        "backdoor.remove",
        "security.scan",
        "trace.status",
        "trace.evade",
        "upload",
        "download",
        "encrypt",
        "decrypt",
        "analyze",
        "defenses",
        "protect",
        "safevault",
        "honeypot",
        "upgrade",
        "msg",
        "mail",
        "inbox",
        "contact",
        "chat",
        "forum",
        "proxy",
        "status",
        "skills",
        "missions",
        "mission",
        "accept",
        "abandon",
        "progress",
        "scripts",
        "shop",
        "buy",
        "sell",
        "use",
        "equip",
        "unequip",
        "equipment",
        "players",
        "who",
        "whois",
        "share_intel",
        "bounties",
        "bounty",
        "stories",
        "story",
        "help",
        "man",
        "history",
        "stats",
        "ps",
        "top",
        "kill",
        "free",
        "uptime",
        "pkill",
        "pgrep",
        "nice",
        "renice",
        "calc",
        "expr",
        "math",
        "vars",
        "set",
        "unset",
        "convert",
        "random",
        "decode",
        "subnet",
        "faction",
        "alias",
        "admin",
        "handshake.ack",
        "signal.trace",
        "connect.abort",
        "leaderboard",
        "achievements",
        "fragment",
        "fragments",
        "endgame",
        "gear",
        "tutorial",
        "settings",
        "clear",
        "report",
    ];
    let tabMatches: string[] = [];
    let tabIndex: number = -1;
    let lastTabPrefix: string = "";
    let tabHint: string = ""; // Temporary hint showing matches, cleared on non-Tab key
    let tabOriginalInput: string = ""; // Input value before Tab was first pressed

    // Suggested command extracted from server output (e.g., "Submit with: handshake.ack <answer>")
    let suggestedCommand: string = "";

    // Command palette state (Ctrl+K)
    let showPalette = false;
    const paletteCommands = KNOWN_COMMANDS.map((name) => ({
        name,
        description: getCommandDescription(name),
        category: getCommandCategory(name),
    }));

    function getCommandCategory(cmd: string): string {
        const cats: Record<string, string[]> = {
            system: ["ls","cd","pwd","cat","rm","mkdir","touch","cp","mv","echo","write","clear"],
            network: ["scan","servers","connect","disconnect","traceroute","probe","netmap","handshake.ack","signal.trace","connect.abort"],
            hack: ["hack","crack","exploit","backdoor","rootkit","firewall.knock","memory.extract","hack.hint","hack.status","hack.abort","crack.submit","backdoor.list","backdoor.use","backdoor.remove","security.scan","trace.status","trace.evade"],
            file: ["upload","download","encrypt","decrypt","analyze"],
            defense: ["defenses","protect","safevault","honeypot","upgrade"],
            social: ["msg","mail","inbox","contact","chat","forum","proxy"],
            shop: ["shop","buy","sell","use","equip","unequip","equipment","gear","scripts"],
            mission: ["missions","mission","accept","abandon","progress","stories","story"],
            fragment: ["fragment","fragments","endgame"],
            player: ["status","skills","players","who","whois","share_intel","bounties","bounty","leaderboard","achievements","report"],
            help: ["help","man","history","stats"],
            process: ["ps","top","kill","pkill","nice","renice","free","uptime"],
            math: ["calc","expr","math","vars","set","unset","convert","random","decode","subnet"],
        };
        for (const [cat, cmds] of Object.entries(cats)) {
            if (cmds.includes(cmd)) return cat;
        }
        return "other";
    }

    function getCommandDescription(cmd: string): string {
        const descs: Record<string, string> = {
            ls: "List directory contents", cd: "Change directory", pwd: "Print working directory",
            cat: "Read file contents", rm: "Remove file or directory", mkdir: "Create directory",
            scan: "Scan for nearby servers", connect: "Connect to a server", disconnect: "Disconnect from server",
            hack: "Initiate hack on target", crack: "Crack encryption", exploit: "Exploit server vulnerability",
            download: "Download file to home", upload: "Upload file to server", encrypt: "Encrypt a file",
            decrypt: "Decrypt a file", status: "View player status", skills: "View skill levels",
            missions: "List missions", mission: "View mission details", accept: "Accept a mission",
            shop: "Browse the shop", buy: "Purchase an item", equip: "Equip an item",
            help: "Show available commands", ps: "Show running processes", kill: "Kill a process",
            msg: "Send a message", mail: "Read/send mail", chat: "Open chat",
            forum: "Browse forums", faction: "Faction commands", alias: "Manage identity alias",
            fragment: "View AIDA fragments", endgame: "Make the final choice",
            report: "Report intel to faction or submit mission findings",
            traceroute: "Trace route to server", probe: "Probe server details", netmap: "Network topology map",
        };
        return descs[cmd] || "";
    }

    // Multi-terminal tab support - reactive
    $: tabState = $terminalTabsStore;
    $: tabs = tabState.tabs;
    $: activeTabId = tabState.activeTabId;
    $: currentTabOutputLines =
        activeTabId && tabState.outputLines.has(activeTabId)
            ? tabState.outputLines.get(activeTabId) || []
            : outputLines;

    let outputLines: OutputLine[] = [];
    let commandHistory: string[] = [];
    let historyIndex = -1;
    let isExecuting = false;
    let lineIdCounter = 0;

    let username = user?.username || "guest";
    let currentServer = user?.homeIp || "local";
    let currentDir = "~";

    // Dialog state
    let activeDialog:
        | "none"
        | "mail"
        | "chat"
        | "forum"
        | "shop"
        | "equipment"
        | "message" = "none";
    let dialogData: any = null;

    // Notification panel state
    let showNotifications = false;

    // Notification state (now managed by notification service)
    $: unreadCount = $unreadCounts.total;
    $: unreadChatCount = $unreadCounts.chat;
    $: unreadMailCount = $unreadCounts.mail;

    // UI enhancements
    let currentTime = new Date().toLocaleTimeString();
    let connectionQuality = 100;
    // Resource data from server (replaces fake systemLoad)
    let cpuPercent = 0;
    let ramPercent = 0;

    // Subscribe to real resource data from Socket.IO
    const unsubResources = playerResources.subscribe(
        (r: {
            cpuUsed: number;
            cpuTotal: number;
            ramUsed: number;
            ramTotal: number;
            bwUsed: number;
            bwTotal: number;
        }) => {
            cpuPercent =
                r.cpuTotal > 0 ? Math.round((r.cpuUsed / r.cpuTotal) * 100) : 0;
            ramPercent =
                r.ramTotal > 0 ? Math.round((r.ramUsed / r.ramTotal) * 100) : 0;
        },
    );
    let scanlineEffect = true;

    // ==================== TERMINAL WIDTH TRACKING ====================

    let terminalCols = 100; // estimated character columns
    let terminalTier: "full" | "medium" | "compact" = "full";
    let resizeObserver: ResizeObserver | null = null;

    function updateTerminalWidth() {
        if (!outputElement) return;
        // Measure actual character width from monospace font (10-char sample for accuracy)
        const testSpan = document.createElement("span");
        testSpan.style.cssText = "position:absolute;visibility:hidden;font:inherit;white-space:pre";
        testSpan.textContent = "MMMMMMMMMM";
        outputElement.appendChild(testSpan);
        const charWidth = (testSpan.getBoundingClientRect().width / 10) || 8;
        outputElement.removeChild(testSpan);
        // Calculate usable width: container minus padding, scrollbar, and safety margin
        const style = getComputedStyle(outputElement);
        const padH = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
        const scrollbar = outputElement.offsetWidth - outputElement.clientWidth;
        const usable = outputElement.clientWidth - padH - scrollbar;
        terminalCols = Math.max(40, Math.floor(usable / charWidth) - 2);
        terminalTier = terminalCols > 90 ? "full" : terminalCols > 55 ? "medium" : "compact";
    }

    // ==================== CHALLENGE COUNTDOWN TIMERS ====================

    let challengeCountdowns = new Map<string, number>(); // type -> remaining seconds
    let challengeTimerIntervals = new Map<string, ReturnType<typeof setInterval>>();

    function startChallengeTimer(type: string, timeLimit: number) {
        stopChallengeTimer(type);
        challengeCountdowns.set(type, timeLimit);
        challengeCountdowns = new Map(challengeCountdowns); // trigger reactivity
        const interval = setInterval(() => {
            const current = challengeCountdowns.get(type) ?? 0;
            if (current <= 0) {
                stopChallengeTimer(type);
                // Clear the panel for this specific challenge type when timer expires
                if (type === "hack" && $activeHackSession?.active) {
                    activeHackSession.set(null);
                    activeProcesses.update(procs => procs.filter((p: any) => p.pid !== ReservedPID.HACK_CHALLENGE));
                }
                if (type === "connection" && $activeConnectionSession?.active) {
                    activeConnectionSession.set(null);
                    activeProcesses.update(procs => procs.filter((p: any) => p.pid !== ReservedPID.CONNECTION_CHALLENGE));
                }
                if (type === "file" && $activeFileChallenge?.active) {
                    activeFileChallenge.set(null);
                    activeProcesses.update(procs => procs.filter((p: any) => p.pid !== ReservedPID.FILE_CHALLENGE));
                }
                return;
            }
            challengeCountdowns.set(type, current - 1);
            challengeCountdowns = new Map(challengeCountdowns); // trigger reactivity
        }, 1000);
        challengeTimerIntervals.set(type, interval);
    }

    function stopChallengeTimer(type: string) {
        const interval = challengeTimerIntervals.get(type);
        if (interval) {
            clearInterval(interval);
            challengeTimerIntervals.delete(type);
        }
        challengeCountdowns.delete(type);
        challengeCountdowns = new Map(challengeCountdowns); // trigger reactivity
    }

    function stopAllChallengeTimers() {
        for (const [type] of challengeTimerIntervals) {
            stopChallengeTimer(type);
        }
    }

    // Start timer when a challenge panel appears
    $: if ($activeHackSession?.active && $activeHackSession.challenge?.timeLimit) {
        startChallengeTimer("hack", $activeHackSession.challenge.timeLimit);
    }
    $: if ($activeConnectionSession?.active && $activeConnectionSession.challenge?.timeLimit) {
        startChallengeTimer("connection", $activeConnectionSession.challenge.timeLimit);
    }
    $: if ($activeFileChallenge?.active && $activeFileChallenge.challenge?.timeLimit) {
        startChallengeTimer("file", $activeFileChallenge.challenge.timeLimit);
    }
    // Stop individual timers when their challenge is resolved
    $: if (!$activeHackSession?.active) {
        stopChallengeTimer("hack");
    }
    $: if (!$activeConnectionSession?.active) {
        stopChallengeTimer("connection");
    }
    $: if (!$activeFileChallenge?.active) {
        stopChallengeTimer("file");
    }
    let glowEffect = true;

    // ==================== LIFECYCLE ====================

    onMount(() => {
        // Initialize everything in proper sequence
        (async () => {
            // Check authentication and load user info first
            await checkAuth();

            // Measure terminal width before showing welcome
            await tick();
            updateTerminalWidth();

            // Now show welcome with correct username (adapts to terminal width)
            showWelcome();
        })();

        // Focus input
        focusInput();

        // Track terminal width changes
        if (typeof ResizeObserver !== "undefined") {
            resizeObserver = new ResizeObserver(() => updateTerminalWidth());
            if (outputElement) resizeObserver.observe(outputElement);
        }

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

        // Resource data updated via Socket.IO subscription (playerResources store)

        // Return cleanup function synchronously
        return () => {
            document.removeEventListener("keydown", handleGlobalKeydown);
            unsubscribe();
            clearInterval(clockInterval);
            unsubResources();
            resizeObserver?.disconnect();
            stopAllChallengeTimers();
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

    // ==================== WELCOME MESSAGE (adapts to terminal width) ====================

    function buildWelcomeLines(): string[] {
        const lines: string[] = [""];

        if (terminalTier === "full") {
            // Full banner (>90 columns) — clean spaced letters, no box frame
            lines.push(
                "  ╔══════════════════════════════════════════════════╗",
                "  ║        N E U R A L    L I N K    v 2 . 0        ║",
                "  ║     Advanced Interactive Data Access [AIDA]      ║",
                "  ╚══════════════════════════════════════════════════╝",
                "",
                "  ════════════════════════════════════════════════════",
            );
        } else if (terminalTier === "medium") {
            // Simplified banner (56-90 columns)
            lines.push(
                "",
                "  N E U R A L   L I N K   T E R M I N A L",
                "       AIDA Network  [ v2.0 ]",
                "",
                "  ════════════════════════════════════════",
            );
        } else {
            // Compact text-only (<56 columns)
            lines.push(
                "  NEURAL LINK TERMINAL",
                "  AIDA Network v2.0",
                "",
            );
        }

        lines.push("");

        if (terminalTier !== "compact") {
            lines.push(
                "  SECURE CONNECTION ESTABLISHED",
                `  User: ${username}  |  Server: ${currentServer}  |  Status: ACTIVE`,
                "",
            );
        } else {
            lines.push(`  ${username}@${currentServer} [CONNECTED]`, "");
        }

        lines.push(
            `  Welcome, ${username}. Neural link active.`,
            "",
            "  help     — available commands    status — player info",
            "  ls       — list files            scan   — find servers",
            "  ↑/↓      — command history       TAB    — auto-complete",
            "",
        );

        return lines;
    }

    $: welcomeLines = buildWelcomeLines();

    function showWelcome() {
        // Add welcome lines to current active tab or fallback to local
        if (activeTabId) {
            welcomeLines.forEach((line) => {
                terminalTabsStore.addOutputLine(activeTabId, line, "system");
            });
        } else {
            welcomeLines.forEach((line) => {
                addOutputLine(line, "system");
            });
        }
    }

    // ==================== OUTPUT MANAGEMENT ====================

    let typewriterActive = false; // true while typewriter is rendering
    let typewriterCancel = false; // set by keypress to skip animation

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

    /**
     * Add output with typewriter effect.
     * Characters appear one by one. Press any key to skip.
     * Large outputs (>500 chars) auto-skip to instant.
     * @param speedOverride - Override the user's setting (for server-hinted renderMode)
     */
    async function addOutputWithTypewriter(
        text: string,
        type: OutputLine["type"] = "output",
        speedOverride?: "instant" | "fast" | "cinematic" | "typewriter",
    ): Promise<void> {
        const speed = speedOverride || $settings.typewriterSpeed;

        // Instant mode or very large text — no animation
        if (speed === "instant" || text.length > 500) {
            addOutputLine(text, type);
            return;
        }

        // "typewriter" is an alias for "fast"
        const delayMs = speed === "cinematic" ? 20 : 5;
        const lineId = ++lineIdCounter;

        // Add empty line that we'll fill character by character
        outputLines = [
            ...outputLines,
            { id: lineId, text: "", type, timestamp: new Date() },
        ];

        typewriterActive = true;
        typewriterCancel = false;

        for (let i = 0; i < text.length; i++) {
            if (typewriterCancel) {
                // Skip: fill remaining text instantly
                outputLines = outputLines.map((l) =>
                    l.id === lineId ? { ...l, text } : l,
                );
                break;
            }

            // Update the line's text one character at a time
            const partial = text.slice(0, i + 1);
            outputLines = outputLines.map((l) =>
                l.id === lineId ? { ...l, text: partial } : l,
            );

            await new Promise((r) => setTimeout(r, delayMs));
        }

        typewriterActive = false;
        typewriterCancel = false;
        await tick();
        scrollToBottom();
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
        welcomeLines.forEach((line) => {
            addOutputLine(line, "system");
        });
    }

    // ==================== COMMAND EXECUTION ====================

    async function handleSubmit() {
        const command = inputValue.trim();

        // Ignore empty commands
        if (!command) {
            return;
        }

        // Sound feedback on submit
        sound.submit();

        // Use tab store if tabs are active, otherwise use local state
        if (activeTabId) {
            // Add command to tab output
            terminalTabsStore.addOutputLine(
                activeTabId,
                `${getPrompt()} ${command}`,
                "command",
            );

            // Add to tab history
            terminalTabsStore.addToHistory(activeTabId, command);

            // Mark terminal as processing
            terminalTabsStore.updateProcessingState(
                activeTabId,
                true,
                command.split(" ")[0],
            );
        } else {
            // Fallback to local state
            addCommandLine(command);
            if (commandHistory[commandHistory.length - 1] !== command) {
                commandHistory = [...commandHistory, command];
            }
            historyIndex = commandHistory.length;
        }

        // Clear input immediately for better UX
        inputValue = "";

        // Handle client-side commands
        if (handleClientCommand(command)) {
            if (activeTabId) {
                terminalTabsStore.updateProcessingState(activeTabId, false);
            }
            return;
        }

        // Execute command on server
        isExecuting = true;

        try {
            // Check if this is a UI command that should open a dialog
            const cmdParts = command.trim().split(/\s+/);
            const cmdName = cmdParts[0].toLowerCase();

            if (cmdName === "shop") {
                openDialog("shop");
                if (activeTabId) {
                    terminalTabsStore.updateProcessingState(activeTabId, false);
                }
                isExecuting = false;
                return;
            }

            if (
                cmdName === "inventory" ||
                cmdName === "equipment" ||
                cmdName === "gear" ||
                cmdName === "scripts"
            ) {
                openDialog("equipment");
                if (activeTabId) {
                    terminalTabsStore.updateProcessingState(activeTabId, false);
                }
                isExecuting = false;
                return;
            }

            // Open chat dialog for messaging commands
            if (
                cmdName === "msg" ||
                cmdName === "message" ||
                cmdName === "chat" ||
                cmdName === "dm"
            ) {
                openDialog("chat", { command: cmdParts });
                if (activeTabId) {
                    terminalTabsStore.updateProcessingState(activeTabId, false);
                }
                isExecuting = false;
                return;
            }

            // Open mail dialog for inbox/mail commands
            if (
                cmdName === "mail" ||
                cmdName === "inbox" ||
                cmdName === "messages"
            ) {
                openDialog("mail");
                if (activeTabId) {
                    terminalTabsStore.updateProcessingState(activeTabId, false);
                }
                isExecuting = false;
                return;
            }

            // Open forum dialog for forum commands
            if (cmdName === "forum" || cmdName === "forums") {
                openDialog("forum", { command: cmdParts });
                if (activeTabId) {
                    terminalTabsStore.updateProcessingState(activeTabId, false);
                }
                isExecuting = false;
                return;
            }

            // Execute the command on the server (send terminal width for adaptive output)
            const result = await terminalService.executeCommand(command, undefined, terminalCols);

            // Check if command wants to open a dialog
            if (result && result.openDialog) {
                openDialog(result.openDialog, result.data);
            }

            // Handle challenge starts from HTTP results (connection/hack)
            if (result.data?.connectionSessionId && result.data?.connectionChallenge) {
                activeConnectionSession.set({
                    active: true,
                    targetIp: result.data.targetIp,
                    challenge: result.data.connectionChallenge,
                    sessionId: result.data.connectionSessionId,
                });
                // Register in ProcessBar for countdown
                const connTimeLimit = result.data.connectionChallenge?.timeLimit || 45;
                const { activeProcesses } = await import("../services/socket");
                activeProcesses.update(procs => [
                    ...procs.filter((p: any) => p.pid !== ReservedPID.CONNECTION_CHALLENGE),
                    { pid: ReservedPID.CONNECTION_CHALLENGE, type: "connection_challenge", description: `Connection challenge — ${result.data.targetIp}`, progress: 0, eta: connTimeLimit },
                ]);
            }
            if (result.data?.connectionResolved) {
                activeConnectionSession.set(null);
                const { activeProcesses } = await import("../services/socket");
                activeProcesses.update(procs => procs.filter((p: any) => p.pid !== ReservedPID.CONNECTION_CHALLENGE));
            }

            // Handle hack session start from HTTP fallback (when memoryService unavailable)
            if (result.data?.sessionId && result.data?.targetIp && !result.data?.connectionSessionId) {
                const { activeProcesses } = await import("../services/socket");
                activeHackSession.set({
                    active: true,
                    targetIp: result.data.targetIp,
                    currentLayer: 0,
                    totalLayers: result.data.totalLayers,
                    challenge: result.data.challenge,
                });
                activeProcesses.update(procs => [
                    ...procs.filter((p: any) => p.pid !== ReservedPID.HACK_CHALLENGE),
                    { pid: ReservedPID.HACK_CHALLENGE, type: "hack", description: `Hacking ${result.data.targetIp}`, progress: 0 },
                ]);
            }
            // Handle hack layer progression (nextChallenge) or resolution (hackResolved)
            if (result.data?.nextChallenge) {
                activeHackSession.update((session: any) => {
                    if (!session) return session;
                    return { ...session, currentLayer: (session.currentLayer || 0) + 1, challenge: result.data.nextChallenge };
                });
            }
            if (result.data?.hackResolved) {
                activeHackSession.set(null);
                const { activeProcesses } = await import("../services/socket");
                activeProcesses.update(procs => procs.filter((p: any) => p.pid !== ReservedPID.HACK_CHALLENGE));
            }

            // Handle file access challenge start from HTTP
            if (result.data?.fileAccessSessionId && result.data?.fileAccessType) {
                const { activeProcesses } = await import("../services/socket");
                activeFileChallenge.set({
                    active: true,
                    type: result.data.fileAccessType,
                    targetFile: result.data.targetFile,
                    targetDir: result.data.targetDir,
                    challenge: result.data.challenge,
                    sessionId: result.data.fileAccessSessionId,
                });
                activeProcesses.update(procs => [
                    ...procs.filter((p: any) => p.pid !== ReservedPID.FILE_CHALLENGE),
                    { pid: ReservedPID.FILE_CHALLENGE, type: "file_challenge", description: `${result.data.fileAccessType} challenge`, progress: 0 },
                ]);
            }
            // Handle file access resolution
            if (result.data?.fileAccessResolved) {
                activeFileChallenge.set(null);
                const { activeProcesses } = await import("../services/socket");
                activeProcesses.update(procs => procs.filter((p: any) => p.pid !== ReservedPID.FILE_CHALLENGE));
            }

            // Display command result (with typewriter if enabled)
            const resultOutput = Array.isArray(result.output)
                ? result.output.join("\n")
                : result.output;
            const resultType = result.success ? "output" : "error";

            // Determine render speed: server renderMode > user setting
            const renderSpeed = result.renderMode || $settings.typewriterSpeed;

            if (activeTabId) {
                // Typewriter only works with local outputLines — for tabs, render to tab store directly
                terminalTabsStore.addOutputLine(activeTabId, resultOutput, resultType);
            } else {
                if (renderSpeed !== "instant" && resultOutput.length <= 500) {
                    await addOutputWithTypewriter(resultOutput, resultType as OutputLine["type"], renderSpeed);
                } else {
                    addCommandOutput(result);
                }
            }

            // Sound feedback — use server hint if provided, else default
            if (result.soundEvent) {
                const sfn = sound[result.soundEvent as keyof typeof sound];
                if (typeof sfn === "function") sfn();
            } else if (result.success) {
                sound.success();
            } else {
                sound.error();
            }

            // Suggested command — use server field if provided, else regex fallback
            if (result.suggestedCommand) {
                suggestedCommand = result.suggestedCommand;
            } else {
                // Regex fallback: only match when followed by a KNOWN command name
                // This prevents matching random words from file content (e.g., "report to...")
                const outputText = Array.isArray(result.output)
                    ? result.output.join("\n")
                    : result.output || "";
                const suggestionMatch = outputText.match(
                    /(?:Submit with|Submit:|Try:|Use:|Run:|Type:)\s+([a-z][a-z0-9_.]+(?:\s+\S+)*)/i,
                );
                if (suggestionMatch?.[1]) {
                    const firstWord = suggestionMatch[1].split(/\s+/)[0]?.toLowerCase() || "";
                    // Only accept if the first word is a known command
                    if (KNOWN_COMMANDS.includes(firstWord)) {
                        suggestedCommand = suggestionMatch[1].trim();
                    }
                }
            }

            // Update context from server data if available
            if (result.data) {
                updateContextFromData(result.data);
            }
        } catch (error: any) {
            // Show detailed error information
            if (activeTabId) {
                terminalTabsStore.addOutputLine(
                    activeTabId,
                    `Command execution failed: ${error.message || "Unknown error"}`,
                    "error",
                );
            } else {
                addOutputLine(
                    `Command execution failed: ${error.message || "Unknown error"}`,
                    "error",
                );
            }

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
            if (activeTabId) {
                terminalTabsStore.updateProcessingState(activeTabId, false);
            }
            await tick();
            scrollToBottom();
            focusInput();
        }
    }

    // ==================== CLIENT-SIDE COMMANDS ====================

    function handleClientCommand(command: string): boolean {
        const cmd = command.toLowerCase().trim();

        // Clear command
        if (cmd === "clear" || cmd === "cls") {
            if (activeTabId) {
                terminalTabsStore.clearOutput(activeTabId);
            } else {
                clearScreen();
            }
            return true;
        }

        // Exit command (logout)
        if (cmd === "exit" || cmd === "quit" || cmd === "logout") {
            handleLogout();
            return true;
        }

        // Settings command
        if (cmd.startsWith("settings")) {
            const parts = cmd.split(/\s+/);
            const key = parts[1];
            const value = parts[2];

            if (!key) {
                // Show all settings
                const s = $settings;
                const lines = [
                    "  Current Settings:",
                    `    typewriter  = ${s.typewriterSpeed}  (instant | fast | cinematic)`,
                    `    sound       = ${s.soundEnabled ? "on" : "off"}`,
                    `    volume      = ${Math.round(s.soundVolume * 100)}%`,
                    `    crt         = ${s.crtEffects ? "on" : "off"}`,
                    `    timestamps  = ${s.timestampsVisible ? "on" : "off"}`,
                    "",
                    "  Usage: settings <key> <value>",
                ];
                const output = lines.join("\n");
                if (activeTabId) {
                    terminalTabsStore.addOutputLine(activeTabId, output, "system");
                } else {
                    addOutputLine(output, "system");
                }
                return true;
            }

            // Set specific setting
            if (key === "typewriter" && ["instant", "fast", "cinematic"].includes(value)) {
                setSetting("typewriterSpeed", value as "instant" | "fast" | "cinematic");
                addOutputLine(`  Typewriter speed set to: ${value}`, "success");
            } else if (key === "sound" && (value === "on" || value === "off")) {
                setSetting("soundEnabled", value === "on");
                addOutputLine(`  Sound ${value}`, "success");
            } else if (key === "volume" && !isNaN(Number(value))) {
                const vol = Math.max(0, Math.min(100, Number(value)));
                setSetting("soundVolume", vol / 100);
                addOutputLine(`  Volume set to ${vol}%`, "success");
            } else if (key === "crt" && (value === "on" || value === "off")) {
                setSetting("crtEffects", value === "on");
                addOutputLine(`  CRT effects ${value}`, "success");
            } else if (key === "timestamps" && (value === "on" || value === "off")) {
                setSetting("timestampsVisible", value === "on");
                addOutputLine(`  Timestamps ${value}`, "success");
            } else {
                addOutputLine(`  Unknown setting or value: settings ${key} ${value || ""}`, "error");
            }
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

    function openDialog(
        type: "mail" | "chat" | "forum" | "shop" | "equipment" | "message",
        data?: any,
    ) {
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

    // ==================== NOTIFICATION HANDLERS ====================

    function handleNotificationPanelClick(event: CustomEvent): void {
        const { type, data } = event.detail;
        showNotifications = false;
        if (type === "chat") openDialog("chat", data);
        else if (type === "mail" || type === "message") openDialog("mail", data);
        else if (type === "forum") openDialog("forum", data);
    }

    function handleToastClick(event: CustomEvent): void {
        const { type, data, command } = event.detail;

        // If toast has an action command, fill input
        if (command) {
            inputValue = command;
            focusInput();
            return;
        }

        // Otherwise open appropriate dialog
        if (type === "chat") openDialog("chat", data);
        else if (type === "mail" || type === "message") openDialog("mail", data);
        else if (type === "forum") openDialog("forum", data);
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
        // Use tab store history if tabs are active
        if (activeTabId) {
            const historyCommand = terminalTabsStore.navigateHistory(
                activeTabId,
                direction,
            );
            if (historyCommand !== null) {
                inputValue = historyCommand;
            }
        } else {
            // Fallback to local history — cycle through all stored commands
            if (commandHistory.length === 0) return;

            if (direction === "up") {
                // historyIndex starts at -1 (no history selected)
                // Move toward older commands (higher index from end)
                const newIndex = historyIndex < commandHistory.length - 1
                    ? historyIndex + 1
                    : historyIndex;
                historyIndex = newIndex;
                inputValue = commandHistory[commandHistory.length - 1 - newIndex] || "";
            } else {
                // Move toward newer commands
                if (historyIndex > 0) {
                    historyIndex--;
                    inputValue = commandHistory[commandHistory.length - 1 - historyIndex] || "";
                } else {
                    historyIndex = -1;
                    inputValue = "";
                }
            }
        }
    }

    // ==================== KEYBOARD HANDLING ====================

    function handleKeyDown(event: KeyboardEvent) {
        // Skip typewriter animation on any key
        if (typewriterActive) {
            typewriterCancel = true;
            // Don't consume printable characters — let them reach the input
            if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
                return;
            }
            event.preventDefault();
            return;
        }

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

        // Tab - Auto-complete (suggested command first, then command name completion)
        if (event.key === "Tab") {
            event.preventDefault();

            // Priority 1: Fill suggested command from server output
            if (suggestedCommand) {
                const trimmed = inputValue.trim().toLowerCase();
                if (!trimmed || suggestedCommand.toLowerCase().startsWith(trimmed)) {
                    inputValue = suggestedCommand;
                    suggestedCommand = "";
                    tabHint = "";
                    return;
                }
            }

            // Use original input for matching (not the already-completed value)
            const input = tabMatches.length > 0 ? tabOriginalInput : inputValue.trimStart();
            const spaceIdx = input.indexOf(" ");
            const prefix = spaceIdx === -1 ? input : input.slice(0, spaceIdx);

            if (!prefix) return;

            // Build match list on first Tab press for this prefix
            if (prefix !== lastTabPrefix) {
                lastTabPrefix = prefix;
                tabOriginalInput = input;
                tabMatches = KNOWN_COMMANDS.filter((c) =>
                    c.startsWith(prefix.toLowerCase()),
                );
                tabIndex = -1;
            }

            if (tabMatches.length === 0) {
                tabHint = "";
                return;
            }

            // Cycle through matches
            tabIndex = (tabIndex + 1) % tabMatches.length;
            const match = tabMatches[tabIndex]!;
            inputValue = spaceIdx === -1 ? match : match + input.slice(spaceIdx);

            // Show temporary hint with all matches (highlight current)
            if (tabMatches.length > 1) {
                tabHint = tabMatches
                    .map((m, i) => i === tabIndex ? `[${m}]` : m)
                    .join("  ");
            } else {
                tabHint = "";
            }
            return;
        }

        // Any non-Tab, non-Shift key clears tab state + hint
        if (event.key !== "Shift") {
            lastTabPrefix = "";
            tabOriginalInput = "";
            tabMatches = [];
            tabIndex = -1;
            tabHint = "";
        }
    }

    async function handleTabSwitch(event: CustomEvent) {
        await terminalTabsStore.switchTab(event.detail.tabId);
        await tick();
        scrollToBottom();
        focusInput();
    }

    async function handleTabClose(event: CustomEvent) {
        if (tabs.length > 1) {
            await terminalTabsStore.closeTab(event.detail.tabId);
            await tick();
            focusInput();
        }
    }

    async function handleTabCreate() {
        const tabNumber = tabs.length + 1;
        await terminalTabsStore.createTab(`Terminal ${tabNumber}`);
        await tick();

        // Show context greeting in new tab
        const newTabId = tabState.activeTabId;
        if (newTabId) {
            terminalTabsStore.addOutputLine(
                newTabId,
                `[Terminal ${tabNumber}] ${username}@${currentServer}:${currentDir}`,
                "system",
            );
            terminalTabsStore.addOutputLine(
                newTabId,
                "Type 'help' for commands. Use Ctrl+W to close this tab.",
                "system",
            );
        }

        focusInput();
    }

    function handleGlobalKeydown(event: KeyboardEvent) {
        // Prevent interference when dialog is active
        if (activeDialog !== "none") {
            return;
        }

        // Ctrl+S: Open shop
        if (event.ctrlKey && event.key === "s") {
            event.preventDefault();
            openDialog("shop");
            return;
        }

        // Ctrl+I: Open inventory/equipment
        if (event.ctrlKey && event.key === "i") {
            event.preventDefault();
            openDialog("equipment");
            return;
        }

        // Ctrl+M: Open mail/inbox
        if (event.ctrlKey && event.key === "m") {
            event.preventDefault();
            openDialog("mail");
            return;
        }

        // Ctrl+C: Open chat (only when not selecting text)
        if (
            event.ctrlKey &&
            event.key === "c" &&
            !window.getSelection()?.toString()
        ) {
            event.preventDefault();
            openDialog("chat");
            return;
        }

        // Ctrl+F: Open forum (override browser find)
        if (event.ctrlKey && event.key === "f") {
            event.preventDefault();
            openDialog("forum");
            return;
        }

        // Ctrl+N: Open notifications panel
        if (event.ctrlKey && event.key === "n") {
            event.preventDefault();
            showNotifications = !showNotifications;
            return;
        }

        // Ctrl+K: Command palette
        if (event.ctrlKey && event.key === "k") {
            event.preventDefault();
            showPalette = !showPalette;
            return;
        }

        // Ctrl+T: New tab
        if (event.ctrlKey && event.key === "t") {
            event.preventDefault();
            handleTabCreate();
            return;
        }

        // Ctrl+W: Close tab
        if (event.ctrlKey && event.key === "w") {
            event.preventDefault();
            if (tabs.length > 1) {
                handleTabClose({
                    detail: { tabId: activeTabId },
                } as CustomEvent);
            }
            return;
        }

        // Ctrl+1-9: Switch to tab N
        if (event.ctrlKey && event.key >= "1" && event.key <= "9") {
            event.preventDefault();
            const index = parseInt(event.key) - 1;
            if (tabs[index]) {
                handleTabSwitch({
                    detail: { tabId: tabs[index].id },
                } as CustomEvent);
            }
            return;
        }

        // Ctrl+Tab: Next tab
        if (event.ctrlKey && event.key === "Tab") {
            event.preventDefault();
            const currentIndex = tabs.findIndex(
                (t: TerminalTab) => t.id === activeTabId,
            );
            const nextIndex = (currentIndex + 1) % tabs.length;
            if (tabs[nextIndex]) {
                handleTabSwitch({
                    detail: { tabId: tabs[nextIndex].id },
                } as CustomEvent);
            }
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

    // ==================== CLICKABLE INLINE COMMANDS ====================

    const COMMAND_SET = new Set(KNOWN_COMMANDS);

    /**
     * Parse output text and wrap recognized commands in clickable spans.
     * Returns HTML string safe to use with {@html}.
     * Only wraps commands that appear as standalone tokens (not inside words).
     */
    function parseClickableCommands(text: string): string {
        // Escape HTML first to prevent XSS
        const escaped = text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");

        // Match patterns like: command arg1 arg2 (e.g., "hack 10.0.0.1", "connect.abort")
        // Only match at word boundaries, and the command must be in KNOWN_COMMANDS
        return escaped.replace(
            /\b([a-z][a-z0-9_.]+(?:\s+(?:\d{1,3}(?:\.\d{1,3}){1,3}|[a-z0-9_.-]+))*)\b/gi,
            (match, group) => {
                const firstWord = group.split(/\s+/)[0]!.toLowerCase();
                if (COMMAND_SET.has(firstWord)) {
                    const escapedMatch = match.replace(/"/g, "&quot;");
                    return `<span class="clickable-cmd" data-cmd="${escapedMatch}">${match}</span>`;
                }
                return match;
            },
        );
    }

    /** Handle click on a clickable command in output. */
    function handleOutputClick(event: MouseEvent) {
        const target = event.target as HTMLElement;
        if (target.classList.contains("clickable-cmd")) {
            const cmd = target.getAttribute("data-cmd");
            if (cmd) {
                inputValue = cmd;
                focusInput();
            }
        }
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
            <!-- Terminal Tabs integrated into status bar -->
            {#if tabs.length === 0}
                <!-- Loading state - show placeholder home tab -->
                <div
                    class="status-item tab-item home-tab active"
                    title="Loading terminal..."
                >
                    <span class="tab-icon">👤</span>
                    <span class="tab-label">{username}@{currentServer}</span>
                </div>
                <button class="status-item tab-new" disabled title="Loading...">
                    <span class="tab-new-icon">+</span>
                </button>
            {:else}
                {#each tabs as tab, index (tab.id)}
                    <div
                        class="status-item tab-item"
                        class:active={tab.id === activeTabId}
                        class:processing={tab.isProcessing}
                        class:home-tab={index === 0}
                        on:click={async () => {
                            await terminalTabsStore.switchTab(tab.id);
                            await tick();
                            scrollToBottom();
                            focusInput();
                        }}
                        on:keydown={async (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                await terminalTabsStore.switchTab(tab.id);
                                await tick();
                                scrollToBottom();
                                focusInput();
                            }
                        }}
                        role="button"
                        tabindex="0"
                        title={index === 0
                            ? `Home Terminal - ${username}@${currentServer}`
                            : tab.isProcessing && tab.processingCommand
                              ? `${tab.label} [${tab.processingCommand}...]`
                              : tab.label}
                    >
                        {#if index === 0}
                            <span class="tab-icon">👤</span>
                            <span class="tab-label"
                                >{username}@{currentServer}</span
                            >
                        {:else}
                            <span class="tab-icon"
                                >{tab.isProcessing ? "⚙️" : "▸"}</span
                            >
                            <span class="tab-label">{tab.label}</span>
                            <button
                                class="tab-close"
                                on:click|stopPropagation={async () => {
                                    await terminalTabsStore.closeTab(tab.id);
                                    await tick();
                                    focusInput();
                                }}
                                title="Close tab (Ctrl+W)"
                                aria-label="Close tab">✕</button
                            >
                        {/if}
                    </div>
                {/each}
                <button
                    class="status-item tab-new"
                    on:click={handleTabCreate}
                    title="New terminal (Ctrl+T)"
                >
                    <span class="tab-new-icon">+</span>
                </button>
            {/if}
        </div>
        <div class="status-right">
            <span class="status-item">
                <span class="status-icon">📡</span>
                <span class="status-label">{connectionQuality}%</span>
            </span>
            <span class="status-item" title="CPU usage">
                <span class="status-label">CPU:{cpuPercent}%</span>
            </span>
            <span class="status-item" title="RAM usage">
                <span class="status-label">RAM:{ramPercent}%</span>
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
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="output" bind:this={outputElement} role="log" aria-live="polite" on:click={handleOutputClick}>
        {#each currentTabOutputLines as line (line.id)}
            <div class={getLineClass(line)}>
                <span class="line-timestamp"
                    >{line.timestamp.toLocaleTimeString()}</span
                >
                <span class="line-content">{@html parseClickableCommands(line.text)}</span>
            </div>
        {/each}
    </div>

    <!-- Sticky Hack Challenge Panel -->
    {#if $activeHackSession?.active && $activeHackSession.challenge}
        <div class="hack-challenge-panel">
            <div class="challenge-header">
                <span>HACK SESSION — {$activeHackSession.targetIp} — Layer {($activeHackSession.currentLayer ||
                    0) + 1}/{$activeHackSession.totalLayers || "?"}</span>
                {#if (challengeCountdowns.get("hack") ?? 0) > 0}
                    <span class="challenge-timer" class:warning={(challengeCountdowns.get("hack") ?? 0) <= ($activeHackSession.challenge.timeLimit || 60) * 0.25} class:urgent={(challengeCountdowns.get("hack") ?? 0) <= 5}>
                        {challengeCountdowns.get("hack")}s
                    </span>
                {/if}
            </div>
            {#if $activeHackSession.challenge.displayText}
                {#each $activeHackSession.challenge.displayText as line}
                    <div class="challenge-line">{line}</div>
                {/each}
            {/if}
            {#if $activeHackSession.challenge.hints?.length}
                <div class="challenge-hints">
                    {#each $activeHackSession.challenge.hints as hint}
                        <div class="hint-line">hint: {hint}</div>
                    {/each}
                </div>
            {/if}
        </div>
    {/if}

    <!-- Sticky Connection Challenge Panel -->
    {#if $activeConnectionSession?.active && $activeConnectionSession.challenge}
        <div class="connection-challenge-panel">
            <div class="challenge-header connection">
                <span>CONNECTION — {$activeConnectionSession.targetIp} —
                {$activeConnectionSession.challenge.type === "handshake"
                    ? "TCP HANDSHAKE"
                    : "SIGNAL TRACE"}</span>
                {#if (challengeCountdowns.get("connection") ?? 0) > 0}
                    <span class="challenge-timer" class:warning={(challengeCountdowns.get("connection") ?? 0) <= ($activeConnectionSession.challenge.timeLimit || 60) * 0.25} class:urgent={(challengeCountdowns.get("connection") ?? 0) <= 5}>
                        {challengeCountdowns.get("connection")}s
                    </span>
                {/if}
            </div>
            {#if $activeConnectionSession.challenge.displayText}
                {#each $activeConnectionSession.challenge.displayText as line}
                    <div class="challenge-line">{line}</div>
                {/each}
            {/if}
            {#if $activeConnectionSession.challenge.hints?.length}
                <div class="challenge-hints">
                    {#each $activeConnectionSession.challenge.hints as hint}
                        <div class="hint-line">hint: {hint}</div>
                    {/each}
                </div>
            {/if}
        </div>
    {/if}

    <!-- Sticky File Access Challenge Panel (sweep/crack/storm) -->
    {#if $activeFileChallenge?.active && $activeFileChallenge.challenge}
        <div class="file-challenge-panel">
            <div class="challenge-header file-access">
                <span>{$activeFileChallenge.type === "sweep" ? "SWEEP" : $activeFileChallenge.type === "storm" ? "STORM" : "CRACK"} —
                {$activeFileChallenge.targetDir || $activeFileChallenge.targetFile || "unknown"}</span>
                {#if (challengeCountdowns.get("file") ?? 0) > 0}
                    <span class="challenge-timer" class:warning={(challengeCountdowns.get("file") ?? 0) <= ($activeFileChallenge.challenge.timeLimit || 60) * 0.25} class:urgent={(challengeCountdowns.get("file") ?? 0) <= 5}>
                        {challengeCountdowns.get("file")}s
                    </span>
                {/if}
            </div>
            {#if $activeFileChallenge.challenge.displayText}
                {#each $activeFileChallenge.challenge.displayText as line}
                    <div class="challenge-line">{line}</div>
                {/each}
            {/if}
            {#if $activeFileChallenge.challenge.hints?.length}
                <div class="challenge-hints">
                    {#each $activeFileChallenge.challenge.hints as hint}
                        <div class="hint-line">hint: {hint}</div>
                    {/each}
                </div>
            {/if}
        </div>
    {/if}

    <!-- Live Process Bar -->
    <ProcessBar />

    <!-- Suggested command hint (above input) -->
    {#if suggestedCommand && !isExecuting}
        <div class="suggestion-hint">
            <span class="suggestion-label">TAB</span>
            <span class="suggestion-text">{suggestedCommand}</span>
        </div>
    {/if}

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

    <!-- Tab completion matches (below input, temporary) -->
    {#if tabHint}
        <div class="tab-hint">{tabHint}</div>
    {/if}

    <!-- In-terminal toast notifications -->
    <TerminalToast on:toastClick={handleToastClick} />

    <!-- Command Palette (Ctrl+K) -->
    <CommandPalette
        visible={showPalette}
        commands={paletteCommands}
        on:close={() => { showPalette = false; focusInput(); }}
        on:select={(e) => { inputValue = e.detail.command + " "; focusInput(); }}
    />
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
{:else if activeDialog === "shop"}
    <ShopDialog visible={true} onClose={closeDialog} />
{:else if activeDialog === "equipment"}
    <EquipmentDialog visible={true} onClose={closeDialog} />
{/if}

<!-- Notification Panel -->
<NotificationPanel
    bind:visible={showNotifications}
    position="top-right"
    on:close={() => (showNotifications = false)}
    on:notificationClick={handleNotificationPanelClick}
/>

<!-- ==================== STYLES ==================== -->

<style>
    /* ==================== TERMINAL CONTAINER ==================== */

    .terminal {
        width: 100vw;
        height: 100vh;
        background: #0a0e14;
        color: #00bcd4;
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
        color: #00bcd4;
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

    /* ==================== TAB ITEMS IN STATUS BAR ==================== */

    .status-item.tab-item {
        background: rgba(0, 255, 65, 0.05);
        border: 1px solid rgba(0, 255, 65, 0.2);
        padding: 4px 10px;
        cursor: pointer;
        transition: all 0.2s ease;
        gap: 6px;
        border-radius: 4px 4px 0 0;
    }

    .status-item.tab-item.home-tab {
        background: rgba(0, 188, 212, 0.1);
        border-color: rgba(0, 188, 212, 0.3);
    }

    .status-item.tab-item.home-tab.active {
        background: rgba(0, 188, 212, 0.2);
        border-color: #00bcd4;
    }

    .status-item.tab-item:hover {
        background: rgba(0, 255, 65, 0.1);
        border-color: rgba(0, 255, 65, 0.4);
        transform: translateY(0);
    }

    .status-item.tab-item.active {
        background: rgba(0, 255, 65, 0.15);
        border-color: #00ff41;
        border-bottom: 2px solid #0a0e14;
        font-weight: bold;
        color: #00ff41;
    }

    .status-item.tab-item.processing {
        border-color: #ffaa00;
        animation: pulse-tab 1.5s ease-in-out infinite;
    }

    @keyframes pulse-tab {
        0%,
        100% {
            border-color: #ffaa00;
        }
        50% {
            border-color: #ff6600;
        }
    }

    .status-item.tab-item.processing .tab-icon {
        animation: spin 2s linear infinite;
    }

    @keyframes spin {
        from {
            transform: rotate(0deg);
        }
        to {
            transform: rotate(360deg);
        }
    }

    .tab-icon {
        font-size: 10px;
        display: inline-block;
    }

    .tab-label {
        font-size: 11px;
        font-family: "Fira Code", monospace;
        text-transform: none;
        letter-spacing: 0.5px;
        max-width: 100px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .tab-close {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 14px;
        height: 14px;
        border-radius: 2px;
        font-size: 10px;
        opacity: 0.6;
        transition: all 0.2s ease;
        margin-left: 2px;
        border: none;
        background: transparent;
        color: inherit;
        padding: 0;
        cursor: pointer;
    }

    .tab-close:hover {
        background: rgba(255, 68, 68, 0.8);
        color: #ffffff;
        opacity: 1;
    }

    .tab-close:focus {
        outline: 2px solid #00ff41;
        outline-offset: 1px;
    }

    .status-item.tab-new {
        background: rgba(0, 255, 65, 0.05);
        border: 1px solid rgba(0, 255, 65, 0.2);
        padding: 4px 8px;
        cursor: pointer;
        transition: all 0.2s ease;
        min-width: 28px;
        justify-content: center;
    }

    .status-item.tab-new:hover:not(:disabled) {
        background: rgba(0, 255, 65, 0.15);
        border-color: #00ff41;
        transform: scale(1.05);
    }

    .status-item.tab-new:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .tab-new-icon {
        font-size: 14px;
        font-weight: bold;
        line-height: 1;
    }

    .status-divider {
        background: none;
        color: rgba(0, 255, 65, 0.3);
        padding: 0 8px;
        font-size: 14px;
    }

    .status-divider:hover {
        background: none;
        transform: none;
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
        background: #00bcd4;
        border-radius: 4px;
    }

    .output::-webkit-scrollbar-thumb:hover {
        background: #00cc33;
    }

    /* ==================== OUTPUT LINES ==================== */

    .output-line {
        position: relative;
        padding: 2px 8px;
        margin: 1px 0;
        line-height: 1.6;
        transition: background-color 0.2s ease;
        font-family: inherit;
        animation: fadeIn 0.2s ease-in;
    }

    .line-content {
        white-space: pre-wrap;
        word-wrap: break-word;
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
        position: absolute;
        right: 8px;
        top: 50%;
        transform: translateY(-50%);
        opacity: 0;
        font-size: 10px;
        color: rgba(0, 204, 255, 0.5);
        pointer-events: none;
        transition: opacity 0.2s ease;
        z-index: 1;
    }

    .output-line:hover .line-timestamp {
        opacity: 1;
    }

    .output-line.command {
        color: #00bcd4;
        font-weight: bold;
        text-shadow: 0 0 5px rgba(0, 255, 65, 0.5);
        background: rgba(0, 255, 65, 0.05);
        padding: 6px 8px;
        margin: 4px 0;
        border-left: 3px solid #00bcd4;
        border-radius: 2px;
    }

    .output-line.command::before {
        content: "▶ ";
        color: #00bcd4;
        margin-right: 8px;
        font-size: 12px;
    }

    .output-line.output {
        color: #00bcd4;
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
        color: #00bcd4;
        text-shadow: 0 0 5px rgba(0, 255, 65, 0.5);
        background: rgba(0, 255, 65, 0.1);
        padding: 6px 8px;
        margin: 4px 0;
        border-left: 3px solid #00bcd4;
        border-radius: 2px;
    }

    .output-line.success::before {
        content: "✓ ";
        margin-right: 8px;
        font-weight: bold;
    }

    .output-line.system {
        color: #00bcd4;
        text-shadow: 0 0 5px rgba(0, 204, 255, 0.5);
        font-style: italic;
        opacity: 0.9;
    }

    /* ==================== HACK CHALLENGE PANEL ==================== */

    .hack-challenge-panel {
        border-top: 1px solid #1a3a1a;
        border-bottom: 1px solid #1a3a1a;
        background: #0a120a;
        padding: 8px 40px;
        font-family: inherit;
        font-size: 0.85em;
        color: #00ff41;
        max-height: 200px;
        overflow-y: auto;
    }

    .challenge-header {
        color: #ff6600;
        font-weight: bold;
        margin-bottom: 4px;
        letter-spacing: 1px;
        display: flex;
        justify-content: space-between;
        align-items: center;
    }

    .challenge-timer {
        font-size: 1.1em;
        color: #00ff41;
        font-variant-numeric: tabular-nums;
        min-width: 40px;
        text-align: right;
    }

    .challenge-timer.warning {
        color: #ffaa00;
    }

    .challenge-timer.urgent {
        color: #ff4444;
        font-weight: bold;
        animation: timerPulse 0.5s ease-in-out infinite alternate;
    }

    @keyframes timerPulse {
        from { opacity: 1; text-shadow: 0 0 5px rgba(255, 68, 68, 0.5); }
        to { opacity: 0.6; text-shadow: 0 0 10px rgba(255, 68, 68, 0.8); }
    }

    .challenge-line {
        color: #00cc33;
        white-space: pre;
        line-height: 1.3;
    }

    .challenge-hints {
        margin-top: 4px;
        border-top: 1px dashed #1a3a1a;
        padding-top: 4px;
    }

    .hint-line {
        color: #666;
        font-style: italic;
        font-size: 0.9em;
    }

    /* ==================== CONNECTION CHALLENGE PANEL ==================== */

    .connection-challenge-panel {
        border-top: 1px solid #0a2a3a;
        border-bottom: 1px solid #0a2a3a;
        background: #060e14;
        padding: 8px 40px;
        font-family: inherit;
        font-size: 0.85em;
        color: #00ccff;
        max-height: 200px;
        overflow-y: auto;
    }

    .challenge-header.connection {
        color: #00ccff;
        text-shadow: 0 0 5px rgba(0, 204, 255, 0.3);
    }

    .connection-challenge-panel .challenge-line {
        color: #0099cc;
    }

    /* ==================== FILE ACCESS CHALLENGE PANEL ==================== */

    .file-challenge-panel {
        border-top: 1px solid #3a2a0a;
        border-bottom: 1px solid #3a2a0a;
        background: #14100a;
        padding: 8px 40px;
        font-family: inherit;
        font-size: 0.85em;
        color: #ffaa00;
        max-height: 280px;
        overflow-y: auto;
    }

    .challenge-header.file-access {
        color: #ffaa00;
        text-shadow: 0 0 5px rgba(255, 170, 0, 0.3);
    }

    .file-challenge-panel .challenge-line {
        color: #cc8800;
    }

    /* ==================== CLICKABLE COMMANDS ==================== */

    :global(.clickable-cmd) {
        color: #00ddaa;
        cursor: pointer;
        border-bottom: 1px dotted rgba(0, 221, 170, 0.3);
        transition: color 0.15s, border-color 0.15s;
    }

    :global(.clickable-cmd:hover) {
        color: #00ffcc;
        border-bottom-color: #00ffcc;
        text-shadow: 0 0 4px rgba(0, 255, 204, 0.4);
    }

    /* ==================== TAB COMPLETION HINTS ==================== */

    .suggestion-hint {
        padding: 2px 40px;
        font-size: 0.8em;
        color: #555;
        font-family: inherit;
    }

    .suggestion-label {
        display: inline-block;
        background: #1a3a1a;
        color: #00cc33;
        padding: 1px 5px;
        border-radius: 2px;
        font-size: 0.85em;
        margin-right: 8px;
        font-weight: bold;
    }

    .suggestion-text {
        color: #006622;
        font-style: italic;
    }

    .tab-hint {
        padding: 2px 40px;
        font-size: 0.8em;
        color: #00aa33;
        font-family: inherit;
        white-space: pre;
        opacity: 0.8;
    }

    /* ==================== INPUT LINE ==================== */

    .input-line {
        display: flex;
        align-items: center;
        padding: 16px 40px;
        background: linear-gradient(to bottom, #0d1117 0%, #0a0e14 100%);
        border-top: 2px solid #00bcd4;
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
            #00bcd4,
            #00bcd4,
            #00bcd4,
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
        color: #00bcd4;
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
        color: #00bcd4;
        font-family: inherit;
        font-size: 15px;
        line-height: inherit;
        padding: 4px 0;
        margin: 0;
        text-shadow: 0 0 5px rgba(0, 255, 65, 0.4);
        caret-color: #00bcd4;
    }

    .input:focus {
        text-shadow: 0 0 8px rgba(0, 255, 65, 0.6);
    }

    .input::placeholder {
        color: #00bcd466;
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
        color: #00bcd4;
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
            gap: 8px;
        }

        .status-item {
            padding: 3px 6px;
        }

        /* Hide tab labels, show icons only */
        .tab-label {
            max-width: 80px;
            overflow: hidden;
            text-overflow: ellipsis;
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
            padding: 6px 10px;
        }

        .status-left {
            flex: 1;
            overflow-x: auto;
            overflow-y: hidden;
            gap: 4px;
        }

        .status-right {
            gap: 6px;
        }

        /* Collapse tab labels to icons only */
        .tab-label {
            display: none;
        }

        /* Hide connection quality */
        .status-icon {
            display: none;
        }

        .output-line.command::before {
            font-size: 10px;
        }

        .line-timestamp {
            display: none;
        }

        /* Challenge panels scroll horizontally */
        .hack-challenge-panel,
        .connection-challenge-panel,
        .file-challenge-panel {
            overflow-x: auto;
        }

        .challenge-line {
            white-space: pre;
            min-width: max-content;
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

        /* Single-line status: just active tab + notification badge */
        .status-right .status-item:not(.notification) {
            display: none;
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
            color: #00ff41;
        }

        .input-line {
            background: #000;
            border-top-color: #00ff41;
        }

        .output-line.error {
            color: #f00;
        }

        .output-line.success {
            color: #00ff41;
        }
    }

    /* ==================== SELECTION ==================== */

    ::selection {
        background: rgba(0, 255, 65, 0.3);
        color: #00bcd4;
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
        border-top-color: #00bcd4;
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
