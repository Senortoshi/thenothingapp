/**
 * GET /api/cron/purge-pii
 *
 * Daily PII Retention Purge -- runs at midnight UTC via Vercel Cron.
 *
 * Why this cron currently performs no deletions:
 *
 *   1. Hashed IP addresses are stored ONLY in Upstash Redis as rate-limit
 *      keys. Upstash's sliding-window ratelimiter sets a TTL on each key
 *      equal to the rate-limit window (60 s for per-minute, 3600 s for
 *      per-hour). Redis evicts them automatically — no manual purge needed.
 *
 *   2. The Postgres `comments` table contains display_name and comment_text
 *      which mirror immutable on-chain (BSV) data. These are NOT PII subject
 *      to time-based purging. Individual comment erasure is handled by
 *      DELETE /api/admin/comments/[txid]/pii.
 *
 *   3. No other off-chain PII tables exist at this time.
 *
 * This cron is kept as scaffolding so that any future PII tables (e.g.
 * user_sessions, audit_logs) can be wired in without adding new
 * infrastructure.
 *
 * Protected by: Authorization: Bearer <CRON_SECRET>
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/auth";
import { GDPR_DATA_RETENTION_DAYS } from "@/lib/constants";
import { safeErrorMessage } from "@/lib/errors";

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - GDPR_DATA_RETENTION_DAYS);

    // -----------------------------------------------------------------
    // Purge future PII tables here. Example:
    //
    //   const deleted = await db.execute(sql`
    //     DELETE FROM user_sessions
    //     WHERE created_at < ${cutoffDate.toISOString()}
    //   `);
    //
    // For now, no off-chain PII tables exist beyond comments (which are
    // on-chain mirrors) and Redis keys (which have their own TTLs).
    // -----------------------------------------------------------------

    console.log(
      `[cron/purge-pii] Retention check complete. ` +
        `Cutoff: ${cutoffDate.toISOString()}, ` +
        `retention: ${GDPR_DATA_RETENTION_DAYS} days. ` +
        `No PII tables to purge at this time.`
    );

    return NextResponse.json({
      ok: true,
      retentionDays: GDPR_DATA_RETENTION_DAYS,
      cutoff: cutoffDate.toISOString(),
      purged: {},
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[cron/purge-pii]", err);
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(err),
      },
      { status: 500 }
    );
  }
}
