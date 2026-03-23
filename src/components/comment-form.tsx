"use client";

import { useState, useRef, useCallback, type FormEvent } from "react";
import type { Comment } from "./comment-item";
import { MAX_COMMENT_LENGTH, MAX_DISPLAY_NAME_LENGTH } from "@/lib/constants";

interface CommentFormProps {
  onCommentPosted?: (comment: Comment) => void;
}

type PostState = "idle" | "submitting" | "success" | "error";

/** Count bytes of a string encoded as UTF-8 */
function getUtf8ByteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

export function CommentForm({ onCommentPosted }: CommentFormProps) {
  const [commentText, setCommentText] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [tipAddress, setTipAddress] = useState("");
  const [showTipField, setShowTipField] = useState(false);
  const [state, setState] = useState<PostState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [lastTxid, setLastTxid] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // UTF-8 aware byte counter
  const byteCount = getUtf8ByteLength(commentText);
  const bytesLeft = MAX_COMMENT_LENGTH - byteCount;
  const isOverLimit = bytesLeft < 0;
  const isEmpty = commentText.trim().length === 0;
  const isSubmitting = state === "submitting";

  // Auto-resize textarea
  const handleTextareaChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setCommentText(e.target.value);
      const el = e.target;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    },
    []
  );

  async function doSubmit() {
    setState("submitting");
    setErrorMessage("");

    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commentText: commentText.trim(),
          displayName: displayName.trim() || "Anonymous",
          ...(tipAddress.trim() ? { tipAddress: tipAddress.trim() } : {}),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMessage("This post was not accepted.");
        setState("error");
        return;
      }

      setLastTxid(data.txid);
      setState("success");
      setCommentText("");

      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }

      onCommentPosted?.({
        txid: data.txid,
        displayName: data.displayName,
        commentText: data.commentText,
        parentTxid: data.parentTxid ?? null,
        tipAddress: data.tipAddress ?? null,
        createdAt: data.createdAt,
      });

      setTimeout(() => {
        setState("idle");
        setLastTxid("");
      }, 8000);
    } catch {
      setErrorMessage("Network error — please try again");
      setState("error");
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (isEmpty || isOverLimit || isSubmitting) return;
    doSubmit();
  }

  const counterColor =
    isOverLimit
      ? "text-red-400"
      : bytesLeft <= 50
      ? "text-amber-400"
      : bytesLeft <= 100
      ? "text-neutral-400"
      : "text-neutral-600";

  const progressPercent = Math.min(100, (byteCount / MAX_COMMENT_LENGTH) * 100);
  const progressColor =
    isOverLimit
      ? "#f87171"
      : bytesLeft <= 50
      ? "#fbbf24"
      : "#10b981";

  return (
    <form
      onSubmit={handleSubmit}
      className="border border-neutral-700/80 rounded-2xl p-5 bg-neutral-900/80 space-y-4 backdrop-blur-sm"
      noValidate
    >
      {/* Name field */}
      <div className="space-y-1.5">
        <label
          htmlFor="displayName"
          className="block text-xs font-medium text-neutral-400"
        >
          Name{" "}
          <span className="text-neutral-600 font-normal">(optional)</span>
        </label>
        <input
          id="displayName"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Anonymous"
          maxLength={MAX_DISPLAY_NAME_LENGTH}
          disabled={isSubmitting}
          autoComplete="off"
          className="w-full bg-neutral-800/70 border border-neutral-700 rounded-lg px-3 py-2.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-500 focus:border-neutral-500 disabled:opacity-50 transition-all min-h-[44px]"
        />
      </div>

      {/* Comment field */}
      <div className="space-y-1.5">
        <label
          htmlFor="commentText"
          className="block text-xs font-medium text-neutral-400"
        >
          Comment
        </label>
        <textarea
          id="commentText"
          ref={textareaRef}
          value={commentText}
          onChange={handleTextareaChange}
          placeholder="Write a message…"
          rows={3}
          disabled={isSubmitting}
          className="w-full bg-neutral-800/70 border border-neutral-700 rounded-lg px-3 py-2.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-500 focus:border-neutral-500 disabled:opacity-50 resize-none transition-all overflow-hidden leading-relaxed"
          style={{ minHeight: "88px" }}
        />

        {/* Byte counter + progress bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className={`text-xs font-mono tabular-nums ${counterColor}`}>
              {isOverLimit
                ? `${Math.abs(bytesLeft)} bytes over limit`
                : `${bytesLeft} bytes left`}
            </span>
            <span className="text-xs text-neutral-700 font-mono tabular-nums">
              {byteCount} / {MAX_COMMENT_LENGTH}
            </span>
          </div>
          {/* Progress bar */}
          {byteCount > 0 && (
            <div className="h-0.5 w-full bg-neutral-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-150"
                style={{
                  width: `${progressPercent}%`,
                  backgroundColor: progressColor,
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Optional tip address toggle + field */}
      {!showTipField ? (
        <button
          type="button"
          onClick={() => setShowTipField(true)}
          disabled={isSubmitting}
          className="text-xs text-neutral-600 hover:text-amber-500 transition-colors disabled:opacity-50 flex items-center gap-1"
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M6 2V10M2 6H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Want tips? Add a BSV address
        </button>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label
              htmlFor="tipAddress"
              className="block text-xs font-medium text-neutral-400"
            >
              Your BSV address{" "}
              <span className="text-neutral-600 font-normal">(for tips)</span>
            </label>
            <button
              type="button"
              onClick={() => { setShowTipField(false); setTipAddress(""); }}
              className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors"
            >
              Hide
            </button>
          </div>
          <input
            id="tipAddress"
            type="text"
            value={tipAddress}
            onChange={(e) => setTipAddress(e.target.value)}
            placeholder="1..."
            disabled={isSubmitting}
            autoComplete="off"
            className="w-full bg-neutral-800/70 border border-neutral-700 rounded-lg px-3 py-2.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-amber-500/50 focus:border-amber-500/50 disabled:opacity-50 transition-all font-mono min-h-[44px]"
          />
          <p className="text-xs text-neutral-700 leading-relaxed">
            Tips go directly to this address on-chain. This address will be permanently public.
          </p>
        </div>
      )}

      {/* Error state */}
      {state === "error" && (
        <div
          role="alert"
          className="text-sm text-red-300 bg-red-950/40 border border-red-800/50 rounded-lg px-3.5 py-2.5 flex items-start gap-2"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            className="flex-shrink-0 mt-0.5 text-red-400"
            aria-hidden="true"
          >
            <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
            <path d="M7 4.5V7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="7" cy="9.5" r="0.75" fill="currentColor" />
          </svg>
          {errorMessage}
        </div>
      )}

      {/* Success state */}
      {state === "success" && (
        <div
          role="status"
          className="text-sm bg-emerald-950/40 border border-emerald-800/50 rounded-lg px-3.5 py-2.5 space-y-1"
        >
          <div className="flex items-center gap-2 text-emerald-400 font-medium">
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              aria-hidden="true"
            >
              <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
              <path
                d="M4.5 7L6.5 9L9.5 5.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Written to BSV mainnet.
          </div>
          <a
            href={`https://whatsonchain.com/tx/${lastTxid}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs text-emerald-400/60 hover:text-emerald-300 underline underline-offset-2 break-all block transition-colors"
            aria-label={`View transaction ${lastTxid} on WhatsOnChain`}
          >
            {lastTxid}
          </a>
        </div>
      )}

      {/* Submit button */}
      <button
        type="submit"
        disabled={isEmpty || isOverLimit || isSubmitting}
        className="w-full bg-neutral-100 text-neutral-900 font-semibold text-sm rounded-lg px-4 py-3 hover:bg-white active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 flex items-center justify-center gap-2 min-h-[44px]"
        aria-busy={isSubmitting}
      >
        {isSubmitting ? (
          <>
            <span
              className="w-3.5 h-3.5 border-2 border-neutral-400 border-t-neutral-800 rounded-full animate-spin"
              aria-hidden="true"
            />
            Broadcasting…
          </>
        ) : (
          "Post to BSV"
        )}
      </button>
    </form>
  );
}
