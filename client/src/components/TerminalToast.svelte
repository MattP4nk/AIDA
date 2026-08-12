<script lang="ts">
    import { onDestroy } from "svelte";
    import {
        notifications,
        notificationService,
        type Notification,
    } from "../services/notifications";
    import { createEventDispatcher } from "svelte";

    const dispatch = createEventDispatcher();

    const MAX_VISIBLE = 3;
    const AUTO_DISMISS_MS: Record<string, number> = {
        low: 4000,
        normal: 5000,
        high: 8000,
        urgent: 0, // urgent persists until dismissed
    };

    interface ToastItem {
        notification: Notification;
        timer: ReturnType<typeof setTimeout> | null;
        entering: boolean;
        leaving: boolean;
    }

    let toasts: ToastItem[] = [];
    let seenIds = new Set<string>();

    // Watch for new notifications
    const unsubscribe = notifications.subscribe((allNotifs) => {
        for (const n of allNotifs) {
            if (n.read || seenIds.has(n.id)) continue;
            seenIds.add(n.id);
            addToast(n);
        }
        // Prevent seenIds from growing forever
        if (seenIds.size > 200) {
            // Keep IDs from current toasts + recent notifications
            const keepIds = new Set([
                ...toasts.map(t => t.notification.id),
                ...allNotifs.slice(0, 100).map((n) => n.id),
            ]);
            seenIds = keepIds;
        }
    });

    onDestroy(() => {
        unsubscribe();
        for (const t of toasts) {
            if (t.timer) clearTimeout(t.timer);
        }
    });

    function addToast(notification: Notification) {
        // Evict oldest if at max
        while (toasts.length >= MAX_VISIBLE) {
            dismissToast(toasts[0]!.notification.id, true);
        }

        const dismissMs = AUTO_DISMISS_MS[notification.priority] || AUTO_DISMISS_MS.normal!;
        const timer = dismissMs > 0
            ? setTimeout(() => dismissToast(notification.id, false), dismissMs)
            : null;

        toasts = [...toasts, { notification, timer, entering: true, leaving: false }];

        // Clear entering flag after animation
        setTimeout(() => {
            toasts = toasts.map((t) =>
                t.notification.id === notification.id ? { ...t, entering: false } : t,
            );
        }, 300);
    }

    function dismissToast(id: string, immediate: boolean) {
        if (immediate) {
            const t = toasts.find((t) => t.notification.id === id);
            if (t?.timer) clearTimeout(t.timer);
            toasts = toasts.filter((t) => t.notification.id !== id);
            return;
        }

        // Animate out
        toasts = toasts.map((t) =>
            t.notification.id === id ? { ...t, leaving: true } : t,
        );

        setTimeout(() => {
            const t = toasts.find((t) => t.notification.id === id);
            if (t?.timer) clearTimeout(t.timer);
            toasts = toasts.filter((t) => t.notification.id !== id);
        }, 250);
    }

    function handleClick(toast: ToastItem) {
        notificationService.markAsRead(toast.notification.id);
        dismissToast(toast.notification.id, false);

        if (toast.notification.action?.handler) {
            toast.notification.action.handler();
        }

        dispatch("toastClick", {
            notification: toast.notification,
            type: toast.notification.type,
            data: toast.notification.data,
            command: toast.notification.action?.command,
        });
    }

    function getIcon(type: string): string {
        switch (type) {
            case "chat": return "💬";
            case "mail": case "message": return "📧";
            case "forum": return "📋";
            case "game": return "🎯";
            case "system": return "⚙";
            default: return "🔔";
        }
    }

    function getAccentColor(priority: string): string {
        switch (priority) {
            case "urgent": return "#ff4444";
            case "high": return "#ffaa00";
            case "normal": return "#00cc33";
            case "low": return "#006622";
            default: return "#00cc33";
        }
    }

    function timeAgo(date: Date): string {
        const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
        if (seconds < 5) return "now";
        if (seconds < 60) return `${seconds}s`;
        const minutes = Math.floor(seconds / 60);
        return `${minutes}m`;
    }
</script>

{#if toasts.length > 0}
    <div class="toast-container">
        {#each toasts as toast (toast.notification.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
                class="toast"
                class:entering={toast.entering}
                class:leaving={toast.leaving}
                class:urgent={toast.notification.priority === "urgent"}
                style="border-left-color: {getAccentColor(toast.notification.priority)}"
                on:click={() => handleClick(toast)}
            >
                <div class="toast-header">
                    <span class="toast-icon">{getIcon(toast.notification.type)}</span>
                    <span class="toast-title">{toast.notification.title}</span>
                    <span class="toast-time">{timeAgo(toast.notification.timestamp)}</span>
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <span
                        class="toast-dismiss"
                        on:click|stopPropagation={() => dismissToast(toast.notification.id, false)}
                    >✕</span>
                </div>
                <div class="toast-message">{toast.notification.message}</div>
                {#if toast.notification.action?.command}
                    <div class="toast-action">
                        <span class="toast-action-label">{toast.notification.action.label || toast.notification.action.command}</span>
                    </div>
                {/if}
            </div>
        {/each}
    </div>
{/if}

<style>
    .toast-container {
        position: absolute;
        bottom: 80px;
        right: 20px;
        display: flex;
        flex-direction: column-reverse;
        gap: 6px;
        z-index: 50;
        pointer-events: none;
        max-width: 340px;
    }

    .toast {
        background: rgba(0, 12, 0, 0.95);
        border: 1px solid #0a3a0a;
        border-left: 3px solid #00cc33;
        border-radius: 3px;
        padding: 8px 12px;
        font-family: inherit;
        font-size: 0.8em;
        cursor: pointer;
        pointer-events: all;
        backdrop-filter: blur(4px);
        transition: opacity 0.25s, transform 0.25s;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
    }

    .toast:hover {
        background: rgba(0, 20, 0, 0.98);
        border-color: #00ff41;
    }

    .toast.entering {
        animation: toastSlideIn 0.3s ease-out;
    }

    .toast.leaving {
        opacity: 0;
        transform: translateX(100%);
    }

    .toast.urgent {
        animation: toastUrgentPulse 1.5s ease-in-out infinite;
        border-color: #ff4444;
    }

    .toast-header {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 3px;
    }

    .toast-icon {
        font-size: 1em;
    }

    .toast-title {
        flex: 1;
        color: #00ff41;
        font-weight: bold;
        font-size: 0.95em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .toast-time {
        color: #445;
        font-size: 0.85em;
    }

    .toast-dismiss {
        color: #444;
        cursor: pointer;
        padding: 0 2px;
        font-size: 0.9em;
    }

    .toast-dismiss:hover {
        color: #ff4444;
    }

    .toast-message {
        color: #00aa33;
        font-size: 0.9em;
        line-height: 1.3;
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
    }

    .toast-action {
        margin-top: 4px;
        padding-top: 4px;
        border-top: 1px dashed #0a3a0a;
    }

    .toast-action-label {
        color: #00ddaa;
        font-size: 0.85em;
        cursor: pointer;
        font-family: inherit;
    }

    .toast-action-label::before {
        content: "▸ ";
    }

    .toast-action-label:hover {
        color: #00ffcc;
        text-decoration: underline;
    }

    @keyframes toastSlideIn {
        from {
            opacity: 0;
            transform: translateX(100%);
        }
        to {
            opacity: 1;
            transform: translateX(0);
        }
    }

    @keyframes toastUrgentPulse {
        0%, 100% {
            border-color: #ff4444;
            box-shadow: 0 0 5px rgba(255, 68, 68, 0.3);
        }
        50% {
            border-color: #ff6666;
            box-shadow: 0 0 12px rgba(255, 68, 68, 0.6);
        }
    }
</style>
