<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import type { TerminalTab } from "../../../shared/types";

    export let tabs: TerminalTab[] = [];
    export let activeTabId: string = "";

    const dispatch = createEventDispatcher();

    function switchTab(tabId: string) {
        if (tabId !== activeTabId) {
            dispatch("switch", { tabId });
        }
    }

    function closeTab(event: MouseEvent, tabId: string) {
        event.stopPropagation();
        if (tabs.length > 1) {
            dispatch("close", { tabId });
        }
    }

    function createTab() {
        dispatch("create");
    }

    function handleKeydown(event: KeyboardEvent, tabId: string) {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            switchTab(tabId);
        }
    }

    function handleCloseKeydown(event: KeyboardEvent, tabId: string) {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            closeTab(event as any, tabId);
        }
    }

    function getTabLabel(tab: TerminalTab): string {
        if (tab.isProcessing && tab.processingCommand) {
            return `${tab.label} [${tab.processingCommand}...]`;
        }
        return tab.label;
    }

    function getTabIcon(tab: TerminalTab): string {
        if (tab.isProcessing) {
            return "⚙️";
        }
        return "▸";
    }
</script>

<div class="terminal-tabs">
    <div class="tabs-list" role="tablist">
        {#each tabs as tab (tab.id)}
            <div
                class="tab"
                class:active={tab.id === activeTabId}
                class:processing={tab.isProcessing}
                role="tab"
                aria-selected={tab.id === activeTabId}
                tabindex={tab.id === activeTabId ? 0 : -1}
                on:click={() => switchTab(tab.id)}
                on:keydown={(e) => handleKeydown(e, tab.id)}
            >
                <span class="tab-icon">{getTabIcon(tab)}</span>
                <span class="tab-label">{getTabLabel(tab)}</span>
                {#if tabs.length > 1}
                    <button
                        class="tab-close"
                        on:click={(e) => closeTab(e, tab.id)}
                        on:keydown={(e) => handleCloseKeydown(e, tab.id)}
                        aria-label="Close tab"
                        title="Close terminal (Ctrl+W)"
                    >
                        ✕
                    </button>
                {/if}
            </div>
        {/each}
        <button
            class="tab-new"
            on:click={createTab}
            aria-label="New terminal"
            title="New terminal (Ctrl+T)"
        >
            <span class="tab-new-icon">+</span>
        </button>
    </div>
</div>

<style>
    .terminal-tabs {
        width: 100%;
        background: #0a0e14;
        border-bottom: 1px solid #00ff41;
        padding: 0;
        user-select: none;
    }

    .tabs-list {
        display: flex;
        align-items: center;
        overflow-x: auto;
        overflow-y: hidden;
        gap: 2px;
        padding: 4px 8px;
        scrollbar-width: thin;
        scrollbar-color: #00ff41 #0a0e14;
    }

    .tabs-list::-webkit-scrollbar {
        height: 4px;
    }

    .tabs-list::-webkit-scrollbar-track {
        background: #0a0e14;
    }

    .tabs-list::-webkit-scrollbar-thumb {
        background: #00ff41;
        border-radius: 2px;
    }

    .tab {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        background: #0d1117;
        border: 1px solid #1a3a1a;
        border-radius: 4px 4px 0 0;
        color: #00cc33;
        font-family: "Courier New", monospace;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s ease;
        white-space: nowrap;
        min-width: 120px;
        max-width: 200px;
        position: relative;
    }

    .tab:hover {
        background: #161b22;
        border-color: #00ff41;
        color: #00ff41;
    }

    .tab:focus {
        outline: 2px solid #00ff41;
        outline-offset: -2px;
    }

    .tab.active {
        background: #0a0e14;
        border-color: #00ff41;
        color: #00ff41;
        border-bottom: 1px solid #0a0e14;
        font-weight: bold;
    }

    .tab.processing {
        border-color: #ffaa00;
        animation: pulse 1.5s ease-in-out infinite;
    }

    .tab.processing .tab-icon {
        animation: spin 2s linear infinite;
    }

    @keyframes pulse {
        0%,
        100% {
            border-color: #ffaa00;
        }
        50% {
            border-color: #ff6600;
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

    .tab-icon {
        font-size: 10px;
        display: inline-block;
    }

    .tab-label {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .tab-close {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        padding: 0;
        background: transparent;
        border: none;
        color: #00cc33;
        font-size: 12px;
        cursor: pointer;
        border-radius: 3px;
        transition: all 0.2s ease;
        opacity: 0.6;
    }

    .tab-close:hover {
        background: #ff4444;
        color: #ffffff;
        opacity: 1;
    }

    .tab-close:focus {
        outline: 2px solid #00ff41;
        outline-offset: 1px;
        opacity: 1;
    }

    .tab-new {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        padding: 0;
        background: #0d1117;
        border: 1px solid #1a3a1a;
        border-radius: 4px;
        color: #00cc33;
        font-size: 18px;
        cursor: pointer;
        transition: all 0.2s ease;
        flex-shrink: 0;
        margin-left: 4px;
    }

    .tab-new:hover {
        background: #161b22;
        border-color: #00ff41;
        color: #00ff41;
        transform: scale(1.1);
    }

    .tab-new:focus {
        outline: 2px solid #00ff41;
        outline-offset: 1px;
    }

    .tab-new:active {
        transform: scale(0.95);
    }

    .tab-new-icon {
        font-weight: bold;
        line-height: 1;
    }

    /* Responsive adjustments */
    @media (max-width: 768px) {
        .tab {
            min-width: 100px;
            max-width: 150px;
            padding: 4px 8px;
            font-size: 11px;
        }

        .tab-label {
            font-size: 11px;
        }

        .tab-new {
            width: 28px;
            height: 28px;
            font-size: 16px;
        }
    }

    @media (max-width: 480px) {
        .terminal-tabs {
            padding: 0;
        }

        .tabs-list {
            padding: 2px 4px;
            gap: 1px;
        }

        .tab {
            min-width: 80px;
            max-width: 120px;
            padding: 4px 6px;
            font-size: 10px;
        }

        .tab-close {
            width: 14px;
            height: 14px;
            font-size: 10px;
        }

        .tab-new {
            width: 24px;
            height: 24px;
            font-size: 14px;
            margin-left: 2px;
        }
    }

    /* Accessibility: Reduced motion */
    @media (prefers-reduced-motion: reduce) {
        .tab,
        .tab-close,
        .tab-new {
            transition: none;
        }

        .tab.processing,
        .tab.processing .tab-icon {
            animation: none;
        }
    }

    /* High contrast mode */
    @media (prefers-contrast: high) {
        .tab {
            border-width: 2px;
        }

        .tab.active {
            background: #000000;
            border-color: #00ff00;
            color: #00ff00;
        }

        .tab-close:hover {
            background: #ff0000;
            color: #ffffff;
        }
    }
</style>
