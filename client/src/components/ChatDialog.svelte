<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { createEventDispatcher } from "svelte";
    import AsciiDialog from "./AsciiDialog.svelte";
    import { terminalService } from "../services/terminal";
    import {
        socketService,
        liveMessages,
        onlineUsers,
    } from "../services/socket";
    import { currentUser } from "../stores/gameState";

    // ==================== PROPS ====================

    export let visible: boolean = false;
    export let initialData: any = null;

    // ==================== EVENTS ====================

    const dispatch = createEventDispatcher();

    // ==================== TYPES ====================

    interface Contact {
        id: string;
        username: string;
        handle?: string;
        isOnline: boolean;
        lastSeen?: Date;
        unreadCount: number;
    }

    interface ChatMessage {
        id: string;
        senderId: string;
        senderUsername: string;
        recipientId: string;
        recipientUsername: string;
        content: string;
        timestamp: Date;
        isRead: boolean;
    }

    // ==================== STATE ====================

    let contacts: Contact[] = [];
    let selectedContactId: string | null = null;
    let selectedContact: Contact | null = null;
    let chatHistory: Map<string, ChatMessage[]> = new Map();
    let currentMessages: ChatMessage[] = [];
    let messageInput: string = "";
    let inputElement: HTMLInputElement;
    let chatAreaElement: HTMLDivElement;

    // UI state
    let loading: boolean = false;
    let error: string = "";
    let typingUsers: Set<string> = new Set();

    // Subscriptions
    let unsubscribeMessages: any;
    let unsubscribeOnline: any;

    // Current user data
    $: userId = $currentUser?.id || "";
    $: username = $currentUser?.username || "You";

    // ==================== LIFECYCLE ====================

    onMount(() => {
        loadContacts();
        setupRealtimeListeners();
    });

    onDestroy(() => {
        if (unsubscribeMessages) unsubscribeMessages();
        if (unsubscribeOnline) unsubscribeOnline();
    });

    // ==================== REALTIME LISTENERS ====================

    function setupRealtimeListeners() {
        // Subscribe to live messages from socket service
        unsubscribeMessages = liveMessages.subscribe((messages) => {
            messages.forEach((msg) => {
                addMessageToHistory(msg);
            });
        });

        // Subscribe to online users
        unsubscribeOnline = onlineUsers.subscribe((users) => {
            contacts = contacts.map((contact) => ({
                ...contact,
                isOnline: users.includes(contact.id),
            }));
        });
    }

    function addMessageToHistory(message: any) {
        const chatMessage: ChatMessage = {
            id: message.id || `msg_${Date.now()}`,
            senderId: message.senderId || message.sender?.id,
            senderUsername: message.senderUsername || message.sender?.username,
            recipientId: message.recipientId || message.recipient?.id,
            recipientUsername:
                message.recipientUsername || message.recipient?.username,
            content: message.content || message.body,
            timestamp: new Date(message.timestamp || Date.now()),
            isRead: message.isRead || false,
        };

        // Determine which contact this message belongs to
        const contactId =
            chatMessage.senderId === userId
                ? chatMessage.recipientId
                : chatMessage.senderId;

        // Add to chat history (check for duplicates first)
        const history = chatHistory.get(contactId) || [];
        const isDuplicate = history.some((msg) => msg.id === chatMessage.id);

        if (!isDuplicate) {
            history.push(chatMessage);
            chatHistory.set(contactId, history);
            chatHistory = chatHistory; // Trigger reactivity
        }

        // Update current view if this contact is selected
        if (selectedContactId === contactId) {
            currentMessages = history;
            scrollToBottom();
        }

        // Update unread count
        if (contactId !== selectedContactId) {
            const contact = contacts.find((c) => c.id === contactId);
            if (contact) {
                contact.unreadCount++;
                contacts = contacts;
            }
        }
    }

    // ==================== DATA LOADING ====================

    async function loadContacts() {
        loading = true;
        error = "";

        try {
            // Load from initial data or fetch
            const contactsData = initialData?.contacts || [];

            contacts = contactsData.map((c: any) => ({
                id: c.id || c.userId,
                username: c.username || c.handle || "Unknown",
                handle: c.handle,
                isOnline: false, // Will be updated by socket
                lastSeen: c.lastSeen ? new Date(c.lastSeen) : undefined,
                unreadCount: 0,
            }));

            // Load recent messages for each contact
            if (initialData?.recentMessages) {
                initialData.recentMessages.forEach((msg: any) => {
                    addMessageToHistory(msg);
                });
            }
        } catch (err) {
            error = "Failed to load contacts";
            console.error(err);
        } finally {
            loading = false;
        }
    }

    async function loadChatHistory(contactId: string, contactUsername: string) {
        try {
            // Fetch chat history from backend, pass contactUsername as extra arg
            const response = await terminalService.executeCommand(
                `chat history ${contactId} ${contactUsername}`,
            );

            if (response.success && response.data?.messages) {
                const history: ChatMessage[] = response.data.messages.map(
                    (msg: any) => ({
                        ...msg,
                        senderUsername:
                            msg.senderUsername === "Unknown"
                                ? msg.senderId === userId
                                    ? username
                                    : selectedContact?.username || "Contact"
                                : msg.senderUsername,
                        recipientUsername:
                            msg.recipientUsername === "Unknown"
                                ? msg.recipientId === userId
                                    ? username
                                    : selectedContact?.username || "Contact"
                                : msg.recipientUsername,
                        timestamp: new Date(msg.timestamp),
                    }),
                );
                chatHistory.set(contactId, history);
            }
        } catch (err) {
            console.error("Failed to load chat history:", err);
        }
    }
    // ==================== CONTACT SELECTION ====================

    async function selectContact(contact: Contact) {
        selectedContactId = contact.id;
        selectedContact = contact;

        await loadChatHistory(contact.id, contact.username);
        // Load chat history
        const history = chatHistory.get(contact.id) || [];

        currentMessages = history;

        // Clear unread count
        contact.unreadCount = 0;
        contacts = contacts;

        // Focus input
        setTimeout(() => {
            if (inputElement) {
                inputElement.focus();
            }
            scrollToBottom();
        }, 100);
    }

    // ==================== MESSAGING ====================

    async function sendMessage() {
        if (!messageInput.trim() || !selectedContact) return;

        const content = messageInput.trim();
        messageInput = "";

        try {
            // Send via backend
            const command = `msg ${selectedContact.username} ${content}`;
            const response = await terminalService.executeCommand(command);

            if (response.success && response.data?.message) {
                // Use the real message returned from server
                const serverMessage = response.data.message;
                const newMessage: ChatMessage = {
                    id: serverMessage.id,
                    senderId: serverMessage.senderId,
                    senderUsername: serverMessage.senderUsername,
                    recipientId: serverMessage.recipientId,
                    recipientUsername: serverMessage.recipientUsername,
                    content: serverMessage.content,
                    timestamp: new Date(serverMessage.timestamp),
                    isRead: serverMessage.isRead,
                };

                const history = chatHistory.get(selectedContact.id) || [];
                history.push(newMessage);
                chatHistory.set(selectedContact.id, history);
                currentMessages = history;
                chatHistory = chatHistory;

                scrollToBottom();
            } else {
                error = "Failed to send message";
            }
        } catch (err) {
            error = "Failed to send message";
            console.error(err);
        }
    }

    function handleKeydown(event: KeyboardEvent) {
        if (!visible) return;

        // Don't intercept typing in input
        const target = event.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
            }
            return;
        }

        // Global shortcuts
        if (event.key === "Escape") {
            event.preventDefault();
            close();
            return;
        }

        // Navigate contacts with arrow keys
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            navigateContacts(event.key === "ArrowUp" ? -1 : 1);
        }
    }

    function navigateContacts(direction: number) {
        if (contacts.length === 0) return;

        const currentIndex = selectedContactId
            ? contacts.findIndex((c) => c.id === selectedContactId)
            : -1;
        const nextIndex = Math.max(
            0,
            Math.min(contacts.length - 1, currentIndex + direction),
        );

        selectContact(contacts[nextIndex]);
    }

    // ==================== UI HELPERS ====================

    function scrollToBottom() {
        setTimeout(() => {
            if (chatAreaElement) {
                chatAreaElement.scrollTop = chatAreaElement.scrollHeight;
            }
        }, 50);
    }

    function formatMessageTime(date: Date): string {
        return date.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
        });
    }

    function close() {
        dispatch("close");
    }
</script>

<svelte:window on:keydown={handleKeydown} />

<AsciiDialog {visible} title="CHAT" width={90} height={28} on:close={close}>
    <div class="chat-container">
        {#if loading}
            <div class="loading">
                <pre>
╔═════════════════════════════════════════════════╗
║                                                 ║
║           LOADING CHAT INTERFACE...             ║
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
        {:else}
            <div class="chat-layout">
                <!-- CONTACTS SIDEBAR -->
                <div class="contacts-sidebar">
                    <div class="contacts-header">CONTACTS</div>
                    <div class="contacts-divider">{"═".repeat(20)}</div>

                    {#if contacts.length === 0}
                        <div class="no-contacts">
                            <div class="no-contacts-text">No contacts</div>
                        </div>
                    {:else}
                        <div class="contacts-list">
                            {#each contacts as contact}
                                <div
                                    class="contact-item"
                                    class:selected={selectedContactId ===
                                        contact.id}
                                    class:online={contact.isOnline}
                                    on:click={() => selectContact(contact)}
                                    on:keydown={(e) => {
                                        if (e.key === "Enter")
                                            selectContact(contact);
                                    }}
                                    role="button"
                                    tabindex="0"
                                >
                                    <span class="contact-status"
                                        >{contact.isOnline ? "●" : "○"}</span
                                    >
                                    <span class="contact-name"
                                        >{contact.username}</span
                                    >
                                    {#if contact.unreadCount > 0}
                                        <span class="contact-unread"
                                            >{contact.unreadCount}</span
                                        >
                                    {/if}
                                </div>
                            {/each}
                        </div>
                    {/if}
                </div>

                <!-- CHAT AREA -->
                <div class="chat-area">
                    {#if !selectedContact}
                        <div class="no-chat-selected">
                            <pre>
╔═════════════════════════════════════════════════╗
║                                                 ║
║         SELECT A CONTACT TO START CHAT          ║
║                                                 ║
║         Use ↑/↓ arrows to navigate              ║
║                                                 ║
╚═════════════════════════════════════════════════╝
                            </pre>
                        </div>
                    {:else}
                        <!-- CHAT HEADER -->
                        <div class="chat-header">
                            <span class="chat-recipient"
                                >@{selectedContact.username}</span
                            >
                            <span class="chat-status">
                                {selectedContact.isOnline
                                    ? "● ONLINE"
                                    : "○ OFFLINE"}
                            </span>
                        </div>

                        <div class="chat-divider">{"═".repeat(68)}</div>

                        <!-- MESSAGES -->
                        <div class="chat-messages" bind:this={chatAreaElement}>
                            {#if currentMessages.length === 0}
                                <div class="no-messages">
                                    No messages yet. Start the conversation!
                                </div>
                            {:else}
                                {#each currentMessages as message}
                                    <div
                                        class="chat-message"
                                        class:outgoing={message.senderId ===
                                            userId}
                                        class:incoming={message.senderId !==
                                            userId}
                                    >
                                        <span class="msg-time"
                                            >[{formatMessageTime(
                                                message.timestamp,
                                            )}]</span
                                        >
                                        <span class="msg-sender"
                                            >{message.senderId === userId
                                                ? "You"
                                                : message.senderUsername}:</span
                                        >
                                        <span class="msg-content"
                                            >{message.content}</span
                                        >
                                    </div>
                                {/each}
                            {/if}

                            <!-- TYPING INDICATOR -->
                            {#if typingUsers.has(selectedContact.id)}
                                <div class="typing-indicator">
                                    {selectedContact.username} is typing...
                                </div>
                            {/if}
                        </div>

                        <div class="chat-divider">{"═".repeat(68)}</div>

                        <!-- INPUT -->
                        <div class="chat-input-area">
                            <span class="input-prompt">></span>
                            <input
                                bind:this={inputElement}
                                bind:value={messageInput}
                                type="text"
                                class="chat-input"
                                placeholder="Type your message..."
                                autocomplete="off"
                            />
                        </div>
                    {/if}
                </div>
            </div>
        {/if}
    </div>

    <!-- FOOTER -->
    <div slot="footer" class="chat-footer">
        <pre>
║ [↑/↓] Select Contact [ENTER] Send Message [ESC] Close                     ║
        </pre>
    </div>
</AsciiDialog>

<style>
    /* ==================== CONTAINER ==================== */

    .chat-container {
        min-height: 400px;
        font-family: "IBM Plex Mono", "Courier New", monospace;
        color: #00ff00;
    }

    /* ==================== LOADING / ERROR ==================== */

    .loading,
    .error-message {
        text-align: center;
        padding: 2em 0;
    }

    .loading pre,
    .error-message pre {
        color: #00ff00;
        font-size: 0.9em;
        margin: 0;
    }

    .error-message pre {
        color: #ff0000;
    }

    /* ==================== LAYOUT ==================== */

    .chat-layout {
        display: flex;
        height: 500px;
        border: 1px solid #00ff00;
    }

    /* ==================== CONTACTS SIDEBAR ==================== */

    .contacts-sidebar {
        width: 220px;
        border-right: 1px solid #00ff00;
        display: flex;
        flex-direction: column;
        background: #000;
    }

    .contacts-header {
        padding: 0.5em;
        color: #008800;
        font-weight: bold;
        text-align: center;
        background: rgba(0, 255, 0, 0.05);
    }

    .contacts-divider {
        color: #004400;
        font-size: 0.8em;
        line-height: 1;
        padding: 0 0.5em;
    }

    .contacts-list {
        flex: 1;
        overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: #00ff00 #002200;
    }

    .contacts-list::-webkit-scrollbar {
        width: 6px;
    }

    .contacts-list::-webkit-scrollbar-track {
        background: #002200;
    }

    .contacts-list::-webkit-scrollbar-thumb {
        background: #00ff00;
        border-radius: 3px;
    }

    .no-contacts {
        padding: 2em 1em;
        text-align: center;
    }

    .no-contacts-text {
        color: #006600;
        font-size: 0.9em;
    }

    .contact-item {
        display: flex;
        align-items: center;
        gap: 0.5ch;
        padding: 0.5em;
        cursor: pointer;
        border-bottom: 1px solid #003300;
        transition: all 0.05s ease;
        color: #00aa00;
    }

    .contact-item:hover {
        background: rgba(0, 255, 0, 0.1);
        color: #00ff00;
    }

    .contact-item.selected {
        background: rgba(0, 255, 0, 0.2);
        color: #ffff00;
        border-left: 3px solid #ffff00;
    }

    .contact-status {
        font-size: 0.8em;
        min-width: 1ch;
    }

    .contact-item.online .contact-status {
        color: #00ff00;
        animation: pulse 2s ease-in-out infinite;
    }

    .contact-item:not(.online) .contact-status {
        color: #666666;
    }

    @keyframes pulse {
        0%,
        100% {
            opacity: 1;
        }
        50% {
            opacity: 0.5;
        }
    }

    .contact-name {
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .contact-unread {
        background: #ffff00;
        color: #000;
        padding: 0.1em 0.4em;
        border-radius: 2px;
        font-size: 0.8em;
        font-weight: bold;
        min-width: 1.5ch;
        text-align: center;
    }

    /* ==================== CHAT AREA ==================== */

    .chat-area {
        flex: 1;
        display: flex;
        flex-direction: column;
        background: #000;
    }

    .no-chat-selected {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #006600;
    }

    .no-chat-selected pre {
        margin: 0;
    }

    .chat-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.5em 1em;
        background: rgba(0, 255, 0, 0.05);
    }

    .chat-recipient {
        color: #00ff00;
        font-weight: bold;
    }

    .chat-status {
        color: #008800;
        font-size: 0.85em;
    }

    .chat-divider {
        color: #004400;
        font-size: 0.8em;
        line-height: 1;
        padding: 0 1em;
    }

    .chat-messages {
        flex: 1;
        overflow-y: auto;
        padding: 1em;
        scrollbar-width: thin;
        scrollbar-color: #00ff00 #002200;
        max-height: 350px;
    }

    .chat-messages::-webkit-scrollbar {
        width: 8px;
    }

    .chat-messages::-webkit-scrollbar-track {
        background: #002200;
    }

    .chat-messages::-webkit-scrollbar-thumb {
        background: #00ff00;
        border-radius: 4px;
    }

    .no-messages {
        text-align: center;
        color: #006600;
        padding: 2em;
    }

    .chat-message {
        display: flex;
        gap: 0.5ch;
        padding: 0.3em 0;
        line-height: 1.5;
        word-wrap: break-word;
    }

    .chat-message.outgoing {
        color: #00ff00;
    }

    .chat-message.incoming {
        color: #00cccc;
    }

    .msg-time {
        color: #006600;
        font-size: 0.85em;
        min-width: 8ch;
    }

    .msg-sender {
        color: inherit;
        font-weight: bold;
        min-width: 10ch;
    }

    .msg-content {
        color: inherit;
        flex: 1;
        word-break: break-word;
    }

    .typing-indicator {
        color: #008800;
        font-style: italic;
        font-size: 0.9em;
        padding: 0.5em 0;
        animation: blink 1.5s ease-in-out infinite;
    }

    @keyframes blink {
        0%,
        100% {
            opacity: 1;
        }
        50% {
            opacity: 0.5;
        }
    }

    /* ==================== INPUT AREA ==================== */

    .chat-input-area {
        display: flex;
        align-items: center;
        gap: 0.5ch;
        padding: 0.5em 1em;
        background: rgba(0, 255, 0, 0.02);
    }

    .input-prompt {
        color: #00ff00;
        font-weight: bold;
    }

    .chat-input {
        flex: 1;
        background: #000;
        color: #00ff00;
        border: none;
        border-bottom: 1px solid #004400;
        padding: 0.3em 0.5em;
        font-family: inherit;
        font-size: inherit;
    }

    .chat-input:focus {
        outline: none;
        border-bottom-color: #00ff00;
        background: rgba(0, 255, 0, 0.05);
    }

    .chat-input::placeholder {
        color: #004400;
    }

    /* ==================== FOOTER ==================== */

    .chat-footer {
        color: #00ff00;
        font-size: 1em;
        padding: 0;
    }

    .chat-footer pre {
        margin: 0;
        line-height: 1.2;
        white-space: pre;
    }

    /* ==================== RESPONSIVE ==================== */

    @media (max-width: 768px) {
        .chat-layout {
            flex-direction: column;
            height: auto;
        }

        .contacts-sidebar {
            width: 100%;
            border-right: none;
            border-bottom: 1px solid #00ff00;
            max-height: 150px;
        }

        .chat-messages {
            max-height: 300px;
        }
    }
</style>
