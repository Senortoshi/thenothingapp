/**
 * POST /api/admin/reconcile
 *
 * Triggers a JungleBus reconciliation run for a block range.
 * Protected by ADMIN_API_KEY.
 *
 * Body:
 *   { fromBlock: number, toBlock?: number, dryRun?: boolean }
 *
 * If toBlock is omitted, reconciles up to the current chain tip.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { reconcile, backfillFromBlock } from "@/services/junglebus.service";
import { requireAdmin } from "@/lib/auth";
import { safeErrorMessage } from "@/lib/errors";

const reconcileSchema = z.object({
  fromBlock: z.number().int().min(0),
  toBlock: z.number().int().min(0).optional(),
  dryRun: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = reconcileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const { fromBlock, toBlock, dryRun } = parsed.data;

  try {
    let report;
    if (toBlock !== undefined) {
      report = await reconcile({ fromBlock, toBlock, dryRun });
    } else {
      report = await backfillFromBlock(fromBlock, dryRun);
    }

    console.log("[reconcile] Run complete", {
      fromBlock,
      toBlock,
      dryRun,
      backfilled: report.backfilled,
      discrepancies: report.discrepancies.length,
      errors: report.errors.length,
    });

    return NextResponse.json({ report });
  } catch (err) {
    console.error("[POST /api/admin/reconcile]", err);
    return NextResponse.json(
      { error: safeErrorMessage(err, "Reconciliation failed") },
      { status: 500 }
    );
  }
}
