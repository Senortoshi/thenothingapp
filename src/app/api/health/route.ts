import { NextResponse } from "next/server";
import { getPoolStats } from "@/services/utxo-pool.service";
import { getFundingAddress } from "@/services/wallet.service";
import { sendAlert } from "@/lib/alerts";
import { ALERT_UTXO_MIN_FREE } from "@/lib/constants";
import { safeErrorMessage } from "@/lib/errors";

/**
 * GET /api/health
 *
 * PUBLIC endpoint — safe to poll from external uptime monitors and status pages.
 * Returns only: { status, timestamp }
 *
 * Deliberately exposes no wallet addresses, balances, UTXO counts, or internal
 * thresholds — those are operational intelligence that belongs behind auth.
 * See GET /api/admin/health for the full diagnostic payload (admin-only).
 *
 * READ-ONLY — no DB writes. Stale lock recovery runs via cron/clear-locks.
 */
export async function GET() {
  try {
    // Pool statistics (used for status derivation and alerting only — not returned)
    const stats = await getPoolStats();

    // Wallet address (used for alerting only — not returned)
    let fundingAddress: string;
    try {
      fundingAddress = getFundingAddress();
    } catch {
      fundingAddress = "BSV_FUNDING_KEY not configured";
    }

    // -----------------------------------------------------------------------
    // Threshold monitoring — fire alerts when things look unhealthy
    // -----------------------------------------------------------------------
    const alerts: string[] = [];

    // The tip-chain model has at most 1 UTXO at any time, so the threshold
    // must be 1 (not the pool-era default of 3). Alert only when truly empty.
    const effectiveThreshold = Math.min(ALERT_UTXO_MIN_FREE, 1);
    if (stats.freeCount < effectiveThreshold) {
      const msg = `BSVibes: low UTXO tip — ${stats.freeCount} free UTXOs (threshold: ${ALERT_UTXO_MIN_FREE}). Address: ${fundingAddress}`;
      alerts.push(msg);
      // Fire-and-forget — never let alert failure break the health response
      sendAlert(msg).catch(() => {});
    }

    // Derive overall status — returned publicly; details stay server-side
    let status: "ok" | "degraded" | "critical" = "ok";
    if (stats.freeCount === 0) {
      status = "critical"; // no UTXOs = comments will fail immediately
    } else if (alerts.length > 0) {
      status = "degraded"; // low but not yet dead
    }

    return NextResponse.json({
      status,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[GET /api/health]", err);
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
