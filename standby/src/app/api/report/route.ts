import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { getClientIp, hashIp } from "@/lib/ip";
import { db } from "@/db";
import { contentReports } from "@/db/schema";

// ---------------------------------------------------------------------------
// Validation schema
// ---------------------------------------------------------------------------

const REPORT_REASONS = [
  "My personal information is in this post",
  "Harassment or threats",
  "Illegal content",
  "Spam",
  "Other",
] as const;

const reportSchema = z.object({
  txid: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, "Invalid txid — must be a 64-character hex string"),
  reason: z.enum(REPORT_REASONS, {
    errorMap: () => ({ message: "Invalid report reason" }),
  }),
  details: z
    .string()
    .max(500, "Details must be 500 characters or fewer")
    .optional(),
  contactEmail: z
    .string()
    .email("Invalid email address")
    .optional(),
});

export type ReportInput = z.infer<typeof reportSchema>;

// ---------------------------------------------------------------------------
// Rate limiter — 5 reports per IP per hour (lazy singleton)
// ---------------------------------------------------------------------------

let reportLimiter: Ratelimit | null = null;

function getReportLimiter(): Ratelimit | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) return null;

  if (!reportLimiter) {
    reportLimiter = new Ratelimit({
      redis: new Redis({ url, token }),
      limiter: Ratelimit.slidingWindow(5, "3600s"),
      analytics: false,
      prefix: "nothing_app:rl:report:ip:hour",
    });
  }

  return reportLimiter;
}

// ---------------------------------------------------------------------------
// POST /api/report
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);

  // ── Rate limiting ──────────────────────────────────────────────────────────
  const limiter = getReportLimiter();
  const isDev = process.env.NODE_ENV === "development";

  if (!limiter) {
    if (!isDev) {
      console.error("[POST /api/report] Rate limiter not configured — rejecting.");
      return NextResponse.json(
        { error: "Service not configured. Please try again later." },
        { status: 503 }
      );
    }
    // Dev: allow without Redis
    console.warn("[POST /api/report] Rate limiting DISABLED (dev mode).");
  } else {
    let rlResult: Awaited<ReturnType<typeof limiter.limit>>;
    try {
      rlResult = await limiter.limit(hashIp(ip));
    } catch (err) {
      console.error("[POST /api/report] Rate limiter Redis error — failing closed:", err);
      return NextResponse.json(
        { error: "Rate limiting service unavailable. Please try again shortly." },
        { status: 503 }
      );
    }

    if (!rlResult.success) {
      return NextResponse.json(
        { error: "Too many reports. Please wait before submitting another report." },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": String(rlResult.limit),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(rlResult.reset),
            "Retry-After": String(
              Math.max(1, Math.ceil((rlResult.reset - Date.now()) / 1000))
            ),
          },
        }
      );
    }
  }

  // ── Parse & validate body ──────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = reportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const { txid, reason, details, contactEmail } = parsed.data;
  const ipHashed = hashIp(ip);

  // Map user-facing reason strings to DB enum values
  const reasonMap: Record<string, "personal_information" | "harassment" | "illegal_content" | "spam" | "other"> = {
    "My personal information is in this post": "personal_information",
    "Harassment or threats": "harassment",
    "Illegal content": "illegal_content",
    "Spam": "spam",
    "Other": "other",
  };
  const dbReason = reasonMap[reason] ?? "other";

  // ── Persist the report ──────────────────────────────────────────────────────
  try {
    await db.insert(contentReports).values({
      txid,
      reason: dbReason,
      details: details ?? null,
      contactEmail: contactEmail ?? null,
      ipHash: ipHashed,
    });
  } catch (err) {
    console.error("[POST /api/report] Failed to persist report:", err);
    return NextResponse.json(
      { error: "Failed to save report. Please try again." },
      { status: 500 }
    );
  }

  console.log("[report] Report persisted", {
    txid,
    reason: dbReason,
    hasDetails: Boolean(details),
    hasContactEmail: Boolean(contactEmail),
    ipHash: ipHashed,
  });

  return NextResponse.json(
    { message: "Report submitted. We will review this content." },
    { status: 201 }
  );
}
