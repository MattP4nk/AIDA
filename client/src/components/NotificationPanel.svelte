<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import {
        notifications,
        unreadCounts,
        notificationService,
        getNotificationIcon,
        getNotificationColor,
        formatNotificationTime,
        type Notification,
    } from "../services/notifications";
    import { createEventDispatcher } from "svelte";

    const dispatch = createEventDispatcher();

    // ==================== PROPS ====================

    export let visible: boolean = false;
    export let position: "top-right" | "bottom-right" | "top-left" | "bottom-left" = "top-right";

    // ==================== STATE ====================

    let filterType: "all" | "message" | "chat" | "mail" | "forum" | "system" | "game" = "all";
    let showReadNotifications = false;
    let selectedNotification: Notification | null = null;

    $: filteredNotifications = $notifications.filter((n) => {
        if (filterType !== "all" && n.type !== filterType) return false;
        if (!showReadNotifications && n.read) return false;
        return true;
    });

    // ==================== LIFECYCLE ====================

    onMount(() => {
        // Auto-refresh counts
        const interval = setInterval(() => {
            // Trigger reactive updates
            notifications.update((n) => n);
        }, 30000); // Every 30 seconds

        return () => clearInterval(interval);
    });

    // ==================== EVENT HANDLERS ====================

    function handleNotificationClick(notification: Notification): void {
        selectedNotification = notification;
        notificationService.markAsRead(notification.id);

        // Dispatch event for parent to handle
        dispatch("notificationClick", {
            notification,
            type: notification.type,
            data: notification.data,
        });

        // Execute action if available
        if (notification.action) {
            notification.action.handler();
        }
    }

    function handleMarkAllRead(): void {
        if (filterType === "all") {
            notificationService.markAllAsRead();
        } else {
            notificationService.markAllAsRead(filterType as any);
        }
    }

    function handleClearAll(): void {
        if (confirm("Clear all notifications?")) {
            if (filterType === "all") {
                notificationService.clearAll();
            } else {
                notificationService.clearAll(filterType as any);
            }
        }
    }

    function handleDismiss(notificationId: string, event: MouseEvent): void {
        event.stopPropagation();
        notificationService.remove(notificationId);
    }

    function close(): void {
        visible = false;
        dispatch("close");
    }

    function handleKeydown(event: KeyboardEvent): void {
        if (!visible) return;

        if (event.key === "Escape") {
            event.preventDefault();
            close();
        }
    }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if visible}
    <div class="notification-panel-overlay" on:click={close}>
        <div
            class="notification-panel {position}"
            on:click|stopPropagation
        >
            <!-- Header -->
            <div class="panel-header">
                <div class="panel-title">
                    <span class="title-icon">🔔</span>
                    <span class="title-text">NOTIFICATIONS</span>
                    {#if $unreadCounts.total > 0}
                        <span class="unread-badge">{$unreadCounts.total}</span>
                    {/if}
                </div>
                <button class="close-btn" on:click={close} title="Close">✕</button>
            </div>

            <!-- Filter Tabs -->
            <div class="filter-tabs">
                <button
                    class="filter-tab"
                    class:active={filterType === "all"}
                    on:click={() => (filterType = "all")}
                >
                    All
                    {#if $unreadCounts.total > 0}
                        <span class="tab-badge">{$unreadCounts.total}</span>
                    {/if}
                </button>
                <button
                    class="filter-tab"
                    class:active={filterType === "chat"}
                    on:click={() => (filterType = "chat")}
                >
                    💬 Chat
                    {#if $unreadCounts.chat > 0}
                        <span class="tab-badge">{$unreadCounts.chat}</span>
                    {/if}
                </button>
                <button
                    class="filter-tab"
                    class:active={filterType === "mail"}
                    on:click={() => (filterType = "mail")}
                >
                    📧 Mail
                    {#if $unreadCounts.mail > 0}
                        <span class="tab-badge">{$unreadCounts.mail}</span>
                    {/if}
                </button>
                <button
                    class="filter-tab"
                    class:active={filterType === "forum"}
                    on:click={() => (filterType = "forum")}
                >
                    📋 Forum
                    {#if $unreadCounts.forum > 0}
                        <span class="tab-badge">{$unreadCounts.forum}</span>
                    {/if}
                </button>
            </div>

            <!-- Actions Bar -->
            <div class="actions-bar">
                <label class="checkbox-label">
                    <input
                        type="checkbox"
                        bind:checked={showReadNotifications}
                    />
                    <span>Show read</span>
                </label>
                <div class="action-buttons">
                    <button
                        class="action-btn"
                        on:click={handleMarkAllRead}
                        disabled={filteredNotifications.filter((n) => !n.read).length === 0}
                    >
                        Mark all read
                    </button>
                    <button
                        class="action-btn danger"
                        on:click={handleClearAll}
                        disabled={filteredNotifications.length === 0}
                    >
                        Clear all
                    </button>
                </div>
            </div>

            <!-- Notifications List -->
            <div class="notifications-list">
                {#if filteredNotifications.length === 0}
                    <div class="empty-state">
                        <div class="empty-icon">📭</div>
                        <div class="empty-text">No notifications</div>
                        {#if !showReadNotifications && $notifications.some((n) => n.read)}
                            <div class="empty-hint">
                                Enable "Show read" to see older notifications
                            </div>
                        {/if}
                    </div>
                {:else}
                    {#each filteredNotifications as notification (notification.id)}
                        <div
                            class="notification-item"
                            class:unread={!notification.read}
                            class:selected={selectedNotification?.id === notification.id}
                            on:click={() => handleNotificationClick(notification)}
                        >
                            <div class="notif-header">
                                <span
                                    class="notif-icon"
                                    style="color: {getNotificationColor(notification.priority)}"
                                >
                                    {getNotificationIcon(notification.type)}
                                </span>
                                <span class="notif-title">{notification.title}</span>
                                <span class="notif-time">
                                    {formatNotificationTime(notification.timestamp)}
                                </span>
                                <button
                                    class="dismiss-btn"
                                    on:click={(e) => handleDismiss(notification.id, e)}
                                    title="Dismiss"
                                >
                                    ✕
                                </button>
                            </div>
                            <div class="notif-message">{notification.message}</div>
                            {#if notification.priority === "high" || notification.priority === "urgent"}
                                <div class="notif-priority {notification.priority}">
                                    {notification.priority.toUpperCase()}
                                </div>
                            {/if}
                        </div>
                    {/each}
                {/if}
            </div>

            <!-- Footer -->
            <div class="panel-footer">
                <div class="footer-stats">
                    {filteredNotifications.length} notification{filteredNotifications.length !== 1 ? "s" : ""}
                </div>
                <div class="footer-hint">
                    Press ESC to close
                </div>
            </div>
        </div>
    </div>
{/if}

<style>
    .notification-panel-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: flex-start;
        justify-content: flex-end;
        z-index: 9999;
        padding: 1rem;
        backdrop-filter: blur(2px);
    }

    .notification-panel {
        background: #001a1a;
        border: 2px solid #00ff00;
        border-radius: 4px;
        box-shadow: 0 0 20px rgba(0, 255, 0, 0.3),
                    inset 0 0 50px rgba(0, 255, 0, 0.05);
        font-family: "IBM Plex Mono", "Courier New", monospace;
        color: #00ff00;
        width: 450px;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        animation: slideIn 0.3s ease-out;
    }

    .notification-panel.top-right {
        margin-top: 0;
    }

    .notification-panel.bottom-right {
        margin-top: auto;
    }

    .notification-panel.top-left {
        margin-right: auto;
    }

    .notification-panel.bottom-left {
        margin-top: auto;
        margin-right: auto;
    }

    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }

    /* Header */
    .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 1rem;
        border-bottom: 1px solid #00ff00;
        background: rgba(0, 255, 0, 0.05);
    }

    .panel-title {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 1.1rem;
        font-weight: bold;
        text-transform: uppercase;
    }

    .title-icon {
        font-size: 1.2rem;
    }

    .unread-badge {
        background: #ff0000;
        color: #ffffff;
        border-radius: 12px;
        padding: 0.1rem 0.5rem;
        font-size: 0.8rem;
        font-weight: bold;
    }

    .close-btn {
        background: none;
        border: 1px solid #00ff00;
        color: #00ff00;
        font-size: 1.2rem;
        cursor: pointer;
        padding: 0.2rem 0.5rem;
        line-height: 1;
        transition: all 0.2s;
    }

    .close-btn:hover {
        background: #00ff00;
        color: #001a1a;
    }

    /* Filter Tabs */
    .filter-tabs {
        display: flex;
        gap: 0.25rem;
        padding: 0.5rem;
        background: rgba(0, 0, 0, 0.3);
        border-bottom: 1px solid #004400;
    }

    .filter-tab {
        flex: 1;
        background: none;
        border: 1px solid #004400;
        color: #008800;
        padding: 0.4rem 0.5rem;
        font-size: 0.85rem;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.25rem;
        font-family: inherit;
    }

    .filter-tab:hover {
        background: rgba(0, 255, 0, 0.1);
        color: #00ff00;
    }

    .filter-tab.active {
        background: rgba(0, 255, 0, 0.2);
        border-color: #00ff00;
        color: #00ff00;
        font-weight: bold;
    }

    .tab-badge {
        background: #00ff00;
        color: #001a1a;
        border-radius: 10px;
        padding: 0 0.4rem;
        font-size: 0.7rem;
        font-weight: bold;
    }

    /* Actions Bar */
    .actions-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.5rem 1rem;
        background: rgba(0, 0, 0, 0.2);
        border-bottom: 1px solid #004400;
    }

    .checkbox-label {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        color: #008800;
        font-size: 0.9rem;
        cursor: pointer;
    }

    .checkbox-label input[type="checkbox"] {
        cursor: pointer;
        accent-color: #00ff00;
    }

    .action-buttons {
        display: flex;
        gap: 0.5rem;
    }

    .action-btn {
        background: none;
        border: 1px solid #008800;
        color: #008800;
        padding: 0.3rem 0.6rem;
        font-size: 0.8rem;
        cursor: pointer;
        transition: all 0.2s;
        font-family: inherit;
    }

    .action-btn:hover:not(:disabled) {
        background: rgba(0, 255, 0, 0.1);
        border-color: #00ff00;
        color: #00ff00;
    }

    .action-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
    }

    .action-btn.danger:hover:not(:disabled) {
        background: rgba(255, 0, 0, 0.1);
        border-color: #ff6600;
        color: #ff6600;
    }

    /* Notifications List */
    .notifications-list {
        flex: 1;
        overflow-y: auto;
        padding: 0.5rem;
        background: rgba(0, 0, 0, 0.2);
    }

    .notifications-list::-webkit-scrollbar {
        width: 8px;
    }

    .notifications-list::-webkit-scrollbar-track {
        background: rgba(0, 0, 0, 0.3);
    }

    .notifications-list::-webkit-scrollbar-thumb {
        background: #004400;
        border-radius: 4px;
    }

    .notifications-list::-webkit-scrollbar-thumb:hover {
        background: #008800;
    }

    .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 3rem 1rem;
        color: #006600;
        text-align: center;
    }

    .empty-icon {
        font-size: 3rem;
        margin-bottom: 1rem;
        opacity: 0.5;
    }

    .empty-text {
        font-size: 1.1rem;
        margin-bottom: 0.5rem;
    }

    .empty-hint {
        font-size: 0.85rem;
        opacity: 0.7;
    }

    /* Notification Item */
    .notification-item {
        background: rgba(0, 50, 50, 0.3);
        border: 1px solid #004400;
        padding: 0.75rem;
        margin-bottom: 0.5rem;
        cursor: pointer;
        transition: all 0.2s;
        position: relative;
    }

    .notification-item.unread {
        background: rgba(0, 100, 100, 0.2);
        border-color: #008800;
        border-left-width: 3px;
    }

    .notification-item:hover {
        background: rgba(0, 255, 0, 0.1);
        border-color: #00ff00;
    }

    .notification-item.selected {
        background: rgba(0, 255, 0, 0.15);
        border-color: #00ff00;
    }

    .notif-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
    }

    .notif-icon {
        font-size: 1.2rem;
    }

    .notif-title {
        flex: 1;
        font-weight: bold;
        font-size: 0.95rem;
    }

    .notif-time {
        color: #006600;
        font-size: 0.75rem;
    }

    .dismiss-btn {
        background: none;
        border: none;
        color: #004400;
        cursor: pointer;
        padding: 0.1rem 0.3rem;
        font-size: 1rem;
        line-height: 1;
        transition: color 0.2s;
    }

    .dismiss-btn:hover {
        color: #ff6600;
    }

    .notif-message {
        color: #00bcd4;
        font-size: 0.9rem;
        line-height: 1.4;
        word-wrap: break-word;
    }

    .notif-priority {
        margin-top: 0.5rem;
        padding: 0.2rem 0.5rem;
        font-size: 0.7rem;
        font-weight: bold;
        display: inline-block;
        border-radius: 2px;
    }

    .notif-priority.high {
        background: rgba(255, 102, 0, 0.2);
        border: 1px solid #ff6600;
        color: #ff6600;
    }

    .notif-priority.urgent {
        background: rgba(255, 0, 0, 0.2);
        border: 1px solid #ff0000;
        color: #ff0000;
        animation: pulse 1s infinite;
    }

    @keyframes pulse {
        0%, 100% {
            opacity: 1;
        }
        50% {
            opacity: 0.6;
        }
    }

    /* Footer */
    .panel-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.75rem 1rem;
        border-top: 1px solid #004400;
        background: rgba(0, 0, 0, 0.3);
        font-size: 0.85rem;
    }

    .footer-stats {
        color: #008800;
    }

    .footer-hint {
        color: #006600;
    }
</style>
