import { buildCommentTransaction } from "./wallet.service";
import { broadcastTransaction } from "./broadcast.service";
import { moderateComment, ModerationUnavailableError, type CrisisResources } from "./moderation.service";
import { recordSpend } from "@/lib/rate-limiter";
import { acquireTipMutex, releaseTipMutex, getTip, setTip, recoverTipFromChain } from "@/lib/utxo-tip";
import { invalidateFeedCache } from "./comment-read.service";
import type { PostCommentInput } from "@/lib/validators";

export interface WriteCommentResult {
  txid: string;
  displayName: string;
  commentText: string;
  parentTxid?: string;
  tipAddress?: string;
  createdAt: Date;
}

/**
 * Orchestrates posting a comment on-chain:
 *   1. Moderate content (fail-closed)
 *   2. Acquire the Redis tip mutex
 *   3. Build + sign the OP_RETURN transaction
 *   4. Broadcast to ARC
 *   5. Update the Redis tip to the change output
 *   6. Release mutex
 *
 * The tip chain replaces the Postgres UTXO pool — every transaction spends
 * the current tip and the change output becomes the next tip.
 */
export async function writeComment(
  input: PostCommentInput,
  requestId: string
): Promise<WriteCommentResult> {
  const { commentText, displayName, parentTxid, tipAddress } = input;
  const timestamp = new Date().toISOString();

  // Step 0: Content moderation — MUST run before any on-chain work
  // Fail CLOSED: if the moderation API is configured but unreachable, reject.
  // displayName is included in the scan because it also goes on-chain verbatim.
  // The separator prevents a keyword being split across the two fields.
  const moderationInput = `${displayName}\n---\n${commentText}`;
  try {
    const modResult = await moderateComment(moderationInput);
    if (!modResult.approved) {
      const code = `CONTENT_VIOLATION:${modResult.violationCategory ?? "policy"}`;
      const err = new ServiceError(
        code,
        modResult.violationDetails ?? "Comment violates content policy.",
        400
      );
      if (code.startsWith("CONTENT_VIOLATION:self_harm") && modResult.crisisResources) {
        err.crisisResources = modResult.crisisResources;
      }
      throw err;
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

  // Step 1: Acquire tip mutex — serialises access so only one request
  // can spend the tip at a time. The 15 s TTL prevents deadlocks.
  const acquired = await acquireTipMutex(requestId);
  if (!acquired) {
    throw new ServiceError(
      "BUSY",
      "Processing another comment. Please try again in a moment.",
      503
    );
  }

  let txid: string;

  try {
    // Step 2: Get the current tip; recover from chain if missing
    let tip = await getTip();
    if (!tip) {
      tip = await recoverTipFromChain();
    }
    if (!tip) {
      throw new ServiceError(
        "NO_UTXOS",
        "The app is out of funded UTXOs. Please try again in a moment.",
        503
      );
    }

    // Step 3: Build + sign the transaction
    const { txHex, txid: builtTxid, fee, changeAmount, changeScriptHex } = await buildCommentTransaction({
      utxo: tip,
      commentText,
      displayName,
      timestamp,
      parentTxid,
      tipAddress,
    });

    txid = builtTxid;

    // Step 4: Optimistic tip update — set the tip to the expected change
    // output BEFORE broadcast. If broadcast succeeds and the function crashes
    // after, the tip is already correct. If broadcast fails, we roll back.
    const newTip = {
      txid: builtTxid,
      vout: 1, // change is always output index 1
      satoshis: changeAmount,
      scriptHex: changeScriptHex,
    };
    await setTip(newTip);

    // Step 5: Broadcast to ARC
    try {
      const arcResult = await broadcastTransaction(txHex);
      // Use ARC's canonical txid if available (should match, but be safe)
      if (arcResult.txid && arcResult.txid !== builtTxid) {
        txid = arcResult.txid;
        await setTip({ ...newTip, txid });
      }
    } catch (broadcastErr) {
      // Broadcast failed — roll back tip to the original UTXO
      await setTip(tip);
      throw broadcastErr;
    }

    // Fire-and-forget: record the on-chain spend against the daily cap
    recordSpend(fee).catch((err) =>
      console.warn("[comment-write] recordSpend failed:", err)
    );

    // Fire-and-forget: bust the feed cache so the next GET sees the new post
    invalidateFeedCache().catch((err) =>
      console.warn("[comment-write] invalidateFeedCache failed:", err)
    );

    return {
      txid,
      displayName,
      commentText,
      parentTxid,
      tipAddress,
      createdAt: new Date(),
    };
  } catch (err) {
    if (err instanceof ServiceError) throw err;

    console.error("[comment-write] Broadcast failed:", err);
    throw new ServiceError(
      "BROADCAST_FAILED",
      "Failed to broadcast transaction. Please try again.",
      502
    );
  } finally {
    // Always release the mutex, even on error
    await releaseTipMutex(requestId).catch(() => {});
  }
}

export class ServiceError extends Error {
  crisisResources?: CrisisResources;

  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = "ServiceError";
  }
}
