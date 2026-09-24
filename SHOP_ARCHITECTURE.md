# Shop, inventory, equipment and the player rig — how it actually works

**Written 2026-08-31**, before touching G3, at the maintainer's instruction — the same call that
produced `MISSIONS_ARCHITECTURE.md`, and for the same reason. G3 was scoped in PLAN.md as *"all 8
`initComputerSpec` call sites omit the argument"*. That is true and it is the **last** of five links,
every one of which is broken. Fixing only the argument would have changed nothing observable, and I
would have reported it as done.

Everything below is read from the code. Claims I verified by execution are marked **[ran]**.

---

## 1. There are two disjoint item universes

This is the single fact that explains most of the defects.

**Universe A — `SHOP_CATALOG`**, an in-memory array of **18 items** in code at
`server/src/services/shopService.ts:82`, keyed by ids like `basic_scanner`, `quantum_charge`,
`cpu_upgrade`. At boot, `index.ts:112` calls `syncCatalogToDatabase()`
(`shopService.ts:436`), which upserts each entry into the `ShopItem` table **using the catalog id as
the row id**. This sync is load-bearing: `InventoryItem.shopItemId` is a required FK, and before the
sync existed every purchase died on a P2003 violation.

**Universe B — the seeded rows**, `prisma/seed.ts:2671-2975`, written with ids generated as
`` `seed_${item.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}` `` (`seed.ts:2969`). Nothing ever adds
these to the in-memory catalog. The two id spaces are disjoint, and so are the names — the seed has
"Port Scanner Pro", the catalog has "Port Scanner".

**Every action resolves through the catalog. Only display reads the table.**

| Path | Source | Behaviour for a Universe-B item |
|---|---|---|
| `shop` (list) | `getAllItems()` → catalog | invisible |
| `buy` | `catalog.get(itemId)` `shopService.ts:735` | `"Script not found in store catalog"` |
| `sell` | `catalog.get` `:913` | `"Item not found"` |
| `use` | `catalog.get` `:1010` | `"Item not found"` |
| `equip` | `getItem()` → catalog `:512` | `"Item not found: seed_..."` |
| `scripts` (inventory) | catalog **∪ DB** `:549-551` | **shown** |
| `equipment` panel | catalog only `:507` | silently omitted, not even a blank row |

So a seeded item a player owns is visible, unusable, unsellable, and unequippable. That asymmetry is
deliberate in one direction — the `getPlayerInventory` fallback was added because mission-granted
tokens were previously *invisible* — but it was never carried through to the action paths.

Two further consequences:

- `fromDbRow` (`shopService.ts:572`) derives the category from the `category` **column**, and maps
  anything it doesn't recognise to `ItemCategory.MISC` (`:585-589`). The seed uses lore categories
  (`"hardware"`, `"communication"`, `"hacking"`, `"faction"`, …), **none** of which are `ItemCategory`
  members. All 29 seeded rows therefore become `MISC`, and `MISC` is not equipable
  (`inventoryService.ts:99-105`).
- The AI can name seeded items. `aiAgentTools.ts:371` (`get_shop_items`) reads the **table**, so an AI
  that awards a `seed_*` item produces a grant the player can see and never use.

---

## 2. What the player actually touches is a GUI, not the ASCII panels

`client/src/components/Terminal.svelte:726-746` intercepts commands **before** they reach the server:

```ts
if (cmdName === "shop") { openDialog("shop"); ... return; }
if (cmdName === "inventory" || cmdName === "equipment" ||
    cmdName === "gear"     || cmdName === "scripts") { openDialog("equipment"); ... return; }
```

`ShopDialog.svelte` (851 lines) and `EquipmentDialog.svelte` (1080 lines) are real UIs, but they are
façades that re-issue the same text commands and read the structured `data` payload.

**The intercept dispatches on `cmdParts[0]` and throws the arguments away.** `shop EXPLOIT` and
`shop exploit scanner` — the literal examples in the server's own help text
(`shopCommands.ts:101`) — cannot reach the server from the browser at all. The server's
`multiPanel`/`render` shop and inventory boxes are unreachable in the web client; they exist for a
terminal that most players never use.

`buy`, `sell`, `use`, `equip`, `unequip` are **not** intercepted and do execute server-side.

---

## 3. Item effects are displayed and never applied

Two different functions sum bonuses, by two different rules, over two different item sets, and
**neither result reaches gameplay**:

| Function | Set summed | Respects `isEquipped`? | Sole caller |
|---|---|---|---|
| `shopService.getPlayerBonuses` `:1041` | entire inventory | **no** | `shopCommands.ts:161`, renders `scripts` |
| `inventoryService.getEquipmentBonuses` `:244` | equipped only | yes | `shopCommands.ts:491`, renders `equipment` |

So the two panels can and do disagree, and both are decorative.

Every effect field, with its real consumer:

| Field | Applied to gameplay? |
|---|---|
| `ItemEffects.hackingBonus`, `stealthBonus`, `speedBonus`, `detectionReduction`, `successRateIncrease` | **No** — display only |
| `ItemEffects.xpMultiplier`, `creditsMultiplier` | **No.** `getPlayerBonuses` initialises them to `1.0` (`:1049-1050`) and never touches them again |
| `ShopItem.cryptographyBonus`, `networkingBonus` (columns) | **Dead.** Written as literal `0` by the sync (`:455-456`); only seeded rows carry values, and nothing reads them |
| `ShopItem.effect` Json, `type: "persona_message"` | **Yes** — `tokenConsumption.ts:103`. The only working item effect in the game |
| `ShopItem.effect` Json, `type: "unlock_area"` (documented at `schema.prisma:1173`) | no consumer |

`useItem` (`shopService.ts:1005`) decrements the stack, emits `item:used`, and returns the effects to
the client — under a comment that says it all: *"Apply item effects (this would integrate with other
systems)"* (`:1020`). `stealth_boost`, `xp_booster`, `credit_multiplier`, `data_backup` and
`zero_day_exploit` are consumed for literally nothing.

**Equipping is cosmetic.** The one place item ownership genuinely affects mechanics is hacking, and it
checks *ownership, not equipped state*: `hackCommands.ts:849-874` maps a tool keyword to a catalog id
via `HACK_TOOL_ITEMS` (`gameBalance.ts:40-52`), calls `shopService.hasItem`, and feeds
`hackService.calculateToolBonus` — which uses its own hardcoded `TOOL_EFFECTIVENESS` table
(`hackService.ts:72`), not the item's `effects`.

Events `purchase:complete`, `item:used`, `item:sold`, `item:equipped`, `item:unequipped`,
`item:auto_unequipped`, `equipment:cleared` — **zero listeners**, server or client.

---

## 4. The rig: what is live and what is dead

`MemoryService` holds four in-memory maps keyed by userId (`memoryService.ts:207-210`). Nothing about
a player's spec is persisted — there are no CPU/RAM/bandwidth columns on `User` or `PlayerProgress`.
The rig is derived from level on demand:

```ts
cpuTotal: 200 + Math.floor(playerLevel / 10) * 100 + (equipmentBonuses?.cpu || 0),
ramTotal: 256 + Math.floor(playerLevel / 10) * 128 + (equipmentBonuses?.ram || 0),
bwTotal:  100 + Math.floor(playerLevel / 10) * 50  + (equipmentBonuses?.bw  || 0),
```

**The whole session lifecycle is dead code.** Verified with a positive control after an empty grep
turned out to be a wrong-directory artefact rather than a finding:

- `initializeSession` (`:674`) — **zero callers**. So `registerTerminal(userId, "default", "Terminal 1")`
  (`:676`) never runs; the terminal passive consumer does not exist in the running game.
- `cleanupSession` (`:683`) — **zero callers**. `baseSpecs.delete` appears exactly once, at `:696`,
  inside it. All four maps therefore **leak for the server's lifetime** and survive reconnects.
- `registerConnection`, `registerBackdoor`, `unregisterConnection`, `unregisterBackdoor`,
  `unregisterTerminal`, `unregisterActiveTrace` — definitions with **zero callers**.
- `registerActiveTrace` has exactly one caller (`hackService.ts:1963`) and is **never unregistered**,
  so a trace's 15 CPU / 16 RAM drain is permanent — it survives evading the trace.

**The resource readout lies.** No handler in `processCommands.ts` calls `initComputerSpec`, and
`getComputerSpec` falls back to `calculateBaseSpec(1)` when the map has no entry (`:244`). A level-40
player who connects and types `free` or `top` sees a hardcoded **200 / 256 / 100** until they run
their first hack or scan. The client store defaults to the same numbers
(`client/src/services/socket.ts:26-40`).

**And the client bars are usually stale.** The emitter skips players with no running processes
(`memoryService.ts:650-663`):

```ts
for (const [userId, userProcesses] of this.gameProcesses) {
  if (userProcesses.size === 0) continue;      // <-- no idle updates, ever
```

Bandwidth is never rendered client-side at all — `bwUsed`/`bwTotal` are destructured in
`Terminal.svelte:280-294` and unused; only `CPU:{n}%` and `RAM:{n}%` reach the status bar
(`:1650-1655`).

Two balance notes that fall out of the formula: `Math.floor(level / 10)` means **levels 1–9 are
identical** — no resource growth at all across most of the early game — and `nice` is half-wired, read
only by `hack`/`exploit` (`hackCommands.ts:416`), so it silently does nothing for scan, probe,
download, decrypt, analyze, sweep, whois and traceroute.

---

## 5. G3 specifically — five links, five breaks

The goal (maintainer, this session): *"this is how the players get more resources to maintain more
processes at the same time."*

| Link | State |
|---|---|
| 1. The items are purchasable | **Broken.** The 9 `HARDWARE_BONUSES` names exist only as `seed_*` rows. `shop` lists the catalog; they are invisible and `buy` rejects them. |
| 2. Hardware can be equipped | **Broken.** Seeded `category: "hardware"` → `MISC` → `"cannot be equipped"` (`inventoryService.ts:107-112`). |
| 3. Multiple parts can be active | **Broken by design.** Exactly one slot per category (`:132-141`), so at most one hardware item could ever apply — which cannot deliver "more resources". |
| 4. Bonuses reach the spec | **Broken.** `equippedItemNames` is optional and **all 9 call sites omit it** (`helpers.ts:165`, `hackCommands.ts:394/990/1328/1389/1450/1845`, `networkCommands.ts:1233`, `memoryService.ts:675`). `HARDWARE_BONUSES` and `sumHardwareBonuses` are unreachable. |
| 5. The player can see the result | **Broken.** No `specs`/`rig` command exists; `free`/`top` show a level-1 rig until a process spawns; the client shows no bandwidth and no idle updates. |

Link 4 is the one PLAN.md described. On its own it is a no-op.

---

## 6. Defect register

Ordered by player impact, not by area.

| # | Defect | Where |
|---|---|---|
| **S1** | `crack.protected` is unusable by anyone. The matcher looks for `"quantum charge"`; the item is `"Quantum Decryptor Charge"`. **[ran]** — the substring test returns `false`. The player is told *"Requires a Quantum Decryptor Charge"* while holding one. Meanwhile `use quantum_charge` succeeds and destroys the 7500-credit item for no effect. | `hackCommands.ts:1145` vs `shopService.ts:239` |
| **S2** | G3: hardware bonuses unreachable — the five links in §5. | §5 |
| **S3** | Every item effect except persona tokens is displayed and never applied. | §3 |
| **S4** | The two bonus panels use different summation rules over different sets and can disagree. | §3 |
| **S5** | **Every example item id in the shop help text is fictional** — `port_scanner`, `firewall`, `old_script`, `exploit_v1`, `health_pack`, `skill_boost`, `stealth_module`. None is among the 18 real ids. A player copying `man buy` verbatim gets "Script not found in store catalog". **[ran]** | `shopCommands.ts:108,115,122,129,136` |
| **S6** | Client intercept discards arguments, so `shop EXPLOIT` — the help's own example — cannot reach the server from the browser. | `Terminal.svelte:726-746` |
| **S7** | `shop <search>` with no category is impossible (`args[0]` is always consumed as a category), and when search *does* run it reassigns `items` wholesale, discarding both the category and the **player-level** filter — so it lists items the player cannot buy. | `shopCommands.ts:249, 265-267` |
| **S8** | Session lifecycle dead: four maps leak for the server's lifetime; the terminal consumer never registers. | `memoryService.ts:674, 683` |
| **S9** | Active-trace resource drain is permanent — `unregisterActiveTrace` has no callers. | `memoryService.ts:384` |
| **S10** | `free`/`top`/`ps`/`uptime` report a level-1 rig until the player's first process spawn. | `processCommands.ts`, `memoryService.ts:244` |
| **S11** | `resources:update` is never sent to idle players, so client bars sit stale. | `memoryService.ts:652` |
| **S12** | No `@@unique([userId, shopItemId])`. Duplicate rows are possible and every reader uses `findFirst`, so quantity silently under-reports and `equipItem` may act on a different row than `sellItem` guards. | `schema.prisma:1215-1217` |
| **S13** | `architectInterventionExecutor` does an unconditional `create` with an **unvalidated** AI-supplied `shopItemId` — reopens P2003 and manufactures the duplicates in S12. | `architectInterventionExecutor.ts:705` |
| **S14** | Mission/story/tutorial credit rewards use absolute assignment from a stale read (`credits = progress.credits + reward`) instead of `increment`, losing concurrent grants. | `missionService.ts:1145` |
| **S15** | Darknet `rare_script` reward never grants: looks up `"zero_day_exploit"` against the row named `"Zero-Day Exploit"`. Only the credits land. | `darknetDungeonService.ts:119, 1107` |
| **S16** | `maxStack` is checked outside the transaction (which re-checks credits only), so concurrent buys can both pass. | `shopService.ts:787, 809-815, 820-828` |
| **S17** | `EquipmentDialog` renders working Equip/Use buttons on seeded items where both are guaranteed to fail. | §1 |
| **S18** | `equipment` panel silently omits an equipped item missing from the catalog — no row, not even a placeholder. | `shopCommands.ts:502-540` |
| **S19** | `validateEquipment` (repairs `isEquipped=true, quantity<=0`) is never called. Also dead: `unequipAll`, `isEquipped`, `getEquippedSlot`, `addItemToInventory`. | `inventoryService.ts:333` |
| **S20** | Reseed hazard: `seed.ts:425` does `shopItem.deleteMany()` and `InventoryItem.shopItem` has no `onDelete`, so it defaults to `Restrict` — reseeding a DB where any player owns an item throws on the FK. The seed's `upsert` also passes `update: {}`, so re-running never corrects existing rows. | `seed.ts:425, 2970-2974` |
| **S21** | Levels 1–9 give identical resources. | `memoryService.ts:179-185` |
| **S22** | `nice` affects only `hack`/`exploit`; silently ignored by the eight helper-spawned commands. | `helpers.ts:188` |
| **S23** | Bandwidth is never displayed in the client. | `Terminal.svelte:280-294` |
| **S24** | `unequipItem`'s return type is a lie — the failure path omits `slot`/`itemId` and the result is force-cast `as unknown as EquipmentResult`. | `inventoryService.ts:213` |
| **S25** | Dead cost entries `crack_file` and `nslookup` have no spawner. `schema.prisma:1198` documents `slot` as `"primary"/"secondary"/…` while all code writes `TOOL`/`SOFTWARE`/…. | `memoryService.ts:100-115` |

---

## 7. Design decisions taken

Both settled by the maintainer this session, before any code was written.

**D1 — Hardware is installed, not equipped.** It leaves the equip system entirely. Buying a part
installs it; the bonuses are cumulative across the three channels (CPU / RAM / bandwidth). This fits
the fiction (you don't "equip" a RAM stick) and is the only shape that delivers the stated goal, since
one slot per category caps you at a single part.

*Consequence worth noting:* because hardware is non-consumable with `maxStack: 1`, and `purchaseItem`
already rejects a second copy with "You already own this item" (`shopService.ts:787`), **ownership is
exactly installation**. No new column, no new state, no migration. Selling a part uninstalls it.

**D2 — `SHOP_CATALOG` is the only source of truth.** The 9 hardware items move into the catalog in
code; the seeded `shopItems` block goes. One list, already synced to the table at boot, so an item can
never again be added somewhere the shop doesn't read.

### Open sub-decision — tier supersession vs. stacking

The option text you picked said *"supersedes RAM Module Mk1"*, and the preview arithmetic
(256 → 384 on installing Mk2) confirms supersession rather than summing. That is coherent, but it
strands the earlier purchase: a player who bought Mk1 for 500c finds it worthless the moment Mk2 is
installed.

**My recommendation:** supersede, but auto-trade-in the superseded part at the existing 50% sell rate
(`shopService.ts:922`), reported in the purchase output. That keeps the ladder clean, keeps exactly one
active part per channel, and never leaves dead weight in the inventory. The alternative — summing all
owned parts — is simpler to implement but makes the tiers a shopping list rather than a progression,
and inverts value-per-credit (Mk1 is 7.8 RAM/credit, Mk2 only 15.6 at four times the price).

I have not implemented either. Say which and I'll build it.

---

## 7a. Tier 1 — DONE 2026-08-31

The three string mismatches. All verified against a live database, not just read.

| # | Fix |
|---|---|
| **S1** | `crack.protected` now resolves the charge **by catalog id** (`QUANTUM_CHARGE_ITEM_ID` in `gameBalance.ts`, following the `HACK_TOOL_ITEMS` convention), with a scoped `findFirst` instead of pulling the whole inventory and filtering in JS. Runtime: the row is `id="quantum_charge", name="Quantum Decryptor Charge"` — so the old `.includes("quantum charge")` could never match. |
| **S5** | Every example id in the shop help replaced with a real catalog id. `shop`'s `[search]` argument was **removed from the help** rather than left advertised, because S7 makes it return items the player cannot buy; a comment points at S7 for restoring it. |
| **S15** | The darknet `rare_script` reward field renamed `scriptName` → `scriptItemId` (the value was always an id) and looked up with `findUnique({ where: { id } })`. Legacy `scriptName` on already-persisted `rewardData` is still read, so no data migration is needed. A missing row now **logs a warning** — the silence is why this paid nothing for as long as it existed. |

**Runtime proof of S15**, run against the live DB: the old lookup
`shopItem.findFirst({ where: { name: "zero_day_exploit" } })` returns **NULL**, while
`findUnique({ where: { id: "zero_day_exploit" } })` returns the row named `"Zero-Day Exploit"`.

**New: `scripts/verify-shop-contract.ts`** (5/5) closes the bug *class* rather than the three
instances — every string that must resolve to an item is now checked statically: help example ids,
`HACK_TOOL_ITEMS`, `QUANTUM_CHARGE_ITEM_ID`, darknet reward ids, and a ban on matching items by name
substring at all.

**Every check was negative-tested.** A passing check proves nothing until it has been seen to fail, so
each bug was reintroduced and the corresponding check confirmed to catch it:

```
mutation: restore a fictional example id   -> FAIL  unresolvable: buy port_scanner
mutation: restore the substring matcher    -> FAIL  hackCommands.ts: shopItem.name?.toLowerCase().includes(
mutation: restore the bad darknet id       -> FAIL  unresolvable: zero_day_exploit_typo
restored                                   -> 5/5 passed
```

The script also throws (rather than passing vacuously) if its catalog parse yields zero ids, if it
checks zero example ids, or if it finds zero darknet rewards — the failure mode that made the mission
provisioning check pass with zero switch arms.

### Correction to D2, found while doing this

**D2 as written — "delete the seeded `shopItems` block" — would break the only working item effect in
the game.** Six of the 19 seeded rows are `itemType: "token"` persona tokens (Commander Steele's
Briefing Token, gh0st's Dead Drop Token, Director Chen's Business Card, AIDA Signal Fragment, Envoy's
Cipher Token, Architect's Seal). They are live: `tokenConsumption.ts` gates persona messaging on them,
`missionService` drops them as rewards, and the darknet `aida_token` reward grants one.

They must **move into `SHOP_CATALOG`**, not be deleted. Live DB count confirms the split: 37 `ShopItem`
rows = 18 catalog + 19 seeded.

---

## 7b. G3 — DONE 2026-08-31

Hardware now changes the rig. **`scripts/verify-g3-hardware.ts` 19/19**, driving the real socket path
and asserting the *numbers*, not that a command printed something hopeful.

**What was built**, per D1/D2:

- The 9 hardware parts and 6 persona tokens **moved into `SHOP_CATALOG`**; the 4 seeded software
  duplicates were dropped. Two new categories: `HARDWARE` (deliberately absent from
  `equipableCategories`, so `equip` refuses it) and `TOKEN` (whose lowercased name becomes the
  `itemType: "token"` that `missionService` and `darknetDungeonService` query on).
- **Ownership is installation.** `HARDWARE_SPECS` in `gameBalance.ts` maps catalog id →
  `{channel, amount, tier}`, and `resolveInstalledHardware` keeps only the highest tier per channel.
- **Supersession with a 50% trade-in**, inside the *same transaction* as the purchase — a follow-up
  step would charge for the upgrade and pay no refund if it crashed between the two.
- **One helper, nine call sites.** `refreshComputerSpec` (helpers.ts) loads the owned parts and calls
  `initComputerSpec`. Every site that used to read only `level` now goes through it, so a new call
  site cannot reintroduce the omission by copying its neighbour.
- **A `specs` command**, and *all* process readouts (`ps`/`top`/`free`/`uptime`/`specs`) now refresh
  the rig first — closing S10, without which every hardware purchase would still have looked inert.
- `reconcileShopItems.ts` runs at **boot as well as seed**, because existing databases hold `seed_*`
  rows and will never be reseeded.

**Measured, on a level-30 player** (baseline 500 CPU / 640 MB / 250 Mbps):

```
tier-1 RAM raises the RAM ceiling by 64     640 -> 704
tier-2 SUPERSEDES tier-1 (not cumulative)   768 (cumulative would be 832)
purchase output reports the trade-in        Traded in RAM Module Mk1 (+250 credits)
trade-in refunds 50%                        49500 -> 47750 (net 1750)
a second channel adds on top                cpu 500->550, ram held at 768
hardware cannot be equipped                 "RAM Module Mk2 cannot be equipped (HARDWARE)"
persona tokens cannot be bought             "...cannot be bought. It has to be earned."
token kept its effect.personaName           {"type":"persona_message","personaName":"Commander Steele"}
```

### The harness caught two real problems on its first run — 13/19

1. **Four orphaned `seed_*` rows survived.** The reconcile only deleted ids in its rename map, so the
   four software duplicates — moved nowhere because catalog equivalents already exist — were stranded.
   It now sweeps *every* unreferenced `seed_*` row, and **skips (with a warning) any row a player still
   holds**, because `InventoryItem.shopItemId` has no `onDelete` and defaults to `Restrict`.
2. **My own harness bug:** the test player was level 1, so `buy ram_module_mk2` was correctly refused
   (tier 2 requires level 10) and four assertions failed for a reason unrelated to supersession. Fixed
   by levelling the test player to 30 — which is also why every assertion is written as a **delta from
   the measured baseline** rather than an absolute, since level feeds the same numbers.

`verify-shop-contract.ts` grew to **10/10** with the new invariants: `HARDWARE_SPECS` ↔ catalog
HARDWARE entries **in both directions** (a part with no spec would apply nothing), one part per
channel+tier, every token keeping `effect.personaName` *and* `purchasable: false`, and that the sync
writes the `effect` column at all.

### Two corrections to this document

- **S20 was wrong.** I claimed reseeding would throw on the `ShopItem` FK. It would not:
  `seed.ts` deletes `inventoryItem` *before* `shopItem`, so the order is already safe. The `upsert`
  with `update: {}` never refreshing existing rows was real, and is now moot — the seed no longer
  writes shop items at all.
- **D2 was refined during Tier 1**, not merely implemented: "delete the seeded block" became "move the
  hardware and tokens, drop the software duplicates", because six of those rows are live persona
  tokens.

**Still open from §6 and unchanged by this work:** S3/S4 (item effects displayed, never applied),
S6/S7 (client intercept and shop search), S8/S9 (dead session lifecycle, permanent trace drain),
S11 (no idle `resources:update`), S12/S13 (missing unique constraint, unvalidated grant), S14, S16,
S23 (bandwidth never rendered client-side).

---

## 8. Proposed fix order

**Tier 1 — player-visible lies, cheap to fix, no design input needed**
S1 (`crack.protected` is dead and eats a 7500c item), S5 (every help example is fictional),
S15 (darknet reward never grants). These are three string mismatches.

**Tier 2 — G3 proper**, per D1/D2 once the sub-decision above is settled: move the 9 items into the
catalog, derive installed bonuses from owned hardware, thread them into `initComputerSpec`, and add
the readout (S2, plus S10/S11/S23 so the player can actually see the effect — without those, G3 is
invisible and therefore untestable by the player).

**Tier 3 — correctness**
S12/S13 together (unique constraint + validated grant path; the constraint must land first or the
migration will fail on existing duplicates), S14, S16, S8, S9.

**Tier 4 — cleanup**
S7, S6, S17, S18, S19, S20, S24, S25, and the balance questions S21/S22.

---

## 9. What I verified, and what I did not

**Verified by running [ran]:** the `quantum charge` substring test returns false; the shop help's
example ids are absent from the 18-id catalog. All greps in §4 were re-run with absolute paths and a
positive control after an earlier empty result turned out to be a wrong-working-directory artefact,
not a finding.

**Verified by reading only:** everything else. In particular I have **not** executed a purchase,
an equip, or a resource readout against a live server. The claim "G3 changes nothing today" rests on
static reads.

**Not determined:**
- Whether live databases currently hold duplicate `(userId, shopItemId)` rows or stale
  `isEquipped=true, quantity<=0` rows — both are possible per S12/S19 and would need a data check
  before the S12 migration.
- Whether the AI actually populates `data.shopItemId` in the `grant_token` intervention (S13); only
  that it is accepted unvalidated.
- Whether `scripts/migrate-inventory-to-table.ts` is still relevant to the id split.

**Correction to an earlier claim of mine in this session:** I reported that `getCombinedBonuses` "has
zero callers — fully dead". `CombinedBonuses` is an *interface*; the method is `getEquipmentBonuses`
and it does have one caller (display). The conclusion held, but the grep matched a type name and I
reported it as a function.
