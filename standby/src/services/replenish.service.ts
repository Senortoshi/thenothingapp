/**
 * Replenish Service
 *
 * UTXO pool replenishment business logic — consolidates UTXOs from the funding
 * wallet and splits them into fixed-size (1000 sat) outputs so concurrent
 * comment requests can each get a UTXO.
 *
 * Extracted from /api/cron/replenish/route.ts (issue #10).
 */

import {
  getPoolStats,
  insertUtxo,
  syncWalletUtxoCount,
} from "@/services/utxo-pool.service";
import type { PoolStats } from "@/services/utxo-pool.service";
import {
  getFundingKey,
  getFundingAddress,
  calculateFee,
} from "@/services/wallet.service";
import { broadcastTransaction } from "@/services/broadcast.service";
import { sendAlert } from "@/lib/alerts";
import {
  UTXO_REPLENISH_THRESHOLD,
  UTXO_SPLIT_TARGET,
  ALERT_UTXO_MIN_FREE,
  ALERT_WALLET_MIN_SATS,
  DUST_LIMIT,
} from "@/lib/constants";
import { Transaction, P2PKH } from "@bsv/sdk";
import { safeErrorMessage } from "@/lib/errors";
import { db } from "@/db";
import { walletState } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PER_OUTPUT_SATS = 1000;
const MAX_CONSOLIDATION_INPUTS = 20;
const DUST_THRESHOLD = DUST_LIMIT;
const STALE_LOCK_MINUTES = 5;

// ---------------------------------------------------------------------------
// Replenish mutex helpers (wallet_state.is_replenishing)
// ---------------------------------------------------------------------------

export async function acquireReplenishLock(): Promise<boolean> {
  await db
    .update(walletState)
    .set({ isReplenishing: false, updatedAt: new Date() })
    .where(
      sql`${walletState.id} = 1
        AND ${walletState.isReplenishing} = TRUE
        AND ${walletState.updatedAt} < NOW() - make_interval(mins => ${STALE_LOCK_MINUTES})`
    );

  const result = await db
    .update(walletState)
    .set({ isReplenishing: true, updatedAt: new Date() })
    .where(
      sql`${walletState.id} = 1 AND ${walletState.isReplenishing} = FALSE`
    );

  const rowCount = (result as unknown as { rowCount: number }).rowCount ?? 0;
  return rowCount > 0;
}

export async function releaseReplenishLock(): Promise<void> {
  await db
    .update(walletState)
    .set({ isReplenishing: false, updatedAt: new Date() })
    .where(eq(walletState.id, 1));
}

// ---------------------------------------------------------------------------
// UTXO split logic
// ---------------------------------------------------------------------------

export interface ReplenishPoolResult {
  skipped: boolean;
  reason?: string;
  splitTxid?: string;
  outputCount?: number;
}

export async function replenishPool(
  targetCount: number
): Promise<ReplenishPoolResult> {
  const address = getFundingAddress();

  let utxos: Array<{ tx_hash: string; tx_pos: number; value: number }>;
  try {
    const res = await fetch(
      `https://api.whatsonchain.com/v1/bsv/main/address/${address}/unspent`,
      { signal: AbortSignal.timeout(15_000) }
    );
    if (!res.ok) {
      return { skipped: true, reason: `WhatsOnChain fetch failed: ${res.status}` };
    }
    utxos = await res.json();
  } catch (err) {
    console.warn("[replenishPool] WhatsOnChain unreachable:", err instanceof Error ? err.message : String(err));
    return { skipped: true, reason: safeErrorMessage(err, "WhatsOnChain unreachable") };
  }

  if (!utxos || utxos.length === 0) {
    return { skipped: true, reason: "No UTXOs found on-chain for funding address" };
  }

  const eligible = utxos
    .filter((u) => u.value >= DUST_THRESHOLD)
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_CONSOLIDATION_INPUTS);

  if (eligible.length === 0) {
    return { skipped: true, reason: `No UTXOs above dust threshold (${DUST_THRESHOLD} sats)` };
  }

  const totalSats = eligible.reduce((sum, u) => sum + u.value, 0);
  const actualOutputCount = Math.min(targetCount, Math.floor((totalSats - 10) / PER_OUTPUT_SATS));
  const estimatedBytes = 10 + eligible.length * 148 + (actualOutputCount + 1) * 34;
  const fee = calculateFee(estimatedBytes);
  const availableSats = totalSats - fee;
  const outputCount = Math.min(targetCount, Math.floor(availableSats / PER_OUTPUT_SATS));

  if (outputCount < 1) {
    return { skipped: true, reason: `Insufficient balance: ${totalSats} sats cannot fund even 1 output of ${PER_OUTPUT_SATS} sats (fee: ${fee})` };
  }

  const changeSats = availableSats - outputCount * PER_OUTPUT_SATS;

  if (totalSats < (ALERT_WALLET_MIN_SATS ?? 10000)) {
    await sendAlert(`Nothing App: low wallet balance — ${totalSats} sats remaining. Deposit BSV to: ${address}`).catch(() => {});
  }

  const uniqueTxHashes = [...new Set(eligible.map((u) => u.tx_hash))];
  const rawTxMap = new Map<string, string>();

  for (const txHash of uniqueTxHashes) {
    try {
      const res = await fetch(
        `https://api.whatsonchain.com/v1/bsv/main/tx/${txHash}/hex`,
        { signal: AbortSignal.timeout(15_000) }
      );
      if (!res.ok) {
        return { skipped: true, reason: `Failed to fetch raw tx for ${txHash}: ${res.status}` };
      }
      rawTxMap.set(txHash, await res.text());
    } catch (err) {
      console.warn("[replenishPool] Raw tx fetch failed:", err instanceof Error ? err.message : String(err));
      return { skipped: true, reason: safeErrorMessage(err, "Raw tx fetch failed") };
    }
  }

  const privateKey = getFundingKey();
  const p2pkh = new P2PKH();
  const lockingScript = p2pkh.lock(address);
  const tx = new Transaction();

  for (const utxo of eligible) {
    const sourceTransaction = Transaction.fromHex(rawTxMap.get(utxo.tx_hash)!);
    tx.addInput({
      sourceTXID: utxo.tx_hash,
      sourceOutputIndex: utxo.tx_pos,
      sourceTransaction,
      unlockingScriptTemplate: p2pkh.unlock(privateKey),
    });
  }

  for (let i = 0; i < outputCount; i++) {
    tx.addOutput({ satoshis: PER_OUTPUT_SATS, lockingScript });
  }

  if (changeSats >= DUST_THRESHOLD) {
    tx.addOutput({ satoshis: changeSats, lockingScript });
  }

  await tx.sign();

  const txHex = tx.toHex();
  const txid = tx.id("hex");

  await broadcastTransaction(txHex);

  const scriptHex = lockingScript.toHex();
  for (let vout = 0; vout < outputCount; vout++) {
    await insertUtxo({ txid, vout, satoshis: PER_OUTPUT_SATS, scriptHex });
  }

  await syncWalletUtxoCount();

  return { skipped: false, splitTxid: txid, outputCount };
}

// ---------------------------------------------------------------------------
// Orchestration — called by the cron route
// ---------------------------------------------------------------------------

export interface ReplenishResult {
  ok: boolean;
  action: "skipped" | "replenished";
  reason?: string;
  splitTxid?: string;
  outputCount?: number;
  pool?: PoolStats;
}

export async function runReplenishment(): Promise<ReplenishResult> {
  const gotLock = await acquireReplenishLock();
  if (!gotLock) {
    console.log("[replenish] Another invocation is already running, skipping");
    return { ok: true, action: "skipped", reason: "Another replenish invocation is already running" };
  }

  try {
    const stats = await getPoolStats();

    const alertMin = ALERT_UTXO_MIN_FREE ?? 3;
    if (stats.freeCount < alertMin) {
      await sendAlert(`Nothing App: UTXO pool critically low — ${stats.freeCount} free UTXOs (threshold: ${alertMin}). Replenishment running now.`).catch(() => {});
    }

    if (stats.freeCount >= UTXO_REPLENISH_THRESHOLD) {
      return { ok: true, action: "skipped", reason: `Pool healthy: ${stats.freeCount} free UTXOs (threshold: ${UTXO_REPLENISH_THRESHOLD})`, pool: stats };
    }

    console.log(`[replenish] Pool low (${stats.freeCount} free), replenishing to ${UTXO_SPLIT_TARGET}`);

    const result = await replenishPool(UTXO_SPLIT_TARGET);

    if (result.skipped) {
      console.warn("[replenish] Skipped:", result.reason);
      await sendAlert(`Nothing App: UTXO replenishment skipped — ${result.reason}`).catch(() => {});
      return { ok: false, action: "skipped", reason: result.reason, pool: stats };
    }

    console.log(`[replenish] Split tx broadcast: ${result.splitTxid} (${result.outputCount} outputs)`);
    return { ok: true, action: "replenished", splitTxid: result.splitTxid, outputCount: result.outputCount };
  } catch (err) {
    console.error("[replenish]", err);
    await sendAlert(`Nothing App: UTXO replenishment error — ${err instanceof Error ? err.message : String(err)}`).catch(() => {});
    throw err;
  } finally {
    await releaseReplenishLock().catch((e) => console.error("[replenish] Failed to release lock:", e));
  }
}
