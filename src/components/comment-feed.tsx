import { db } from "@/db";
import { sql } from "drizzle-orm";
import { COMMENTS_PAGE_SIZE } from "@/lib/constants";
import type { Comment } from "./comment-item";

/**
 * Server Component — fetches the initial page of comments at render time.
 * Returned data is passed as a prop to the client wrapper for hydration.
 */
export async function CommentFeedServer(): Promise<{
  initialComments: Comment[];
  nextCursor: { createdAt: string; id: number } | null;
}> {
  try {
    const rows = await db.execute(sql`
      SELECT c.id, c.txid, c.display_name, c.comment_text, c.parent_txid, c.created_at
      FROM comments c
      WHERE NOT EXISTS (
        SELECT 1 FROM txid_blocklist bl
        WHERE bl.txid = c.txid AND bl.is_active = TRUE
      )
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT ${COMMENTS_PAGE_SIZE}
    `);

    type CommentRow = {
      id: number | string;
      txid: string;
      display_name: string;
      comment_text: string;
      parent_txid: string | null;
      created_at: Date | string;
    };
    const initialComments = (rows as unknown as CommentRow[]).map((row) => ({
      id: Number(row.id),
      txid: row.txid,
      displayName: row.display_name,
      commentText: row.comment_text,
      parentTxid: row.parent_txid,
      createdAt:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : String(row.created_at),
    }));

    const lastItem = initialComments[initialComments.length - 1];
    const nextCursor =
      initialComments.length === COMMENTS_PAGE_SIZE && lastItem
        ? { createdAt: lastItem.createdAt, id: lastItem.id }
        : null;

    return { initialComments, nextCursor };
  } catch (err) {
    console.error("[CommentFeedServer] Failed to fetch comments", err);
    return { initialComments: [], nextCursor: null };
  }
}
