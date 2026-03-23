import { NextRequest, NextResponse } from "next/server";
import { getPoolStats, recoverStaleLocks, getWalletState } from "@/services/utxo-pool.service";
import { getFundingAddress } from "@/services/wallet.service";
import { sendAlert } from "@/lib/alerts";
import { ALERT_UTXO_MIN_FREE, ALERT_WALLET_MIN_SATS } from "@/lib/constants";
import { requireAdmin } from "@/lib/auth";
import { safeErrorMessage } from "@/lib/errors";

/**
 * GET /api/admin/health
 *
 * ADMIN-ONLY endpoint — full diagnostic payload including wallet address,
 * balances, UTXO pool statistics, alert messages, and threshold configuration.
 *
 * Protected by: Authorization: Bearer <ADMIN_API_KEY>
 *
 * For the public status signal (uptime monitors, status pages) use:
 *   GET /api/health  — returns only { status, timestamp }
 */
export async function GET(req: NextRequest) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  try {
    // Recover stale locks as a side effect (lightweight, ~1ms)
    const recovered = await recoverStaleLocks().catch(() => 0);

    // Pool statistics
    const stats = await getPoolStats();

    // Wallet address (derived from env key — no DB needed)
    let fundingAddress: string;
    try {
      fundingAddress = getFundingAddress();
    } catch {
      fundingAddress = "BSV_FUNDING_KEY not configured";
    }

    // Wallet state from DB
    const walletRow = await getWalletState();

    // -----------------------------------------------------------------------
    // Threshold monitoring — fire alerts when things look unhealthy
    // -----------------------------------------------------------------------
    const alerts: string[] = [];

    if (stats.freeCount < ALERT_UTXO_MIN_FREE) {
      const msg = `Nothing App: low UTXO pool — ${stats.freeCount} free UTXOs (threshold: ${ALERT_UTXO_MIN_FREE}). Address: ${fundingAddress}`;
      alerts.push(msg);
      // Fire-and-forget — never let alert failure break the health response
      sendAlert(msg).catch(() => {});
    }

    if (walletRow && walletRow.totalBalance < ALERT_WALLET_MIN_SATS && walletRow.totalBalance > 0) {
      const msg = `Nothing App: low wallet balance — ${walletRow.totalBalance} sats (threshold: ${ALERT_WALLET_MIN_SATS}). Deposit BSV to: ${fundingAddress}`;
      alerts.push(msg);
      sendAlert(msg).catch(() => {});
    }

    // Derive an overall status: "ok", "degraded", or "critical"
    let status: "ok" | "degraded" | "critical" = "ok";
    if (stats.freeCount === 0) {
      status = "critical"; // no UTXOs = comments will fail immediately
    } else if (alerts.length > 0) {
      status = "degraded"; // low but not yet dead
    }

    return NextResponse.json({
      status,
      wallet: {
        address: fundingAddress,
        freeUtxoCount: stats.freeCount,
        freeSats: stats.freeSats,
        totalBalance: walletRow?.totalBalance ?? 0,
        isReplenishing: walletRow?.isReplenishing ?? false,
        lastReplenishedAt: walletRow?.lastReplenishedAt ?? null,
      },
      pool: {
        free: stats.freeCount,
        locked: stats.lockedCount,
        spent: stats.spentCount,
        freeSats: stats.freeSats,
      },
      staleLockRecoveries: recovered,
      alerts: alerts.length > 0 ? alerts : undefined,
      thresholds: {
        utxoMinFree: ALERT_UTXO_MIN_FREE,
        walletMinSats: ALERT_WALLET_MIN_SATS,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[GET /api/admin/health]", err);
    return NextResponse.json(
      {
        status: "error",
        error: safeErrorMessage(err),
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
