/**
 * GET /api/comments/[txid]
 *
 * Fetch a single comment by BSV txid.
 * Returns 410 Gone if the txid is blocklisted (MAX-3).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";

interface RouteParams {
  params: { txid: string };
}

export async function GET(
  _req: NextRequest,
  { params }: RouteParams
) {
  const { txid } = params;

  // Validate txid format
  if (!/^[0-9a-f]{64}$/i.test(txid)) {
    return NextResponse.json(
      { error: "Invalid txid format" },
      { status: 400 }
    );
  }

  try {
    // Check blocklist first — fast indexed lookup
    const blockedRows = await db.execute(sql`
      SELECT reason FROM txid_blocklist
      WHERE txid = ${txid} AND is_active = TRUE
      LIMIT 1
    `);

    if ((blockedRows as unknown[]).length > 0) {
      return NextResponse.json(
        { error: "This content is no longer available.", txid },
        { status: 410 } // 410 Gone
      );
    }

    // Fetch the comment
    const rows = await db.execute(sql`
      SELECT id, txid, display_name, comment_text, parent_txid, created_at
      FROM comments
      WHERE txid = ${txid}
      LIMIT 1
    `);

    type CommentRow = {
      id: number | string;
      txid: string;
      display_name: string;
      comment_text: string;
      parent_txid: string | null;
      created_at: Date | string;
    };

    const row = (rows as unknown as CommentRow[])[0];

    if (!row) {
      return NextResponse.json(
        { error: "Comment not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: Number(row.id),
      txid: row.txid,
      displayName: row.display_name,
      commentText: row.comment_text,
      parentTxid: row.parent_txid,
      createdAt:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : String(row.created_at),
    });
  } catch (err) {
    console.error(`[GET /api/comments/${txid}]`, err);
    return NextResponse.json(
      { error: "Failed to fetch comment" },
      { status: 500 }
    );
  }
}
