/**
 * Admin Blocklist API
 *
 * Manages the txid_blocklist table for legal content delisting.
 * All routes require the ADMIN_API_KEY header.
 *
 * GET    /api/admin/blocklist          — list all entries (paginated)
 * POST   /api/admin/blocklist          — add a txid to the blocklist
 * DELETE /api/admin/blocklist          — deactivate a blocklist entry (soft delete)
 *
 * GET /api/admin/blocklist/[txid]      — handled in ./[txid]/route.ts
 *
 * Protected by: Authorization: Bearer <ADMIN_API_KEY>
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { txidBlocklist } from "@/db/schema";
import { sql, eq, and } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const BLOCKLIST_REASONS = [
  "dmca",
  "csam",
  "court_order",
  "hate_speech",
  "violence",
  "spam",
  "other",
] as const;

const addBlocklistSchema = z.object({
  txid: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, "txid must be a 64-character hex string"),
  reason: z.enum(BLOCKLIST_REASONS),
  notes: z.string().max(1000).optional(),
  addedBy: z.string().max(100).optional().default("admin"),
});

const removeBlocklistSchema = z.object({
  txid: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, "txid must be a 64-character hex string"),
  notes: z.string().max(1000).optional(), // optional reason for removal
});

// ---------------------------------------------------------------------------
// GET /api/admin/blocklist — list entries
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  try {
    const { searchParams } = req.nextUrl;
    const includeInactive = searchParams.get("includeInactive") === "true";
    const limit = Math.min(
      parseInt(searchParams.get("limit") ?? "50", 10),
      200
    );

    const rows = await db.execute(sql`
      SELECT id, txid, reason, notes, added_by, is_active, created_at, updated_at
      FROM txid_blocklist
      ${includeInactive ? sql`` : sql`WHERE is_active = TRUE`}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);

    return NextResponse.json({ entries: rows, count: (rows as unknown[]).length });
  } catch (err) {
    console.error("[GET /api/admin/blocklist]", err);
    return NextResponse.json(
      { error: "Failed to fetch blocklist" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/admin/blocklist — add a txid
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = addBlocklistSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const { txid, reason, notes, addedBy } = parsed.data;

  try {
    // Upsert: if it already exists but is inactive, reactivate it
    const existing = await db.execute(sql`
      SELECT id, is_active FROM txid_blocklist WHERE txid = ${txid}
    `);

    type ExistingRow = { id: number | string; is_active: boolean };
    const existingRow = (existing as unknown as ExistingRow[])[0];

    if (existingRow) {
      if (existingRow.is_active) {
        return NextResponse.json(
          { error: "txid is already blocklisted", txid },
          { status: 409 }
        );
      }

      // Reactivate
      await db.execute(sql`
        UPDATE txid_blocklist
        SET is_active = TRUE,
            reason = ${reason},
            notes = ${notes ?? null},
            added_by = ${addedBy},
            updated_at = NOW()
        WHERE txid = ${txid}
      `);

      console.warn("[blocklist] Reactivated blocklist entry", { txid, reason, addedBy });
      return NextResponse.json({ txid, action: "reactivated" }, { status: 200 });
    }

    // New entry
    await db.insert(txidBlocklist).values({
      txid,
      reason,
      notes: notes ?? null,
      addedBy,
      isActive: true,
    });

    // Special handling for CSAM — trigger NCMEC pipeline
    if (reason === "csam") {
      console.error(
        "[blocklist] CSAM txid blocklisted via admin API",
        { txid, addedBy }
      );
      // Import dynamically to avoid circular deps at module load time
      const { reportToNcmec } = await import("@/services/ncmec.service");
      await reportToNcmec({
        content: `[admin-blocklisted txid: ${txid}]`,
        detectedBy: `admin:${addedBy}`,
        detectedAt: new Date().toISOString(),
        txid,
      }).catch((err) => console.error("[blocklist] NCMEC report failed:", err));
    }

    console.warn("[blocklist] Added txid to blocklist", { txid, reason, addedBy });
    return NextResponse.json({ txid, action: "blocklisted" }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/admin/blocklist]", err);
    return NextResponse.json(
      { error: "Failed to add to blocklist" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/admin/blocklist — deactivate (soft-remove) an entry
// ---------------------------------------------------------------------------

export async function DELETE(req: NextRequest) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = removeBlocklistSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const { txid, notes } = parsed.data;

  try {
    const result = await db.execute(sql`
      UPDATE txid_blocklist
      SET is_active = FALSE,
          notes = COALESCE(${notes ?? null}, notes),
          updated_at = NOW()
      WHERE txid = ${txid} AND is_active = TRUE
      RETURNING id
    `);

    if ((result as unknown[]).length === 0) {
      return NextResponse.json(
        { error: "No active blocklist entry found for that txid" },
        { status: 404 }
      );
    }

    console.warn("[blocklist] Deactivated blocklist entry", { txid });
    return NextResponse.json({ txid, action: "delisted" });
  } catch (err) {
    console.error("[DELETE /api/admin/blocklist]", err);
    return NextResponse.json(
      { error: "Failed to remove from blocklist" },
      { status: 500 }
    );
  }
}
