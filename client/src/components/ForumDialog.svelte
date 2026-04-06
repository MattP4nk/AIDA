<script lang="ts">
    import { onMount, tick, createEventDispatcher } from "svelte";
    import AsciiDialog from "./AsciiDialog.svelte";
    import { terminalService } from "../services/terminal";

    // ==================== PROPS ====================

    export let visible: boolean = false;
    export let initialData: any = null;

    // ==================== EVENTS ====================

    const dispatch = createEventDispatcher();

    // ==================== TYPES ====================

    type Mode = "browse" | "input" | "compose";
    type InputAction = "reply" | "post" | "search" | "register" | "vote" | "report" | "tag" | "command";

    interface NavState {
        forumId: string;
        forumName: string;
        postId: string;
        postTitle: string;
    }

    // ==================== STATE ====================

    let mode: Mode = "browse";
    let inputAction: InputAction = "command";
    let inputPrompt: string = ">";
    let inputValue: string = "";
    let inputStep: number = 0; // For multi-step inputs (post: title then content)
    let inputStash: string = ""; // Stash first step (e.g., post title)

    let outputLines: string[] = [];
    let loading: boolean = false;
    let nav: NavState = { forumId: "", forumName: "", postId: "", postTitle: "" };

    let outputEl: HTMLDivElement;
    let inputEl: HTMLInputElement;

    // ==================== LIFECYCLE ====================

    onMount(() => {
        if (initialData?.forumId && initialData?.postId) {
            runCommand(`forum read ${initialData.forumId} ${initialData.postId}`);
            nav.forumId = initialData.forumId;
            nav.postId = initialData.postId;
        } else if (initialData?.forumId) {
            runCommand(`forum access ${initialData.forumId}`);
            nav.forumId = initialData.forumId;
        } else {
            runCommand("forum");
        }
    });

    // ==================== COMMAND EXECUTION ====================

    async function runCommand(cmd: string) {
        loading = true;
        try {
            const result = await terminalService.executeCommand(cmd);
            const text = Array.isArray(result.output) ? result.output.join("\n") : String(result.output);
            outputLines = text.split("\n");

            // Extract nav context from successful responses
            extractNavContext(cmd, result);
        } catch {
            outputLines = ["ERROR: Command failed. Try again or press ESC."];
        } finally {
            loading = false;
            await tick();
            scrollToBottom();
        }
    }

    function extractNavContext(cmd: string, result: any) {
        const parts = cmd.trim().split(/\s+/);
        if (parts[0] !== "forum") return;
        const sub = parts[1];

        if (sub === "access" && parts[2]) {
            nav.forumId = parts[2];
            nav.postId = "";
            nav.postTitle = "";
        } else if (sub === "read" && parts[2] && parts[3]) {
            nav.forumId = parts[2];
            nav.postId = parts[3];
        } else if (!sub || sub === "scan") {
            nav.forumId = "";
            nav.postId = "";
        }
    }

    function scrollToBottom() {
        if (outputEl) {
            outputEl.scrollTop = outputEl.scrollHeight;
        }
    }

    // ==================== INPUT HANDLING ====================

    function startInput(action: InputAction, prompt: string) {
        mode = "input";
        inputAction = action;
        inputPrompt = prompt;
        inputValue = "";
        inputStep = 0;
        inputStash = "";
        tick().then(() => inputEl?.focus());
    }

    function startCompose(action: InputAction) {
        mode = "compose";
        inputAction = action;
        inputValue = "";
        inputStep = 0;
        inputStash = "";
        tick().then(() => inputEl?.focus());
    }

    async function submitInput() {
        const val = inputValue.trim();
        if (!val) return;

        if (inputAction === "reply") {
            if (!nav.forumId || !nav.postId) {
                outputLines = [...outputLines, "", "ERROR: Navigate to a post first (forum read <forumId> <postId>)"];
                mode = "browse";
                return;
            }
            await runCommand(`forum reply ${nav.forumId} ${nav.postId} ${val}`);
            // Refresh post to show new reply
            await runCommand(`forum read ${nav.forumId} ${nav.postId}`);
            mode = "browse";
        } else if (inputAction === "post") {
            if (!nav.forumId) {
                outputLines = [...outputLines, "", "ERROR: Access a forum first (forum access <forumId>)"];
                mode = "browse";
                return;
            }
            if (inputStep === 0) {
                // Step 1: got title, now ask for content
                inputStash = val;
                inputPrompt = "CONTENT >";
                inputValue = "";
                inputStep = 1;
                return;
            }
            // Step 2: got content, submit
            await runCommand(`forum post ${nav.forumId} "${inputStash}" "${val}"`);
            await runCommand(`forum access ${nav.forumId}`);
            mode = "browse";
        } else if (inputAction === "search") {
            if (nav.forumId) {
                await runCommand(`forum search ${nav.forumId} ${val}`);
            } else {
                await runCommand(`forum search ${val}`);
            }
            mode = "browse";
        } else if (inputAction === "register") {
            if (!nav.forumId) {
                outputLines = [...outputLines, "", "ERROR: Access a forum first."];
                mode = "browse";
                return;
            }
            await runCommand(`forum register ${nav.forumId} ${val}`);
            mode = "browse";
        } else if (inputAction === "vote") {
            // val should be "up" or "down"
            const dir = val.toLowerCase().startsWith("u") ? "up" : "down";
            if (nav.postId) {
                await runCommand(`forum vote ${nav.forumId} ${nav.postId} ${dir}`);
                await runCommand(`forum read ${nav.forumId} ${nav.postId}`);
            }
            mode = "browse";
        } else if (inputAction === "report") {
            if (nav.postId) {
                await runCommand(`forum report ${nav.forumId} ${nav.postId} ${val}`);
            }
            mode = "browse";
        } else if (inputAction === "tag") {
            if (nav.forumId) {
                await runCommand(`forum tag ${nav.forumId} ${val}`);
            }
            mode = "browse";
        } else if (inputAction === "command") {
            // Raw command mode
            await runCommand(val);
            mode = "browse";
        }

        inputValue = "";
    }

    // ==================== KEYBOARD ====================

    function handleKeydown(event: KeyboardEvent) {
        if (!visible) return;

        // In input/compose mode, only handle Escape and Enter
        if (mode !== "browse") {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                mode = "browse";
                inputValue = "";
            }
            return;
        }

        // Browse mode shortcuts
        switch (event.key) {
            case "Escape":
                event.preventDefault();
                event.stopPropagation();
                if (nav.postId) {
                    // Back to forum threads
                    nav.postId = "";
                    nav.postTitle = "";
                    if (nav.forumId) runCommand(`forum access ${nav.forumId}`);
                } else if (nav.forumId) {
                    // Back to forum list
                    nav.forumId = "";
                    nav.forumName = "";
                    runCommand("forum");
                } else {
                    close();
                }
                break;
            case "r":
            case "R":
                if (nav.postId) {
                    event.preventDefault();
                    startInput("reply", "REPLY >");
                }
                break;
            case "n":
            case "N":
                if (nav.forumId) {
                    event.preventDefault();
                    startInput("post", "TITLE >");
                }
                break;
            case "/":
                event.preventDefault();
                startInput("search", "SEARCH >");
                break;
            case "v":
            case "V":
                if (nav.postId) {
                    event.preventDefault();
                    startInput("vote", "VOTE (up/down) >");
                }
                break;
            case "j":
            case "J":
                if (nav.forumId && !nav.postId) {
                    event.preventDefault();
                    startInput("register", "HANDLE >");
                }
                break;
            case "!":
                if (nav.postId) {
                    event.preventDefault();
                    startInput("report", "REASON >");
                }
                break;
            case "t":
            case "T":
                if (nav.forumId) {
                    event.preventDefault();
                    startInput("tag", "TAG >");
                }
                break;
            case ":":
                event.preventDefault();
                startInput("command", "CMD >");
                break;
            case "m":
            case "M":
                if (nav.forumId) {
                    event.preventDefault();
                    runCommand(`forum members ${nav.forumId}`);
                }
                break;
            case "f":
            case "F":
                event.preventDefault();
                runCommand("forum");
                nav.forumId = "";
                nav.postId = "";
                break;
            case "s":
            case "S":
                event.preventDefault();
                runCommand("forum scan");
                break;
        }
    }

    function handleInputKeydown(event: KeyboardEvent) {
        if (event.key === "Enter") {
            event.preventDefault();
            submitInput();
        }
    }

    // ==================== HELPERS ====================

    function close() {
        dispatch("close");
    }

    function getBreadcrumb(): string {
        let parts = ["FORUMS"];
        if (nav.forumId) parts.push(nav.forumName || nav.forumId);
        if (nav.postId) parts.push("POST:" + nav.postId.slice(0, 8));
        return parts.join(" > ");
    }

    function getShortcuts(): string {
        if (mode !== "browse") return "[ENTER] Submit  [ESC] Cancel";
        if (nav.postId) return "[R]eply [V]ote [!]Report [ESC]Back [/]Search [:]Cmd";
        if (nav.forumId) return "[N]ew post [J]oin [M]embers [T]ag [/]Search [ESC]Back [:]Cmd";
        return "[S]can [F]orums [/]Search [ESC]Close [:]Cmd";
    }
</script>

<svelte:window on:keydown={handleKeydown} />

<AsciiDialog {visible} title="FORUM NETWORK" width={96} height={30} on:close={close}>
    <div class="forum-container">
        <!-- BREADCRUMB BAR -->
        <div class="breadcrumb-bar">
            <span class="breadcrumb-text">{getBreadcrumb()}</span>
            {#if loading}
                <span class="status-indicator blink">LOADING...</span>
            {:else}
                <span class="status-indicator">ONLINE</span>
            {/if}
        </div>

        <div class="divider">{"─".repeat(94)}</div>

        <!-- ASCII OUTPUT VIEWPORT -->
        <div class="output-viewport" bind:this={outputEl}>
            {#if loading && outputLines.length === 0}
                <pre class="loading-text">
  Establishing secure connection...
  Routing through proxy network...
  Decrypting forum headers...
  ████████████░░░░░░░░ 60%</pre>
            {:else}
                <pre class="output-text">{outputLines.join("\n")}</pre>
            {/if}
        </div>

        <!-- INPUT BAR -->
        {#if mode !== "browse"}
            <div class="divider">{"─".repeat(94)}</div>
            <div class="input-bar">
                <span class="input-prompt">{inputPrompt}</span>
                <input
                    bind:this={inputEl}
                    bind:value={inputValue}
                    on:keydown={handleInputKeydown}
                    class="input-field"
                    spellcheck="false"
                    autocomplete="off"
                />
            </div>
        {/if}
    </div>

    <div slot="footer" class="footer-bar">
        <span class="shortcuts">{getShortcuts()}</span>
    </div>
</AsciiDialog>

<style>
    .forum-container {
        height: 100%;
        display: flex;
        flex-direction: column;
        font-family: "IBM Plex Mono", "Courier New", monospace;
        color: #00bcd4;
    }

    /* BREADCRUMB BAR */
    .breadcrumb-bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.4em 1em;
        background: rgba(0, 39, 67, 0.3);
    }

    .breadcrumb-text {
        color: #ffff00;
        font-weight: bold;
        font-size: 0.9em;
        letter-spacing: 0.05em;
    }

    .status-indicator {
        color: #00ff41;
        font-size: 0.8em;
    }

    .blink {
        animation: blinkAnim 0.8s step-end infinite;
    }

    @keyframes blinkAnim {
        50% { opacity: 0; }
    }

    .divider {
        color: #003344;
        line-height: 1;
        overflow: hidden;
        padding: 0 0.2em;
    }

    /* OUTPUT VIEWPORT */
    .output-viewport {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 0.5em 1em;
        min-height: 200px;
        scrollbar-width: thin;
        scrollbar-color: #00bcd4 #001a2b;
    }

    .output-viewport::-webkit-scrollbar {
        width: 6px;
    }
    .output-viewport::-webkit-scrollbar-track {
        background: #001a2b;
    }
    .output-viewport::-webkit-scrollbar-thumb {
        background: #004455;
        border-radius: 3px;
    }
    .output-viewport::-webkit-scrollbar-thumb:hover {
        background: #00bcd4;
    }

    .output-text {
        margin: 0;
        font-family: inherit;
        font-size: 0.95em;
        line-height: 1.4;
        color: #00bcd4;
        white-space: pre-wrap;
        word-break: break-word;
    }

    .loading-text {
        margin: 0;
        font-family: inherit;
        color: #008899;
        animation: blinkAnim 1.2s step-end infinite;
    }

    /* INPUT BAR */
    .input-bar {
        display: flex;
        align-items: center;
        padding: 0.4em 1em;
        background: rgba(0, 60, 80, 0.25);
        gap: 0.5em;
    }

    .input-prompt {
        color: #ffff00;
        font-weight: bold;
        white-space: nowrap;
        font-size: 0.95em;
    }

    .input-field {
        flex: 1;
        background: transparent;
        border: none;
        outline: none;
        color: #00ff41;
        font-family: inherit;
        font-size: 0.95em;
        caret-color: #00ff41;
    }

    .input-field::placeholder {
        color: #004455;
    }

    /* FOOTER */
    .footer-bar {
        padding: 0.3em 0;
    }

    .shortcuts {
        color: #006677;
        font-size: 0.85em;
        letter-spacing: 0.02em;
    }
</style>
