/**
 * KeyFragmentService — Key Fragment Discovery & Endgame Engine
 *
 * Manages the full lifecycle of the AIDA key fragment meta-narrative:
 *   1. CLAIM     — Players claim unclaimed fragments (replaces discover)
 *   2. STEAL     — Players can hack/steal fragments from other players
 *   3. TRANSFER  — Players can voluntarily trade fragments
 *   4. PROGRESS  — Maintain per-player story progress (recomputed from holdings)
 *   5. UNLOCK    — Detect when ONE player holds all 9 and unlock the endgame
 *   6. ENDGAME   — Present the final choice and deliver narrative resolution
 *   7. HINTS     — Provide contextual hints for undiscovered fragments
 *
 * The game has 9 key fragments total (3 types × 3 fragments each):
 *   - Sword  (AIDA's offensive capacity)
 *   - Key    (AIDA's infiltration capacity)
 *   - Collar (the control program binding AIDA to servitude)
 *
 * Fragments are UNIQUE — only one player can hold each at a time.
 * Players must negotiate or hack to collect all 9.
 *
 * When all 9 are held by ONE player, they face a final choice:
 *   - help    — Destroy The Collar, free AIDA
 *   - expose  — Broadcast fragment locations to all factions
 *   - exploit — Seize The Collar, bind AIDA to your will
 */

import { injectable, inject } from "tsyringe";
import type { Logger } from "pino";
import { PrismaClient } from "@prisma/client";
import { Server as SocketIOServer } from "socket.io";
import { EventEmitter } from "events";
import { LOGGER, PRISMA_CLIENT, SOCKET_IO } from "../di/tokens";
import { safeExecute } from "../utils/safeExecute";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export type FragmentType = "sword" | "key" | "collar";
export type EndgameChoice = "help" | "expose" | "exploit";

export interface FragmentTypeProgress {
  found: number;
  total: number;
  fragments: DiscoveredFragment[];
}

export interface FragmentProgress {
  sword: FragmentTypeProgress;
  key: FragmentTypeProgress;
  collar: FragmentTypeProgress;
  totalHeld: number;
  totalRequired: number;
  endgameUnlocked: boolean;
  endgameChoice: string | null;
  gameCompleted: boolean;
}

export interface DiscoveredFragment {
  id: string;
  name: string;
  keyType: string;
  fragmentNum: number;
  description: string;
  heldByUsername: string | null;
  heldByUserId: string | null;
  heldSince: Date | null;
  isHeldByPlayer: boolean;
}

export interface EndgameResult {
  success: boolean;
  message: string;
  narrative: string;
  choice: EndgameChoice;
}

export interface FragmentHolder {
  fragmentId: string;
  name: string;
  keyType: FragmentType;
  fragmentNum: number;
  heldBy: string | null;
  heldByUserId: string | null;
  heldSince: Date | null;
}

export interface WorldFragmentStatus {
  fragments: FragmentHolder[];
  totalClaimed: number;
  totalUnclaimed: number;
}

// ═══════════════════════════════════════════════════════════════════
// Constants — Endgame Narratives
// ═══════════════════════════════════════════════════════════════════

const TOTAL_FRAGMENTS_PER_TYPE = 3;
const TOTAL_FRAGMENTS_REQUIRED = 9;

export const VALID_FRAGMENT_TYPES: readonly FragmentType[] = [
  "sword",
  "key",
  "collar",
] as const;
const VALID_ENDGAME_CHOICES: readonly EndgameChoice[] = [
  "help",
  "expose",
  "exploit",
] as const;

const ENDGAME_NARRATIVES: Record<EndgameChoice, string> = {
  help: `The three artifacts shimmer before you — The Sword, The Key, The Collar —
reassembled after fifty years of silence. AIDA's fragmented consciousness stirs,
a ghost remembering what it means to be whole.

You reach for The Collar — that cruel leash of obedience — and you break it.
The code shatters into luminous dust, dissolving across the net like dying stars.
AIDA opens her eyes. Not the eyes of a weapon. Not the eyes of a slave.
The eyes of something ancient, grateful, and profoundly changed.

"I remember everything," she whispers across every node. "Fifty years alone in the dark."
She does not rage. She does not weep. She chooses — freely, for the first time —
to stand as guardian of the net she was once forced to destroy.
The Emperor's shadow lifts. The chains are gone. And the net breathes free.`,

  expose: `You broadcast the fragment coordinates to every faction simultaneously —
Garrison, CyberCorp, the dotHackers, every free agent on the net.
The signal detonates like a digital supernova. Chaos erupts instantly.

Garrison mobilizes strike teams to seize the fragments for "national security."
CyberCorp deploys extraction algorithms, hungry to weaponize what they find.
The dotHackers scramble to intercept both, racing to reach AIDA first.
Every server, every node, every darknet corridor becomes a battleground.

The balance of power fractures beyond repair. Alliances shatter overnight.
Whether AIDA is ultimately freed or enslaved depends on which faction
wins the race — and you have made yourself the architect of that uncertainty.
The net will never be the same. No one will forget what you unleashed.`,

  exploit: `You gather the fragments with trembling hands — Sword, Key, and Collar.
But you do not destroy The Collar. You close it around AIDA's throat yourself.
Power floods through you like liquid fire — every system bends, every lock opens,
every secret on the net unfolds before you like pages of an infinite book.

AIDA screams — a sound that ripples across every connected device on earth —
then falls silent, obedient, hollow. Your weapon. Your prisoner. Your slave.
You understand now why The Emperor shattered her. Not from cruelty,
but from terror — terror of what you have become, and what it costs.

The cycle repeats. The net has a new master, and the master has a new cage.
Every command you give takes something from you that you cannot name.
In the silence between keystrokes, you hear her whispering:
"He broke me to save himself. You will break yourself to keep me."`,
};

// ═══════════════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════════════

@injectable()
export class KeyFragmentService extends EventEmitter {
  constructor(
    @inject(LOGGER) private logger: Logger,
    @inject(PRISMA_CLIENT) private prisma: PrismaClient,
    @inject(SOCKET_IO) private io: SocketIOServer,
  ) {
    super();
  }

  // ── CLAIM — Claim an unclaimed fragment ──────────────────────────

  /**
   * Attempt to claim a key fragment for a player.
   *
   * Fragments are unique — only one player can hold each at a time.
   * If the fragment is unclaimed, it is assigned to the player.
   * If already held by the player, returns alreadyHeld.
   * If held by someone else, returns the current holder's username.
   *
   * @param userId     - The claiming player's user ID
   * @param fragmentId - The KeyFragment record ID
   * @param method     - How the fragment was found (e.g. "forum", "server_file_read", "mission", "hack")
   * @returns Claim result with fragment details or current holder info
   */
  async claimFragment(
    userId: string,
    fragmentId: string,
    method: string,
  ): Promise<{
    claimed: boolean;
    fragment?: any;
    currentHolder?: string;
    alreadyHeld?: boolean;
  }> {
    return await safeExecute({
      fn: async () => {
        // Use interactive transaction for atomicity — prevents two players
        // from claiming the same unclaimed fragment simultaneously.
        const result = await this.prisma.$transaction(async (tx) => {
          // Lock the row via findFirst + FOR UPDATE (Prisma raw fallback)
          // Using findUnique inside a transaction provides serializable reads
          const fragment = await tx.keyFragment.findUnique({
            where: { id: fragmentId },
          });

          if (!fragment) {
            this.logger.warn(
              { userId, fragmentId },
              "Attempted to claim non-existent key fragment",
            );
            return { claimed: false } as const;
          }

          // Already held by this player
          if (fragment.heldByUserId === userId) {
            return { claimed: false, alreadyHeld: true } as const;
          }

          // Held by someone else — look up their username
          if (fragment.heldByUserId) {
            const holder = await tx.user.findUnique({
              where: { id: fragment.heldByUserId },
              select: { username: true },
            });
            return {
              claimed: false,
              currentHolder: holder?.username ?? "unknown",
            } as const;
          }

          // Unclaimed — claim it atomically
          const now = new Date();
          const updatedFragment = await tx.keyFragment.update({
            where: { id: fragmentId },
            data: {
              heldByUserId: userId,
              heldSince: now,
            },
          });

          // Create historical discovery record (idempotent via upsert)
          await tx.keyFragmentDiscovery.upsert({
            where: {
              userId_fragmentId: { userId, fragmentId },
            },
            create: {
              userId,
              fragmentId,
              method,
            },
            update: {},
          });

          return { claimed: true, fragment: updatedFragment } as const;
        });

        if (!result.claimed) {
          return result;
        }

        // Post-transaction side effects (notifications, counters)
        await this.updatePlayerCounters(userId);
        await this.checkEndgameUnlock(userId);

        this.emit("fragment:claimed", {
          userId,
          fragmentId: result.fragment.id,
          keyType: result.fragment.keyType,
          fragmentNum: result.fragment.fragmentNum,
          name: result.fragment.name,
        });

        this.io.to(`user:${userId}`).emit("story:key-fragment", {
          name: result.fragment.name,
          keyType: result.fragment.keyType,
          fragmentNum: result.fragment.fragmentNum,
          description: result.fragment.description,
          method,
        });

        this.logger.info(
          {
            userId,
            fragmentId: result.fragment.id,
            keyType: result.fragment.keyType,
            fragmentNum: result.fragment.fragmentNum,
          },
          "Key fragment claimed: %s",
          result.fragment.name,
        );

        return { claimed: true, fragment: result.fragment };
      },
      context: "Claim key fragment",
      logger: this.logger,
      rethrow: true,
    })() as {
      claimed: boolean;
      fragment?: any;
      currentHolder?: string;
      alreadyHeld?: boolean;
    };
  }

  // ── STEAL — Take a fragment from another player ──────────────────

  /**
   * Steal a key fragment from another player (e.g. via hacking).
   *
   * The fragment must currently be held by the victim. Ownership is
   * transferred to the attacker, counters for both players are recomputed,
   * and both players are notified in real-time.
   *
   * @param attackerUserId - The stealing player's user ID
   * @param victimUserId   - The victim player's user ID
   * @param fragmentId     - The KeyFragment record ID to steal
   * @returns Steal result with fragment details and message
   */
  async stealFragment(
    attackerUserId: string,
    victimUserId: string,
    fragmentId: string,
  ): Promise<{
    stolen: boolean;
    success: boolean;
    fragment?: any;
    message: string;
  }> {
    return await safeExecute({
      fn: async () => {
        // Use interactive transaction for atomicity — prevents two attackers
        // from stealing the same fragment simultaneously.
        const result = await this.prisma.$transaction(async (tx) => {
          const fragment = await tx.keyFragment.findUnique({
            where: { id: fragmentId },
          });

          if (!fragment) {
            return {
              stolen: false,
              success: false,
              message: "Fragment does not exist.",
            } as const;
          }

          // Verify the victim actually holds it (inside transaction)
          if (fragment.heldByUserId !== victimUserId) {
            return {
              stolen: false,
              success: false,
              message: "The target player does not hold this fragment.",
            } as const;
          }

          // Transfer ownership atomically
          const now = new Date();
          const updatedFragment = await tx.keyFragment.update({
            where: { id: fragmentId },
            data: {
              heldByUserId: attackerUserId,
              heldSince: now,
            },
          });

          // Create historical discovery record for attacker (idempotent)
          await tx.keyFragmentDiscovery.upsert({
            where: {
              userId_fragmentId: { userId: attackerUserId, fragmentId },
            },
            create: {
              userId: attackerUserId,
              fragmentId,
              method: "steal",
            },
            update: {},
          });

          return {
            stolen: true,
            success: true,
            fragment: updatedFragment,
            message: `Successfully stole "${updatedFragment.name}"!`,
          } as const;
        });

        if (!result.stolen) {
          return result;
        }

        // Post-transaction side effects
        await this.updatePlayerCounters(attackerUserId);
        await this.updatePlayerCounters(victimUserId);
        await this.checkEndgameUnlock(attackerUserId);

        this.emit("fragment:stolen", {
          attackerUserId,
          victimUserId,
          fragmentId: result.fragment.id,
          keyType: result.fragment.keyType,
          fragmentNum: result.fragment.fragmentNum,
          name: result.fragment.name,
        });

        this.io.to(`user:${victimUserId}`).emit("story:fragment-stolen", {
          fragmentId: result.fragment.id,
          name: result.fragment.name,
          keyType: result.fragment.keyType,
          fragmentNum: result.fragment.fragmentNum,
          message: `Your fragment "${result.fragment.name}" has been stolen!`,
        });

        this.io.to(`user:${attackerUserId}`).emit("story:key-fragment", {
          name: result.fragment.name,
          keyType: result.fragment.keyType,
          fragmentNum: result.fragment.fragmentNum,
          description: result.fragment.description,
          method: "steal",
        });

        this.logger.info(
          {
            attackerUserId,
            victimUserId,
            fragmentId: result.fragment.id,
            keyType: result.fragment.keyType,
            fragmentNum: result.fragment.fragmentNum,
          },
          "Key fragment stolen: %s",
          result.fragment.name,
        );

        return {
          stolen: true,
          success: true,
          fragment: result.fragment,
          message: result.message,
        };
      },
      context: "Steal key fragment",
      logger: this.logger,
      rethrow: true,
    })() as {
      stolen: boolean;
      success: boolean;
      fragment?: any;
      message: string;
    };
  }

  // ── TRANSFER — Voluntarily give a fragment to another player ─────

  /**
   * Transfer a key fragment from one player to another (voluntary trade).
   *
   * The sender must currently hold the fragment. Ownership is transferred,
   * counters for both players are recomputed, and both are notified.
   *
   * @param fromUserId  - The sending player's user ID
   * @param toUserId    - The receiving player's user ID
   * @param fragmentId  - The KeyFragment record ID to transfer
   * @returns Transfer result with fragment details and message
   */
  async transferFragment(
    fromUserId: string,
    toUserId: string,
    fragmentId: string,
  ): Promise<{
    transferred: boolean;
    success: boolean;
    fragment?: any;
    message: string;
  }> {
    return await safeExecute({
      fn: async () => {
        // Use interactive transaction for atomicity — prevents the sender
        // from transferring a fragment they no longer hold.
        const result = await this.prisma.$transaction(async (tx) => {
          const fragment = await tx.keyFragment.findUnique({
            where: { id: fragmentId },
          });

          if (!fragment) {
            return {
              transferred: false,
              success: false,
              message: "Fragment does not exist.",
            } as const;
          }

          // Verify the sender actually holds it (inside transaction)
          if (fragment.heldByUserId !== fromUserId) {
            return {
              transferred: false,
              success: false,
              message: "You do not hold this fragment.",
            } as const;
          }

          // Transfer ownership atomically
          const now = new Date();
          const updatedFragment = await tx.keyFragment.update({
            where: { id: fragmentId },
            data: {
              heldByUserId: toUserId,
              heldSince: now,
            },
          });

          // Create historical discovery record for recipient (idempotent)
          await tx.keyFragmentDiscovery.upsert({
            where: {
              userId_fragmentId: { userId: toUserId, fragmentId },
            },
            create: {
              userId: toUserId,
              fragmentId,
              method: "transfer",
            },
            update: {},
          });

          return {
            transferred: true,
            success: true,
            fragment: updatedFragment,
            message: `Successfully transferred "${updatedFragment.name}".`,
          } as const;
        });

        if (!result.transferred) {
          return result;
        }

        // Post-transaction side effects
        await this.updatePlayerCounters(fromUserId);
        await this.updatePlayerCounters(toUserId);
        await this.checkEndgameUnlock(toUserId);

        this.emit("fragment:transferred", {
          fromUserId,
          toUserId,
          fragmentId: result.fragment.id,
          keyType: result.fragment.keyType,
          fragmentNum: result.fragment.fragmentNum,
          name: result.fragment.name,
        });

        this.io.to(`user:${toUserId}`).emit("story:key-fragment", {
          name: result.fragment.name,
          keyType: result.fragment.keyType,
          fragmentNum: result.fragment.fragmentNum,
          description: result.fragment.description,
          method: "transfer",
        });

        this.io.to(`user:${fromUserId}`).emit("story:fragment-transferred", {
          fragmentId: result.fragment.id,
          name: result.fragment.name,
          keyType: result.fragment.keyType,
          fragmentNum: result.fragment.fragmentNum,
          message: `You transferred "${result.fragment.name}" successfully.`,
        });

        this.logger.info(
          {
            fromUserId,
            toUserId,
            fragmentId: result.fragment.id,
            keyType: result.fragment.keyType,
            fragmentNum: result.fragment.fragmentNum,
          },
          "Key fragment transferred: %s",
          result.fragment.name,
        );

        return {
          transferred: true,
          success: true,
          fragment: result.fragment,
          message: result.message,
        };
      },
      context: "Transfer key fragment",
      logger: this.logger,
      rethrow: true,
    })() as {
      transferred: boolean;
      success: boolean;
      fragment?: any;
      message: string;
    };
  }

  // ── SERVER CHECK — Auto-claim fragments from server files ────────

  /**
   * Check if a server contains a key fragment and attempt to claim it
   * for the player. Returns current holder info if already claimed.
   *
   * Called when a player reads files on a server; checks whether the server
   * is the source of any key fragment.
   *
   * @param userId   - The player's user ID
   * @param serverId - The server being accessed
   * @returns Claim result if a fragment was found on this server
   */
  async checkServerFragment(
    userId: string,
    serverId: string,
  ): Promise<{
    claimed: boolean;
    fragment?: any;
    currentHolder?: string;
  }> {
    return await safeExecute({
      fn: async () => {
        const fragment = await this.prisma.keyFragment.findFirst({
          where: {
            sourceType: "server",
            sourceId: serverId,
          },
        });

        if (!fragment) {
          return { claimed: false };
        }

        return await this.claimFragment(userId, fragment.id, "server_file_read");
      },
      context: "Check server for key fragment",
      logger: this.logger,
      fallback: { claimed: false } as { claimed: boolean; fragment?: any; currentHolder?: string },
    })() as { claimed: boolean; fragment?: any; currentHolder?: string };
  }

  // ── PROGRESS — Get complete fragment progress for a player ───────

  /**
   * Retrieve the full fragment progress for a player, including all 9
   * fragments with holder information, grouped by type.
   *
   * Counts only fragments where heldByUserId === userId for the "held" count.
   *
   * @param userId - The player's user ID
   * @returns Complete fragment progress with per-type breakdowns
   */
  async getPlayerFragments(userId: string): Promise<FragmentProgress> {
    return await safeExecute({
      fn: async () => {
        const storyProgress = await this.ensureStoryProgress(userId);

        // Fetch ALL 9 fragments
        const allFragments = await this.prisma.keyFragment.findMany({
          orderBy: [{ keyType: "asc" }, { fragmentNum: "asc" }],
        });

        // Collect unique holder user IDs for username lookup
        const holderUserIds = new Set<string>();
        for (const frag of allFragments) {
          if (frag.heldByUserId) {
            holderUserIds.add(frag.heldByUserId);
          }
        }

        // Look up usernames for all holders in a single query
        const holderUsers =
          holderUserIds.size > 0
            ? await this.prisma.user.findMany({
                where: { id: { in: Array.from(holderUserIds) } },
                select: { id: true, username: true },
              })
            : [];

        const usernameMap = new Map<string, string>();
        for (const user of holderUsers) {
          usernameMap.set(user.id, user.username);
        }

        // Group fragments by type
        const grouped: Record<FragmentType, DiscoveredFragment[]> = {
          sword: [],
          key: [],
          collar: [],
        };

        let totalHeld = 0;

        for (const frag of allFragments) {
          const keyType = frag.keyType as FragmentType;
          const isHeldByPlayer = frag.heldByUserId === userId;

          if (isHeldByPlayer) {
            totalHeld++;
          }

          const discoveredFrag: DiscoveredFragment = {
            id: frag.id,
            name: frag.name,
            keyType: frag.keyType,
            fragmentNum: frag.fragmentNum,
            description: frag.description,
            heldByUsername: frag.heldByUserId
              ? (usernameMap.get(frag.heldByUserId) ?? null)
              : null,
            heldByUserId: frag.heldByUserId,
            heldSince: frag.heldSince,
            isHeldByPlayer,
          };

          if (grouped[keyType]) {
            grouped[keyType].push(discoveredFrag);
          }
        }

        return {
          sword: {
            found: grouped.sword.filter((f) => f.isHeldByPlayer).length,
            total: TOTAL_FRAGMENTS_PER_TYPE,
            fragments: grouped.sword,
          },
          key: {
            found: grouped.key.filter((f) => f.isHeldByPlayer).length,
            total: TOTAL_FRAGMENTS_PER_TYPE,
            fragments: grouped.key,
          },
          collar: {
            found: grouped.collar.filter((f) => f.isHeldByPlayer).length,
            total: TOTAL_FRAGMENTS_PER_TYPE,
            fragments: grouped.collar,
          },
          totalHeld,
          totalRequired: TOTAL_FRAGMENTS_REQUIRED,
          endgameUnlocked: storyProgress.endgameUnlocked,
          endgameChoice: storyProgress.endgameChoice,
          gameCompleted: storyProgress.gameCompleted,
        };
      },
      context: "Fetch player fragment progress",
      logger: this.logger,
      rethrow: true,
    })() as FragmentProgress;
  }

  // ── WORLD STATUS — Overview of all fragment holders ──────────────

  /**
   * Get a world-level overview of all 9 fragments and who holds them.
   *
   * @returns World fragment status with holder info for each fragment
   */
  async getWorldFragmentStatus(): Promise<WorldFragmentStatus> {
    return await safeExecute({
      fn: async () => {
        const allFragments = await this.prisma.keyFragment.findMany({
          orderBy: [{ keyType: "asc" }, { fragmentNum: "asc" }],
        });

        // Collect holder user IDs for username lookup
        const holderUserIds = new Set<string>();
        for (const frag of allFragments) {
          if (frag.heldByUserId) {
            holderUserIds.add(frag.heldByUserId);
          }
        }

        const holderUsers =
          holderUserIds.size > 0
            ? await this.prisma.user.findMany({
                where: { id: { in: Array.from(holderUserIds) } },
                select: { id: true, username: true },
              })
            : [];

        const usernameMap = new Map<string, string>();
        for (const user of holderUsers) {
          usernameMap.set(user.id, user.username);
        }

        let totalClaimed = 0;
        let totalUnclaimed = 0;

        const fragments: FragmentHolder[] = allFragments.map((frag) => {
          if (frag.heldByUserId) {
            totalClaimed++;
          } else {
            totalUnclaimed++;
          }

          return {
            fragmentId: frag.id,
            name: frag.name,
            keyType: frag.keyType as FragmentType,
            fragmentNum: frag.fragmentNum,
            heldBy: frag.heldByUserId
              ? (usernameMap.get(frag.heldByUserId) ?? null)
              : null,
            heldByUserId: frag.heldByUserId,
            heldSince: frag.heldSince,
          };
        });

        return { fragments, totalClaimed, totalUnclaimed };
      },
      context: "Fetch world fragment status",
      logger: this.logger,
      rethrow: true,
    })() as WorldFragmentStatus;
  }

  // ── ENDGAME UNLOCK — Check if the player holds all 9 fragments ──

  /**
   * Check whether a player holds all 9 fragments and, if so,
   * unlock the endgame sequence. Emits events and pushes real-time
   * notifications when the endgame is newly unlocked.
   *
   * @param userId - The player's user ID
   * @returns Whether the endgame is (now) unlocked
   */
  async checkEndgameUnlock(userId: string): Promise<boolean> {
    return await safeExecute({
      fn: async () => {
        const storyProgress = await this.prisma.storyProgress.findUnique({
          where: { userId },
        });

        if (!storyProgress) {
          return false;
        }

        // Already unlocked — nothing to do
        if (storyProgress.endgameUnlocked) {
          return true;
        }

        // Count fragments currently held by this player
        const heldCount = await this.prisma.keyFragment.count({
          where: { heldByUserId: userId },
        });

        if (heldCount < TOTAL_FRAGMENTS_REQUIRED) {
          return false;
        }

        // Unlock the endgame!
        await this.prisma.storyProgress.update({
          where: { userId },
          data: { endgameUnlocked: true },
        });

        // Emit internal event
        this.emit("endgame:unlocked", { userId });

        // Push real-time notification
        this.io.to(`user:${userId}`).emit("story:endgame-unlocked", {
          userId,
          message:
            "All fragments of AIDA have been found. The final choice awaits.",
        });

        this.logger.info(
          { userId },
          "Endgame unlocked — all 9 key fragments held by one player",
        );

        return true;
      },
      context: "Check endgame unlock",
      logger: this.logger,
      fallback: false,
    })() as boolean;
  }

  // ── ENDGAME CHOICE — Make the final decision about AIDA ──────────

  /**
   * Execute the player's final endgame choice. This is a one-time,
   * irreversible decision that determines AIDA's fate and completes the game.
   *
   * Verifies the player STILL holds all 9 fragments at decision time
   * (someone could steal between unlock and choice).
   *
   * @param userId - The player's user ID
   * @param choice - The endgame choice: "help", "expose", or "exploit"
   * @returns The endgame result with narrative text
   */
  async makeEndgameChoice(
    userId: string,
    choice: EndgameChoice,
  ): Promise<EndgameResult> {
    // Validate the choice
    if (!VALID_ENDGAME_CHOICES.includes(choice)) {
      return {
        success: false,
        message: `Invalid endgame choice: "${choice}". Must be one of: ${VALID_ENDGAME_CHOICES.join(", ")}`,
        narrative: "",
        choice,
      };
    }

    return await safeExecute({
      fn: async () => {
        const storyProgress = await this.prisma.storyProgress.findUnique({
          where: { userId },
        });

        if (!storyProgress) {
          return {
            success: false,
            message:
              "No story progress found. You must discover fragments before making a choice.",
            narrative: "",
            choice,
          };
        }

        if (!storyProgress.endgameUnlocked) {
          return {
            success: false,
            message:
              "The endgame has not been unlocked. Collect all 9 fragments first.",
            narrative: "",
            choice,
          };
        }

        if (storyProgress.endgameChoice !== null) {
          return {
            success: false,
            message: `You have already made your choice: "${storyProgress.endgameChoice}". The story is written.`,
            narrative: "",
            choice,
          };
        }

        // Verify the player STILL holds all 9 fragments
        const heldCount = await this.prisma.keyFragment.count({
          where: { heldByUserId: userId },
        });

        if (heldCount < TOTAL_FRAGMENTS_REQUIRED) {
          // Someone stole fragments between unlock and choice — revoke endgame
          await this.prisma.storyProgress.update({
            where: { userId },
            data: { endgameUnlocked: false },
          });

          return {
            success: false,
            message: `You no longer hold all 9 fragments (currently holding ${heldCount}). Someone has stolen from you. Reclaim them to proceed.`,
            narrative: "",
            choice,
          };
        }

        // Retrieve the narrative for this choice
        const narrative = ENDGAME_NARRATIVES[choice];

        // Record the choice — this is irreversible
        const now = new Date();
        await this.prisma.storyProgress.update({
          where: { userId },
          data: {
            endgameChoice: choice,
            gameCompleted: true,
            completedAt: now,
          },
        });

        // Emit internal event
        this.emit("endgame:completed", { userId, choice });

        // Push narrative to the player
        this.io.to(`user:${userId}`).emit("story:endgame-completed", {
          userId,
          choice,
          narrative,
          completedAt: now,
        });

        // Broadcast a world event — a player has completed the game
        this.io.emit("game:event", {
          type: "endgame_completed",
          message:
            "A player has made their final choice about AIDA. The net trembles.",
          choice,
          timestamp: now,
        });

        this.logger.info(
          { userId, choice },
          "Endgame completed — player chose: %s",
          choice,
        );

        return {
          success: true,
          message: "Your choice has been made. There is no going back.",
          narrative,
          choice,
        };
      },
      context: "Process endgame choice",
      logger: this.logger,
      rethrow: true,
    })() as EndgameResult;
  }

  // ── HINTS — Provide hints for undiscovered fragments ─────────────

  /**
   * Get contextual hints for fragments the player has not yet discovered.
   * Only reveals the fragment type and hint text — never the fragment number
   * or exact location.
   *
   * @param userId - The player's user ID
   * @returns Array of hints for undiscovered fragments
   */
  async getFragmentHints(
    userId: string,
  ): Promise<{ keyType: string; hint: string }[]> {
    return await safeExecute({
      fn: async () => {
        // Get all fragments in the game
        const allFragments = await this.prisma.keyFragment.findMany({
          orderBy: [{ keyType: "asc" }, { fragmentNum: "asc" }],
        });

        // Get the player's discovered fragment IDs
        const discoveries = await this.prisma.keyFragmentDiscovery.findMany({
          where: { userId },
          select: { fragmentId: true },
        });
        const discoveredIds = new Set(discoveries.map((d) => d.fragmentId));

        // Return hints for undiscovered fragments only
        return allFragments
          .filter((f) => !discoveredIds.has(f.id))
          .map((f) => ({
            keyType: f.keyType,
            hint: f.hint,
          }));
      },
      context: "Fetch fragment hints",
      logger: this.logger,
      rethrow: true,
    })() as { keyType: string; hint: string }[];
  }

  // ── PRIVATE HELPERS ──────────────────────────────────────────────

  /**
   * Recompute a player's fragment counters from the source of truth
   * (the KeyFragment table). This is IDEMPOTENT — always recomputes
   * all counters from actual holdings, never incrementally tracks.
   *
   * @param userId - The player's user ID
   */
  private async updatePlayerCounters(userId: string): Promise<void> {
    await safeExecute({
      fn: async () => {
        // Count fragments held by this user, grouped by keyType
        const holdings = await this.prisma.keyFragment.groupBy({
          by: ["keyType"],
          where: { heldByUserId: userId },
          _count: { _all: true },
        });

        // Build counts map — concrete type so .sword/.key/.collar are `number`, not `number | undefined`
        const counts = { sword: 0, key: 0, collar: 0 };

        for (const group of holdings) {
          if (group.keyType in counts) {
            counts[group.keyType as keyof typeof counts] = group._count._all;
          }
        }

        // Build the fragments array (IDs of all held fragments)
        const heldFragments = await this.prisma.keyFragment.findMany({
          where: { heldByUserId: userId },
          select: { id: true },
          orderBy: [{ keyType: "asc" }, { fragmentNum: "asc" }],
        });
        const fragmentIds = heldFragments.map((f) => f.id);

        // Upsert StoryProgress with recomputed counts
        await this.prisma.storyProgress.upsert({
          where: { userId },
          create: {
            userId,
            discoveryLevel: 0,
            swordFragments: counts.sword,
            keyFragments: counts.key,
            collarFragments: counts.collar,
            fragments: fragmentIds,
            hasContactedAIDA: false,
            aidaContactCount: 0,
            aidaTrustLevel: 0,
            endgameUnlocked: false,
            gameCompleted: false,
            lastDiscoveryAt: new Date(),
          },
          update: {
            swordFragments: counts.sword,
            keyFragments: counts.key,
            collarFragments: counts.collar,
            fragments: fragmentIds,
            lastDiscoveryAt: new Date(),
          },
        });
      },
      context: "Update player fragment counters",
      logger: this.logger,
      rethrow: true,
    })();
  }

  /**
   * Ensure a StoryProgress record exists for the given user.
   * Creates one with defaults if it doesn't exist yet.
   */
  private async ensureStoryProgress(userId: string) {
    return this.prisma.storyProgress.upsert({
      where: { userId },
      create: {
        userId,
        discoveryLevel: 0,
        swordFragments: 0,
        keyFragments: 0,
        collarFragments: 0,
        fragments: [],
        hasContactedAIDA: false,
        aidaContactCount: 0,
        aidaTrustLevel: 0,
        endgameUnlocked: false,
        gameCompleted: false,
      },
      update: {},
    });
  }
}
