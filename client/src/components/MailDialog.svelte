<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { createEventDispatcher } from "svelte";
    import AsciiDialog from "./AsciiDialog.svelte";
    import { terminalService } from "../services/terminal";
    import { newMailNotifications } from "../services/socketStores";
    import { currentUser } from "../stores/gameState";

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
        avatar?: {
            glyph: string;
            color: string;
            compact?: string[];
        };
        decryptedContent?: string;
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
    type MessageCategory =
        | "all"
        | "private"
        | "system"
        | "mission"
        | "faction"
        | "alert";

    let mode: ViewMode = "list";
    let mailboxType: MailboxType = "inbox";
    let activeCategory: MessageCategory = "all";
    let decrypting: Set<string> = new Set();
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

    // Real-time mail subscription
    let unsubscribeNewMail: any;

    // ==================== LIFECYCLE ====================

    onMount(() => {
        loadMessages();
        loadContacts();
        // Subscribe to real-time mail notifications
        unsubscribeNewMail = newMailNotifications.subscribe(
            (notifications: any[]) => {
                if (notifications.length > 0) {
                    // Add new mail to messages if in inbox view
                    for (const notif of notifications) {
                        const exists = messages.some((m) => m.id === notif.id);
                        if (!exists) {
                            const newMsg: Message = {
                                id: notif.id,
                                senderId: notif.senderId,
                                senderUsername: notif.senderUsername,
                                recipientId: "",
                                subject: notif.subject,
                                content: "[New Mail]",
                                timestamp: new Date(notif.timestamp),
                                isRead: false,
                                isEncrypted: notif.isEncrypted || false,
                                messageType: notif.messageType || "private",
                                avatar: notif.avatar || null,
                            };
                            messages = [newMsg, ...messages];
                        }
                    }
                }
            },
        );
    });

    onDestroy(() => {
        if (unsubscribeNewMail) unsubscribeNewMail();
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
            // Use 'mail' command if subject is provided, otherwise 'msg'
            // Quote recipient if it contains spaces (e.g., "The Architect")
            const encryptFlag = isEncrypted ? " --encrypt" : "";
            const cleanRecipient = composeRecipient.replace(/"/g, "");
            const safeRecipient = cleanRecipient.includes(" ")
                ? `"${cleanRecipient}"`
                : cleanRecipient;
            const command = composeSubject.trim()
                ? `mail ${safeRecipient} ${composeSubject} ${composeBody}${encryptFlag}`
                : `msg ${safeRecipient} ${composeBody}${encryptFlag}`;
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

    // ==================== REPORT ====================

    async function reportMessage(messageId: string) {
        const reason = prompt("Report reason:");
        if (!reason || !reason.trim()) return;

        try {
            const response = await terminalService.executeCommand(
                `mail report ${messageId} ${reason.trim()}`,
            );
            if (response.success) {
                successMsg = "Report submitted. Thank you.";
                setTimeout(() => (successMsg = ""), 3000);
            } else {
                error = response.output?.toString() || "Failed to submit report";
            }
        } catch (err) {
            error = "Failed to submit report";
            console.error(err);
        }
    }

    // ==================== DECRYPT / CATEGORY ====================

    async function decryptMessage(messageId: string) {
        decrypting = new Set([...decrypting, messageId]);
        try {
            // For authorized recipients, use requestDecryption
            const response = await terminalService.executeCommand(
                `crack ${messageId}`,
            );
            if (response.success && response.data?.content) {
                // Update the message content
                const msg = messages.find((m) => m.id === messageId);
                if (msg) {
                    msg.decryptedContent = response.data.content;
                    messages = messages; // trigger reactivity
                }
                if (selectedMessage && selectedMessage.id === messageId) {
                    selectedMessage = {
                        ...selectedMessage,
                        decryptedContent: response.data.content,
                    };
                }
            } else {
                error = response.data?.message || "Failed to decrypt message";
            }
        } catch (err) {
            error = "Decryption failed";
            console.error(err);
        } finally {
            decrypting.delete(messageId);
            decrypting = decrypting;
        }
    }

    function setCategory(cat: string) {
        activeCategory = cat as MessageCategory;
        selectedIndex = 0;
    }

    function handleDecryptClick() {
        if (selectedMessage) {
            decryptMessage(selectedMessage.id);
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
            // Use "RE:" without space to avoid parsing issues with multi-word subjects
            composeSubject = `RE:${replyTo.subject}`;
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
                    if (selectedIndex < filteredMessages.length - 1) {
                        selectedIndex++;
                    }
                    break;
                case "Enter":
                    event.preventDefault();
                    if (filteredMessages[selectedIndex]) {
                        openMessage(
                            filteredMessages[selectedIndex],
                            selectedIndex,
                        );
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
                        filteredMessages[selectedIndex]
                    ) {
                        event.preventDefault();
                        deleteMessage(filteredMessages[selectedIndex].id);
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
                case "!":
                    event.preventDefault();
                    reportMessage(selectedMessage.id);
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

    $: filteredMessages =
        activeCategory === "all"
            ? messages
            : messages.filter((m) => m.messageType === activeCategory);
    $: userId = $currentUser?.id || "";
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

                <!-- Category Tabs -->
                <div class="category-tabs">
                    {#each [["all", "ALL"], ["private", "PRIV"], ["system", "SYS"], ["mission", "MISSION"], ["faction", "FACTION"], ["alert", "ALERT"]] as [cat, label]}
                        <button
                            class="category-tab"
                            class:active={activeCategory === cat}
                            on:click={() => setCategory(cat)}
                        >
                            {label}{#if cat !== "all"}{@const count =
                                    messages.filter(
                                        (m) =>
                                            m.messageType === cat && !m.isRead,
                                    ).length}{#if count > 0}
                                    ({count}){/if}{/if}
                        </button>
                    {/each}
                </div>

                {#if filteredMessages.length === 0}
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
                        {#each filteredMessages as message, index}
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
                                <span
                                    class="msg-avatar"
                                    style="color: {message.avatar?.color ||
                                        '#888'}"
                                    >{message.avatar?.glyph || "[•_•]"}</span
                                >
                                <span class="msg-from"
                                    >{truncate(
                                        mailboxType === "inbox"
                                            ? message.senderUsername ||
                                                  "Unknown"
                                            : message.recipientUsername ||
                                                  "Unknown",
                                        12,
                                    )}</span
                                >
                                <span class="msg-subject"
                                    >{truncate(message.subject, 30)}</span
                                >
                                <span class="msg-date"
                                    >{formatDate(message.timestamp)}</span
                                >
                                {#if message.isEncrypted}
                                    <span class="msg-encrypt"
                                        >{message.decryptedContent
                                            ? "🔓"
                                            : "🔒"}</span
                                    >
                                {/if}
                            </div>
                        {/each}
                    </div>

                    <div class="list-footer">
                        ══════════════════════════════════════════════════════════════════════<br
                        />
                        TOTAL: {filteredMessages.length} MESSAGE{filteredMessages.length !==
                        1
                            ? "S"
                            : ""} │ UNREAD: {filteredMessages.filter(
                            (m) => !m.isRead,
                        ).length}
                    </div>
                {/if}
            </div>
        {:else if mode === "read" && selectedMessage}
            <!-- READ VIEW -->
            <div class="mail-read">
                <div class="read-header">
                    <div class="read-line">
                        <span class="read-label">FROM:</span>
                        <span
                            class="read-avatar"
                            style="color: {selectedMessage.avatar?.color ||
                                '#888'}"
                            >{selectedMessage.avatar?.glyph || ""}</span
                        >
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
                                >{selectedMessage.decryptedContent
                                    ? "🔓"
                                    : "🔒"} Level {selectedMessage.encryptionLevel ||
                                    1}</span
                            >
                            {#if !selectedMessage.decryptedContent}
                                <button
                                    class="decrypt-btn"
                                    on:click={handleDecryptClick}
                                    disabled={decrypting.has(
                                        selectedMessage.id,
                                    )}
                                >
                                    {#if decrypting.has(selectedMessage.id)}
                                        DECRYPTING...
                                    {:else}
                                        [DECRYPT]
                                    {/if}
                                </button>
                            {/if}
                        </div>
                    {/if}
                    <div class="read-divider">
                        {"═".repeat(74)}
                    </div>
                </div>

                <div class="message-body">
                    {#if selectedMessage.isEncrypted && !selectedMessage.decryptedContent}
                        <pre
                            class="encrypted-content">{selectedMessage.content}</pre>
                    {:else}
                        <pre>{selectedMessage.decryptedContent ||
                                selectedMessage.content}</pre>
                    {/if}
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
            {:else if mode === "read"}║ [R]eply [D]elete [!]Report [B]ack [ESC] Close                             ║
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
        color: #00bcd4;
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
        color: #00bcd4;
        font-size: 0.9em;
        margin: 0;
    }

    .error-message pre {
        color: #ff0000;
    }

    .success-message pre {
        color: #00bcd4;
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
        border-bottom: 1px solid #00bcd4;
    }

    .mailbox-type {
        color: #00bcd4;
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
        border: 1px solid #00bcd4;
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
        color: #00bcd4;
        border-bottom-color: #00bcd4;
    }

    .message-item.selected {
        background: rgba(0, 255, 0, 0.2);
        color: #ffff00;
        border-bottom-color: #ffff00;
    }

    .message-item.unread {
        color: #00bcd4;
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

    .msg-avatar {
        font-family: monospace;
        font-size: 0.8em;
        margin-right: 4px;
        min-width: 50px;
        display: inline-block;
    }

    .list-footer {
        margin-top: 0;
        padding: 0.5em;
        border: 1px solid #00bcd4;
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
        border: 1px solid #00bcd4;
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
        color: #00bcd4;
        flex: 1;
    }

    .read-value.encrypt {
        color: #00ffff;
    }

    .read-avatar {
        font-family: monospace;
        margin-right: 6px;
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
        border: 1px solid #00bcd4;
        min-height: 200px;
        max-height: 400px;
        overflow-y: auto;
    }

    .message-body pre {
        color: #00bcd4;
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
        border: 1px solid #00bcd4;
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
        color: #00bcd4;
        border: none;
        border-bottom: 1px solid #004400;
        padding: 0.3em 0.5em;
        font-family: inherit;
        font-size: inherit;
    }

    .compose-input:focus {
        outline: none;
        border-bottom-color: #00bcd4;
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
        color: #00bcd4;
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
        border-color: #00bcd4;
        background: rgba(0, 255, 0, 0.02);
    }

    .compose-textarea::placeholder {
        color: #004400;
    }

    .encrypt-label {
        color: #00bcd4;
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

    /* ==================== CATEGORY TABS ==================== */

    .category-tabs {
        display: flex;
        gap: 2px;
        padding: 4px 0;
        border-bottom: 1px solid #333;
        margin-bottom: 4px;
        flex-wrap: wrap;
    }

    .category-tab {
        background: none;
        border: 1px solid #333;
        color: #666;
        font-family: "Courier New", monospace;
        font-size: 0.7em;
        padding: 1px 6px;
        cursor: pointer;
        transition: all 0.15s;
    }

    .category-tab:hover {
        border-color: #00ff41;
        color: #00ff41;
    }

    .category-tab.active {
        background: #00ff41;
        color: #000;
        border-color: #00ff41;
    }

    /* ==================== DECRYPT ==================== */

    .decrypt-btn {
        background: none;
        border: 1px solid #ff6600;
        color: #ff6600;
        font-family: "Courier New", monospace;
        font-size: 0.75em;
        padding: 1px 8px;
        cursor: pointer;
        margin-left: 10px;
    }

    .decrypt-btn:hover:not(:disabled) {
        background: #ff6600;
        color: #000;
    }

    .decrypt-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .encrypted-content {
        color: #ff6600;
        font-style: italic;
    }

    /* ==================== FOOTER ==================== */

    .mail-footer {
        color: #00bcd4;
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

        .msg-from {
            min-width: 10ch;
        }

        .msg-subject {
            display: none;
        }
    }
</style>
