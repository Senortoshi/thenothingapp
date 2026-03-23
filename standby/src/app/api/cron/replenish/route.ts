/**
 * GET /api/cron/replenish
 *
 * UTXO Pool Replenishment — runs every 5 minutes via Vercel Cron.
 *
 * This route is a thin HTTP wrapper. All business logic lives in
 * @/services/replenish.service.ts (issue #10).
 *
 * Protected by: Authorization: Bearer <CRON_SECRET>
 * Vercel sets this header automatically when invoking scheduled cron jobs.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/auth";
import { safeErrorMessage } from "@/lib/errors";
import { runReplenishment } from "@/services/replenish.service";

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runReplenishment();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: safeErrorMessage(err) },
      { status: 500 }
    );
  }
}
