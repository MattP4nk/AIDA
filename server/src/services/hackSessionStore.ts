/**
 * Hack session store: the live session and timer maps, and their persistence
 * to the hackSession table so a restart does not drop in-flight hacks.
 *
 * A8: split out of hackService.ts (2,739 lines). Code moved verbatim; the only
 * rewrites are the call paths between the pieces — see the commit.
 */
import { db } from "../database/client";
import { HackMethod } from "../types/game";
import type { HackSessionInfo, MinigameChallenge, LayerResult } from "../types/game";
import { safeExecute } from "../utils/safeExecute";
import type { Logger } from "pino";

export class HackSessionStore {
  readonly activeHacks = new Map<string, HackSessionInfo>();
  readonly sessionTimers = new Map<string, NodeJS.Timeout>();

  constructor(private logger: Logger) {}

  /**
   * Persist a hack session to the database for crash recovery.
   */
  public async persistSession(session: HackSessionInfo): Promise<void> {
    await safeExecute({
      fn: () => db.client.hackSession.upsert({
        where: { id: session.id },
        create: {
          id: session.id,
          attackerId: session.attackerId,
          targetOwnerId: session.targetOwnerId,
          targetServerId: session.targetServerId,
          targetIp: session.targetIp,
          method: session.method,
          tools: session.tools,
          currentLayer: session.currentLayer,
          totalLayers: session.totalLayers,
          status: session.status,
          layersData: JSON.parse(JSON.stringify(session.layers)),
          layerResults: JSON.parse(JSON.stringify(session.layerResults)),
          detectionAccumulator: session.detectionAccumulator,
          startedAt: BigInt(session.startedAt),
          expiresAt: BigInt(session.expiresAt),
          layerStartedAt: BigInt(session.layerStartedAt),
        },
        update: {
          currentLayer: session.currentLayer,
          status: session.status,
          layerResults: JSON.parse(JSON.stringify(session.layerResults)),
          detectionAccumulator: session.detectionAccumulator,
          layerStartedAt: BigInt(session.layerStartedAt),
        },
      }),
      context: "Persist hack session",
      logger: this.logger,
    })();
  }

  /**
   * Remove a persisted session from the database (after resolution).
   */
  public async removePersistedSession(sessionId: string): Promise<void> {
    await safeExecute({
      fn: () => db.client.hackSession.deleteMany({ where: { id: sessionId } }),
      context: "Remove persisted hack session",
      logger: this.logger,
    })();
  }

  /**
   * Restore active hack sessions from the database after a server restart.
   * Expired sessions are resolved; active sessions are rehydrated with fresh timers.
   */
  public async restoreSessionsFromDB(
    onExpire: (attackerId: string) => Promise<void>,
  ): Promise<void> {
    const rows = await db.client.hackSession.findMany({
      where: { status: "active" },
    });

    if (rows.length === 0) return;

    this.logger.info({ count: rows.length }, "Restoring hack sessions from DB");

    const now = Date.now();

    for (const row of rows) {
      const expiresAt = Number(row.expiresAt);
      const startedAt = Number(row.startedAt);
      const layerStartedAt = Number(row.layerStartedAt);

      const session: HackSessionInfo = {
        id: row.id,
        targetIp: row.targetIp,
        targetServerId: row.targetServerId,
        targetOwnerId: row.targetOwnerId,
        attackerId: row.attackerId,
        method: row.method as HackMethod,
        tools: row.tools,
        currentLayer: row.currentLayer,
        totalLayers: row.totalLayers,
        status: row.status as HackSessionInfo["status"],
        layers: row.layersData as unknown as MinigameChallenge[],
        layerResults: row.layerResults as unknown as LayerResult[],
        detectionAccumulator: row.detectionAccumulator,
        startedAt,
        expiresAt,
        layerStartedAt,
      };

      if (now >= expiresAt) {
        // Session has expired while server was down — resolve it
        this.activeHacks.set(row.attackerId, session);
        this.logger.info(
          { sessionId: row.id },
          "Expiring restored session (past deadline)",
        );
        await onExpire(row.attackerId);
      } else {
        // Session still valid — rehydrate with a fresh timeout
        this.activeHacks.set(row.attackerId, session);
        const remainingMs = expiresAt - now;
        const timer = setTimeout(() => {
          onExpire(row.attackerId);
        }, remainingMs);
        this.sessionTimers.set(row.attackerId, timer);

        this.logger.info(
          { sessionId: row.id, remainingMs },
          "Restored active hack session",
        );
      }
    }
  }

  // ==================== MAIN HACK PROCESSING ====================
}
