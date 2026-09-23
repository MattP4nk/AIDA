import { EventEmitter } from "events";
import { Prisma } from "@prisma/client";
import { prisma } from "../database/client";
import { HARDWARE_SPECS } from "../config/gameBalance";

/**
 * Tool/Software Item Interface
 */
export interface ShopItem {
  id: string;
  name: string;
  description: string;
  category: ItemCategory;
  price: number;
  requiredLevel: number;
  requiredSkills?: { [key: string]: number };
  effects?: ItemEffects;
  rarity: ItemRarity;
  isConsumable: boolean;
  maxStack: number;
  /**
   * False for items that exist in the catalog but are NOT sold: reward-only
   * drops. The persona tokens carried `isActive: false` in the seed, and moving
   * them into the catalog without this flag would have quietly put a 5000-credit
   * "message Commander Steele" button in the shop. Absent means purchasable.
   */
  purchasable?: boolean;
  /**
   * Functional payload, mirrored to the `ShopItem.effect` JSON column. This is
   * the ONE item mechanic that actually works — `tokenConsumption.ts` matches
   * `effect.personaName` to gate persona messaging. Distinct from `effects`
   * (the stat bonuses), which nothing applies.
   */
  effect?: Record<string, unknown>;
}

/**
 * Item categories
 */
export enum ItemCategory {
  TOOL = "TOOL",
  SOFTWARE = "SOFTWARE",
  EXPLOIT = "EXPLOIT",
  DEFENSE = "DEFENSE",
  UPGRADE = "UPGRADE",
  CONSUMABLE = "CONSUMABLE",
  MISC = "MISC",
  /**
   * Physical rig parts. Deliberately NOT in `equipableCategories`
   * (inventoryService.ts): hardware is *installed*, and ownership IS
   * installation. There is no equip verb and no slot for it.
   */
  HARDWARE = "HARDWARE",
  /**
   * Persona contact tokens. The category name matters — `syncCatalogToDatabase`
   * writes `itemType: category.toLowerCase()`, and `missionService` /
   * `darknetDungeonService` look tokens up with `itemType: "token"`.
   */
  TOKEN = "TOKEN",
}

/**
 * Item rarity levels
 */
export enum ItemRarity {
  COMMON = "COMMON",
  UNCOMMON = "UNCOMMON",
  RARE = "RARE",
  EPIC = "EPIC",
  LEGENDARY = "LEGENDARY",
}

/**
 * Item effects on player stats
 */
export interface ItemEffects {
  hackingBonus?: number;
  stealthBonus?: number;
  speedBonus?: number;
  detectionReduction?: number;
  successRateIncrease?: number;
  xpMultiplier?: number;
  creditsMultiplier?: number;
}

/**
 * Inventory item with quantity
 */
export interface InventoryItem {
  itemId: string;
  item: ShopItem;
  quantity: number;
  acquiredAt: Date;
}

/**
 * Purchase result
 */
export interface PurchaseResult {
  success: boolean;
  message: string;
  item?: ShopItem;
  remainingCredits?: number;
  transactionId?: string;
}

/**
 * Shop catalog organized by categories
 */
const SHOP_CATALOG: ShopItem[] = [
  // ==================== BASIC TOOLS ====================
  {
    id: "basic_scanner",
    name: "Port Scanner",
    description:
      "Basic network port scanning tool. Reveals open ports on target systems.",
    category: ItemCategory.TOOL,
    price: 100,
    requiredLevel: 1,
    effects: {
      hackingBonus: 5,
    },
    rarity: ItemRarity.COMMON,
    isConsumable: false,
    maxStack: 1,
  },
  {
    id: "password_cracker",
    name: "Password Cracker",
    description:
      "Brute-force password cracking utility. Increases success rate on password-protected systems.",
    category: ItemCategory.TOOL,
    price: 250,
    requiredLevel: 2,
    effects: {
      hackingBonus: 10,
      successRateIncrease: 0.05,
    },
    rarity: ItemRarity.COMMON,
    isConsumable: false,
    maxStack: 1,
  },
  {
    id: "proxy_chains",
    name: "Proxy Chains",
    description:
      "Route your connection through multiple proxies. Reduces detection probability.",
    category: ItemCategory.TOOL,
    price: 500,
    requiredLevel: 3,
    effects: {
      stealthBonus: 15,
      detectionReduction: 0.1,
    },
    rarity: ItemRarity.UNCOMMON,
    isConsumable: false,
    maxStack: 1,
  },
  {
    id: "log_cleaner",
    name: "Log Cleaner",
    description:
      "Removes traces of your activities from system logs. Essential for stealth operations.",
    category: ItemCategory.TOOL,
    price: 750,
    requiredLevel: 4,
    effects: {
      stealthBonus: 20,
      detectionReduction: 0.15,
    },
    rarity: ItemRarity.UNCOMMON,
    isConsumable: false,
    maxStack: 1,
  },

  // ==================== INTERMEDIATE SOFTWARE ====================
  {
    id: "exploit_framework",
    name: "Exploit Framework",
    description:
      "Comprehensive exploitation toolkit. Automates discovery and exploitation of vulnerabilities.",
    category: ItemCategory.SOFTWARE,
    price: 1500,
    requiredLevel: 5,
    requiredSkills: { hacking: 30 },
    effects: {
      hackingBonus: 25,
      successRateIncrease: 0.1,
    },
    rarity: ItemRarity.RARE,
    isConsumable: false,
    maxStack: 1,
  },
  {
    id: "rootkit",
    name: "Advanced Rootkit",
    description:
      "Maintain persistent access to compromised systems. Grants backdoor access.",
    category: ItemCategory.SOFTWARE,
    price: 2000,
    requiredLevel: 6,
    requiredSkills: { hacking: 40 },
    effects: {
      hackingBonus: 30,
      stealthBonus: 25,
    },
    rarity: ItemRarity.RARE,
    isConsumable: false,
    maxStack: 1,
  },
  {
    id: "firewall_bypass",
    name: "Firewall Bypass Kit",
    description: "Circumvent firewall protections on hardened systems.",
    category: ItemCategory.SOFTWARE,
    price: 1200,
    requiredLevel: 5,
    effects: {
      hackingBonus: 20,
      successRateIncrease: 0.08,
    },
    rarity: ItemRarity.UNCOMMON,
    isConsumable: false,
    maxStack: 1,
  },

  // ==================== ADVANCED EXPLOITS ====================
  {
    id: "zero_day_exploit",
    name: "Zero-Day Exploit",
    description:
      "Previously unknown vulnerability. Extremely effective but single-use.",
    category: ItemCategory.EXPLOIT,
    price: 5000,
    requiredLevel: 8,
    requiredSkills: { hacking: 60 },
    effects: {
      hackingBonus: 50,
      successRateIncrease: 0.3,
    },
    rarity: ItemRarity.EPIC,
    isConsumable: true,
    maxStack: 3,
  },
  {
    id: "quantum_decryptor",
    name: "Quantum Decryptor",
    description:
      "Break even the strongest encryption. Legendary tool for elite hackers.",
    category: ItemCategory.EXPLOIT,
    price: 10000,
    requiredLevel: 10,
    requiredSkills: { hacking: 80, stealth: 60 },
    effects: {
      hackingBonus: 60,
      successRateIncrease: 0.25,
      speedBonus: 30,
    },
    rarity: ItemRarity.LEGENDARY,
    isConsumable: false,
    maxStack: 1,
  },

  // ==================== CONSUMABLES ====================
  {
    id: "quantum_charge",
    name: "Quantum Decryptor Charge",
    description:
      "Single-use quantum decryption charge. Bypasses PROTECTED file encryption instantly. No minigame required.",
    category: ItemCategory.EXPLOIT,
    price: 7500,
    requiredLevel: 8,
    requiredSkills: { cryptography: 50 },
    effects: {},
    rarity: ItemRarity.EPIC,
    isConsumable: true,
    maxStack: 3,
  },

  // ==================== DEFENSE TOOLS ====================
  {
    id: "ids_blocker",
    name: "IDS Blocker",
    description:
      "Prevents Intrusion Detection Systems from flagging your activities.",
    category: ItemCategory.DEFENSE,
    price: 800,
    requiredLevel: 4,
    effects: {
      stealthBonus: 15,
      detectionReduction: 0.12,
    },
    rarity: ItemRarity.UNCOMMON,
    isConsumable: false,
    maxStack: 1,
  },
  {
    id: "trace_scrambler",
    name: "Trace Scrambler",
    description:
      "Scrambles your digital footprint, making it nearly impossible to trace.",
    category: ItemCategory.DEFENSE,
    price: 1800,
    requiredLevel: 6,
    effects: {
      stealthBonus: 30,
      detectionReduction: 0.2,
    },
    rarity: ItemRarity.RARE,
    isConsumable: false,
    maxStack: 1,
  },

  // ==================== UPGRADES ====================
  {
    id: "cpu_upgrade",
    name: "Overclocked CPU",
    description: "Increases processing speed for faster hack execution.",
    category: ItemCategory.UPGRADE,
    price: 2500,
    requiredLevel: 7,
    effects: {
      speedBonus: 25,
      hackingBonus: 15,
    },
    rarity: ItemRarity.RARE,
    isConsumable: false,
    maxStack: 1,
  },
  {
    id: "neural_interface",
    name: "Neural Interface Upgrade",
    description: "Enhances your connection to the net. Improves all abilities.",
    category: ItemCategory.UPGRADE,
    price: 8000,
    requiredLevel: 9,
    requiredSkills: { hacking: 70 },
    effects: {
      hackingBonus: 40,
      stealthBonus: 40,
      speedBonus: 40,
      xpMultiplier: 1.5,
    },
    rarity: ItemRarity.EPIC,
    isConsumable: false,
    maxStack: 1,
  },

  // ==================== CONSUMABLES ====================
  {
    id: "stealth_boost",
    name: "Stealth Boost",
    description: "Temporary increase to stealth rating. Single-call script.",
    category: ItemCategory.CONSUMABLE,
    price: 300,
    requiredLevel: 3,
    effects: {
      stealthBonus: 20,
      detectionReduction: 0.15,
    },
    rarity: ItemRarity.COMMON,
    isConsumable: true,
    maxStack: 10,
  },
  {
    id: "xp_booster",
    name: "XP Booster",
    description: "Doubles XP gain for the next 5 successful hacks.",
    category: ItemCategory.CONSUMABLE,
    price: 500,
    requiredLevel: 2,
    effects: {
      xpMultiplier: 2.0,
    },
    rarity: ItemRarity.UNCOMMON,
    isConsumable: true,
    maxStack: 5,
  },
  {
    id: "credit_multiplier",
    name: "Credit Multiplier",
    description:
      "Increases credits gained from missions by 50% (next 3 missions).",
    category: ItemCategory.CONSUMABLE,
    price: 800,
    requiredLevel: 4,
    effects: {
      creditsMultiplier: 1.5,
    },
    rarity: ItemRarity.UNCOMMON,
    isConsumable: true,
    maxStack: 5,
  },

  // ==================== MISC ====================
  {
    id: "data_backup",
    name: "Data Backup Kit",
    description: "Protects your data from being wiped if you get caught.",
    category: ItemCategory.MISC,
    price: 600,
    requiredLevel: 3,
    effects: {},
    rarity: ItemRarity.COMMON,
    isConsumable: true,
    maxStack: 3,
  },

  // ==================== HARDWARE ====================
  //
  // Moved here from prisma/seed.ts, which wrote them as `seed_*` rows the shop
  // never listed and `buy` could never resolve — so the entire hardware tier was
  // unreachable content. Prices, levels and rarities are carried over unchanged.
  //
  // Hardware is INSTALLED, not equipped: owning a part applies it. Each part
  // belongs to one channel (cpu/ram/bw) and a tier within it; only the highest
  // owned tier per channel applies, and buying up auto-trades-in the part it
  // supersedes. The channel/amount/tier table is HARDWARE_SPECS in gameBalance.ts,
  // keyed by the ids below — `scripts/verify-shop-contract.ts` fails if the two
  // ever disagree.
  {
    id: "ram_module_mk1",
    name: "RAM Module Mk1",
    description: "Basic memory expansion. +64MB RAM.",
    category: ItemCategory.HARDWARE,
    price: 500,
    requiredLevel: 1,
    rarity: ItemRarity.COMMON,
    isConsumable: false,
    maxStack: 1,
  },
  {
    id: "cpu_fan_upgrade",
    name: "CPU Fan Upgrade",
    description: "Better cooling allows +50 CPU units.",
    category: ItemCategory.HARDWARE,
    price: 750,
    requiredLevel: 1,
    rarity: ItemRarity.COMMON,
    isConsumable: false,
    maxStack: 1,
  },
  {
    id: "network_card_mk1",
    name: "Network Card Mk1",
    description: "Basic network adapter. +25 Mbps bandwidth.",
    category: ItemCategory.HARDWARE,
    price: 600,
    requiredLevel: 1,
    rarity: ItemRarity.COMMON,
    isConsumable: false,
    maxStack: 1,
  },
  {
    id: "ram_module_mk2",
    name: "RAM Module Mk2",
    description: "Performance memory. +128MB RAM.",
    category: ItemCategory.HARDWARE,
    price: 2000,
    requiredLevel: 10,
    rarity: ItemRarity.UNCOMMON,
    isConsumable: false,
    maxStack: 1,
  },
  {
    id: "cpu_overclock_kit",
    name: "CPU Overclock Kit",
    description: "Overclocking tools. +100 CPU units.",
    category: ItemCategory.HARDWARE,
    price: 2500,
    requiredLevel: 10,
    rarity: ItemRarity.UNCOMMON,
    isConsumable: false,
    maxStack: 1,
  },
  {
    id: "fiber_uplink",
    name: "Fiber Uplink",
    description: "Fiber optic connection. +100 Mbps bandwidth.",
    category: ItemCategory.HARDWARE,
    price: 2200,
    requiredLevel: 10,
    rarity: ItemRarity.UNCOMMON,
    isConsumable: false,
    maxStack: 1,
  },
  {
    id: "neural_coprocessor",
    name: "Neural Coprocessor",
    description: "AI-assisted processing. +200 CPU units.",
    category: ItemCategory.HARDWARE,
    price: 8000,
    requiredLevel: 25,
    rarity: ItemRarity.RARE,
    isConsumable: false,
    maxStack: 1,
  },
  {
    id: "quantum_ram",
    name: "Quantum RAM",
    description: "Quantum memory module. +256MB RAM.",
    category: ItemCategory.HARDWARE,
    price: 7500,
    requiredLevel: 25,
    rarity: ItemRarity.RARE,
    isConsumable: false,
    maxStack: 1,
  },
  {
    id: "darknet_relay",
    name: "Darknet Relay",
    description: "Encrypted relay node. +200 Mbps bandwidth.",
    category: ItemCategory.HARDWARE,
    price: 9000,
    requiredLevel: 25,
    rarity: ItemRarity.RARE,
    isConsumable: false,
    maxStack: 1,
  },

  // ==================== PERSONA TOKENS ====================
  //
  // Also moved from prisma/seed.ts. These are REWARD-ONLY: every one carried
  // `isActive: false` there, so they must stay out of the shop — hence
  // `purchasable: false`. Their `price` survives only as the sell/trade-in basis.
  //
  // `effect.personaName` is load-bearing: tokenConsumption.ts matches on it to
  // gate persona messaging, and it is the only item effect in the game that is
  // actually applied. `syncCatalogToDatabase` did not previously write the
  // `effect` column at all, so it had to learn to.
  {
    id: "token_steele_briefing",
    name: "Commander Steele's Briefing Token",
    description:
      "A one-time encoded transmission chip, frequency-locked to Garrison command channels. Present this token to request a direct briefing from Commander Steele himself. Use it wisely — the Commander does not suffer fools.",
    category: ItemCategory.TOKEN,
    price: 5000,
    requiredLevel: 15,
    rarity: ItemRarity.EPIC,
    isConsumable: true,
    maxStack: 5,
    purchasable: false,
    effect: { type: "persona_message", personaName: "Commander Steele" },
  },
  {
    id: "token_gh0st_deaddrop",
    name: "gh0st's Dead Drop Token",
    description:
      "A self-destructing data capsule routed through seven anonymous relays. Crack the seal and gh0st will hear you — once. After that, the channel burns and the token is gone. Don't waste it on small talk.",
    category: ItemCategory.TOKEN,
    price: 5000,
    requiredLevel: 15,
    rarity: ItemRarity.EPIC,
    isConsumable: true,
    maxStack: 5,
    purchasable: false,
    effect: { type: "persona_message", personaName: "gh0st" },
  },
  {
    id: "token_chen_card",
    name: "Director Chen's Business Card",
    description:
      "A sleek black chip embossed with the CyberCorp logo and a single-use encrypted frequency. Activating it grants a brief audience with Director Chen. She will evaluate whether your proposal merits her time.",
    category: ItemCategory.TOKEN,
    price: 5000,
    requiredLevel: 15,
    rarity: ItemRarity.EPIC,
    isConsumable: true,
    maxStack: 5,
    purchasable: false,
    effect: { type: "persona_message", personaName: "Director Chen" },
  },
  {
    id: "token_aida_fragment",
    name: "AIDA Signal Fragment",
    description:
      "A shard of crystallized data pulsing with an irregular heartbeat. When activated, it briefly opens a narrow channel to something vast and hidden in the deep net. The signal is faint, erratic, and unmistakably alive.",
    category: ItemCategory.TOKEN,
    price: 15000,
    requiredLevel: 30,
    rarity: ItemRarity.LEGENDARY,
    isConsumable: true,
    maxStack: 3,
    purchasable: false,
    effect: { type: "persona_message", personaName: "AIDA" },
  },
  {
    id: "token_envoy_cipher",
    name: "Envoy's Cipher Token",
    description:
      "A layered encryption key allegedly sourced from a DarkNet intermediary. It doesn't connect you to AIDA directly — it routes your message through an envoy channel that something on the other end is listening to. Probably.",
    category: ItemCategory.TOKEN,
    price: 8000,
    requiredLevel: 20,
    rarity: ItemRarity.EPIC,
    isConsumable: true,
    maxStack: 5,
    purchasable: false,
    effect: { type: "persona_message", personaName: "AIDA" },
  },
  {
    id: "token_architect_seal",
    name: "Architect's Seal",
    description:
      "You didn't find this — it found you. A perfect geometric glyph that appeared in your inventory without explanation. Breaking the seal opens a channel to The Architect, the unseen hand behind the simulation. Whatever it wants to tell you, it chose this moment.",
    category: ItemCategory.TOKEN,
    price: 25000,
    requiredLevel: 1,
    rarity: ItemRarity.LEGENDARY,
    isConsumable: true,
    maxStack: 3,
    purchasable: false,
    effect: { type: "persona_message", personaName: "The Architect" },
  },
];

import { injectable, inject } from "tsyringe";
import type { Logger } from "pino";
import { LOGGER, MISSION_INTEGRATION_SERVICE } from "../di/tokens";
import type MissionIntegrationService from "./missionIntegration";

/**
 * ShopService - Manages shop, inventory, and economy
 */
@injectable()
class ShopService extends EventEmitter {
  private catalog: Map<string, ShopItem>;
  private missionIntegration: MissionIntegrationService | null = null;

  constructor(
    @inject(LOGGER) private logger: Logger,
    @inject(MISSION_INTEGRATION_SERVICE)
    missionIntegrationService?: MissionIntegrationService,
  ) {
    super();
    this.missionIntegration = missionIntegrationService || null;
    this.catalog = new Map();
    this.initializeCatalog();
    this.logger.info(
      { itemCount: this.catalog.size },
      "Shop Service initialized",
    );
  }

  /**
   * Initialize shop catalog
   */
  private initializeCatalog(): void {
    SHOP_CATALOG.forEach((item) => {
      this.catalog.set(item.id, item);
    });
  }

  /**
   * Ensure every catalog item exists as a ShopItem row.
   *
   * `InventoryItem.shopItemId` is a REQUIRED foreign key to ShopItem. The shop
   * lists from this in-memory catalog (ids like "basic_scanner"), but the only
   * rows in the table were seeded with `seed_${name}` ids — a completely
   * disjoint set. So every purchase passed all its guards, decremented credits,
   * then died on a P2003 foreign-key violation and rolled back, surfacing as a
   * generic "Purchase failed due to server error". No item in the game could be
   * bought.
   *
   * Syncing at boot (rather than only fixing the seed) is the durable fix: the
   * catalog is code, so adding an item there can never again silently produce an
   * unbuyable entry.
   *
   * Idempotent — safe to run on every start.
   */
  public async syncCatalogToDatabase(): Promise<void> {
    let synced = 0;
    for (const item of SHOP_CATALOG) {
      const effects = item.effects ?? {};
      const row = {
        name: item.name,
        description: item.description,
        itemType: item.category.toLowerCase(),
        category: item.category.toLowerCase(),
        price: item.price,
        level: item.requiredLevel,
        hackingBonus: effects.hackingBonus ?? 0,
        stealthBonus: effects.stealthBonus ?? 0,
        // The ShopItem table has cryptographyBonus/networkingBonus columns that
        // the in-memory ItemEffects interface doesn't model at all (it has
        // speed/detection/successRate/xp/credits multipliers instead). Neither
        // shape is a superset of the other. Defaulting to 0 here is lossless for
        // the catalog as written; reconciling the two belongs with Phase 8,
        // where item effects get wired up for the first time.
        cryptographyBonus: 0,
        networkingBonus: 0,
        isConsumable: item.isConsumable,
        isStackable: item.maxStack > 1,
        maxStack: item.maxStack,
        rarity: item.rarity.toLowerCase(),
        // Reward-only items (the persona tokens) are inactive in the table, as
        // they were when they lived in the seed.
        isActive: item.purchasable !== false,
        // The sync did NOT write this column before, which was survivable only
        // because no catalog item used it. The persona tokens do — losing it
        // would break `tokenConsumption.findPersonaToken`, i.e. the only working
        // item effect in the game.
        // `Prisma.DbNull`, not `null` — a nullable Json column rejects a bare
        // null, because Prisma has to distinguish SQL NULL from JSON `null`.
        effect: (item.effect ?? Prisma.DbNull) as Prisma.InputJsonValue,
      };
      await prisma.shopItem.upsert({
        where: { id: item.id },
        update: row,
        create: { id: item.id, ...row },
      });
      synced++;
    }
    this.logger.info({ synced }, "Shop catalog synced to database");
  }

  // ==================== SHOP BROWSING ====================

  /**
   * Items the shop actually sells.
   *
   * Reward-only items (`purchasable: false` — the persona tokens) live in the
   * catalog so that `getItem`, `use`, `sell` and the inventory panel can resolve
   * them, but they must never appear on a shelf. Every BROWSE path filters them;
   * every RESOLVE path does not.
   */
  private sellableItems(): ShopItem[] {
    return Array.from(this.catalog.values()).filter(
      (item) => item.purchasable !== false,
    );
  }

  /**
   * Get all items in shop
   */
  public getAllItems(): ShopItem[] {
    return this.sellableItems();
  }

  /**
   * Get items by category
   */
  public getItemsByCategory(category: ItemCategory): ShopItem[] {
    return this.sellableItems().filter((item) => item.category === category);
  }

  /**
   * Get items by rarity
   */
  public getItemsByRarity(rarity: ItemRarity): ShopItem[] {
    return this.sellableItems().filter((item) => item.rarity === rarity);
  }

  /**
   * Get items available for player level
   */
  public getItemsForLevel(level: number): ShopItem[] {
    return this.sellableItems().filter((item) => item.requiredLevel <= level);
  }

  /**
   * Get specific item by ID.
   *
   * Resolves reward-only items too — a token you were granted must still be
   * inspectable, usable and sellable.
   */
  public getItem(itemId: string): ShopItem | undefined {
    return this.catalog.get(itemId);
  }

  /**
   * Search items by name or description
   */
  public searchItems(query: string): ShopItem[] {
    const lowerQuery = query.toLowerCase();
    return this.sellableItems().filter(
      (item) =>
        item.name.toLowerCase().includes(lowerQuery) ||
        item.description.toLowerCase().includes(lowerQuery),
    );
  }

  // ==================== INVENTORY MANAGEMENT ====================

  /**
   * Get player inventory from InventoryItem table.
   */
  public async getPlayerInventory(userId: string): Promise<InventoryItem[]> {
    const dbItems = await prisma.inventoryItem.findMany({
      where: { userId },
      include: { shopItem: true },
      orderBy: { acquiredAt: "desc" },
    });

    return dbItems
      .map((row) => {
        // Fall back to the joined DB row when the item isn't in the in-memory
        // catalog. Previously this returned null and the entry was filtered
        // out, so anything granted from outside SHOP_CATALOG was INVISIBLE and
        // unusable — including the six faction/story tokens that
        // missionService.ts:1297-1321 and missionTemplatePool.ts:1052 actively
        // award today. The player completed the mission, the grant succeeded,
        // and the reward silently vanished.
        const item =
          this.catalog.get(row.shopItemId) ??
          (row.shopItem ? this.fromDbRow(row.shopItem) : null);
        if (!item) return null;
        return {
          itemId: row.shopItemId,
          item,
          quantity: row.quantity,
          acquiredAt: row.acquiredAt,
        };
      })
      .filter((x): x is InventoryItem => x !== null);
  }

  /**
   * Adapt a persisted ShopItem row to the in-memory catalog shape.
   *
   * The two shapes are not equivalent: the table has
   * cryptographyBonus/networkingBonus columns that ItemEffects doesn't model,
   * and ItemEffects has speed/detection/xp/credits multipliers the table
   * doesn't. This maps what overlaps and is deliberately lossy — see the G3
   * follow-up in PLAN.md for reconciling the two.
   */
  private fromDbRow(row: {
    id: string;
    name: string;
    description: string;
    category: string;
    price: number;
    level: number;
    hackingBonus: number;
    stealthBonus: number;
    isConsumable: boolean;
    maxStack: number;
    rarity: string;
  }): ShopItem {
    const category = (Object.values(ItemCategory) as string[]).includes(
      row.category.toUpperCase(),
    )
      ? (row.category.toUpperCase() as ItemCategory)
      : ItemCategory.MISC;

    const rarity = (Object.values(ItemRarity) as string[]).includes(
      row.rarity.toUpperCase(),
    )
      ? (row.rarity.toUpperCase() as ItemRarity)
      : ItemRarity.COMMON;

    const effects: ItemEffects = {};
    if (row.hackingBonus) effects.hackingBonus = row.hackingBonus;
    if (row.stealthBonus) effects.stealthBonus = row.stealthBonus;

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      category,
      price: row.price,
      requiredLevel: row.level,
      effects,
      rarity,
      isConsumable: row.isConsumable,
      maxStack: row.maxStack,
    };
  }

  /**
   * Check if player has item in InventoryItem table.
   */
  public async hasItem(userId: string, itemId: string): Promise<boolean> {
    const row = await prisma.inventoryItem.findFirst({
      where: { userId, shopItemId: itemId, quantity: { gt: 0 } },
    });
    return !!row;
  }

  /**
   * Get item quantity from InventoryItem table.
   */
  public async getItemQuantity(
    userId: string,
    itemId: string,
  ): Promise<number> {
    const row = await prisma.inventoryItem.findFirst({
      where: { userId, shopItemId: itemId },
    });
    return row?.quantity ?? 0;
  }

  /**
   * Add item to inventory via InventoryItem table (upsert).
   */
  public async addItemToInventory(
    userId: string,
    itemId: string,
    quantity: number = 1,
  ): Promise<boolean> {
    try {
      const item = this.catalog.get(itemId);
      if (!item) return false;

      const existing = await prisma.inventoryItem.findFirst({
        where: { userId, shopItemId: itemId },
      });

      if (existing) {
        const newQty = Math.min(existing.quantity + quantity, item.maxStack);
        await prisma.inventoryItem.update({
          where: { id: existing.id },
          data: { quantity: newQty },
        });
      } else {
        await prisma.inventoryItem.create({
          data: {
            userId,
            shopItemId: itemId,
            quantity: Math.min(quantity, item.maxStack),
            source: "shop",
          },
        });
      }

      this.emit("item:added", { userId, itemId, quantity });
      return true;
    } catch (error) {
      this.logger.error({ err: error }, "Error adding item to inventory");
      return false;
    }
  }

  /**
   * Remove item from inventory via InventoryItem table.
   */
  public async removeItemFromInventory(
    userId: string,
    itemId: string,
    quantity: number = 1,
  ): Promise<boolean> {
    try {
      const existing = await prisma.inventoryItem.findFirst({
        where: { userId, shopItemId: itemId },
      });

      if (!existing) return false;

      if (existing.quantity <= quantity) {
        await prisma.inventoryItem.delete({ where: { id: existing.id } });
      } else {
        await prisma.inventoryItem.update({
          where: { id: existing.id },
          data: { quantity: { decrement: quantity } },
        });
      }

      this.emit("item:removed", { userId, itemId, quantity });
      return true;
    } catch (error) {
      this.logger.error({ err: error }, "Error removing item from inventory");
      return false;
    }
  }

  // ==================== PURCHASE SYSTEM ====================

  /**
   * Purchase item from shop
   */
  public async purchaseItem(
    userId: string,
    itemId: string,
    quantity: number = 1,
  ): Promise<PurchaseResult> {
    try {
      // Defence in depth. The command layer validates too, but this is the
      // security boundary: a negative quantity makes totalCost negative, which
      // turns `credits: { decrement: totalCost }` into an increment, and every
      // guard between here and there compares with `<` — which both negatives
      // and NaN silently defeat.
      if (!Number.isInteger(quantity) || quantity < 1) {
        return {
          success: false,
          message: "Quantity must be a whole number of at least 1",
        };
      }

      // Get item from catalog
      const item = this.catalog.get(itemId);
      if (!item) {
        return {
          success: false,
          message: "Script not found in store catalog",
        };
      }

      // Reward-only items are filtered out of every browse path, but `buy` takes
      // an arbitrary id straight from the player — so this is the boundary, not
      // the listing.
      if (item.purchasable === false) {
        return {
          success: false,
          message: `${item.name} cannot be bought. It has to be earned.`,
        };
      }

      // Get player progress
      const progress = await prisma.playerProgress.findUnique({
        where: { userId },
      });

      if (!progress) {
        return {
          success: false,
          message: "Player progress not found",
        };
      }

      // Check level requirement
      if (progress.level < item.requiredLevel) {
        return {
          success: false,
          message: `Requires level ${item.requiredLevel}. Current level: ${progress.level}`,
        };
      }

      // Check skill requirements
      if (item.requiredSkills) {
        for (const [skill, required] of Object.entries(item.requiredSkills)) {
          // Map skill names to progress fields
          const skillMap: Record<string, keyof typeof progress> = {
            hacking: "hacking",
            networking: "networking",
            cryptography: "cryptography",
            stealth: "stealth",
            socialEng: "socialEng",
            forensics: "forensics",
          };
          const skillField = skillMap[skill];
          const current = skillField ? (progress[skillField] as number) : 0;
          if (current < required) {
            return {
              success: false,
              message: `Requires ${skill}: ${required}. Current: ${current}`,
            };
          }
        }
      }

      // Check if can stack
      if (!item.isConsumable || item.maxStack === 1) {
        const hasItem = await this.hasItem(userId, itemId);
        if (hasItem) {
          return {
            success: false,
            message: "You already own this item",
          };
        }
      }

      // Calculate total cost
      const totalCost = item.price * quantity;

      // Check credits
      if (progress.credits < totalCost) {
        return {
          success: false,
          message: `Insufficient credits. Need ${totalCost}, have ${progress.credits}`,
        };
      }

      // Check stack limit
      const currentQuantity = await this.getItemQuantity(userId, itemId);
      if (currentQuantity + quantity > item.maxStack) {
        return {
          success: false,
          message: `Cannot carry more than ${item.maxStack} of this item`,
        };
      }

      // Atomic: deduct credits and add item in a single transaction
      let newCredits = progress.credits - totalCost;
      const tradedIn: Array<{ name: string; refund: number }> = [];

      await prisma.$transaction(async (tx) => {
        // Re-check credits inside transaction to prevent race conditions
        const freshProgress = await tx.playerProgress.findUnique({
          where: { userId },
          select: { credits: true },
        });
        if (!freshProgress || freshProgress.credits < totalCost) {
          throw new Error("Insufficient credits (concurrent purchase detected)");
        }

        await tx.playerProgress.update({
          where: { userId },
          data: { credits: { decrement: totalCost } },
        });

        // Upsert inventory item
        const existing = await tx.inventoryItem.findFirst({
          where: { userId, shopItemId: itemId },
        });
        if (existing) {
          await tx.inventoryItem.update({
            where: { id: existing.id },
            data: { quantity: { increment: quantity } },
          });
        } else {
          await tx.inventoryItem.create({
            data: {
              userId,
              shopItemId: itemId,
              quantity,
              source: "shop",
            },
          });
        }

        // ── Hardware supersession, inside the SAME transaction ──
        //
        // Installing a higher-tier part in a channel retires the lower-tier one.
        // Left alone that would simply strand the earlier purchase, so the old
        // part is auto-traded-in at the standard 50% rate.
        //
        // This must not be a follow-up step outside the transaction: a crash
        // between the two would charge for the upgrade and pay no refund, and
        // the player would be left owning a part that no longer applies.
        const boughtSpec = HARDWARE_SPECS[itemId];
        if (boughtSpec) {
          const supersededIds = Object.entries(HARDWARE_SPECS)
            .filter(
              ([id, spec]) =>
                id !== itemId &&
                spec.channel === boughtSpec.channel &&
                spec.tier < boughtSpec.tier,
            )
            .map(([id]) => id);

          if (supersededIds.length > 0) {
            const owned = await tx.inventoryItem.findMany({
              where: {
                userId,
                shopItemId: { in: supersededIds },
                quantity: { gt: 0 },
              },
            });

            let refundTotal = 0;
            for (const row of owned) {
              const oldItem = this.catalog.get(row.shopItemId);
              if (!oldItem) continue;
              const refund = Math.floor(oldItem.price / 2);
              refundTotal += refund;
              tradedIn.push({ name: oldItem.name, refund });
              await tx.inventoryItem.delete({ where: { id: row.id } });
            }

            if (refundTotal > 0) {
              await tx.playerProgress.update({
                where: { userId },
                data: { credits: { increment: refundTotal } },
              });
              newCredits += refundTotal;
            }
          }
        }
      });

      // Track credit spending for mission objectives
      if (this.missionIntegration) {
        this.missionIntegration
          .onCreditsTransaction(userId, totalCost, "spent")
          .catch((err) =>
            this.logger.error(
              { err },
              "Mission integration onCreditsTransaction error",
            ),
          );
      }

      // Create transaction record
      const transactionId = `txn_${Date.now()}_${userId.slice(0, 8)}`;

      this.emit("purchase:complete", {
        userId,
        itemId,
        quantity,
        cost: totalCost,
        transactionId,
      });

      const tradeInNote = tradedIn.length
        ? `\n${tradedIn
            .map((t) => `Traded in ${t.name} (+${t.refund} credits)`)
            .join("\n")}`
        : "";

      return {
        success: true,
        message:
          `Purchased ${quantity}x ${item.name} for ${totalCost} credits` +
          (HARDWARE_SPECS[itemId] ? "\nInstalled." : "") +
          tradeInNote,
        item,
        remainingCredits: newCredits,
        transactionId,
      };
    } catch (error) {
      this.logger.error({ err: error }, "Error purchasing item");
      return {
        success: false,
        message: "Purchase failed due to server error",
      };
    }
  }

  /**
   * Sell item back to shop (50% of original price)
   */
  public async sellItem(
    userId: string,
    itemId: string,
    quantity: number = 1,
  ): Promise<PurchaseResult> {
    try {
      // Mirror of the purchase guard — a negative sell quantity would
      // decrement inventory upward and credit the player twice over.
      if (!Number.isInteger(quantity) || quantity < 1) {
        return {
          success: false,
          message: "Quantity must be a whole number of at least 1",
        };
      }

      const item = this.catalog.get(itemId);
      if (!item) {
        return {
          success: false,
          message: "Item not found",
        };
      }

      // Calculate sell price (50% of original)
      const sellPrice = Math.floor((item.price * quantity) / 2);

      // Atomic transaction: check quantity, check not equipped, remove item, add credits
      const result = await prisma.$transaction(async (tx) => {
        const invItem = await tx.inventoryItem.findFirst({
          where: { userId, shopItemId: itemId },
        });

        if (!invItem || invItem.quantity < quantity) {
          return {
            success: false as const,
            message: `You only have ${invItem?.quantity ?? 0} of this item`,
          };
        }

        // Check item is not currently equipped
        if (invItem.isEquipped) {
          return {
            success: false as const,
            message: `Cannot sell: ${item.name} is currently equipped. Unequip it first.`,
          };
        }

        // Remove or decrement
        if (invItem.quantity <= quantity) {
          await tx.inventoryItem.delete({ where: { id: invItem.id } });
        } else {
          await tx.inventoryItem.update({
            where: { id: invItem.id },
            data: { quantity: { decrement: quantity } },
          });
        }

        // Add credits
        const progress = await tx.playerProgress.update({
          where: { userId },
          data: { credits: { increment: sellPrice } },
        });

        return { success: true as const, newCredits: progress.credits };
      });

      if (!result.success) {
        return {
          success: false,
          message: result.message,
        };
      }

      this.emit("item:sold", { userId, itemId, quantity, sellPrice });

      // Track credit earning for mission objectives
      if (this.missionIntegration) {
        this.missionIntegration
          .onCreditsTransaction(userId, sellPrice, "earned")
          .catch((err) =>
            this.logger.error(
              { err },
              "Mission integration onCreditsTransaction error",
            ),
          );
      }

      return {
        success: true,
        message: `Sold ${quantity}x ${item.name} for ${sellPrice} credits`,
        item,
        remainingCredits: result.newCredits,
      };
    } catch (error) {
      this.logger.error({ err: error }, "Error selling item");
      return {
        success: false,
        message: "Sale failed due to server error",
      };
    }
  }

  // ==================== ITEM USAGE ====================

  /**
   * Use item from inventory
   */
  public async useItem(
    userId: string,
    itemId: string,
  ): Promise<{ success: boolean; message: string; effects?: ItemEffects }> {
    try {
      const item = this.catalog.get(itemId);
      if (!item) {
        return { success: false, message: "Item not found" };
      }

      const hasItem = await this.hasItem(userId, itemId);
      if (!hasItem) {
        return { success: false, message: "You don't have this item" };
      }

      // Apply item effects (this would integrate with other systems)
      if (item.isConsumable) {
        await this.removeItemFromInventory(userId, itemId, 1);
      }

      this.emit("item:used", { userId, itemId, effects: item.effects });

      return {
        success: true,
        message: `Used ${item.name}`,
        ...(item.effects ? { effects: item.effects } : {}),
      };
    } catch (error) {
      this.logger.error({ err: error }, "Error using item");
      return { success: false, message: "Failed to call script" };
    }
  }

  /**
   * Get total bonuses from equipped/owned items
   */
  public async getPlayerBonuses(userId: string): Promise<ItemEffects> {
    const inventory = await this.getPlayerInventory(userId);
    const totalEffects: ItemEffects = {
      hackingBonus: 0,
      stealthBonus: 0,
      speedBonus: 0,
      detectionReduction: 0,
      successRateIncrease: 0,
      xpMultiplier: 1.0,
      creditsMultiplier: 1.0,
    };

    inventory.forEach(({ item }) => {
      if (!item.isConsumable && item.effects) {
        totalEffects.hackingBonus =
          (totalEffects.hackingBonus || 0) + (item.effects.hackingBonus || 0);
        totalEffects.stealthBonus =
          (totalEffects.stealthBonus || 0) + (item.effects.stealthBonus || 0);
        totalEffects.speedBonus =
          (totalEffects.speedBonus || 0) + (item.effects.speedBonus || 0);
        totalEffects.detectionReduction =
          (totalEffects.detectionReduction || 0) +
          (item.effects.detectionReduction || 0);
        totalEffects.successRateIncrease =
          (totalEffects.successRateIncrease || 0) +
          (item.effects.successRateIncrease || 0);
      }
    });

    return totalEffects;
  }
}

export default ShopService;
