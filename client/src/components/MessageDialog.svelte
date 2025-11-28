<script lang="ts">
    import { onMount } from "svelte";
    import { createEventDispatcher } from "svelte";
    import { generateAvatar, getCompactAvatar } from "../utils/asciiAvatars";
    import {
        messagingSystem,
        type Message,
        type Thread,
    } from "../utils/messagingSystem";

    const dispatch = createEventDispatcher();

    // Modes:
    //  - 'single' : show a single message (legacy behavior)
    //  - 'thread' : show a conversation thread between player and a contact
    //  - 'inbox'  : show thread list / inbox view
    export let visible: boolean = false;
    export let mode: "single" | "thread" | "inbox" = "single";

    // Single message (legacy)
    export let message: Message | null = null;

    // Optional thread id (if provided we open the thread)
    export let threadId: string | null = null;

    // Optional pre-supplied lists (if parent provides them)
    export let threads: Thread[] | null = null;

    // Visual/UX
    let threadMessages: Message[] = [];
    let selectedThread: Thread | null = null;
    let selectedThreadId: string | null = null;
    let showReplyBox = false;
    let replySubject = "";
    let replyText = "";

    // Avatars
    $: currentSenderHandle =
        mode === "single" && message
            ? message.sender
            : selectedThread
              ? (selectedThread.participants.find((p) => p !== "player") ??
                selectedThread.participants[0])
              : "System";
    $: avatar = generateAvatar(
        currentSenderHandle || "System",
        currentSenderHandle === "player"
            ? "player"
            : currentSenderHandle === "System"
              ? "system"
              : "npc",
    );
    $: compactAvatar = getCompactAvatar(avatar);

    // Load threads/messages lazily
    function refreshThreads() {
        threads = messagingSystem.listThreads();
    }

    function openThread(tid: string) {
        selectedThreadId = tid;
        selectedThread =
            (threads || messagingSystem.listThreads()).find(
                (t) => t.threadId === tid,
            ) || null;
        threadMessages = messagingSystem.getThreadMessages(tid);
        // Mark read locally in messagingSystem
        messagingSystem.markThreadRead(tid);
        showReplyBox = false;
        mode = "thread";
        dispatch("openThread", { threadId: tid });
    }

    function openInbox() {
        mode = "inbox";
        refreshThreads();
        selectedThread = null;
        selectedThreadId = null;
        threadMessages = [];
    }

    function openMessage(msgId: string) {
        // If the parent wants to handle this, dispatch; otherwise render using internal store
        const all = threadMessages.length
            ? threadMessages
            : message
              ? [message]
              : [];
        const found = all.find((m) => m.id === msgId);
        if (found) {
            message = found;
            visible = true;
            mode = "single";
            dispatch("openMessage", { messageId: msgId });
        } else {
            dispatch("openMessage", { messageId: msgId });
        }
    }

    function close() {
        visible = false;
        dispatch("close");
    }

    function toggleReply() {
        showReplyBox = !showReplyBox;
        if (showReplyBox && mode === "single" && message) {
            replySubject = `Re: ${message.subject || ""}`;
        } else if (selectedThread && mode === "thread") {
            replySubject = `Re: ${selectedThread.lastMessage?.subject || ""}`;
        } else {
            replySubject = "";
        }
    }

    function sendReply() {
        // Determine target: thread or single recipient
        let targetThread = selectedThreadId;
        if (!targetThread && message) {
            targetThread = `thread:player:${message.sender}`;
        }

        if (!replyText.trim()) {
            // nothing to send
            return;
        }

        if (targetThread) {
            // Inform parent and update local messaging system
            const success = messagingSystem.sendMessageToThread(
                targetThread,
                replySubject,
                replyText,
            );
            dispatch("send", {
                threadId: targetThread,
                subject: replySubject,
                content: replyText,
                success,
            });
            // Refresh thread messages
            threadMessages = messagingSystem.getThreadMessages(targetThread);
            showReplyBox = false;
            replyText = "";
        } else if (message) {
            // Fallback: send directly to message.sender via sendMessage
            const success = messagingSystem.sendMessage(
                message.sender,
                replySubject,
                replyText,
            );
            dispatch("send", {
                to: message.sender,
                subject: replySubject,
                content: replyText,
                success,
            });
            showReplyBox = false;
            replyText = "";
        } else {
            dispatch("send", { error: "No target specified" });
        }
    }

    function deleteCurrentMessage() {
        if (!message) {
            dispatch("delete", { messageId: null });
            return;
        }
        dispatch("delete", { messageId: message.id });
        // parent or store should handle actual deletion
        close();
    }

    function markMessageRead(msgId?: string) {
        if (msgId) {
            messagingSystem.readMessage(msgId);
            dispatch("markRead", { messageId: msgId });
            return;
        }
        if (selectedThreadId) {
            messagingSystem.markThreadRead(selectedThreadId);
            dispatch("markRead", { threadId: selectedThreadId });
        } else if (message) {
            messagingSystem.readMessage(message.id);
            dispatch("markRead", { messageId: message.id });
        }
    }

    function handleKeydown(event: KeyboardEvent) {
        if (event.key === "Escape") {
            if (showReplyBox) {
                showReplyBox = false;
            } else {
                close();
            }
        } else if (event.key === "Enter" && event.ctrlKey) {
            // send reply if visible
            if (showReplyBox) sendReply();
        } else if (event.key === "ArrowLeft") {
            // go back to inbox
            if (mode === "thread") openInbox();
        }
    }

    onMount(() => {
        if (!threads) refreshThreads();
        if (threadId) {
            // attempt to open provided thread
            setTimeout(() => openThread(threadId!), 50);
        }
    });

    // Utilities
    function fmtDate(d: Date | string | undefined) {
        if (!d) return "";
        const date = typeof d === "string" ? new Date(d) : d;
        return date.toLocaleString();
    }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if visible}
    <div
        class="message-overlay"
        on:click={close}
        role="dialog"
        aria-modal="true"
        aria-label="Messages dialog"
    >
        <div
            class="message-dialog"
            on:click|stopPropagation
            role="document"
            aria-labelledby="msg-title"
        >
            <!-- Header -->
            <div class="message-header">
                <div class="header-left">
                    <div class="avatar-section" aria-hidden="true">
                        {#each compactAvatar as line}
                            <div
                                class="avatar-line"
                                style="color: {avatar.color}"
                            >
                                {line}
                            </div>
                        {/each}
                    </div>
                    <div class="sender-info">
                        <div
                            id="msg-title"
                            class="sender-name"
                            style="color: {avatar.color}"
                        >
                            {#if mode === "inbox"}
                                Inbox
                            {:else if mode === "thread"}
                                {selectedThread
                                    ? selectedThread.participants
                                          .filter((p) => p !== "player")
                                          .join(", ")
                                    : "Conversation"}
                            {:else}
                                {message ? message.sender : "Message"}
                            {/if}
                        </div>
                        <div class="sender-meta">
                            {#if mode === "single" && message}
                                <span class="sender-type"
                                    >[{message.sender.toUpperCase()}]</span
                                >
                                <span class="message-time"
                                    >{fmtDate(message.timestamp)}</span
                                >
                            {:else if mode === "thread" && selectedThread}
                                <span class="sender-type">Thread</span>
                                <span class="message-time"
                                    >Last: {fmtDate(
                                        selectedThread.lastMessage?.timestamp,
                                    )}</span
                                >
                            {:else}
                                <span class="sender-type">Messaging System</span
                                >
                            {/if}
                        </div>
                    </div>
                </div>

                <div class="header-actions">
                    <button
                        class="small-btn"
                        on:click={refreshThreads}
                        aria-label="Refresh threads">⟳</button
                    >
                    <button
                        class="small-btn"
                        on:click={openInbox}
                        aria-label="Open inbox">📥</button
                    >
                    <button
                        class="small-btn close-btn"
                        on:click={close}
                        aria-label="Close dialog">✕</button
                    >
                </div>
            </div>

            <div class="message-body-area">
                {#if mode !== "single"}
                    <!-- Sidebar: threads -->
                    <div
                        class="threads-sidebar"
                        role="navigation"
                        aria-label="Threads"
                    >
                        <div class="threads-header">
                            <strong>Threads</strong>
                        </div>
                        {#if threads && threads.length > 0}
                            <ul class="thread-list" role="list">
                                {#each threads as t}
                                    <li
                                        class="thread-item {t.threadId ===
                                        selectedThreadId
                                            ? 'active'
                                            : ''}"
                                        on:click={() => openThread(t.threadId)}
                                        role="listitem"
                                        tabindex="0"
                                        aria-selected={t.threadId ===
                                            selectedThreadId}
                                    >
                                        <div class="thread-top">
                                            <span class="thread-name"
                                                >{t.participants
                                                    .filter(
                                                        (p) => p !== "player",
                                                    )
                                                    .join(", ")}</span
                                            >
                                            {#if t.unreadCount > 0}
                                                <span class="thread-unread"
                                                    >+{t.unreadCount}</span
                                                >
                                            {/if}
                                        </div>
                                        <div class="thread-sub">
                                            <span class="thread-subject"
                                                >{t.lastMessage?.subject ||
                                                    "(no subject)"}</span
                                            >
                                            <span class="thread-time"
                                                >{fmtDate(
                                                    t.lastMessage?.timestamp,
                                                )}</span
                                            >
                                        </div>
                                    </li>
                                {/each}
                            </ul>
                        {:else}
                            <div class="no-threads">No threads</div>
                        {/if}
                    </div>

                    <!-- Main panel: thread messages or inbox summary -->
                    <div class="threads-main" role="main">
                        {#if mode === "inbox"}
                            <div class="inbox-summary">
                                <h3>Inbox</h3>
                                <p>Click a thread to open the conversation.</p>
                            </div>
                        {:else if mode === "thread"}
                            <div
                                class="thread-messages"
                                role="log"
                                aria-live="polite"
                            >
                                {#if threadMessages.length === 0}
                                    <div class="no-messages">
                                        No messages in this conversation.
                                    </div>
                                {:else}
                                    {#each threadMessages as tm}
                                        <div
                                            class="message-row {tm.sender ===
                                            'player'
                                                ? 'outgoing'
                                                : 'incoming'}"
                                            on:dblclick={() =>
                                                openMessage(tm.id)}
                                            tabindex="0"
                                        >
                                            <div class="msg-meta">
                                                <div class="msg-who">
                                                    {tm.sender === "player"
                                                        ? "You"
                                                        : tm.sender}
                                                </div>
                                                <div class="msg-time">
                                                    {fmtDate(tm.timestamp)}
                                                </div>
                                            </div>
                                            <div class="msg-body">
                                                <div class="msg-subject">
                                                    {tm.subject || ""}
                                                </div>
                                                <div class="msg-content">
                                                    {tm.content}
                                                </div>
                                            </div>
                                        </div>
                                    {/each}
                                {/if}
                            </div>

                            <div class="thread-actions">
                                <button
                                    class="action-btn"
                                    on:click={() => {
                                        showReplyBox = !showReplyBox;
                                        if (showReplyBox) replyText = "";
                                    }}>Reply</button
                                >
                                <button
                                    class="action-btn"
                                    on:click={() => markMessageRead()}
                                    >Mark Read</button
                                >
                                <button
                                    class="action-btn"
                                    on:click={() => {
                                        dispatch("closeThread", {
                                            threadId: selectedThreadId,
                                        });
                                        openInbox();
                                    }}>Close Thread</button
                                >
                            </div>

                            {#if showReplyBox}
                                <div class="reply-box">
                                    <input
                                        class="reply-subject"
                                        bind:value={replySubject}
                                        placeholder="Subject (optional)"
                                    />
                                    <textarea
                                        class="reply-text"
                                        bind:value={replyText}
                                        placeholder="Type your reply here (Ctrl+Enter to send)"
                                    ></textarea>
                                    <div class="reply-actions">
                                        <button
                                            class="action-btn send-btn"
                                            on:click={sendReply}>Send</button
                                        >
                                        <button
                                            class="action-btn cancel-btn"
                                            on:click={() =>
                                                (showReplyBox = false)}
                                            >Cancel</button
                                        >
                                    </div>
                                </div>
                            {/if}
                        {/if}
                    </div>
                {:else}
                    <!-- Single message view -->
                    <div class="single-main">
                        {#if message}
                            <div class="single-header">
                                <div class="single-subject">
                                    {message.subject}
                                </div>
                                <div class="single-time">
                                    {fmtDate(message.timestamp)}
                                </div>
                            </div>
                            <div class="single-body">
                                <pre
                                    class="single-content">{message.content}</pre>
                            </div>

                            <div class="message-actions">
                                <button
                                    class="action-btn reply-btn"
                                    on:click={toggleReply}>↩ Reply</button
                                >
                                <button
                                    class="action-btn delete-btn"
                                    on:click={deleteCurrentMessage}
                                    >🗑 Delete</button
                                >
                                <button
                                    class="action-btn close-btn-footer"
                                    on:click={close}>✓ Close</button
                                >
                            </div>

                            {#if showReplyBox}
                                <div class="reply-box single-reply">
                                    <input
                                        class="reply-subject"
                                        bind:value={replySubject}
                                        placeholder="Subject (optional)"
                                    />
                                    <textarea
                                        class="reply-text"
                                        bind:value={replyText}
                                        placeholder="Reply (Ctrl+Enter to send)"
                                    ></textarea>
                                    <div class="reply-actions">
                                        <button
                                            class="action-btn send-btn"
                                            on:click={sendReply}>Send</button
                                        >
                                        <button
                                            class="action-btn cancel-btn"
                                            on:click={() =>
                                                (showReplyBox = false)}
                                            >Cancel</button
                                        >
                                    </div>
                                </div>
                            {/if}
                        {:else}
                            <div class="no-message">No message selected.</div>
                        {/if}
                    </div>
                {/if}
            </div>
        </div>
    </div>
{/if}

<style>
    /* Overlay & dialog */
    .message-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.85);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
    }

    .message-dialog {
        width: 92%;
        max-width: 1000px;
        max-height: 86vh;
        background: #0b0f15;
        border: 2px solid #00ff41;
        display: flex;
        flex-direction: column;
        border-radius: 8px;
        overflow: hidden;
        font-family: "Fira Code", monospace;
    }

    .message-header {
        display: flex;
        justify-content: space-between;
        padding: 14px;
        border-bottom: 2px solid rgba(0, 255, 65, 0.12);
        gap: 12px;
    }

    .header-left {
        display: flex;
        gap: 12px;
        align-items: center;
    }

    .avatar-section {
        font-size: 12px;
        line-height: 1;
        white-space: pre;
        text-shadow: 0 0 6px currentColor;
    }

    .avatar-line {
        font-family: monospace;
    }

    .sender-info {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .sender-name {
        font-weight: 700;
        font-size: 18px;
    }
    .sender-meta {
        display: flex;
        gap: 8px;
        color: #9aa;
        font-size: 12px;
        align-items: center;
    }

    .header-actions {
        display: flex;
        gap: 8px;
        align-items: center;
    }
    .small-btn {
        background: transparent;
        border: 1px solid rgba(255, 255, 255, 0.06);
        color: #cfc;
        padding: 6px 8px;
        border-radius: 4px;
        cursor: pointer;
    }
    .small-btn:hover {
        background: rgba(255, 255, 255, 0.02);
    }

    .message-body-area {
        display: flex;
        flex: 1;
        min-height: 300px;
        overflow: hidden;
    }

    /* Sidebar */
    .threads-sidebar {
        width: 300px;
        border-right: 1px solid rgba(0, 255, 65, 0.06);
        padding: 12px;
        background: linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.01),
            transparent
        );
        overflow-y: auto;
    }

    .threads-header {
        margin-bottom: 8px;
        color: #bdf;
    }
    .thread-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .thread-item {
        padding: 8px;
        border-radius: 6px;
        cursor: pointer;
        border: 1px solid transparent;
    }
    .thread-item:hover {
        background: rgba(0, 255, 65, 0.02);
        border-color: rgba(0, 255, 65, 0.04);
    }
    .thread-item.active {
        background: rgba(0, 255, 65, 0.05);
        border-color: rgba(0, 255, 65, 0.12);
    }
    .thread-top {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        font-weight: 600;
        color: #cdf;
    }
    .thread-sub {
        display: flex;
        justify-content: space-between;
        color: #8aa;
        font-size: 12px;
        margin-top: 4px;
    }

    .no-threads,
    .no-messages,
    .no-message {
        padding: 20px;
        color: #88a;
    }

    /* Main panel */
    .threads-main {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        overflow: auto;
    }
    .thread-messages {
        display: flex;
        flex-direction: column;
        gap: 10px;
        overflow: auto;
        padding-bottom: 12px;
    }
    .message-row {
        padding: 8px;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.01);
        border: 1px solid rgba(255, 255, 255, 0.02);
    }
    .message-row.outgoing {
        align-self: flex-end;
        border-color: rgba(0, 200, 255, 0.06);
    }
    .message-row.incoming {
        align-self: flex-start;
        border-color: rgba(0, 255, 65, 0.02);
    }
    .msg-meta {
        display: flex;
        gap: 12px;
        font-size: 12px;
        color: #9aa;
        margin-bottom: 6px;
    }
    .msg-body {
        color: #cfc;
        font-size: 13px;
        white-space: pre-wrap;
    }

    .thread-actions,
    .message-actions {
        display: flex;
        gap: 10px;
        padding: 8px 0;
    }
    .action-btn {
        padding: 10px 12px;
        border-radius: 6px;
        border: 1px solid #00ff41;
        background: transparent;
        color: #00ff41;
        cursor: pointer;
        font-weight: 700;
    }
    .action-btn:hover {
        background: rgba(0, 255, 65, 0.06);
        transform: translateY(-2px);
    }

    .reply-box {
        border-top: 1px solid rgba(0, 255, 65, 0.06);
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        background: rgba(0, 0, 0, 0.2);
    }
    .reply-subject {
        padding: 8px;
        border-radius: 4px;
        border: 1px solid rgba(255, 255, 255, 0.04);
        background: #071014;
        color: #cfc;
    }
    .reply-text {
        min-height: 80px;
        max-height: 240px;
        padding: 8px;
        border-radius: 4px;
        border: 1px solid rgba(255, 255, 255, 0.04);
        background: #071014;
        color: #cfc;
        resize: vertical;
        font-family: inherit;
    }

    /* Single message */
    .single-main {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 12px;
        overflow: auto;
    }
    .single-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
    }
    .single-subject {
        font-size: 18px;
        font-weight: 700;
        color: #bdf;
    }
    .single-content {
        color: #cfc;
        white-space: pre-wrap;
        background: transparent;
        border: none;
    }

    /* Responsive */
    @media (max-width: 800px) {
        .threads-sidebar {
            display: none;
        }
        .message-dialog {
            width: 96%;
        }
    }
</style>
