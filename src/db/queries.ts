import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// 1. UTXO Checkout — Atomic locking for serverless
// ---------------------------------------------------------------------------
// FOR UPDATE SKIP LOCKED guarantees:
//   - Only one serverless function gets each UTXO
//   - No blocking — if all UTXOs are locked, returns empty (caller retries or 503s)
//   - Must run inside a transaction
//
// Usage:
//   const [utxo] = await tx.execute(checkoutUtxoQuery("req_abc123"));
//   if (!utxo) throw new Error("No UTXOs available");
//   // ... sign & broadcast ...
//   await tx.execute(markUtxoSpent(utxo.id));
//   await tx.commit();
// ---------------------------------------------------------------------------

export const CHECKOUT_UTXO = sql`
  UPDATE utxo_pool
  SET status = 'locked',
      locked_at = NOW(),
      locked_by = ${sql.placeholder("requestId")}
  WHERE id = (
    SELECT id FROM utxo_pool
    WHERE status = 'free'
    ORDER BY satoshis ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING id, txid, vout, satoshis, script_hex;
`;

// ---------------------------------------------------------------------------
// 2. Mark UTXO as spent — after successful broadcast
// ---------------------------------------------------------------------------

export const MARK_UTXO_SPENT = sql`
  UPDATE utxo_pool
  SET status = 'spent'
  WHERE id = ${sql.placeholder("utxoId")};
`;

// ---------------------------------------------------------------------------
// 3. Stale lock recovery — cron job (run every 1-2 minutes)
// ---------------------------------------------------------------------------
// Any UTXO locked for more than 60 seconds is assumed to be from a
// crashed/timed-out serverless invocation. Reset it to free.
// Vercel functions timeout at 10s (hobby) or 60s (pro), so 60s is safe.
// ---------------------------------------------------------------------------

export const RECOVER_STALE_LOCKS = sql`
  UPDATE utxo_pool
  SET status = 'free',
      locked_at = NULL,
      locked_by = NULL
  WHERE status = 'locked'
    AND locked_at < NOW() - INTERVAL '60 seconds'
  RETURNING id, txid, vout;
`;

// ---------------------------------------------------------------------------
// 4. Cursor-based pagination — fetch comments page
// ---------------------------------------------------------------------------
// First page:  pass no cursor values
// Next page:   pass created_at and id of the last item from previous page
// ---------------------------------------------------------------------------

export const FETCH_COMMENTS_PAGE = sql`
  SELECT id, txid, display_name, comment_text, parent_txid, created_at
  FROM comments
  WHERE (
    ${sql.placeholder("cursorCreatedAt")}::timestamptz IS NULL
    OR (created_at, id) < (${sql.placeholder("cursorCreatedAt")}::timestamptz, ${sql.placeholder("cursorId")}::bigint)
  )
  ORDER BY created_at DESC, id DESC
  LIMIT ${sql.placeholder("pageSize")};
`;

// ---------------------------------------------------------------------------
// 5. UTXO pool health check — for replenishment cron
// ---------------------------------------------------------------------------

export const UTXO_POOL_STATS = sql`
  SELECT
    COUNT(*) FILTER (WHERE status = 'free')   AS free_count,
    COUNT(*) FILTER (WHERE status = 'locked') AS locked_count,
    COUNT(*) FILTER (WHERE status = 'spent')  AS spent_count,
    COALESCE(SUM(satoshis) FILTER (WHERE status = 'free'), 0) AS free_sats
  FROM utxo_pool;
`;
