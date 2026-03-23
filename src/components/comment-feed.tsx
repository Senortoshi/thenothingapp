import { getComments } from "@/services/comment-read.service";
import type { Comment } from "./comment-item";

/**
 * Server Component — fetches the initial page of comments at render time.
 * Returned data is passed as a prop to the client wrapper for hydration.
 */
export async function CommentFeedServer(): Promise<{
  initialComments: Comment[];
  nextCursor: { offset: number } | null;
}> {
  try {
    const { comments, nextCursor } = await getComments();
    return { initialComments: comments, nextCursor };
  } catch (err) {
    console.error("[CommentFeedServer] Failed to fetch comments", err);
    return { initialComments: [], nextCursor: null };
  }
}
