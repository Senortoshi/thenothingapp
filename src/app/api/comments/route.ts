import { NextRequest, NextResponse } from "next/server";
import { postCommentSchema, getCommentsSchema } from "@/lib/validators";
import { writeComment, ServiceError } from "@/services/comment-write.service";
import { getComments } from "@/services/comment-read.service";
import { randomBytes } from "crypto";
import { checkRateLimit } from "@/lib/rate-limiter";
import { getClientIp } from "@/lib/ip";

// ---------------------------------------------------------------------------
// GET /api/comments — paginated comment feed
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const parsed = getCommentsSchema.safeParse({
      cursorOffset: searchParams.get("cursorOffset") ?? undefined,
      pageSize: searchParams.get("pageSize") ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { comments, nextCursor } = await getComments({
      cursorOffset: parsed.data.cursorOffset,
      pageSize: parsed.data.pageSize,
    });

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
  // ── Rate limiting — fail closed ──────────────────────────────────────────
  const ip = getClientIp(req);
  const rlResult = await checkRateLimit(ip);

  if (!rlResult.allowed) {
    return NextResponse.json(
      { error: rlResult.reason },
      { status: rlResult.status, headers: rlResult.headers }
    );
  }

  // ── Parse & validate body ────────────────────────────────────────────────
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

  // ── Write comment + circuit breaker telemetry ────────────────────────────
  try {
    const result = await writeComment(parsed.data, requestId);

    // Feed cache invalidation already happens inside writeComment() (fire-and-forget)

    return NextResponse.json(
      {
        txid: result.txid,
        displayName: result.displayName,
        commentText: result.commentText,
        parentTxid: result.parentTxid ?? null,
        createdAt: result.createdAt.toISOString(),
      },
      { status: 201, headers: rlResult.headers }
    );
  } catch (err) {
    if (err instanceof ServiceError) {
      // A known service error (e.g. validation, UTXO exhaustion) is not a
      // broadcast failure in the circuit-breaker sense — don't count it.
      const body: Record<string, unknown> = { error: err.message, code: err.code };
      if (err.crisisResources) {
        body.crisisResources = err.crisisResources;
      }
      return NextResponse.json(body, { status: err.statusCode });
    }

    // Unknown error — broadcast failures are tracked by the broadcast service itself
    console.error("[POST /api/comments]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
