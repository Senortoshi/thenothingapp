/**
 * GET /api/cron/clear-locks
 *
 * Stale Lock Clearing — runs every 2 minutes via Vercel Cron.
 *
 * Releases UTXO locks that are older than 60 seconds back to 'free' status.
 * This recovers UTXOs from serverless invocations that crashed, timed out,
 * or failed after locking but before marking the UTXO as spent.
 *
 * The lock timeout (60s) is intentionally longer than the max Vercel function
 * duration (10s hobby / 30s pro) so a legitimate in-flight request is never
 * cancelled by this cron.
 *
 * Protected by: Authorization: Bearer <CRON_SECRET>
 */

import { NextRequest, NextResponse } from "next/server";
import { recoverStaleLocks } from "@/services/utxo-pool.service";
import { verifyCronSecret } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const recovered = await recoverStaleLocks();

    if (recovered > 0) {
      console.log(`[cron/clear-locks] Recovered ${recovered} stale UTXO lock(s)`);
    }

    return NextResponse.json({
      ok: true,
      recovered,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[cron/clear-locks]", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
