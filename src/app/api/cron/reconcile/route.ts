/**
 * GET /api/cron/reconcile
 *
 * JungleBus Reconciliation — runs every 15 minutes via Vercel Cron.
 *
 * Cross-references on-chain BSV transactions (via JungleBus) against
 * our local Postgres comments table for the last ~100 blocks.
 * Backfills any missing comments and reports discrepancies.
 *
 * This is a no-op if JUNGLEBUS_SUBSCRIPTION_ID is not set.
 * To set it up: POST /api/admin/reconcile (which calls createSubscription()).
 *
 * Protected by: Authorization: Bearer <CRON_SECRET>
 */

import { NextRequest, NextResponse } from "next/server";
import { reconcile } from "@/services/junglebus.service";
import { sendAlert } from "@/lib/alerts";

// ---------------------------------------------------------------------------
// Auth guard
// ---------------------------------------------------------------------------

function verifyCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return process.env.NODE_ENV === "development";
  }
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

// How many blocks to look back on each cron run.
// 15 min runs * 4 blocks/min on BSV = ~60 blocks, so 100 gives comfortable overlap.
const BLOCKS_TO_SCAN = 100;

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const subscriptionId = process.env.JUNGLEBUS_SUBSCRIPTION_ID;
  if (!subscriptionId) {
    // Not configured — skip silently, this is expected during initial setup
    return NextResponse.json({
      ok: true,
      action: "skipped",
      reason: "JUNGLEBUS_SUBSCRIPTION_ID not set. See /api/admin/reconcile to set up.",
    });
  }

  // Get current block height from JungleBus
  const jbBase =
    process.env.JUNGLEBUS_URL ?? "https://junglebus.gorillapool.io";

  let toBlock: number;
  try {
    const res = await fetch(`${jbBase}/v1/block_header/tip`, {
      headers: process.env.JUNGLEBUS_API_KEY
        ? { Authorization: `Bearer ${process.env.JUNGLEBUS_API_KEY}` }
        : {},
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Block tip fetch failed: ${res.status}`);
    const tip: { height: number } = await res.json();
    toBlock = tip.height;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[cron/reconcile] Could not fetch chain tip:", msg);
    return NextResponse.json({
      ok: false,
      error: `Could not fetch chain tip: ${msg}`,
    }, { status: 503 });
  }

  const fromBlock = Math.max(0, toBlock - BLOCKS_TO_SCAN);

  console.log(
    `[cron/reconcile] Scanning blocks ${fromBlock} – ${toBlock} (${BLOCKS_TO_SCAN} blocks)`
  );

  try {
    const report = await reconcile({ fromBlock, toBlock });

    if (report.errors.length > 0) {
      console.error("[cron/reconcile] Errors during reconciliation:", report.errors);
    }

    if (report.discrepancies.length > 0) {
      console.warn(
        `[cron/reconcile] ${report.discrepancies.length} discrepancy(ies) found`
      );
      // Alert on discrepancies so the operator can investigate
      await sendAlert(
        `Nothing App: JungleBus reconciliation found ${report.discrepancies.length} discrepancy(ies) in blocks ${fromBlock}–${toBlock}. ` +
          `Backfilled: ${report.backfilled}. Errors: ${report.errors.length}. ` +
          `First discrepancy: ${report.discrepancies[0]?.txid} (${report.discrepancies[0]?.issue})`
      ).catch(() => {});
    }

    if (report.backfilled > 0) {
      console.log(`[cron/reconcile] Backfilled ${report.backfilled} comment(s)`);
    }

    return NextResponse.json({
      ok: true,
      fromBlock,
      toBlock,
      blocksScanned: report.blocksScanned,
      transactionsFound: report.transactionsFound,
      backfilled: report.backfilled,
      discrepancies: report.discrepancies.length,
      errors: report.errors.length,
    });
  } catch (err) {
    console.error("[cron/reconcile]", err);
    await sendAlert(
      `Nothing App: JungleBus reconciliation cron error — ${err instanceof Error ? err.message : String(err)}`
    ).catch(() => {});
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
