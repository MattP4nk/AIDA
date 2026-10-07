<!--
  The terminal's status bar: tab strip on the left, connection / resources /
  unread / clock on the right.

  A8: split out of Terminal.svelte (2,867 lines, ~970 of them CSS). Markup and
  its CSS moved verbatim — including the status rules inside the parent's
  @media blocks, which keep the same queries here. The four inline handlers
  became callbacks, because switching or closing a tab also scrolls and
  refocuses the terminal, which is the parent's job. Shared keyframes (pulse,
  spin) are copied: Svelte scopes @keyframes names per component.
-->
<script lang="ts">
    export let tabs: Array<{ id: string; label: string; isProcessing?: boolean; processingCommand?: string }> = [];
    export let activeTabId: string | null = null;
    export let username: string;
    export let currentServer: string;
    export let connectionQuality: number;
    export let cpuPercent: number;
    export let ramPercent: number;
    export let unreadCount: number;
    export let unreadChatCount: number;
    export let unreadMailCount: number;
    export let currentTime: string;

    export let onSwitchTab: (tabId: string) => void;
    export let onCloseTab: (tabId: string) => void;
    export let onNewTab: () => void;
    export let onNotificationClick: () => void;
</script>

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
                    on:click={() => onSwitchTab(tab.id)}
                    on:keydown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onSwitchTab(tab.id);
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
                            on:click|stopPropagation={() => onCloseTab(tab.id)}
                            title="Close tab (Ctrl+W)"
                            aria-label="Close tab">✕</button
                        >
                    {/if}
                </div>
            {/each}
            <button
                class="status-item tab-new"
                on:click={onNewTab}
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
                on:click={onNotificationClick}
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

<style>

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
    }

    @media (max-width: 480px) {

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

    /* ==================== PRINT STYLES ==================== */

    @media print {

        .status-bar {
            display: none;
        }
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
    @keyframes spin {
        from {
            transform: rotate(0deg);
        }
        to {
            transform: rotate(360deg);
        }
    }
</style>
