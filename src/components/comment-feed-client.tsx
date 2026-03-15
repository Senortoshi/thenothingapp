"use client";

import { useState, useCallback, useTransition } from "react";
import { CommentItem, CommentItemSkeleton, type Comment } from "./comment-item";
import { CommentForm } from "./comment-form";

interface CommentFeedClientProps {
  initialComments: Comment[];
  initialNextCursor: { createdAt: string; id: number } | null;
}

export function CommentFeedClient({
  initialComments,
  initialNextCursor,
}: CommentFeedClientProps) {
  const [comments, setComments] = useState<Comment[]>(initialComments);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [isPending, startTransition] = useTransition();
  const [hasMore, setHasMore] = useState(initialNextCursor !== null);
  const [loadError, setLoadError] = useState("");

  const handleCommentPosted = useCallback((newComment: Comment) => {
    setComments((prev) => [newComment, ...prev]);
  }, []);

  const loadMore = useCallback(() => {
    if (!nextCursor || isPending) return;

    setLoadError("");
    startTransition(async () => {
      try {
        const params = new URLSearchParams({
          cursorCreatedAt: nextCursor.createdAt,
          cursorId: String(nextCursor.id),
        });

        const res = await fetch(`/api/comments?${params.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        const newComments: Comment[] = data.comments ?? [];

        setComments((prev) => [...prev, ...newComments]);

        if (data.nextCursor) {
          setNextCursor(data.nextCursor);
        } else {
          setNextCursor(null);
          setHasMore(false);
        }
      } catch (err) {
        setLoadError(
          err instanceof Error ? err.message : "Failed to load more"
        );
      }
    });
  }, [nextCursor, isPending]);

  const commentCount = comments.length;

  return (
    <div className="space-y-6">
      {/* Post form */}
      <CommentForm onCommentPosted={handleCommentPosted} />

      {/* Feed header */}
      <div className="flex items-center justify-between pt-2">
        <h2 className="text-xs font-medium text-neutral-500 uppercase tracking-widest">
          {commentCount === 0
            ? "No messages yet"
            : `${commentCount} message${commentCount === 1 ? "" : "s"}`}
        </h2>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/70" aria-hidden="true" />
          <span className="text-xs text-neutral-600 font-mono">BSV mainnet</span>
        </div>
      </div>

      {/* Comment list */}
      {commentCount === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-2.5">
          {comments.map((comment) => (
            <CommentItem key={comment.txid} comment={comment} />
          ))}
        </div>
      )}

      {/* Load more skeletons while pending */}
      {isPending && (
        <div className="space-y-2.5" aria-label="Loading more comments">
          <CommentItemSkeleton />
          <CommentItemSkeleton />
          <CommentItemSkeleton />
        </div>
      )}

      {/* Load error */}
      {loadError && (
        <p className="text-sm text-red-400 text-center py-2" role="alert">
          {loadError}
        </p>
      )}

      {/* Load more button */}
      {hasMore && !isPending && (
        <button
          onClick={loadMore}
          disabled={isPending}
          className="w-full border border-neutral-800 rounded-xl py-3 text-sm text-neutral-500 hover:text-neutral-300 hover:border-neutral-700 hover:bg-neutral-900/40 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed font-medium min-h-[44px]"
        >
          Load more
        </button>
      )}

      {/* End of feed */}
      {!hasMore && commentCount > 0 && (
        <div className="flex items-center gap-3 py-2">
          <div className="flex-1 h-px bg-neutral-800/60" />
          <p className="text-xs text-neutral-700 font-mono whitespace-nowrap">
            all messages loaded
          </p>
          <div className="flex-1 h-px bg-neutral-800/60" />
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="border border-dashed border-neutral-800 rounded-2xl py-16 px-6 text-center space-y-3">
      {/* Icon */}
      <div className="flex justify-center mb-4">
        <div className="w-12 h-12 rounded-full border border-neutral-800 flex items-center justify-center">
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            className="text-neutral-700"
            aria-hidden="true"
          >
            <rect x="2" y="4" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
            <path d="M6 8h8M6 11h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      </div>
      <p className="text-neutral-500 text-sm font-medium">Nothing here yet.</p>
      <p className="text-neutral-700 text-xs leading-relaxed max-w-xs mx-auto">
        Be the first to write something permanent. It will live on the BSV
        blockchain forever.
      </p>
    </div>
  );
}
