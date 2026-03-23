/**
 * GET /api/comments/[txid]
 *
 * Fetch a single comment by BSV txid.
 * Reads directly from the blockchain via WhatsOnChain.
 * Returns 410 Gone if the txid is blocklisted.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTxHex } from "@/lib/woc";
import { parseOpReturnComment } from "@/lib/op-return";
import { isBlocklisted } from "@/lib/blocklist";

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
    // Check blocklist first
    if (await isBlocklisted(txid)) {
      return NextResponse.json(
        { error: "This content is no longer available.", txid },
        { status: 410 } // 410 Gone
      );
    }

    // Fetch raw tx from chain and parse OP_RETURN
    const hex = await getTxHex(txid);
    const parsed = parseOpReturnComment(hex);

    if (!parsed) {
      return NextResponse.json(
        { error: "Comment not found or not a valid BSVibes comment" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      txid,
      displayName: parsed.displayName || "Anonymous",
      commentText: parsed.commentText,
      parentTxid: parsed.parentTxid ?? null,
      createdAt: parsed.timestamp,
    });
  } catch (err) {
    console.error(`[GET /api/comments/${txid}]`, err);
    return NextResponse.json(
      { error: "Failed to fetch comment" },
      { status: 500 }
    );
  }
}
