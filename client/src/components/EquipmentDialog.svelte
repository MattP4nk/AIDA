<script lang="ts">
    import { onMount } from "svelte";
    import { apiClient } from "../services/api";

    export let visible = false;
    export let onClose: () => void;

    interface ShopItem {
        id: string;
        name: string;
        description: string;
        category: string;
        price: number;
        requiredLevel: number;
        effects?: {
            hackingBonus?: number;
            stealthBonus?: number;
            speedBonus?: number;
            detectionReduction?: number;
            successRateIncrease?: number;
            xpMultiplier?: number;
            creditsMultiplier?: number;
        };
        rarity: string;
        isConsumable: boolean;
    }

    interface InventoryItem {
        itemId: string;
        item: ShopItem;
        quantity: number;
        acquiredAt: Date;
    }

    interface Equipment {
        TOOL?: string;
        SOFTWARE?: string;
        EXPLOIT?: string;
        DEFENSE?: string;
        UPGRADE?: string;
    }

    interface Bonuses {
        hackingBonus: number;
        stealthBonus: number;
        speedBonus: number;
        detectionReduction: number;
        successRateIncrease: number;
        xpMultiplier: number;
        creditsMultiplier: number;
    }

    let inventory: InventoryItem[] = [];
    let equipment: Equipment = {};
    let bonuses: Bonuses = {
        hackingBonus: 0,
        stealthBonus: 0,
        speedBonus: 0,
        detectionReduction: 0,
        successRateIncrease: 0,
        xpMultiplier: 1.0,
        creditsMultiplier: 1.0,
    };
    let selectedItem: InventoryItem | null = null;
    let loading: boolean = true;
    let message: string = "";
    let messageType: "success" | "error" | "info" = "info";
    let activeTab: "inventory" | "equipped" = "inventory";

    const slots = ["TOOL", "SOFTWARE", "EXPLOIT", "DEFENSE", "UPGRADE"];

    const rarityColors: { [key: string]: string } = {
        COMMON: "#9e9e9e",
        UNCOMMON: "#4caf50",
        RARE: "#2196f3",
        EPIC: "#9c27b0",
        LEGENDARY: "#ff9800",
    };

    const slotIcons: { [key: string]: string } = {
        TOOL: "🔧",
        SOFTWARE: "💾",
        EXPLOIT: "⚡",
        DEFENSE: "🛡️",
        UPGRADE: "⚙️",
    };

    onMount(async () => {
        await loadInventory();
        await loadEquipment();
    });

    // Re-fetch inventory and equipment when dialog becomes visible (covers external changes)
    $: if (visible) {
        loadInventory();
        loadEquipment();
    }

    async function loadInventory() {
        try {
            loading = true;
            const response = await apiClient.executeCommand("scripts");

            if (response.success && response.data) {
                inventory = response.data.inventory || [];
            }
        } catch (error) {
            console.error("Failed to load inventory:", error);
            showMessage("Failed to load inventory", "error");
        } finally {
            loading = false;
        }
    }

    async function loadEquipment() {
        try {
            const response = await apiClient.executeCommand("equipment");

            if (response.success && response.data) {
                equipment = response.data.equipment || {};
                bonuses = response.data.bonuses || {
                    hackingBonus: 0,
                    stealthBonus: 0,
                    speedBonus: 0,
                    detectionReduction: 0,
                    successRateIncrease: 0,
                    xpMultiplier: 1.0,
                    creditsMultiplier: 1.0,
                };
            }
        } catch (error) {
            console.error("Failed to load equipment:", error);
        }
    }

    async function equipItem(item: InventoryItem) {
        try {
            const response = await apiClient.executeCommand(
                `equip ${item.itemId}`,
            );

            if (response.success) {
                showMessage(`Equipped ${item.item.name}`, "success");
                await loadEquipment();
                await loadInventory();
            } else {
                showMessage(response.output || "Failed to equip item", "error");
            }
        } catch (error) {
            console.error("Failed to equip item:", error);
            showMessage("Failed to equip item", "error");
        }
    }

    async function unequipSlot(slot: string) {
        try {
            const response = await apiClient.executeCommand(`unequip ${slot}`);

            if (response.success) {
                showMessage(`Unequipped ${slot}`, "success");
                await loadEquipment();
            } else {
                showMessage(response.output || "Failed to unequip", "error");
            }
        } catch (error) {
            console.error("Failed to unequip:", error);
            showMessage("Failed to unequip", "error");
        }
    }

    async function useItem(item: InventoryItem) {
        try {
            const response = await apiClient.executeCommand(
                `use ${item.itemId}`,
            );

            if (response.success) {
                showMessage(response.output || "Item used", "success");
                await loadInventory();
            } else {
                showMessage(response.output || "Failed to use item", "error");
            }
        } catch (error) {
            console.error("Failed to use item:", error);
            showMessage("Failed to use item", "error");
        }
    }

    function getEquippedItem(slot: string): ShopItem | null {
        const itemId = equipment[slot as keyof Equipment];
        if (!itemId) return null;

        const invItem = inventory.find((i) => i.itemId === itemId);
        return invItem?.item || null;
    }

    function isEquipped(itemId: string): boolean {
        return Object.values(equipment).includes(itemId);
    }

    function canEquip(item: ShopItem): boolean {
        return ["TOOL", "SOFTWARE", "EXPLOIT", "DEFENSE", "UPGRADE"].includes(
            item.category,
        );
    }

    function showMessage(msg: string, type: "success" | "error" | "info") {
        message = msg;
        messageType = type;
        setTimeout(() => {
            message = "";
        }, 3000);
    }

    function close() {
        visible = false;
        if (onClose) onClose();
    }

    function handleKeydown(event: KeyboardEvent) {
        if (event.key === "Escape") {
            close();
        }
    }

    function formatEffects(item: ShopItem): string[] {
        if (!item.effects) return [];

        const effects: string[] = [];
        const e = item.effects;

        if (e.hackingBonus) effects.push(`+${e.hackingBonus} Hacking`);
        if (e.stealthBonus) effects.push(`+${e.stealthBonus} Stealth`);
        if (e.speedBonus) effects.push(`+${e.speedBonus}% Speed`);
        if (e.detectionReduction)
            effects.push(`-${e.detectionReduction}% Detection`);
        if (e.successRateIncrease)
            effects.push(`+${e.successRateIncrease}% Success`);
        if (e.xpMultiplier)
            effects.push(`${(e.xpMultiplier * 100).toFixed(0)}% XP`);
        if (e.creditsMultiplier)
            effects.push(`${(e.creditsMultiplier * 100).toFixed(0)}% Credits`);

        return effects;
    }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if visible}
    <div class="equipment-overlay" on:click={close}>
        <div class="equipment-dialog" on:click|stopPropagation>
            <!-- Header -->
            <div class="equipment-header">
                <div class="header-left">
                    <h2>EQUIPMENT & INVENTORY</h2>
                    <span class="subtitle">Manage your gear and tools</span>
                </div>
                <button class="close-btn" on:click={close}>✕</button>
            </div>

            {#if message}
                <div class="message message-{messageType}">
                    {message}
                </div>
            {/if}

            <!-- Tabs -->
            <div class="tabs">
                <button
                    class="tab-btn"
                    class:active={activeTab === "inventory"}
                    on:click={() => (activeTab = "inventory")}
                >
                    INVENTORY
                </button>
                <button
                    class="tab-btn"
                    class:active={activeTab === "equipped"}
                    on:click={() => (activeTab = "equipped")}
                >
                    EQUIPPED
                </button>
            </div>

            <!-- Content -->
            <div class="equipment-content">
                {#if activeTab === "inventory"}
                    <!-- Inventory View -->
                    <div class="inventory-view">
                        <div class="inventory-grid">
                            {#if loading}
                                <div class="loading">Loading inventory...</div>
                            {:else if inventory.length === 0}
                                <div class="no-items">
                                    Your inventory is empty. Visit the shop to
                                    purchase items.
                                </div>
                            {:else}
                                {#each inventory as invItem}
                                    <div
                                        class="inventory-item"
                                        class:selected={selectedItem?.itemId ===
                                            invItem.itemId}
                                        class:equipped={isEquipped(
                                            invItem.itemId,
                                        )}
                                        on:click={() =>
                                            (selectedItem = invItem)}
                                    >
                                        <div
                                            class="item-rarity"
                                            style="background-color: {rarityColors[
                                                invItem.item.rarity
                                            ]}"
                                        >
                                            {invItem.item.rarity}
                                        </div>
                                        <div class="item-name">
                                            {invItem.item.name}
                                        </div>
                                        <div class="item-category">
                                            {invItem.item.category}
                                        </div>
                                        <div class="item-quantity">
                                            Qty: {invItem.quantity}
                                        </div>
                                        {#if isEquipped(invItem.itemId)}
                                            <div class="equipped-badge">
                                                EQUIPPED
                                            </div>
                                        {/if}
                                    </div>
                                {/each}
                            {/if}
                        </div>

                        <!-- Item Details Panel -->
                        <div class="item-details-panel">
                            {#if selectedItem}
                                <div class="details-header">
                                    <h3>{selectedItem.item.name}</h3>
                                    <div
                                        class="details-rarity"
                                        style="color: {rarityColors[
                                            selectedItem.item.rarity
                                        ]}"
                                    >
                                        {selectedItem.item.rarity}
                                    </div>
                                </div>

                                <div class="details-body">
                                    <p class="description">
                                        {selectedItem.item.description}
                                    </p>

                                    <div class="detail-row">
                                        <span class="label">Category:</span>
                                        <span class="value"
                                            >{selectedItem.item.category}</span
                                        >
                                    </div>

                                    <div class="detail-row">
                                        <span class="label">Quantity:</span>
                                        <span class="value"
                                            >{selectedItem.quantity}</span
                                        >
                                    </div>

                                    {#if formatEffects(selectedItem.item).length > 0}
                                        <div class="effects">
                                            <span class="label">Effects:</span>
                                            {#each formatEffects(selectedItem.item) as effect}
                                                <div class="effect">
                                                    {effect}
                                                </div>
                                            {/each}
                                        </div>
                                    {/if}
                                </div>

                                <div class="details-footer">
                                    {#if canEquip(selectedItem.item)}
                                        <button
                                            class="action-btn equip-btn"
                                            disabled={isEquipped(
                                                selectedItem.itemId,
                                            )}
                                            on:click={() =>
                                                equipItem(selectedItem!)}
                                        >
                                            {isEquipped(selectedItem.itemId)
                                                ? "EQUIPPED"
                                                : "EQUIP"}
                                        </button>
                                    {/if}
                                    {#if selectedItem.item.isConsumable}
                                        <button
                                            class="action-btn use-btn"
                                            on:click={() =>
                                                useItem(selectedItem!)}
                                        >
                                            USE
                                        </button>
                                    {/if}
                                </div>
                            {:else}
                                <div class="no-selection">
                                    <p>Select an item to view details</p>
                                </div>
                            {/if}
                        </div>
                    </div>
                {:else}
                    <!-- Equipment View -->
                    <div class="equipment-view">
                        <div class="equipment-slots">
                            {#each slots as slot}
                                {@const equippedItem = getEquippedItem(slot)}
                                <div class="equipment-slot">
                                    <div class="slot-header">
                                        <span class="slot-icon"
                                            >{slotIcons[slot]}</span
                                        >
                                        <span class="slot-name">{slot}</span>
                                    </div>
                                    <div class="slot-content">
                                        {#if equippedItem}
                                            <div
                                                class="equipped-item"
                                                style="border-color: {rarityColors[
                                                    equippedItem.rarity
                                                ]}"
                                            >
                                                <div class="equipped-item-name">
                                                    {equippedItem.name}
                                                </div>
                                                <div
                                                    class="equipped-item-rarity"
                                                >
                                                    {equippedItem.rarity}
                                                </div>
                                                {#if formatEffects(equippedItem).length > 0}
                                                    <div
                                                        class="equipped-effects"
                                                    >
                                                        {#each formatEffects(equippedItem) as effect}
                                                            <div
                                                                class="effect-line"
                                                            >
                                                                {effect}
                                                            </div>
                                                        {/each}
                                                    </div>
                                                {/if}
                                                <button
                                                    class="unequip-btn"
                                                    on:click={() =>
                                                        unequipSlot(slot)}
                                                >
                                                    UNEQUIP
                                                </button>
                                            </div>
                                        {:else}
                                            <div class="empty-slot">
                                                <span>Empty</span>
                                            </div>
                                        {/if}
                                    </div>
                                </div>
                            {/each}
                        </div>

                        <!-- Bonuses Panel -->
                        <div class="bonuses-panel">
                            <h3>TOTAL BONUSES</h3>
                            <div class="bonuses-list">
                                {#if bonuses.hackingBonus}
                                    <div class="bonus-item">
                                        <span class="bonus-label">Hacking:</span
                                        >
                                        <span class="bonus-value"
                                            >+{bonuses.hackingBonus}</span
                                        >
                                    </div>
                                {/if}
                                {#if bonuses.stealthBonus}
                                    <div class="bonus-item">
                                        <span class="bonus-label">Stealth:</span
                                        >
                                        <span class="bonus-value"
                                            >+{bonuses.stealthBonus}</span
                                        >
                                    </div>
                                {/if}
                                {#if bonuses.speedBonus}
                                    <div class="bonus-item">
                                        <span class="bonus-label">Speed:</span>
                                        <span class="bonus-value"
                                            >+{bonuses.speedBonus}%</span
                                        >
                                    </div>
                                {/if}
                                {#if bonuses.detectionReduction}
                                    <div class="bonus-item">
                                        <span class="bonus-label"
                                            >Detection:</span
                                        >
                                        <span class="bonus-value"
                                            >-{bonuses.detectionReduction}%</span
                                        >
                                    </div>
                                {/if}
                                {#if bonuses.successRateIncrease}
                                    <div class="bonus-item">
                                        <span class="bonus-label"
                                            >Success Rate:</span
                                        >
                                        <span class="bonus-value"
                                            >+{bonuses.successRateIncrease}%</span
                                        >
                                    </div>
                                {/if}
                                {#if bonuses.xpMultiplier !== 1.0}
                                    <div class="bonus-item">
                                        <span class="bonus-label"
                                            >XP Multiplier:</span
                                        >
                                        <span class="bonus-value"
                                            >{bonuses.xpMultiplier.toFixed(
                                                2,
                                            )}x</span
                                        >
                                    </div>
                                {/if}
                                {#if bonuses.creditsMultiplier !== 1.0}
                                    <div class="bonus-item">
                                        <span class="bonus-label"
                                            >Credits Multiplier:</span
                                        >
                                        <span class="bonus-value"
                                            >{bonuses.creditsMultiplier.toFixed(
                                                2,
                                            )}x</span
                                        >
                                    </div>
                                {/if}
                                {#if bonuses.hackingBonus === 0 && bonuses.stealthBonus === 0 && bonuses.speedBonus === 0 && bonuses.detectionReduction === 0 && bonuses.successRateIncrease === 0 && bonuses.xpMultiplier === 1.0 && bonuses.creditsMultiplier === 1.0}
                                    <div class="no-bonuses">
                                        No active bonuses. Equip items to gain
                                        bonuses.
                                    </div>
                                {/if}
                            </div>
                        </div>
                    </div>
                {/if}
            </div>
        </div>
    </div>
{/if}

<style>
    .equipment-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.85);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        backdrop-filter: blur(5px);
    }

    .equipment-dialog {
        width: 90vw;
        max-width: 1400px;
        height: 85vh;
        background: #0a0e14;
        border: 2px solid #00ff41;
        border-radius: 4px;
        display: flex;
        flex-direction: column;
        box-shadow: 0 0 30px rgba(0, 255, 65, 0.3);
        font-family: "Courier New", monospace;
        color: #00ff41;
    }

    .equipment-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px;
        border-bottom: 1px solid #00ff41;
        background: rgba(0, 255, 65, 0.05);
    }

    .header-left h2 {
        margin: 0 0 5px 0;
        font-size: 24px;
        letter-spacing: 2px;
        text-shadow: 0 0 10px rgba(0, 255, 65, 0.5);
    }

    .subtitle {
        font-size: 12px;
        color: #00ff4188;
        letter-spacing: 1px;
    }

    .close-btn {
        background: transparent;
        border: 1px solid #00ff41;
        color: #00ff41;
        width: 40px;
        height: 40px;
        cursor: pointer;
        font-size: 20px;
        border-radius: 4px;
        transition: all 0.2s;
    }

    .close-btn:hover {
        background: #00ff41;
        color: #0a0e14;
    }

    .message {
        padding: 12px 20px;
        text-align: center;
        font-weight: bold;
        letter-spacing: 1px;
    }

    .message-success {
        background: rgba(0, 255, 65, 0.2);
        border-bottom: 1px solid #00ff41;
    }

    .message-error {
        background: rgba(255, 0, 0, 0.2);
        color: #ff4444;
        border-bottom: 1px solid #ff4444;
    }

    .tabs {
        display: flex;
        border-bottom: 1px solid #00ff4144;
    }

    .tab-btn {
        flex: 1;
        padding: 15px;
        background: transparent;
        border: none;
        color: #00ff4188;
        font-family: inherit;
        font-size: 13px;
        letter-spacing: 2px;
        cursor: pointer;
        transition: all 0.2s;
        border-bottom: 2px solid transparent;
    }

    .tab-btn:hover {
        color: #00ff41;
        background: rgba(0, 255, 65, 0.05);
    }

    .tab-btn.active {
        color: #00ff41;
        background: rgba(0, 255, 65, 0.1);
        border-bottom-color: #00ff41;
    }

    .equipment-content {
        flex: 1;
        overflow: hidden;
    }

    /* Inventory View */
    .inventory-view {
        display: flex;
        height: 100%;
    }

    .inventory-grid {
        flex: 1;
        padding: 20px;
        overflow-y: auto;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 15px;
        align-content: start;
    }

    .inventory-item {
        background: rgba(0, 255, 65, 0.03);
        border: 1px solid #00ff4144;
        padding: 12px;
        cursor: pointer;
        transition: all 0.2s;
        border-radius: 4px;
        position: relative;
    }

    .inventory-item:hover {
        border-color: #00ff41;
        background: rgba(0, 255, 65, 0.08);
        transform: translateY(-2px);
    }

    .inventory-item.selected {
        border-color: #00ff41;
        background: rgba(0, 255, 65, 0.15);
        box-shadow: 0 0 15px rgba(0, 255, 65, 0.3);
    }

    .inventory-item.equipped {
        border-color: #ffff00;
    }

    .item-rarity {
        font-size: 8px;
        padding: 3px 6px;
        border-radius: 2px;
        margin-bottom: 8px;
        text-align: center;
        font-weight: bold;
        color: #000;
    }

    .item-name {
        font-size: 13px;
        font-weight: bold;
        margin-bottom: 4px;
        min-height: 32px;
    }

    .item-category {
        font-size: 10px;
        opacity: 0.6;
        margin-bottom: 4px;
    }

    .item-quantity {
        font-size: 11px;
        color: #ffff00;
    }

    .equipped-badge {
        position: absolute;
        top: 8px;
        right: 8px;
        font-size: 8px;
        padding: 2px 6px;
        background: #ffff00;
        color: #000;
        font-weight: bold;
        border-radius: 2px;
    }

    .item-details-panel {
        width: 400px;
        border-left: 1px solid #00ff4144;
        padding: 20px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
    }

    .details-header {
        margin-bottom: 20px;
        padding-bottom: 15px;
        border-bottom: 1px solid #00ff4144;
    }

    .details-header h3 {
        margin: 0 0 8px 0;
        font-size: 18px;
        color: #00ff41;
    }

    .details-rarity {
        font-size: 12px;
        font-weight: bold;
    }

    .details-body {
        flex: 1;
    }

    .description {
        margin-bottom: 20px;
        line-height: 1.6;
        font-size: 12px;
        opacity: 0.9;
    }

    .detail-row {
        display: flex;
        justify-content: space-between;
        margin-bottom: 10px;
        font-size: 12px;
    }

    .label {
        opacity: 0.7;
        font-weight: bold;
    }

    .value {
        font-weight: bold;
    }

    .effects {
        margin-top: 15px;
        padding-top: 15px;
        border-top: 1px solid #00ff4144;
    }

    .effect {
        margin: 8px 0;
        font-size: 11px;
        padding: 4px 8px;
        background: rgba(0, 255, 65, 0.05);
        border-radius: 2px;
    }

    .details-footer {
        padding-top: 20px;
        border-top: 1px solid #00ff4144;
        margin-top: 20px;
        display: flex;
        gap: 10px;
    }

    .action-btn {
        flex: 1;
        padding: 12px;
        border: none;
        font-family: inherit;
        font-size: 13px;
        font-weight: bold;
        letter-spacing: 1px;
        cursor: pointer;
        border-radius: 4px;
        transition: all 0.2s;
    }

    .equip-btn {
        background: #00ff41;
        color: #0a0e14;
    }

    .equip-btn:hover:not(:disabled) {
        background: #00cc33;
        box-shadow: 0 0 20px rgba(0, 255, 65, 0.5);
    }

    .equip-btn:disabled {
        background: #333;
        color: #666;
        cursor: not-allowed;
    }

    .use-btn {
        background: #2196f3;
        color: #fff;
    }

    .use-btn:hover {
        background: #1976d2;
        box-shadow: 0 0 20px rgba(33, 150, 243, 0.5);
    }

    .no-selection {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        opacity: 0.5;
    }

    /* Equipment View */
    .equipment-view {
        display: flex;
        height: 100%;
    }

    .equipment-slots {
        flex: 1;
        padding: 20px;
        overflow-y: auto;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
        gap: 20px;
        align-content: start;
    }

    .equipment-slot {
        background: rgba(0, 255, 65, 0.03);
        border: 1px solid #00ff4144;
        border-radius: 4px;
        overflow: hidden;
    }

    .slot-header {
        padding: 12px;
        background: rgba(0, 255, 65, 0.1);
        border-bottom: 1px solid #00ff4144;
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .slot-icon {
        font-size: 20px;
    }

    .slot-name {
        font-size: 13px;
        font-weight: bold;
        letter-spacing: 1px;
    }

    .slot-content {
        padding: 15px;
    }

    .equipped-item {
        border: 2px solid;
        border-radius: 4px;
        padding: 12px;
        background: rgba(0, 255, 65, 0.05);
    }

    .equipped-item-name {
        font-size: 14px;
        font-weight: bold;
        margin-bottom: 8px;
    }

    .equipped-item-rarity {
        font-size: 10px;
        opacity: 0.7;
        margin-bottom: 12px;
    }

    .equipped-effects {
        margin-bottom: 12px;
    }

    .effect-line {
        font-size: 11px;
        padding: 4px 8px;
        background: rgba(0, 255, 65, 0.1);
        margin: 4px 0;
        border-radius: 2px;
    }

    .unequip-btn {
        width: 100%;
        padding: 8px;
        background: transparent;
        border: 1px solid #00ff41;
        color: #00ff41;
        font-family: inherit;
        font-size: 11px;
        font-weight: bold;
        letter-spacing: 1px;
        cursor: pointer;
        border-radius: 3px;
        transition: all 0.2s;
    }

    .unequip-btn:hover {
        background: #ff4444;
        border-color: #ff4444;
        color: #fff;
    }

    .empty-slot {
        text-align: center;
        padding: 30px;
        opacity: 0.3;
        font-size: 12px;
    }

    .bonuses-panel {
        width: 350px;
        border-left: 1px solid #00ff4144;
        padding: 20px;
        overflow-y: auto;
    }

    .bonuses-panel h3 {
        margin: 0 0 20px 0;
        font-size: 16px;
        letter-spacing: 2px;
        padding-bottom: 15px;
        border-bottom: 1px solid #00ff4144;
    }

    .bonuses-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .bonus-item {
        display: flex;
        justify-content: space-between;
        padding: 10px 12px;
        background: rgba(0, 255, 65, 0.05);
        border: 1px solid #00ff4144;
        border-radius: 4px;
        font-size: 12px;
    }

    .bonus-label {
        opacity: 0.7;
    }

    .bonus-value {
        font-weight: bold;
        color: #ffff00;
    }

    .no-bonuses {
        text-align: center;
        padding: 30px;
        opacity: 0.5;
        font-size: 12px;
        line-height: 1.6;
    }

    .loading,
    .no-items {
        grid-column: 1 / -1;
        text-align: center;
        padding: 40px;
        opacity: 0.5;
    }

    /* Scrollbar styling */
    .inventory-grid::-webkit-scrollbar,
    .item-details-panel::-webkit-scrollbar,
    .equipment-slots::-webkit-scrollbar,
    .bonuses-panel::-webkit-scrollbar {
        width: 8px;
    }

    .inventory-grid::-webkit-scrollbar-track,
    .item-details-panel::-webkit-scrollbar-track,
    .equipment-slots::-webkit-scrollbar-track,
    .bonuses-panel::-webkit-scrollbar-track {
        background: rgba(0, 255, 65, 0.05);
    }

    .inventory-grid::-webkit-scrollbar-thumb,
    .item-details-panel::-webkit-scrollbar-thumb,
    .equipment-slots::-webkit-scrollbar-thumb,
    .bonuses-panel::-webkit-scrollbar-thumb {
        background: #00ff4144;
        border-radius: 4px;
    }

    .inventory-grid::-webkit-scrollbar-thumb:hover,
    .item-details-panel::-webkit-scrollbar-thumb:hover,
    .equipment-slots::-webkit-scrollbar-thumb:hover,
    .bonuses-panel::-webkit-scrollbar-thumb:hover {
        background: #00ff41;
    }
</style>
