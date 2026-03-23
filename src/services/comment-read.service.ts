import { getAddressTxHistory, getTxHex } from "@/lib/woc";
import { parseOpReturnComment } from "@/lib/op-return";
import { getFundingAddress } from "@/services/wallet.service";
import { isBlocklisted } from "@/lib/blocklist";
import { COMMENTS_PAGE_SIZE, FEED_CACHE_TTL_SECONDS, FEED_CACHE_MAX_ITEMS } from "@/lib/constants";

export interface CommentDTO {
  txid: string;
  displayName: string;
  commentText: string;
  parentTxid: string | null;
  tipAddress: string | null;
  createdAt: string;
}

export interface GetCommentsResult {
  comments: CommentDTO[];
  nextCursor: { offset: number } | null;
}

// ---------------------------------------------------------------------------
// In-memory feed cache
// ---------------------------------------------------------------------------

let feedCache: { data: CommentDTO[]; expiry: number } | null = null;

export async function getComments(params?: { cursorOffset?: number; pageSize?: number }): Promise<GetCommentsResult> {
  const offset = params?.cursorOffset ?? 0;
  const pageSize = params?.pageSize ?? COMMENTS_PAGE_SIZE;
  const now = Date.now();

  // Try in-memory cache for first page
  if (offset === 0 && feedCache && now < feedCache.expiry) {
    const page = feedCache.data.slice(0, pageSize);
    return {
      comments: page,
      nextCursor: feedCache.data.length > pageSize ? { offset: pageSize } : null,
    };
  }

  // Fetch from chain
  const address = getFundingAddress();
  const history = await getAddressTxHistory(address);

  // Newest first
  history.reverse();

  // Scan a generous window of txs to collect a full page of comments.
  // The address history includes non-comment txs (funding tx, old-prefix txs,
  // change-only txs) that all parse to null — so we must look well beyond
  // pageSize entries to fill a page. Cap at FEED_CACHE_MAX_ITEMS to limit
  // WoC round-trips per request.
  const scanWindow = history.slice(offset, offset + FEED_CACHE_MAX_ITEMS);

  // Fetch and parse each tx, stopping once we have a full page
  const comments: CommentDTO[] = [];
  for (const item of scanWindow) {
    if (comments.length >= pageSize) break;
    try {
      if (await isBlocklisted(item.tx_hash)) continue;
      const hex = await getTxHex(item.tx_hash);
      const parsed = parseOpReturnComment(hex);
      if (!parsed) continue;
      comments.push({
        txid: item.tx_hash,
        displayName: parsed.displayName || "Anonymous",
        commentText: parsed.commentText,
        parentTxid: parsed.parentTxid ?? null,
        tipAddress: parsed.tipAddress ?? null,
        createdAt: parsed.timestamp,
      });
    } catch { continue; }
  }

  // Cache first page in memory only when we actually found comments —
  // avoids caching an empty result caused by transient WoC issues.
  if (offset === 0 && comments.length > 0) {
    feedCache = { data: comments, expiry: now + FEED_CACHE_TTL_SECONDS * 1000 };
  }

  const nextOffset = offset + pageSize;
  return {
    comments,
    nextCursor: nextOffset < history.length ? { offset: nextOffset } : null,
  };
}

export async function invalidateFeedCache(): Promise<void> {
  feedCache = null;
}
