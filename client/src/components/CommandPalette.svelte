<script lang="ts">
    import { createEventDispatcher, onMount, tick } from "svelte";

    export let visible = false;
    export let commands: Array<{ name: string; description: string; category: string }> = [];

    const dispatch = createEventDispatcher();

    let searchInput = "";
    let searchElement: HTMLInputElement;
    let selectedIndex = 0;

    $: filtered = searchInput.trim()
        ? commands.filter(
              (cmd) =>
                  cmd.name.includes(searchInput.toLowerCase()) ||
                  cmd.description.toLowerCase().includes(searchInput.toLowerCase()) ||
                  cmd.category.toLowerCase().includes(searchInput.toLowerCase()),
          )
        : commands.slice(0, 20);

    $: if (filtered.length > 0 && selectedIndex >= filtered.length) {
        selectedIndex = 0;
    }

    $: if (visible) {
        searchInput = "";
        selectedIndex = 0;
        tick().then(() => searchElement?.focus());
    }

    function handleKeydown(event: KeyboardEvent) {
        if (event.key === "Escape") {
            event.preventDefault();
            dispatch("close");
            return;
        }

        if (event.key === "ArrowDown") {
            event.preventDefault();
            selectedIndex = (selectedIndex + 1) % filtered.length;
            return;
        }

        if (event.key === "ArrowUp") {
            event.preventDefault();
            selectedIndex = (selectedIndex - 1 + filtered.length) % filtered.length;
            return;
        }

        if (event.key === "Enter") {
            event.preventDefault();
            const selected = filtered[selectedIndex];
            if (selected) {
                dispatch("select", { command: selected.name });
                dispatch("close");
            }
            return;
        }
    }

    function getCategoryColor(category: string): string {
        switch (category) {
            case "system": return "#00bcd4";
            case "network": return "#4caf50";
            case "hack": return "#ff5722";
            case "file": return "#2196f3";
            case "social": return "#9c27b0";
            case "shop": return "#ff9800";
            case "mission": return "#ffeb3b";
            case "fragment": return "#e91e63";
            case "player": return "#00bcd4";
            case "process": return "#607d8b";
            case "math": return "#795548";
            case "defense": return "#f44336";
            default: return "#888";
        }
    }
</script>

{#if visible}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="palette-overlay" on:click={() => dispatch("close")}>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="palette" on:click|stopPropagation>
            <div class="palette-input-row">
                <span class="palette-icon">></span>
                <input
                    bind:this={searchElement}
                    bind:value={searchInput}
                    on:keydown={handleKeydown}
                    class="palette-input"
                    type="text"
                    placeholder="Search commands..."
                    spellcheck="false"
                    autocomplete="off"
                />
            </div>

            <div class="palette-results">
                {#each filtered as cmd, i (cmd.name)}
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div
                        class="palette-item"
                        class:selected={i === selectedIndex}
                        on:click={() => {
                            dispatch("select", { command: cmd.name });
                            dispatch("close");
                        }}
                    >
                        <span class="palette-cmd">{cmd.name}</span>
                        <span class="palette-cat" style="color: {getCategoryColor(cmd.category)}">{cmd.category}</span>
                        <span class="palette-desc">{cmd.description}</span>
                    </div>
                {/each}

                {#if filtered.length === 0}
                    <div class="palette-empty">No commands match "{searchInput}"</div>
                {/if}
            </div>

            <div class="palette-footer">
                <span>↑↓ navigate</span>
                <span>Enter select</span>
                <span>Esc close</span>
            </div>
        </div>
    </div>
{/if}

<style>
    .palette-overlay {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.6);
        z-index: 100;
        display: flex;
        justify-content: center;
        padding-top: 60px;
    }

    .palette {
        background: #0a0e14;
        border: 1px solid #00ff41;
        border-radius: 4px;
        width: 500px;
        max-width: 90vw;
        max-height: 400px;
        display: flex;
        flex-direction: column;
        box-shadow: 0 4px 20px rgba(0, 255, 65, 0.2);
        font-family: inherit;
        align-self: flex-start;
    }

    .palette-input-row {
        display: flex;
        align-items: center;
        padding: 10px 14px;
        border-bottom: 1px solid #1a3a1a;
        gap: 8px;
    }

    .palette-icon {
        color: #00ff41;
        font-size: 1.1em;
        font-weight: bold;
    }

    .palette-input {
        flex: 1;
        background: transparent;
        border: none;
        outline: none;
        color: #00ff41;
        font-family: inherit;
        font-size: 14px;
    }

    .palette-input::placeholder {
        color: #335;
    }

    .palette-results {
        overflow-y: auto;
        flex: 1;
        max-height: 300px;
    }

    .palette-item {
        padding: 6px 14px;
        display: flex;
        align-items: center;
        gap: 10px;
        cursor: pointer;
        font-size: 0.85em;
    }

    .palette-item:hover,
    .palette-item.selected {
        background: rgba(0, 255, 65, 0.1);
    }

    .palette-cmd {
        color: #00ff41;
        font-weight: bold;
        min-width: 120px;
    }

    .palette-cat {
        font-size: 0.8em;
        min-width: 60px;
    }

    .palette-desc {
        color: #557;
        font-size: 0.85em;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
    }

    .palette-empty {
        padding: 20px;
        text-align: center;
        color: #445;
    }

    .palette-footer {
        padding: 6px 14px;
        border-top: 1px solid #1a3a1a;
        display: flex;
        gap: 16px;
        font-size: 0.75em;
        color: #445;
    }

    /* Scrollbar */
    .palette-results::-webkit-scrollbar {
        width: 4px;
    }
    .palette-results::-webkit-scrollbar-thumb {
        background: #1a3a1a;
        border-radius: 2px;
    }
</style>
