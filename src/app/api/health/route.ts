import { NextResponse } from "next/server";
import { getPoolStats, recoverStaleLocks, getWalletState } from "@/services/utxo-pool.service";
import { getFundingAddress } from "@/services/wallet.service";
import { sendAlert } from "@/lib/alerts";
import { ALERT_UTXO_MIN_FREE, ALERT_WALLET_MIN_SATS } from "@/lib/constants";

/**
 * GET /api/health
 *
 * Returns pool and wallet status. Useful for monitoring and seeding the wallet.
 * Also opportunistically recovers stale UTXO locks.
 *
 * Monitoring thresholds (configured via env vars):
 *   ALERT_UTXO_MIN_FREE    — alert when free UTXOs drop below this (default: 3)
 *   ALERT_WALLET_MIN_SATS  — alert when wallet balance drops below this (default: 10000)
 *   ALERT_WEBHOOK_URL      — Slack/Discord webhook to send alerts to
 *
 * This route is public and safe to poll from external uptime monitors.
 * It does not expose private key material.
 */
export async function GET() {
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
    console.error("[GET /api/health]", err);
    return NextResponse.json(
      {
        status: "error",
        error: err instanceof Error ? err.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
