/**
 * GET /api/cron/replenish
 *
 * UTXO Pool Replenishment — runs every 5 minutes via Vercel Cron.
 *
 * Checks the free UTXO count. If it is below UTXO_REPLENISH_THRESHOLD,
 * takes the funding wallet balance and splits it into UTXO_SPLIT_TARGET
 * individual outputs so concurrent comment requests can each get a UTXO.
 *
 * Protected by: Authorization: Bearer <CRON_SECRET>
 * Vercel sets this header automatically when invoking scheduled cron jobs.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getPoolStats,
  insertUtxo,
  syncWalletUtxoCount,
} from "@/services/utxo-pool.service";
import {
  getFundingKey,
  getFundingAddress,
  calculateFee,
} from "@/services/wallet.service";
import { sendAlert } from "@/lib/alerts";
import {
  UTXO_REPLENISH_THRESHOLD,
  UTXO_SPLIT_TARGET,
  ALERT_UTXO_MIN_FREE,
  ALERT_WALLET_MIN_SATS,
} from "@/lib/constants";
import { Transaction, P2PKH } from "@bsv/sdk";
import { verifyCronSecret } from "@/lib/auth";
import { db } from "@/db";
import { walletState } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Replenish mutex helpers (wallet_state.is_replenishing)
// ---------------------------------------------------------------------------

const STALE_LOCK_MINUTES = 5;

/**
 * Atomically acquire the replenish lock.
 * Returns true if we got the lock, false if another invocation holds it.
 * Also force-releases stale locks (updated_at > STALE_LOCK_MINUTES ago).
 */
async function acquireReplenishLock(): Promise<boolean> {
  // First: force-release stale lock if it exists
  await db
    .update(walletState)
    .set({ isReplenishing: false, updatedAt: new Date() })
    .where(
      sql`${walletState.id} = 1
        AND ${walletState.isReplenishing} = TRUE
        AND ${walletState.updatedAt} < NOW() - INTERVAL '${sql.raw(String(STALE_LOCK_MINUTES))} minutes'`
    );

  // Atomically set is_replenishing = TRUE only if currently FALSE
  const result = await db
    .update(walletState)
    .set({ isReplenishing: true, updatedAt: new Date() })
    .where(
      sql`${walletState.id} = 1 AND ${walletState.isReplenishing} = FALSE`
    );

  // drizzle returns { rowCount } for postgres-js driver
  const rowCount = (result as unknown as { rowCount: number }).rowCount ?? 0;
  return rowCount > 0;
}

/**
 * Release the replenish lock.
 */
async function releaseReplenishLock(): Promise<void> {
  await db
    .update(walletState)
    .set({ isReplenishing: false, updatedAt: new Date() })
    .where(eq(walletState.id, 1));
}

// ---------------------------------------------------------------------------
// UTXO split helper
// ---------------------------------------------------------------------------

/**
 * Fetches the current UTXO set for the funding address from WhatsOnChain,
 * picks the largest single UTXO, and splits it into `targetCount` outputs.
 *
 * Returns early if:
 *   - No UTXOs found on-chain
 *   - Largest UTXO can't cover fees + target outputs at dust minimum
 */
async function replenishPool(targetCount: number): Promise<{
  skipped: boolean;
  reason?: string;
  splitTxid?: string;
  outputCount?: number;
}> {
  const address = getFundingAddress();

  // Fetch UTXOs from WhatsOnChain (BSV mainnet)
  let utxos: Array<{ tx_hash: string; tx_pos: number; value: number }>;
  try {
    const res = await fetch(
      `https://api.whatsonchain.com/v1/bsv/main/address/${address}/unspent`,
      { signal: AbortSignal.timeout(15_000) }
    );
    if (!res.ok) {
      return {
        skipped: true,
        reason: `WhatsOnChain fetch failed: ${res.status}`,
      };
    }
    utxos = await res.json();
  } catch (err) {
    return {
      skipped: true,
      reason: `WhatsOnChain unreachable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!utxos || utxos.length === 0) {
    return { skipped: true, reason: "No UTXOs found on-chain for funding address" };
  }

  // Pick the largest UTXO as the input
  const largest = utxos.reduce((a, b) => (a.value > b.value ? a : b));
  const totalSats = largest.value;

  // Estimate fees: 1 input, targetCount outputs + 1 change, ~150 bytes base + 34 bytes per output
  const estimatedBytes = 150 + targetCount * 34;
  const fee = calculateFee(estimatedBytes);

  // Each output gets an equal share minus fees
  const perOutputSats = Math.floor((totalSats - fee) / targetCount);

  if (perOutputSats < 546) {
    return {
      skipped: true,
      reason: `Insufficient balance: ${totalSats} sats cannot fund ${targetCount} outputs (need ${546 * targetCount + fee} sats minimum)`,
    };
  }

  // Alert if balance is getting low even though we're replenishing
  if (totalSats < (ALERT_WALLET_MIN_SATS ?? 10000)) {
    await sendAlert(
      `Nothing App: low wallet balance — ${totalSats} sats remaining. Deposit BSV to: ${address}`
    ).catch(() => {});
  }

  // Fetch the raw tx for the source UTXO (needed for signing with @bsv/sdk)
  let rawTx: string;
  try {
    const res = await fetch(
      `https://api.whatsonchain.com/v1/bsv/main/tx/${largest.tx_hash}/hex`,
      { signal: AbortSignal.timeout(15_000) }
    );
    if (!res.ok) {
      return {
        skipped: true,
        reason: `Failed to fetch raw tx for ${largest.tx_hash}: ${res.status}`,
      };
    }
    rawTx = await res.text();
  } catch (err) {
    return {
      skipped: true,
      reason: `Raw tx fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Build the split transaction
  const privateKey = getFundingKey();
  const p2pkh = new P2PKH();
  const lockingScript = p2pkh.lock(address);
  const sourceTransaction = Transaction.fromHex(rawTx);

  const tx = new Transaction();

  tx.addInput({
    sourceTXID: largest.tx_hash,
    sourceOutputIndex: largest.tx_pos,
    sourceTransaction,
    unlockingScriptTemplate: p2pkh.unlock(privateKey),
  });

  for (let i = 0; i < targetCount; i++) {
    tx.addOutput({
      satoshis: perOutputSats,
      lockingScript,
    });
  }

  await tx.sign();

  const txHex = tx.toHex();
  const txid = tx.id("hex");

  // Broadcast
  const { broadcastTransaction } = await import("@/services/broadcast.service");
  await broadcastTransaction(txHex);

  // Insert each new output into the pool
  const scriptHex = lockingScript.toHex();
  for (let vout = 0; vout < targetCount; vout++) {
    await insertUtxo({
      txid,
      vout,
      satoshis: perOutputSats,
      scriptHex,
    });
  }

  await syncWalletUtxoCount();

  return { skipped: false, splitTxid: txid, outputCount: targetCount };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Acquire the replenish mutex — bail if another invocation is already running
  const gotLock = await acquireReplenishLock();
  if (!gotLock) {
    console.log("[cron/replenish] Another invocation is already running, skipping");
    return NextResponse.json({
      ok: true,
      action: "skipped",
      reason: "Another replenish invocation is already running",
    });
  }

  try {
    const stats = await getPoolStats();

    // Alert if pool is critically low (below alert threshold, not just replenish threshold)
    const alertMin = ALERT_UTXO_MIN_FREE ?? 3;
    if (stats.freeCount < alertMin) {
      await sendAlert(
        `Nothing App: UTXO pool critically low — ${stats.freeCount} free UTXOs (threshold: ${alertMin}). Replenishment running now.`
      ).catch(() => {});
    }

    // Skip if pool is healthy
    if (stats.freeCount >= UTXO_REPLENISH_THRESHOLD) {
      return NextResponse.json({
        ok: true,
        action: "skipped",
        reason: `Pool healthy: ${stats.freeCount} free UTXOs (threshold: ${UTXO_REPLENISH_THRESHOLD})`,
        pool: stats,
      });
    }

    console.log(
      `[cron/replenish] Pool low (${stats.freeCount} free), replenishing to ${UTXO_SPLIT_TARGET}`
    );

    const result = await replenishPool(UTXO_SPLIT_TARGET);

    if (result.skipped) {
      console.warn("[cron/replenish] Skipped:", result.reason);
      // Alert if we can't replenish
      await sendAlert(
        `Nothing App: UTXO replenishment skipped — ${result.reason}`
      ).catch(() => {});
      return NextResponse.json({
        ok: false,
        action: "skipped",
        reason: result.reason,
        pool: stats,
      });
    }

    console.log(
      `[cron/replenish] Split tx broadcast: ${result.splitTxid} (${result.outputCount} outputs)`
    );

    return NextResponse.json({
      ok: true,
      action: "replenished",
      splitTxid: result.splitTxid,
      outputCount: result.outputCount,
    });
  } catch (err) {
    console.error("[cron/replenish]", err);
    await sendAlert(
      `Nothing App: UTXO replenishment cron error — ${err instanceof Error ? err.message : String(err)}`
    ).catch(() => {});
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  } finally {
    // Always release the mutex, even on error or early return
    await releaseReplenishLock().catch((e) =>
      console.error("[cron/replenish] Failed to release lock:", e)
    );
  }
}
