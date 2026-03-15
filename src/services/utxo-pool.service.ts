import { db } from "@/db";
import { utxoPool, walletState } from "@/db/schema";
import { sql, eq } from "drizzle-orm";
import { UTXO_LOCK_TIMEOUT_SECONDS } from "@/lib/constants";

export interface LockedUtxo {
  id: number;
  txid: string;
  vout: number;
  satoshis: number;
  scriptHex: string;
}

export interface PoolStats {
  freeCount: number;
  lockedCount: number;
  spentCount: number;
  freeSats: number;
}

/**
 * Atomically checks out (locks) the smallest free UTXO from the pool.
 * Uses FOR UPDATE SKIP LOCKED for serverless safety.
 *
 * Must be called inside a Postgres transaction — pass the `tx` object.
 * Returns null if no free UTXOs are available.
 */
export async function checkoutUtxo(
  requestId: string
): Promise<LockedUtxo | null> {
  const result = await db.execute(sql`
    UPDATE utxo_pool
    SET status = 'locked',
        locked_at = NOW(),
        locked_by = ${requestId}
    WHERE id = (
      SELECT id FROM utxo_pool
      WHERE status = 'free'
      ORDER BY satoshis ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, txid, vout, satoshis, script_hex
  `);

  if (result.length === 0) return null;

  type UtxoRow = {
    id: number | string;
    txid: string;
    vout: number | string;
    satoshis: number | string;
    script_hex: string;
  };
  const row = (result as unknown as UtxoRow[])[0];

  return {
    id: Number(row.id),
    txid: row.txid,
    vout: Number(row.vout),
    satoshis: Number(row.satoshis),
    scriptHex: row.script_hex,
  };
}

/**
 * Marks a UTXO as spent after a successful broadcast.
 */
export async function markUtxoSpent(utxoId: number): Promise<void> {
  await db
    .update(utxoPool)
    .set({ status: "spent" })
    .where(eq(utxoPool.id, utxoId));
}

/**
 * Releases a locked UTXO back to free status (used on error paths).
 */
export async function releaseUtxo(utxoId: number): Promise<void> {
  await db
    .update(utxoPool)
    .set({ status: "free", lockedAt: null, lockedBy: null })
    .where(eq(utxoPool.id, utxoId));
}

/**
 * Recovers stale locks older than UTXO_LOCK_TIMEOUT_SECONDS.
 * Run this periodically (e.g., from a cron route).
 */
export async function recoverStaleLocks(): Promise<number> {
  const result = await db.execute(sql`
    UPDATE utxo_pool
    SET status = 'free',
        locked_at = NULL,
        locked_by = NULL
    WHERE status = 'locked'
      AND locked_at < NOW() - INTERVAL '${sql.raw(String(UTXO_LOCK_TIMEOUT_SECONDS))} seconds'
    RETURNING id
  `);

  return result.length;
}

/**
 * Returns pool health statistics.
 */
export async function getPoolStats(): Promise<PoolStats> {
  const result = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'free')   AS free_count,
      COUNT(*) FILTER (WHERE status = 'locked') AS locked_count,
      COUNT(*) FILTER (WHERE status = 'spent')  AS spent_count,
      COALESCE(SUM(satoshis) FILTER (WHERE status = 'free'), 0) AS free_sats
    FROM utxo_pool
  `);

  type StatsRow = {
    free_count: string | number;
    locked_count: string | number;
    spent_count: string | number;
    free_sats: string | number;
  };
  const row = (result as unknown as StatsRow[])[0];

  return {
    freeCount: Number(row.free_count),
    lockedCount: Number(row.locked_count),
    spentCount: Number(row.spent_count),
    freeSats: Number(row.free_sats),
  };
}

/**
 * Inserts a new UTXO into the pool (used during replenishment).
 */
export async function insertUtxo(utxo: {
  txid: string;
  vout: number;
  satoshis: number;
  scriptHex: string;
}): Promise<void> {
  await db
    .insert(utxoPool)
    .values({
      txid: utxo.txid,
      vout: utxo.vout,
      satoshis: utxo.satoshis,
      scriptHex: utxo.scriptHex,
      status: "free",
    })
    .onConflictDoNothing();
}

/**
 * Gets or initialises the wallet_state row.
 */
export async function getWalletState() {
  const rows = await db.select().from(walletState).limit(1);
  return rows[0] ?? null;
}

/**
 * Updates the free_utxo_count in wallet_state.
 */
export async function syncWalletUtxoCount(): Promise<void> {
  const stats = await getPoolStats();
  await db
    .update(walletState)
    .set({
      freeUtxoCount: stats.freeCount,
      updatedAt: new Date(),
    })
    .where(eq(walletState.id, 1));
}
