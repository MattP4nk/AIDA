<script lang="ts">
    import { onDestroy } from "svelte";
    import { activeProcesses } from "../services/socket";

    // Local ETA countdown — initialized once per process, then ticks locally
    let localETAs: Map<number, number> = new Map();
    let knownPids: Set<number> = new Set(); // tracks which PIDs we've already initialized
    let expanded = true;

    const tickInterval = setInterval(() => {
        let changed = false;
        for (const [pid, eta] of localETAs) {
            if (eta > 0) {
                localETAs.set(pid, eta - 1);
                changed = true;
            }
        }
        if (changed) {
            localETAs = new Map(localETAs); // trigger reactivity
        }
    }, 1000);

    onDestroy(() => clearInterval(tickInterval));

    // Initialize ETA only for NEW processes (never overwrite from progress updates)
    $: {
        const activePids = new Set<number>();
        for (const proc of $activeProcesses) {
            activePids.add(proc.pid);
            // Only set ETA on first appearance (process:started)
            if (!knownPids.has(proc.pid)) {
                knownPids.add(proc.pid);
                localETAs.set(proc.pid, proc.eta ?? 0);
            }
        }
        // Clean up PIDs no longer active
        for (const pid of knownPids) {
            if (!activePids.has(pid)) {
                knownPids.delete(pid);
                localETAs.delete(pid);
            }
        }
    }

    function getProgressBar(progress: number, width: number = 20): string {
        const filled = Math.round((progress / 100) * width);
        const empty = width - filled;
        return "█".repeat(filled) + "░".repeat(empty);
    }

    function getTypeIcon(type: string): string {
        switch (type) {
            case "hack_prep": return "⚔";
            case "scan": return "📡";
            case "download": return "⬇";
            case "decrypt": return "🔓";
            case "backdoor_install": return "🚪";
            case "traceroute": return "🔍";
            case "trace_evade": return "👻";
            case "hack_challenge": return "🔐";
            case "connection_challenge": return "🔗";
            default: return "⚙";
        }
    }

    function formatType(type: string): string {
        return type.replace(/_/g, " ");
    }
</script>

{#if $activeProcesses.length > 0}
    <div class="process-bar">
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="process-bar-header" on:click={() => expanded = !expanded}>
            <span class="process-icon">⚙</span>
            <span class="process-count">{$activeProcesses.length} process{$activeProcesses.length !== 1 ? "es" : ""}</span>
            <span class="process-toggle">{expanded ? "▾" : "▸"}</span>
        </div>

        {#if expanded}
            {#each $activeProcesses as proc (proc.pid)}
                {@const progress = proc.progress ?? 0}
                {@const eta = localETAs.get(proc.pid) ?? 0}
                {@const urgency = eta <= 3 ? "critical" : eta <= 10 ? "warning" : "normal"}
                <div class="process-row">
                    <span class="proc-icon">{getTypeIcon(proc.type)}</span>
                    <span class="proc-label">{proc.description || formatType(proc.type)}</span>
                    <span class="proc-bar" class:warning={urgency === "warning"} class:critical={urgency === "critical"}>
                        {getProgressBar(progress, 16)}
                    </span>
                    <span class="proc-pct">{progress}%</span>
                    <span class="proc-eta" class:warning={urgency === "warning"} class:critical={urgency === "critical"}>
                        {eta > 0 ? `${eta}s` : "..."}
                    </span>
                    <span class="proc-pid">PID {proc.pid}</span>
                </div>
            {/each}
        {/if}
    </div>
{/if}

<style>
    .process-bar {
        border-top: 1px solid #0a2a0a;
        background: rgba(0, 10, 0, 0.9);
        font-family: inherit;
        font-size: 0.8em;
        padding: 2px 20px;
    }

    .process-bar-header {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 2px 0;
        cursor: pointer;
        color: #00aa33;
        user-select: none;
    }

    .process-bar-header:hover {
        color: #00ff41;
    }

    .process-icon {
        animation: spin 2s linear infinite;
    }

    .process-count {
        flex: 1;
        font-size: 0.9em;
    }

    .process-toggle {
        color: #555;
    }

    .process-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 1px 0;
        color: #00cc33;
        animation: fadeIn 0.2s ease-out;
    }

    .proc-icon {
        width: 16px;
        text-align: center;
    }

    .proc-label {
        min-width: 100px;
        max-width: 160px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: #00aa44;
    }

    .proc-bar {
        font-family: inherit;
        letter-spacing: -1px;
        color: #00ff41;
    }

    .proc-bar.warning {
        color: #ffaa00;
    }

    .proc-bar.critical {
        color: #ff4444;
        animation: pulse 0.5s ease-in-out infinite alternate;
    }

    .proc-pct {
        width: 32px;
        text-align: right;
        color: #00aa33;
        font-size: 0.9em;
    }

    .proc-eta {
        width: 36px;
        text-align: right;
        color: #008822;
        font-size: 0.9em;
    }

    .proc-eta.warning {
        color: #ffaa00;
    }

    .proc-eta.critical {
        color: #ff4444;
        font-weight: bold;
    }

    .proc-pid {
        color: #444;
        font-size: 0.85em;
        margin-left: auto;
    }

    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }

    @keyframes fadeIn {
        from { opacity: 0; transform: translateY(-4px); }
        to { opacity: 1; transform: translateY(0); }
    }

    @keyframes pulse {
        from { opacity: 1; }
        to { opacity: 0.5; }
    }
</style>
