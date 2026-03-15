import { NextRequest, NextResponse } from "next/server";
import { Ratelimit, type Duration } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { postCommentSchema, getCommentsSchema } from "@/lib/validators";
import { writeComment, ServiceError } from "@/services/comment-write.service";
import { COMMENTS_PAGE_SIZE } from "@/lib/constants";
import { randomBytes } from "crypto";

// ---------------------------------------------------------------------------
// Rate limiters — two sliding windows per IP
//   • Per-minute : 5 requests per 60s
//   • Per-hour   : 50 requests per 3600s
// ---------------------------------------------------------------------------

interface RateLimiters {
  perMinute: Ratelimit;
  perHour: Ratelimit;
}

let limiters: RateLimiters | null = null;

function getRateLimiters(): RateLimiters | null {
  if (
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    return null; // Rate limiting disabled — env vars not configured
  }

  if (!limiters) {
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });

    limiters = {
      perMinute: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(
          parseInt(process.env.RATE_LIMIT_MAX ?? "5", 10),
          (`${process.env.RATE_LIMIT_WINDOW ?? "60"}s`) as Duration
        ),
        analytics: false,
        prefix: "nothing_app:rl:min",
      }),
      perHour: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(
          parseInt(process.env.RATE_LIMIT_HOURLY_MAX ?? "50", 10),
          "3600s" as Duration
        ),
        analytics: false,
        prefix: "nothing_app:rl:hour",
      }),
    };
  }

  return limiters;
}

/**
 * Checks both rate limit windows. Returns the tightest constraint.
 * Gracefully degrades to null on Redis error.
 */
async function checkRateLimit(
  ip: string
): Promise<{ allowed: boolean; limit: number; remaining: number; reset: number; window: string } | null> {
  const rl = getRateLimiters();
  if (!rl) return null;

  try {
    // Run both checks in parallel
    const [minuteResult, hourResult] = await Promise.all([
      rl.perMinute.limit(ip),
      rl.perHour.limit(ip),
    ]);

    // Minute limit hit
    if (!minuteResult.success) {
      return {
        allowed: false,
        limit: minuteResult.limit,
        remaining: minuteResult.remaining,
        reset: minuteResult.reset,
        window: "minute",
      };
    }

    // Hour limit hit
    if (!hourResult.success) {
      return {
        allowed: false,
        limit: hourResult.limit,
        remaining: hourResult.remaining,
        reset: hourResult.reset,
        window: "hour",
      };
    }

    // Both passed — return the tighter remaining count (minute window)
    return {
      allowed: true,
      limit: minuteResult.limit,
      remaining: Math.min(minuteResult.remaining, hourResult.remaining),
      reset: minuteResult.reset,
      window: "minute",
    };
  } catch (err) {
    // Graceful degradation — Redis unavailable, allow the request
    console.warn("[rate-limit] Redis check failed, allowing request:", err);
    return null;
  }
}

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

// ---------------------------------------------------------------------------
// GET /api/comments — paginated comment feed
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const parsed = getCommentsSchema.safeParse({
      cursorCreatedAt: searchParams.get("cursorCreatedAt") ?? undefined,
      cursorId: searchParams.get("cursorId") ?? undefined,
      pageSize: searchParams.get("pageSize") ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { cursorCreatedAt, cursorId, pageSize } = parsed.data;

    // Cursor-based pagination query — blocklisted txids are excluded
    const rows = await db.execute(sql`
      SELECT c.id, c.txid, c.display_name, c.comment_text, c.parent_txid, c.created_at
      FROM comments c
      WHERE (
        ${
          cursorCreatedAt && cursorId
            ? sql`(c.created_at, c.id) < (${cursorCreatedAt}::timestamptz, ${cursorId}::bigint)`
            : sql`TRUE`
        }
      )
      AND NOT EXISTS (
        SELECT 1 FROM txid_blocklist bl
        WHERE bl.txid = c.txid AND bl.is_active = TRUE
      )
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT ${pageSize ?? COMMENTS_PAGE_SIZE}
    `);

    type CommentRow = {
      id: number | string;
      txid: string;
      display_name: string;
      comment_text: string;
      parent_txid: string | null;
      created_at: Date | string;
    };

    const comments = (rows as unknown as CommentRow[]).map((row) => ({
      id: Number(row.id),
      txid: row.txid,
      displayName: row.display_name,
      commentText: row.comment_text,
      parentTxid: row.parent_txid,
      createdAt:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : String(row.created_at),
    }));

    // Build next cursor
    const lastItem = comments[comments.length - 1];
    const nextCursor =
      comments.length === (pageSize ?? COMMENTS_PAGE_SIZE) && lastItem
        ? { createdAt: lastItem.createdAt, id: lastItem.id }
        : null;

    return NextResponse.json(
      { comments, nextCursor },
      {
        headers: {
          "Cache-Control": "public, s-maxage=5, stale-while-revalidate=30",
        },
      }
    );
  } catch (err) {
    console.error("[GET /api/comments]", err);
    return NextResponse.json(
      { error: "Failed to fetch comments" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/comments — create a new on-chain comment
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  // Rate limiting — checks both per-minute and per-hour windows
  const ip = getClientIp(req);
  const rlResult = await checkRateLimit(ip);

  if (rlResult !== null && !rlResult.allowed) {
    return NextResponse.json(
      {
        error: "Too many requests. Please wait before posting again.",
        window: rlResult.window,
      },
      {
        status: 429,
        headers: {
          "X-RateLimit-Limit": String(rlResult.limit),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(rlResult.reset),
          "Retry-After": String(Math.ceil((rlResult.reset - Date.now()) / 1000)),
        },
      }
    );
  }

  // Parse & validate body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = postCommentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  // Generate a unique request ID for UTXO locking
  const requestId = randomBytes(8).toString("hex");

  // Build rate limit headers for the success response
  const rlHeaders: Record<string, string> = {};
  if (rlResult !== null) {
    rlHeaders["X-RateLimit-Limit"] = String(rlResult.limit);
    rlHeaders["X-RateLimit-Remaining"] = String(rlResult.remaining);
    rlHeaders["X-RateLimit-Reset"] = String(rlResult.reset);
  }

  try {
    const result = await writeComment(parsed.data, requestId);

    return NextResponse.json(
      {
        txid: result.txid,
        displayName: result.displayName,
        commentText: result.commentText,
        parentTxid: result.parentTxid ?? null,
        createdAt: result.createdAt.toISOString(),
      },
      { status: 201, headers: rlHeaders }
    );
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode }
      );
    }

    console.error("[POST /api/comments]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
