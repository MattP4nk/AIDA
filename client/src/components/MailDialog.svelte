<script lang="ts">
    import { onMount } from "svelte";
    import { createEventDispatcher } from "svelte";
    import AsciiDialog from "./AsciiDialog.svelte";
    import { terminalService } from "../services/terminal";

    // ==================== PROPS ====================

    export let visible: boolean = false;
    export let initialData: any = null;

    // ==================== EVENTS ====================

    const dispatch = createEventDispatcher();

    // ==================== TYPES ====================

    interface Message {
        id: string;
        senderId: string;
        senderUsername?: string;
        recipientId: string;
        recipientUsername?: string;
        subject: string;
        content: string;
        timestamp: Date;
        isRead: boolean;
        isEncrypted: boolean;
        encryptionLevel?: number;
        messageType: string;
    }

    interface Contact {
        id: string;
        handle: string;
        name?: string;
        status: string;
    }

    // ==================== STATE ====================

    type ViewMode = "list" | "read" | "compose";
    type MailboxType = "inbox" | "sent";

    let mode: ViewMode = "list";
    let mailboxType: MailboxType = "inbox";
    let messages: Message[] = [];
    let selectedMessage: Message | null = null;
    let selectedIndex: number = 0;
    let contacts: Contact[] = [];

    // Compose form
    let composeRecipient: string = "";
    let composeSubject: string = "";
    let composeBody: string = "";
    let isEncrypted: boolean = false;

    // UI state
    let loading: boolean = false;
    let error: string = "";
    let successMessage: string = "";

    // Input refs for auto-focus
    let recipientInput: HTMLInputElement;
    let bodyTextarea: HTMLTextAreaElement;

    // ==================== LIFECYCLE ====================

    onMount(() => {
        loadMessages();
        loadContacts();
    });

    // ==================== API CALLS ====================

    async function loadMessages() {
        loading = true;
        error = "";

        try {
            const command = mailboxType === "inbox" ? "inbox" : "mail sent";
            const response = await terminalService.executeCommand(command);

            if (response.success && response.data) {
                messages =
                    response.data.messages || initialData?.messages || [];
                // Sort by timestamp, newest first
                messages.sort(
                    (a, b) =>
                        new Date(b.timestamp).getTime() -
                        new Date(a.timestamp).getTime(),
                );
            }
        } catch (err) {
            error = "Failed to load messages";
            console.error(err);
        } finally {
            loading = false;
        }
    }

    function toggleMailbox() {
        mailboxType = mailboxType === "inbox" ? "sent" : "inbox";
        selectedIndex = 0;
        loadMessages();
    }

    async function loadContacts() {
        try {
            // Try to get contacts from initial data or fetch them
            contacts = initialData?.contacts || [];
        } catch (err) {
            console.error("Failed to load contacts:", err);
        }
    }

    async function sendMessage() {
        if (!composeRecipient.trim() || !composeBody.trim()) {
            error = "Recipient and message are required";
            return;
        }

        loading = true;
        error = "";
        successMessage = "";

        try {
            const command = `msg ${composeRecipient} ${composeBody}`;
            const response = await terminalService.executeCommand(command);

            if (response.success) {
                successMessage = "Message sent successfully!";
                // Reset form
                composeRecipient = "";
                composeSubject = "";
                composeBody = "";
                isEncrypted = false;
                // Wait a moment then return to list
                setTimeout(() => {
                    mode = "list";
                    loadMessages();
                }, 1500);
            } else {
                error = Array.isArray(response.output)
                    ? response.output.join(" ")
                    : response.output || "Failed to send message";
            }
        } catch (err) {
            error = "Failed to send message";
            console.error(err);
        } finally {
            loading = false;
        }
    }

    async function markAsRead(messageId: string) {
        try {
            await terminalService.executeCommand(`mail read ${messageId}`);
            // Update local state
            const msg = messages.find((m) => m.id === messageId);
            if (msg) {
                msg.isRead = true;
            }
            messages = messages; // Trigger reactivity
        } catch (err) {
            console.error("Failed to mark as read:", err);
        }
    }

    async function deleteMessage(messageId: string) {
        if (!confirm("Delete this message?")) return;

        try {
            await terminalService.executeCommand(`mail delete ${messageId}`);
            // Remove from local list
            messages = messages.filter((m) => m.id !== messageId);
            mode = "list";
            selectedMessage = null;
        } catch (err) {
            error = "Failed to delete message";
            console.error(err);
        }
    }

    // ==================== NAVIGATION ====================

    function openMessage(message: Message, index: number) {
        selectedMessage = message;
        selectedIndex = index;
        mode = "read";
        if (!message.isRead) {
            markAsRead(message.id);
        }
    }

    function openCompose(replyTo?: Message) {
        mode = "compose";
        if (replyTo) {
            composeRecipient = replyTo.senderUsername || "";
            composeSubject = `RE: ${replyTo.subject}`;
        }
        // Auto-focus recipient field after a brief delay
        setTimeout(() => {
            if (recipientInput) {
                recipientInput.focus();
            } else if (bodyTextarea) {
                bodyTextarea.focus();
            }
        }, 100);
    }

    function backToList() {
        mode = "list";
        selectedMessage = null;
        error = "";
        successMessage = "";
    }

    function close() {
        dispatch("close");
    }

    // ==================== KEYBOARD NAVIGATION ====================

    function handleKeydown(event: KeyboardEvent) {
        if (!visible) return;

        // Don't intercept typing in input fields
        const target = event.target as HTMLElement;
        const isInputField =
            target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable;

        // Global shortcuts
        if (event.key === "Escape") {
            if (mode === "list") {
                close();
            } else {
                backToList();
            }
            return;
        }

        // In compose mode, only handle Ctrl shortcuts, let typing pass through
        if (mode === "compose") {
            if (event.ctrlKey && event.key === "s") {
                event.preventDefault();
                sendMessage();
                return;
            }
            if (event.ctrlKey && event.key === "e") {
                event.preventDefault();
                isEncrypted = !isEncrypted;
                return;
            }
            // Don't intercept any other keys in compose mode
            return;
        }

        // Don't intercept typing in any input field
        if (isInputField) {
            return;
        }

        // List view shortcuts
        if (mode === "list") {
            switch (event.key) {
                case "ArrowUp":
                    event.preventDefault();
                    if (selectedIndex > 0) {
                        selectedIndex--;
                    }
                    break;
                case "ArrowDown":
                    event.preventDefault();
                    if (selectedIndex < messages.length - 1) {
                        selectedIndex++;
                    }
                    break;
                case "Enter":
                    event.preventDefault();
                    if (messages[selectedIndex]) {
                        openMessage(messages[selectedIndex], selectedIndex);
                    }
                    break;
                case "c":
                case "C":
                    if (!event.ctrlKey && !event.metaKey) {
                        event.preventDefault();
                        openCompose();
                    }
                    break;
                case "r":
                case "R":
                    if (!event.ctrlKey && !event.metaKey) {
                        event.preventDefault();
                        loadMessages();
                    }
                    break;
                case "t":
                case "T":
                    if (!event.ctrlKey && !event.metaKey) {
                        event.preventDefault();
                        toggleMailbox();
                    }
                    break;
                case "d":
                case "D":
                    if (
                        !event.ctrlKey &&
                        !event.metaKey &&
                        messages[selectedIndex]
                    ) {
                        event.preventDefault();
                        deleteMessage(messages[selectedIndex].id);
                    }
                    break;
            }
        }

        // Read view shortcuts
        if (mode === "read" && selectedMessage) {
            switch (event.key) {
                case "r":
                case "R":
                    if (!event.ctrlKey && !event.metaKey) {
                        event.preventDefault();
                        openCompose(selectedMessage);
                    }
                    break;
                case "d":
                case "D":
                    if (!event.ctrlKey && !event.metaKey) {
                        event.preventDefault();
                        deleteMessage(selectedMessage.id);
                    }
                    break;
                case "b":
                case "B":
                    event.preventDefault();
                    backToList();
                    break;
            }
        }
    }

    // ==================== FORMATTING ====================

    function formatDate(dateStr: Date | string): string {
        const date = new Date(dateStr);
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));

        if (hours < 1) return "< 1h";
        if (hours < 24) return `${hours}h`;
        if (days < 7) return `${days}d`;
        return date.toLocaleDateString();
    }

    function truncate(text: string, length: number): string {
        if (text.length <= length) return text;
        return text.substring(0, length - 3) + "...";
    }

    // ==================== REACTIVE ====================

    $: unreadCount = messages.filter((m) => !m.isRead).length;
    $: dialogTitle =
        mode === "list" ? "INBOX" : mode === "read" ? "MESSAGE" : "COMPOSE";
</script>

<svelte:window on:keydown={handleKeydown} />

<AsciiDialog
    {visible}
    title={dialogTitle}
    width={80}
    height={24}
    on:close={close}
>
    <div class="mail-dialog-content">
        {#if loading}
            <div class="loading">
                <pre>
╔═════════════════════════════════════════════════╗
║                                                 ║
║              LOADING MESSAGES...                ║
║                                                 ║
║              [████████░░░░░░░░]                 ║
║                                                 ║
╚═════════════════════════════════════════════════╝
        </pre>
            </div>
        {:else if error}
            <div class="error-message">
                <pre>
╔═══════════════════════════════════════════════════╗
║  ⚠️  ERROR                                        ║
╠═══════════════════════════════════════════════════╣
║  {error.padEnd(48)}║
╚═══════════════════════════════════════════════════╝
        </pre>
            </div>
        {:else if successMessage}
            <div class="success-message">
                <pre>
╔═══════════════════════════════════════════════════╗
║  ✓ SUCCESS                                        ║
╠═══════════════════════════════════════════════════╣
║  {successMessage.padEnd(48)}║
╚═══════════════════════════════════════════════════╝
        </pre>
            </div>
        {/if}

        {#if mode === "list"}
            <!-- LIST VIEW -->
            <div class="mail-list">
                <div class="mailbox-header">
                    <span class="mailbox-type"
                        >{mailboxType === "inbox" ? "INBOX" : "SENT"}</span
                    >
                    <span class="mailbox-hint">Press [T] to toggle</span>
                </div>
                {#if messages.length === 0}
                    <div class="empty-state">
                        <pre>
╔═════════════════════════════════════════════════╗
║                                                 ║
║            NO MESSAGES IN {mailboxType === "inbox"
                                ? "INBOX"
                                : "SENT"}                 ║
║                                                 ║
║         Press [C] to compose a message          ║
║         Press [T] to toggle Inbox/Sent          ║
║                                                 ║
╚═════════════════════════════════════════════════╝
            </pre>
                    </div>
                {:else}
                    <div class="message-list">
                        {#each messages as message, index}
                            <div
                                class="message-item"
                                class:selected={index === selectedIndex}
                                class:unread={!message.isRead}
                                on:click={() => openMessage(message, index)}
                                on:keydown={(e) => {
                                    if (e.key === "Enter")
                                        openMessage(message, index);
                                }}
                                role="button"
                                tabindex="0"
                            >
                                <span class="msg-num"
                                    >{String(index + 1).padStart(2, "0")}</span
                                >
                                <span class="msg-status"
                                    >{message.isRead ? " " : "►"}</span
                                >
                                <span class="msg-from"
                                    >{truncate(
                                        mailboxType === "inbox"
                                            ? message.senderUsername ||
                                                  "Unknown"
                                            : message.recipientUsername ||
                                                  "Unknown",
                                        15,
                                    )}</span
                                >
                                <span class="msg-subject">
                                    >{truncate(message.subject, 35)}</span
                                >
                                <span class="msg-date"
                                    >{formatDate(message.timestamp)}</span
                                >
                                {#if message.isEncrypted}
                                    <span class="msg-encrypt">🔒</span>
                                {/if}
                            </div>
                        {/each}
                    </div>

                    <div class="list-footer">
                        ══════════════════════════════════════════════════════════════════════<br
                        />
                        TOTAL: {messages.length} MESSAGE{messages.length !== 1
                            ? "S"
                            : ""} │ UNREAD: {unreadCount}
                    </div>
                {/if}
            </div>
        {:else if mode === "read" && selectedMessage}
            <!-- READ VIEW -->
            <div class="mail-read">
                <div class="read-header">
                    <div class="read-line">
                        <span class="read-label">FROM:</span>
                        <span class="read-value"
                            >{selectedMessage.senderUsername || "Unknown"}</span
                        >
                    </div>
                    <div class="read-line">
                        <span class="read-label">TO:</span>
                        <span class="read-value">You</span>
                    </div>
                    <div class="read-line">
                        <span class="read-label">DATE:</span>
                        <span class="read-value"
                            >{new Date(
                                selectedMessage.timestamp,
                            ).toLocaleString()}</span
                        >
                    </div>
                    <div class="read-line">
                        <span class="read-label">SUBJECT:</span>
                        <span class="read-value">{selectedMessage.subject}</span
                        >
                    </div>
                    {#if selectedMessage.isEncrypted}
                        <div class="read-line">
                            <span class="read-label">ENCRYPT:</span>
                            <span class="read-value encrypt"
                                >🔒 Level {selectedMessage.encryptionLevel ||
                                    1}</span
                            >
                        </div>
                    {/if}
                    <div class="read-divider">
                        {"═".repeat(74)}
                    </div>
                </div>

                <div class="message-body">
                    <pre>{selectedMessage.content}</pre>
                </div>
            </div>
        {:else if mode === "compose"}
            <!-- COMPOSE VIEW -->
            <div class="mail-compose">
                <div class="compose-form">
                    <div class="compose-row">
                        <span class="compose-label">TO:</span>
                        <input
                            bind:this={recipientInput}
                            id="recipient"
                            type="text"
                            bind:value={composeRecipient}
                            placeholder="username"
                            class="compose-input"
                            autocomplete="off"
                        />
                        <span class="compose-hint">[TAB for contacts]</span>
                    </div>

                    <div class="compose-divider">{"─".repeat(74)}</div>

                    <div class="compose-row">
                        <span class="compose-label">SUBJECT:</span>
                        <input
                            id="subject"
                            type="text"
                            bind:value={composeSubject}
                            placeholder="(optional)"
                            class="compose-input"
                            autocomplete="off"
                        />
                    </div>

                    <div class="compose-divider">{"─".repeat(74)}</div>

                    <div class="compose-row">
                        <span class="compose-label">MESSAGE:</span>
                    </div>

                    <textarea
                        bind:this={bodyTextarea}
                        id="body"
                        bind:value={composeBody}
                        placeholder="Type your message here..."
                        class="compose-textarea"
                        rows="12"
                    ></textarea>

                    <div class="compose-divider">{"─".repeat(74)}</div>

                    <div class="compose-row">
                        <label class="encrypt-label">
                            <input type="checkbox" bind:checked={isEncrypted} />
                            ENCRYPT MESSAGE
                        </label>
                        {#if isEncrypted}
                            <span class="encrypt-status">🔒 ENABLED</span>
                        {/if}
                    </div>
                </div>
            </div>
        {/if}
    </div>

    <!-- FOOTER with shortcuts -->
    <div slot="footer" class="mail-footer">
        <pre>
{#if mode === "list"}║ [↑/↓] Nav [ENTER] Read [C]ompose [T]oggle [R]efresh [D]elete [ESC] Close ║
            {:else if mode === "read"}║ [R]eply [D]elete [B]ack [ESC] Close                                      ║
            {:else if mode === "compose"}║ [CTRL+S] Send [CTRL+E] Encrypt [ESC] Cancel                              ║
            {/if}        </pre>
    </div>
</AsciiDialog>

<style>
    /* ==================== MAIL DIALOG CONTENT ==================== */

    .mail-dialog-content {
        min-height: 300px;
        font-family: "IBM Plex Mono", "Courier New", monospace;
        padding: 1em;
        color: #00ff00;
    }

    /* ==================== LOADING / ERROR / SUCCESS ==================== */

    .loading,
    .error-message,
    .success-message {
        text-align: center;
        padding: 2em 0;
    }

    .loading pre,
    .error-message pre,
    .success-message pre {
        color: #00ff00;
        font-size: 0.9em;
        margin: 0;
    }

    .error-message pre {
        color: #ff0000;
    }

    .success-message pre {
        color: #00ff00;
        animation: pulse 1s ease-in-out;
    }

    @keyframes pulse {
        0%,
        100% {
            opacity: 1;
        }
        50% {
            opacity: 0.7;
        }
    }

    /* ==================== LIST VIEW ==================== */

    .mail-list {
        flex: 1;
    }

    .mailbox-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.5em 1em;
        margin-bottom: 1em;
        border-bottom: 1px solid #00ff00;
    }

    .mailbox-type {
        color: #00ff00;
        font-weight: bold;
        font-size: 1.1em;
    }

    .mailbox-hint {
        color: #888;
        font-size: 0.85em;
    }

    .empty-state {
        text-align: center;
        padding: 2em 0;
        color: #008800;
    }

    .message-list {
        display: flex;
        flex-direction: column;
        font-family: "IBM Plex Mono", monospace;
        letter-spacing: 0;
        gap: 0;
        border: 1px solid #00ff00;
        border-bottom: none;
    }

    .message-item {
        cursor: pointer;
        transition: all 0.05s ease;
        display: flex;
        gap: 1ch;
        padding: 0.3em 0.5em;
        line-height: 1.4;
        background: #000;
        border-bottom: 1px solid #003300;
        color: #00aa00;
        align-items: center;
    }

    .message-item:hover {
        background: rgba(0, 255, 0, 0.1);
        color: #00ff00;
        border-bottom-color: #00ff00;
    }

    .message-item.selected {
        background: rgba(0, 255, 0, 0.2);
        color: #ffff00;
        border-bottom-color: #ffff00;
    }

    .message-item.unread {
        color: #00ff00;
        font-weight: bold;
    }

    .msg-num {
        color: #008800;
        min-width: 3ch;
        text-align: right;
    }

    .msg-status {
        color: #ffff00;
        min-width: 1ch;
    }

    .msg-from {
        color: inherit;
        min-width: 15ch;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .msg-subject {
        color: inherit;
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .msg-date {
        color: #008800;
        min-width: 8ch;
        text-align: right;
    }

    .msg-encrypt {
        color: #00ffff;
        margin-left: 0.5ch;
    }

    .list-footer {
        margin-top: 0;
        padding: 0.5em;
        border: 1px solid #00ff00;
        border-top: none;
        color: #008800;
        font-size: 0.9em;
        line-height: 1.4;
    }

    /* ==================== READ VIEW ==================== */

    .mail-read {
        min-height: 300px;
    }

    .read-header {
        border: 1px solid #00ff00;
        padding: 0.5em;
        margin-bottom: 0.5em;
    }

    .read-line {
        display: flex;
        gap: 1ch;
        padding: 0.2em 0;
        line-height: 1.4;
    }

    .read-label {
        color: #008800;
        min-width: 10ch;
        font-weight: bold;
    }

    .read-value {
        color: #00ff00;
        flex: 1;
    }

    .read-value.encrypt {
        color: #00ffff;
    }

    .read-divider {
        color: #004400;
        margin: 0.5em 0;
        font-size: 0.8em;
        line-height: 1;
    }

    .message-body {
        background: #000;
        padding: 1em;
        border: 1px solid #00ff00;
        min-height: 200px;
        max-height: 400px;
        overflow-y: auto;
    }

    .message-body pre {
        color: #00ff00;
        white-space: pre-wrap;
        word-wrap: break-word;
        margin: 0;
        font-family: inherit;
        line-height: 1.5;
    }

    /* ==================== COMPOSE VIEW ==================== */

    .mail-compose {
        min-height: 300px;
    }

    .compose-form {
        display: flex;
        flex-direction: column;
        gap: 0;
        border: 1px solid #00ff00;
        padding: 0.5em;
    }

    .compose-row {
        display: flex;
        gap: 1ch;
        align-items: center;
        padding: 0.3em 0;
        line-height: 1.4;
    }

    .compose-label {
        color: #008800;
        min-width: 10ch;
        font-weight: bold;
    }

    .compose-input {
        flex: 1;
        background: #000;
        color: #00ff00;
        border: none;
        border-bottom: 1px solid #004400;
        padding: 0.3em 0.5em;
        font-family: inherit;
        font-size: inherit;
    }

    .compose-input:focus {
        outline: none;
        border-bottom-color: #00ff00;
        background: rgba(0, 255, 0, 0.05);
    }

    .compose-input::placeholder {
        color: #004400;
    }

    .compose-hint {
        color: #006600;
        font-size: 0.85em;
    }

    .compose-divider {
        color: #004400;
        font-size: 0.8em;
        line-height: 1;
        margin: 0.3em 0;
    }

    .compose-textarea {
        width: 100%;
        background: #000;
        color: #00ff00;
        border: 1px solid #004400;
        padding: 0.5em;
        font-family: inherit;
        font-size: inherit;
        resize: vertical;
        min-height: 150px;
        line-height: 1.5;
        margin: 0.3em 0;
    }

    .compose-textarea:focus {
        outline: none;
        border-color: #00ff00;
        background: rgba(0, 255, 0, 0.02);
    }

    .compose-textarea::placeholder {
        color: #004400;
    }

    .encrypt-label {
        color: #00ff00;
        display: inline-flex;
        align-items: center;
        gap: 0.5ch;
        cursor: pointer;
    }

    .encrypt-label input[type="checkbox"] {
        cursor: pointer;
    }

    .encrypt-status {
        color: #00ffff;
        margin-left: 2ch;
        font-weight: bold;
    }

    /* ==================== FOOTER ==================== */

    .mail-footer {
        color: #00ff00;
        font-size: 1em;
        padding: 0;
    }

    .mail-footer pre {
        margin: 0;
        line-height: 1.2;
        white-space: pre;
    }

    /* ==================== RESPONSIVE ==================== */

    @media (max-width: 768px) {
        .mail-dialog-content {
            padding: 0.5em;
            font-size: 12px;
        }

        .message-sender {
            min-width: 10ch;
        }

        .message-subject {
            display: none;
        }
    }
</style>
