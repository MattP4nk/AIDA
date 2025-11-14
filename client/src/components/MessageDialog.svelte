<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { generateAvatar, getCompactAvatar } from "../utils/asciiAvatars";

    export let visible = false;
    export let sender = "System";
    export let senderType: "player" | "npc" | "system" | "ai" = "system";
    export let subject = "";
    export let message = "";
    export let timestamp = new Date();
    export let unreadCount = 1;

    const dispatch = createEventDispatcher();

    function close() {
        visible = false;
        dispatch("close");
    }

    function reply() {
        dispatch("reply", { sender });
        close();
    }

    function deleteMessage() {
        dispatch("delete");
        close();
    }

    function handleKeydown(event: KeyboardEvent) {
        if (event.key === "Escape") {
            close();
        } else if (event.key === "Enter" && event.ctrlKey) {
            reply();
        }
    }

    $: avatar = generateAvatar(sender, senderType);
    $: compactAvatar = getCompactAvatar(avatar);
</script>

<svelte:window on:keydown={handleKeydown} />

{#if visible}
    <div class="message-overlay" on:click={close} role="dialog" aria-modal="true">
        <div class="message-dialog" on:click|stopPropagation role="document">
            <!-- Header with Avatar -->
            <div class="message-header">
                <div class="header-content">
                    <div class="avatar-section">
                        {#each compactAvatar as line}
                            <div class="avatar-line" style="color: {avatar.color}">
                                {line}
                            </div>
                        {/each}
                    </div>
                    <div class="sender-info">
                        <div class="sender-name" style="color: {avatar.color}">
                            {sender}
                        </div>
                        <div class="sender-type">[{senderType.toUpperCase()}]</div>
                        <div class="message-time">
                            {timestamp.toLocaleString()}
                        </div>
                        {#if unreadCount > 1}
                            <div class="unread-badge">
                                +{unreadCount - 1} more
                            </div>
                        {/if}
                    </div>
                </div>
                <button class="close-btn" on:click={close} aria-label="Close">
                    ✕
                </button>
            </div>

            <!-- Subject Line -->
            {#if subject}
                <div class="message-subject">
                    <span class="subject-label">Subject:</span>
                    <span class="subject-text">{subject}</span>
                </div>
            {/if}

            <!-- Message Body -->
            <div class="message-body">
                <div class="message-content">
                    {message}
                </div>
            </div>

            <!-- Actions -->
            <div class="message-actions">
                <button class="action-btn reply-btn" on:click={reply}>
                    <span class="btn-icon">↩</span>
                    Reply (Ctrl+Enter)
                </button>
                <button class="action-btn delete-btn" on:click={deleteMessage}>
                    <span class="btn-icon">🗑</span>
                    Delete
                </button>
                <button class="action-btn close-btn-footer" on:click={close}>
                    <span class="btn-icon">✓</span>
                    Close (Esc)
                </button>
            </div>
        </div>
    </div>
{/if}

<style>
    /* ==================== OVERLAY ==================== */

    .message-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.85);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        animation: fadeIn 0.2s ease-in;
    }

    @keyframes fadeIn {
        from {
            opacity: 0;
        }
        to {
            opacity: 1;
        }
    }

    /* ==================== DIALOG ==================== */

    .message-dialog {
        background: #0a0e14;
        border: 2px solid #00ff41;
        border-radius: 8px;
        box-shadow: 0 0 30px rgba(0, 255, 65, 0.5);
        max-width: 800px;
        width: 90%;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        animation: slideIn 0.3s ease-out;
        font-family: "Fira Code", "JetBrains Mono", "Courier New", monospace;
    }

    @keyframes slideIn {
        from {
            opacity: 0;
            transform: translateY(-20px) scale(0.95);
        }
        to {
            opacity: 1;
            transform: translateY(0) scale(1);
        }
    }

    /* ==================== HEADER ==================== */

    .message-header {
        background: linear-gradient(to bottom, #0d1117 0%, #0a0e14 100%);
        border-bottom: 2px solid #00ff41;
        padding: 20px;
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        position: relative;
    }

    .header-content {
        display: flex;
        gap: 20px;
        flex: 1;
    }

    .avatar-section {
        font-size: 12px;
        line-height: 1.2;
        white-space: pre;
        text-shadow: 0 0 10px currentColor;
    }

    .avatar-line {
        font-family: monospace;
    }

    .sender-info {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .sender-name {
        font-size: 20px;
        font-weight: bold;
        text-shadow: 0 0 10px currentColor;
    }

    .sender-type {
        font-size: 12px;
        color: #00ccff;
        opacity: 0.8;
        text-transform: uppercase;
        letter-spacing: 1px;
    }

    .message-time {
        font-size: 12px;
        color: #888;
        font-style: italic;
    }

    .unread-badge {
        display: inline-block;
        background: #ff4444;
        color: white;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: bold;
        animation: pulse 2s infinite;
    }

    @keyframes pulse {
        0%,
        100% {
            opacity: 1;
        }
        50% {
            opacity: 0.6;
        }
    }

    .close-btn {
        background: transparent;
        border: 1px solid #ff4444;
        color: #ff4444;
        width: 32px;
        height: 32px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
    }

    .close-btn:hover {
        background: #ff4444;
        color: white;
        transform: scale(1.1);
    }

    /* ==================== SUBJECT ==================== */

    .message-subject {
        padding: 15px 20px;
        border-bottom: 1px solid rgba(0, 255, 65, 0.2);
        background: rgba(0, 255, 65, 0.05);
    }

    .subject-label {
        color: #00ccff;
        font-weight: bold;
        margin-right: 10px;
    }

    .subject-text {
        color: #00ff41;
        font-size: 16px;
    }

    /* ==================== BODY ==================== */

    .message-body {
        flex: 1;
        overflow-y: auto;
        padding: 20px;
        background: #0a0e14;
    }

    .message-content {
        color: #c0c0c0;
        line-height: 1.8;
        white-space: pre-wrap;
        word-wrap: break-word;
        font-size: 14px;
    }

    .message-body::-webkit-scrollbar {
        width: 8px;
    }

    .message-body::-webkit-scrollbar-track {
        background: rgba(0, 0, 0, 0.3);
    }

    .message-body::-webkit-scrollbar-thumb {
        background: rgba(0, 255, 65, 0.5);
        border-radius: 4px;
    }

    .message-body::-webkit-scrollbar-thumb:hover {
        background: rgba(0, 255, 65, 0.7);
    }

    /* ==================== ACTIONS ==================== */

    .message-actions {
        display: flex;
        gap: 10px;
        padding: 15px 20px;
        border-top: 2px solid #00ff41;
        background: linear-gradient(to top, #0d1117 0%, #0a0e14 100%);
    }

    .action-btn {
        flex: 1;
        padding: 12px 20px;
        border: 1px solid #00ff41;
        background: transparent;
        color: #00ff41;
        border-radius: 4px;
        cursor: pointer;
        font-family: inherit;
        font-size: 14px;
        font-weight: bold;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        transition: all 0.2s ease;
        text-transform: uppercase;
        letter-spacing: 1px;
    }

    .action-btn:hover {
        background: rgba(0, 255, 65, 0.2);
        transform: translateY(-2px);
        box-shadow: 0 4px 10px rgba(0, 255, 65, 0.3);
    }

    .action-btn:active {
        transform: translateY(0);
    }

    .btn-icon {
        font-size: 16px;
    }

    .reply-btn {
        border-color: #00ccff;
        color: #00ccff;
    }

    .reply-btn:hover {
        background: rgba(0, 204, 255, 0.2);
        box-shadow: 0 4px 10px rgba(0, 204, 255, 0.3);
    }

    .delete-btn {
        border-color: #ff4444;
        color: #ff4444;
    }

    .delete-btn:hover {
        background: rgba(255, 68, 68, 0.2);
        box-shadow: 0 4px 10px rgba(255, 68, 68, 0.3);
    }

    /* ==================== RESPONSIVE ==================== */

    @media (max-width: 768px) {
        .message-dialog {
            width: 95%;
            max-height: 90vh;
        }

        .header-content {
            flex-direction: column;
            gap: 10px;
        }

        .message-actions {
            flex-direction: column;
        }

        .action-btn {
            width: 100%;
        }

        .sender-name {
            font-size: 16px;
        }
    }

    @media (max-width: 480px) {
        .avatar-section {
            font-size: 10px;
        }

        .message-subject {
            padding: 10px 15px;
        }

        .message-body {
            padding: 15px;
        }

        .message-actions {
            padding: 10px 15px;
        }
    }

    /* ==================== ACCESSIBILITY ==================== */

    @media (prefers-reduced-motion: reduce) {
        .message-overlay,
        .message-dialog {
            animation: none;
        }

        .unread-badge {
            animation: none;
        }
    }
</style>
