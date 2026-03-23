/**
 * DELETE /api/admin/comments/[txid]/pii
 *
 * GDPR Right-to-Erasure endpoint.
 *
 * Nullifies the display_name for a given comment (sets it to "Deleted").
 * The comment_text is an on-chain mirror and is not modified here; if full
 * delisting is needed, use the blocklist API to hide the comment entirely.
 *
 * Protected by: Authorization: Bearer <ADMIN_API_KEY>
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { comments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";

// ---------------------------------------------------------------------------
// DELETE handler
// ---------------------------------------------------------------------------

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ txid: string }> }
) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  const { txid } = await params;

  // Basic validation: txid must be a 64-char hex string
  if (!/^[0-9a-f]{64}$/i.test(txid)) {
    return NextResponse.json(
      { error: "Invalid txid format. Must be a 64-character hex string." },
      { status: 400 }
    );
  }

  try {
    const result = await db
      .update(comments)
      .set({ displayName: "Deleted" })
      .where(eq(comments.txid, txid))
      .returning({ id: comments.id });

    if (result.length === 0) {
      return NextResponse.json(
        { error: "Comment not found for the given txid." },
        { status: 404 }
      );
    }

    console.warn("[admin/pii-erasure] display_name erased", { txid });

    return NextResponse.json({
      ok: true,
      txid,
      action: "display_name set to Deleted",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[DELETE /api/admin/comments/[txid]/pii]", err);
    return NextResponse.json(
      { error: "Failed to erase PII." },
      { status: 500 }
    );
  }
}
