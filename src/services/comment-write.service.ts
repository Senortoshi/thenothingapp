import { db } from "@/db";
import { comments } from "@/db/schema";
import { checkoutUtxo, markUtxoSpent, releaseUtxo } from "./utxo-pool.service";
import { buildCommentTransaction } from "./wallet.service";
import { broadcastTransaction } from "./broadcast.service";
import { moderateComment, ModerationUnavailableError } from "./moderation.service";
import type { PostCommentInput } from "@/lib/validators";

export interface WriteCommentResult {
  txid: string;
  displayName: string;
  commentText: string;
  parentTxid?: string;
  createdAt: Date;
}

/**
 * Orchestrates posting a comment on-chain:
 *   1. Lock a UTXO
 *   2. Build + sign the OP_RETURN transaction
 *   3. Broadcast to ARC
 *   4. Persist to Postgres
 *   5. Mark UTXO spent
 *
 * On any failure after locking, the UTXO is released back to free.
 */
export async function writeComment(
  input: PostCommentInput,
  requestId: string
): Promise<WriteCommentResult> {
  const { commentText, displayName, parentTxid } = input;
  const timestamp = new Date().toISOString();

  // Step 0: Content moderation — MUST run before any on-chain work
  // Fail CLOSED: if the moderation API is configured but unreachable, reject.
  try {
    const modResult = await moderateComment(commentText);
    if (!modResult.approved) {
      throw new ServiceError(
        `CONTENT_VIOLATION:${modResult.violationCategory ?? "policy"}`,
        modResult.violationDetails ?? "Comment violates content policy.",
        400
      );
    }
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    if (err instanceof ModerationUnavailableError) {
      throw new ServiceError(
        "MODERATION_UNAVAILABLE",
        err.message,
        503
      );
    }
    // Unexpected moderation error — fail CLOSED
    console.error("[comment-write] Unexpected moderation error:", err);
    throw new ServiceError(
      "MODERATION_ERROR",
      "Unable to verify content at this time. Please try again.",
      503
    );
  }

  // Step 1: Lock a UTXO
  const utxo = await checkoutUtxo(requestId);
  if (!utxo) {
    throw new ServiceError(
      "NO_UTXOS",
      "The app is out of funded UTXOs. Please try again in a moment.",
      503
    );
  }

  let txid: string;

  try {
    // Step 2: Build + sign the transaction
    const { txHex, txid: builtTxid } = await buildCommentTransaction({
      utxo,
      commentText,
      displayName,
      timestamp,
      parentTxid,
    });

    txid = builtTxid;

    // Step 3: Broadcast to ARC
    const arcResult = await broadcastTransaction(txHex);

    // Use ARC's canonical txid if available (should match, but be safe)
    txid = arcResult.txid ?? txid;
  } catch (err) {
    // Release the UTXO so it can be used by the next request
    await releaseUtxo(utxo.id).catch(() => {
      // Non-critical — stale lock recovery will clean this up
    });

    if (err instanceof ServiceError) throw err;

    throw new ServiceError(
      "BROADCAST_FAILED",
      err instanceof Error ? err.message : "Failed to broadcast transaction",
      502
    );
  }

  try {
    // Step 4: Persist the comment
    const now = new Date();
    await db.insert(comments).values({
      txid,
      displayName,
      commentText,
      parentTxid: parentTxid ?? null,
      createdAt: now,
    });

    // Step 5: Mark UTXO as spent
    await markUtxoSpent(utxo.id);

    return {
      txid,
      displayName,
      commentText,
      parentTxid,
      createdAt: now,
    };
  } catch (err) {
    // TX was broadcast — can't undo that. Log and surface a degraded success.
    console.error("[comment-write] Failed to persist comment after broadcast", {
      txid,
      err,
    });

    // Still mark utxo spent (best effort)
    await markUtxoSpent(utxo.id).catch(() => {});

    // Return what we have — the on-chain write succeeded
    return {
      txid,
      displayName,
      commentText,
      parentTxid,
      createdAt: new Date(),
    };
  }
}

export class ServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = "ServiceError";
  }
}
