<script lang="ts">
    import { onMount } from "svelte";
    import { apiClient } from "../services/api";
    // socketService removed — shop data refreshes on buy/sell, no real-time socket events needed

    export let visible = false;
    export let onClose: () => void;

    interface ShopItem {
        id: string;
        name: string;
        description: string;
        category: string;
        price: number;
        requiredLevel: number;
        requiredSkills?: { [key: string]: number };
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
        maxStack: number;
    }

    let items: ShopItem[] = [];
    let filteredItems: ShopItem[] = [];
    let selectedCategory: string = "ALL";
    let searchQuery: string = "";
    let selectedItem: ShopItem | null = null;
    let playerCredits: number = 0;
    let playerLevel: number = 1;
    let playerSkills: any = {};
    let purchaseQuantity: number = 1;
    let loading: boolean = true;
    let message: string = "";
    let messageType: "success" | "error" | "info" = "info";

    const categories = [
        "ALL",
        "TOOL",
        "SOFTWARE",
        "EXPLOIT",
        "DEFENSE",
        "UPGRADE",
        "CONSUMABLE",
        "MISC",
    ];

    const rarityColors: { [key: string]: string } = {
        COMMON: "#9e9e9e",
        UNCOMMON: "#4caf50",
        RARE: "#2196f3",
        EPIC: "#9c27b0",
        LEGENDARY: "#ff9800",
    };

    onMount(async () => {
        await loadShopData();
        await loadPlayerData();
    });

    async function loadShopData() {
        try {
            loading = true;
            const response = await apiClient.executeCommand("shop");

            if (response.success && response.data) {
                items = response.data.items || [];
                filterItems();
            }
        } catch (error) {
            console.error("Failed to load shop data:", error);
            showMessage("Failed to load shop data", "error");
        } finally {
            loading = false;
        }
    }

    async function loadPlayerData() {
        try {
            const response = await apiClient.executeCommand("status");
            if (response.success && response.data?.progress) {
                playerCredits = response.data.progress.credits || 0;
                playerLevel = response.data.progress.level || 1;
                playerSkills = {
                    hacking: response.data.progress.hacking || 0,
                    networking: response.data.progress.networking || 0,
                    cryptography: response.data.progress.cryptography || 0,
                    stealth: response.data.progress.stealth || 0,
                    socialEng: response.data.progress.socialEng || 0,
                    forensics: response.data.progress.forensics || 0,
                };
            }
        } catch (error) {
            console.error("Failed to load player data:", error);
        }
    }

    function filterItems() {
        filteredItems = items.filter((item) => {
            const matchesCategory =
                selectedCategory === "ALL" || item.category === selectedCategory;
            const matchesSearch =
                searchQuery === "" ||
                item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                item.description.toLowerCase().includes(searchQuery.toLowerCase());
            return matchesCategory && matchesSearch;
        });
    }

    function selectItem(item: ShopItem) {
        selectedItem = item;
        purchaseQuantity = 1;
    }

    function canAfford(item: ShopItem): boolean {
        return playerCredits >= item.price * purchaseQuantity;
    }

    function meetsRequirements(item: ShopItem): boolean {
        if (item.requiredLevel > playerLevel) {
            return false;
        }

        if (item.requiredSkills) {
            for (const [skill, level] of Object.entries(item.requiredSkills)) {
                if ((playerSkills[skill] || 0) < level) {
                    return false;
                }
            }
        }

        return true;
    }

    async function purchaseItem() {
        if (!selectedItem) return;

        if (!canAfford(selectedItem)) {
            showMessage("Not enough credits!", "error");
            return;
        }

        if (!meetsRequirements(selectedItem)) {
            showMessage("You don't meet the requirements for this item", "error");
            return;
        }

        try {
            const response = await apiClient.executeCommand(
                `buy ${selectedItem.id} ${purchaseQuantity}`
            );

            if (response.success) {
                showMessage(
                    `Purchased ${purchaseQuantity}x ${selectedItem.name}!`,
                    "success"
                );
                await loadPlayerData();
                selectedItem = null;
            } else {
                showMessage(response.output || "Purchase failed", "error");
            }
        } catch (error) {
            console.error("Purchase failed:", error);
            showMessage("Purchase failed", "error");
        }
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

    function formatPrice(price: number): string {
        return price.toLocaleString();
    }

    function formatEffects(item: ShopItem): string[] {
        if (!item.effects) return [];

        const effects: string[] = [];
        const e = item.effects;

        if (e.hackingBonus) effects.push(`+${e.hackingBonus} Hacking`);
        if (e.stealthBonus) effects.push(`+${e.stealthBonus} Stealth`);
        if (e.speedBonus) effects.push(`+${e.speedBonus}% Speed`);
        if (e.detectionReduction) effects.push(`-${e.detectionReduction}% Detection`);
        if (e.successRateIncrease) effects.push(`+${e.successRateIncrease}% Success`);
        if (e.xpMultiplier) effects.push(`${(e.xpMultiplier * 100).toFixed(0)}% XP`);
        if (e.creditsMultiplier)
            effects.push(`${(e.creditsMultiplier * 100).toFixed(0)}% Credits`);

        return effects;
    }

    $: if (selectedCategory || searchQuery) {
        filterItems();
    }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if visible}
    <div class="shop-overlay" on:click={close}>
        <div class="shop-dialog" on:click|stopPropagation>
            <!-- Header -->
            <div class="shop-header">
                <div class="header-left">
                    <h2>DARKNET MARKETPLACE</h2>
                    <span class="subtitle">Secure. Anonymous. Untraceable.</span>
                </div>
                <div class="header-right">
                    <div class="credits">
                        <span class="label">CREDITS:</span>
                        <span class="value">{formatPrice(playerCredits)}</span>
                    </div>
                    <button class="close-btn" on:click={close}>✕</button>
                </div>
            </div>

            {#if message}
                <div class="message message-{messageType}">
                    {message}
                </div>
            {/if}

            <!-- Filters -->
            <div class="filters">
                <div class="category-filters">
                    {#each categories as category}
                        <button
                            class="category-btn"
                            class:active={selectedCategory === category}
                            on:click={() => (selectedCategory = category)}
                        >
                            {category}
                        </button>
                    {/each}
                </div>
                <div class="search-bar">
                    <input
                        type="text"
                        placeholder="Search items..."
                        bind:value={searchQuery}
                    />
                </div>
            </div>

            <!-- Main Content -->
            <div class="shop-content">
                <!-- Items Grid -->
                <div class="items-grid">
                    {#if loading}
                        <div class="loading">Loading items...</div>
                    {:else if filteredItems.length === 0}
                        <div class="no-items">No items found</div>
                    {:else}
                        {#each filteredItems as item}
                            <div
                                class="item-card"
                                class:selected={selectedItem?.id === item.id}
                                class:affordable={canAfford(item)}
                                class:locked={!meetsRequirements(item)}
                                on:click={() => selectItem(item)}
                            >
                                <div
                                    class="item-rarity"
                                    style="background-color: {rarityColors[item.rarity]}"
                                >
                                    {item.rarity}
                                </div>
                                <div class="item-name">{item.name}</div>
                                <div class="item-category">{item.category}</div>
                                <div class="item-price">
                                    {formatPrice(item.price)}₡
                                </div>
                                {#if !meetsRequirements(item)}
                                    <div class="item-locked">🔒 LOCKED</div>
                                {/if}
                            </div>
                        {/each}
                    {/if}
                </div>

                <!-- Item Details -->
                <div class="item-details">
                    {#if selectedItem}
                        <div class="details-header">
                            <h3>{selectedItem.name}</h3>
                            <div
                                class="details-rarity"
                                style="color: {rarityColors[selectedItem.rarity]}"
                            >
                                {selectedItem.rarity}
                            </div>
                        </div>

                        <div class="details-body">
                            <p class="description">{selectedItem.description}</p>

                            <div class="detail-row">
                                <span class="label">Category:</span>
                                <span class="value">{selectedItem.category}</span>
                            </div>

                            <div class="detail-row">
                                <span class="label">Price:</span>
                                <span class="value price-value">
                                    {formatPrice(selectedItem.price)}₡
                                </span>
                            </div>

                            {#if selectedItem.requiredLevel > 1}
                                <div class="detail-row">
                                    <span class="label">Required Level:</span>
                                    <span
                                        class="value"
                                        class:req-met={playerLevel >= selectedItem.requiredLevel}
                                        class:req-unmet={playerLevel < selectedItem.requiredLevel}
                                    >
                                        {selectedItem.requiredLevel}
                                        {playerLevel >= selectedItem.requiredLevel ? "✓" : "✗"}
                                    </span>
                                </div>
                            {/if}

                            {#if selectedItem.requiredSkills}
                                <div class="requirements">
                                    <span class="label">Required Skills:</span>
                                    {#each Object.entries(selectedItem.requiredSkills) as [skill, level]}
                                        <div class="skill-req">
                                            <span>{skill}:</span>
                                            <span
                                                class:req-met={(playerSkills[skill] || 0) >= level}
                                                class:req-unmet={(playerSkills[skill] || 0) < level}
                                            >
                                                {level}
                                                {(playerSkills[skill] || 0) >= level ? "✓" : "✗"}
                                            </span>
                                        </div>
                                    {/each}
                                </div>
                            {/if}

                            {#if formatEffects(selectedItem).length > 0}
                                <div class="effects">
                                    <span class="label">Effects:</span>
                                    {#each formatEffects(selectedItem) as effect}
                                        <div class="effect">{effect}</div>
                                    {/each}
                                </div>
                            {/if}

                            {#if selectedItem.maxStack > 1}
                                <div class="quantity-selector">
                                    <span class="label">Quantity:</span>
                                    <input
                                        type="number"
                                        min="1"
                                        max={selectedItem.maxStack}
                                        bind:value={purchaseQuantity}
                                    />
                                    <span class="total-price">
                                        Total: {formatPrice(selectedItem.price * purchaseQuantity)}₡
                                    </span>
                                </div>
                            {/if}
                        </div>

                        <div class="details-footer">
                            <button
                                class="buy-btn"
                                disabled={!canAfford(selectedItem) || !meetsRequirements(selectedItem)}
                                on:click={purchaseItem}
                            >
                                {#if !meetsRequirements(selectedItem)}
                                    LOCKED
                                {:else if !canAfford(selectedItem)}
                                    INSUFFICIENT FUNDS
                                {:else}
                                    PURCHASE
                                {/if}
                            </button>
                        </div>
                    {:else}
                        <div class="no-selection">
                            <p>Select an item to view details</p>
                        </div>
                    {/if}
                </div>
            </div>
        </div>
    </div>
{/if}

<style>
    .shop-overlay {
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

    .shop-dialog {
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

    .shop-header {
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

    .header-right {
        display: flex;
        align-items: center;
        gap: 20px;
    }

    .credits {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        padding: 8px 16px;
        background: rgba(0, 255, 65, 0.1);
        border: 1px solid #00ff41;
        border-radius: 4px;
    }

    .credits .label {
        font-size: 10px;
        opacity: 0.7;
    }

    .credits .value {
        font-size: 18px;
        font-weight: bold;
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

    .filters {
        padding: 15px 20px;
        border-bottom: 1px solid #00ff4144;
        display: flex;
        gap: 20px;
        align-items: center;
    }

    .category-filters {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
    }

    .category-btn {
        background: transparent;
        border: 1px solid #00ff4144;
        color: #00ff4188;
        padding: 6px 12px;
        cursor: pointer;
        font-family: inherit;
        font-size: 11px;
        letter-spacing: 1px;
        border-radius: 3px;
        transition: all 0.2s;
    }

    .category-btn:hover {
        border-color: #00ff41;
        color: #00ff41;
    }

    .category-btn.active {
        background: #00ff41;
        color: #0a0e14;
        border-color: #00ff41;
    }

    .search-bar {
        flex: 1;
    }

    .search-bar input {
        width: 100%;
        padding: 8px 12px;
        background: rgba(0, 255, 65, 0.05);
        border: 1px solid #00ff4144;
        color: #00ff41;
        font-family: inherit;
        font-size: 12px;
        border-radius: 3px;
    }

    .search-bar input:focus {
        outline: none;
        border-color: #00ff41;
        box-shadow: 0 0 10px rgba(0, 255, 65, 0.2);
    }

    .shop-content {
        display: flex;
        flex: 1;
        overflow: hidden;
    }

    .items-grid {
        flex: 1;
        padding: 20px;
        overflow-y: auto;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 15px;
        align-content: start;
    }

    .item-card {
        background: rgba(0, 255, 65, 0.03);
        border: 1px solid #00ff4144;
        padding: 12px;
        cursor: pointer;
        transition: all 0.2s;
        border-radius: 4px;
        position: relative;
    }

    .item-card:hover {
        border-color: #00ff41;
        background: rgba(0, 255, 65, 0.08);
        transform: translateY(-2px);
    }

    .item-card.selected {
        border-color: #00ff41;
        background: rgba(0, 255, 65, 0.15);
        box-shadow: 0 0 15px rgba(0, 255, 65, 0.3);
    }

    .item-card.locked {
        opacity: 0.5;
        border-color: #ff444444;
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
        margin-bottom: 8px;
    }

    .item-price {
        font-size: 14px;
        font-weight: bold;
        color: #ffff00;
    }

    .item-locked {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 11px;
        color: #ff4444;
        font-weight: bold;
    }

    .item-details {
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

    .price-value {
        color: #ffff00;
    }

    .req-met {
        color: #00ff41;
    }

    .req-unmet {
        color: #ff4444;
    }

    .requirements,
    .effects {
        margin-top: 15px;
        padding-top: 15px;
        border-top: 1px solid #00ff4144;
    }

    .skill-req,
    .effect {
        display: flex;
        justify-content: space-between;
        margin: 8px 0;
        font-size: 11px;
        padding: 4px 8px;
        background: rgba(0, 255, 65, 0.05);
        border-radius: 2px;
    }

    .quantity-selector {
        margin-top: 15px;
        padding-top: 15px;
        border-top: 1px solid #00ff4144;
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 12px;
    }

    .quantity-selector input {
        width: 60px;
        padding: 6px;
        background: rgba(0, 255, 65, 0.05);
        border: 1px solid #00ff4144;
        color: #00ff41;
        font-family: inherit;
        border-radius: 3px;
    }

    .total-price {
        color: #ffff00;
        font-weight: bold;
    }

    .details-footer {
        padding-top: 20px;
        border-top: 1px solid #00ff4144;
        margin-top: 20px;
    }

    .buy-btn {
        width: 100%;
        padding: 12px;
        background: #00ff41;
        color: #0a0e14;
        border: none;
        font-family: inherit;
        font-size: 14px;
        font-weight: bold;
        letter-spacing: 2px;
        cursor: pointer;
        border-radius: 4px;
        transition: all 0.2s;
    }

    .buy-btn:hover:not(:disabled) {
        background: #00cc33;
        box-shadow: 0 0 20px rgba(0, 255, 65, 0.5);
    }

    .buy-btn:disabled {
        background: #333;
        color: #666;
        cursor: not-allowed;
    }

    .no-selection {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        opacity: 0.5;
    }

    .loading,
    .no-items {
        grid-column: 1 / -1;
        text-align: center;
        padding: 40px;
        opacity: 0.5;
    }

    /* Scrollbar styling */
    .items-grid::-webkit-scrollbar,
    .item-details::-webkit-scrollbar {
        width: 8px;
    }

    .items-grid::-webkit-scrollbar-track,
    .item-details::-webkit-scrollbar-track {
        background: rgba(0, 255, 65, 0.05);
    }

    .items-grid::-webkit-scrollbar-thumb,
    .item-details::-webkit-scrollbar-thumb {
        background: #00ff4144;
        border-radius: 4px;
    }

    .items-grid::-webkit-scrollbar-thumb:hover,
    .item-details::-webkit-scrollbar-thumb:hover {
        background: #00ff41;
    }
</style>
