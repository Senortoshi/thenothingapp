import { formatDistanceToNowStrict } from "@/lib/date-utils";
import { TipButton } from "./tip-button";

export interface Comment {
  txid: string;
  displayName: string;
  commentText: string;
  parentTxid: string | null;
  tipAddress: string | null;
  createdAt: string;
}

interface CommentItemProps {
  comment: Comment;
  onReport?: (txid: string) => void;
}

/** Deterministic hue from a string — used for avatar color */
function stringToHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

export function CommentItem({ comment, onReport }: CommentItemProps) {
  const { txid, displayName, commentText, createdAt } = comment;
  const shortTxid = `${txid.slice(0, 6)}…${txid.slice(-6)}`;
  const timeAgo = formatDistanceToNowStrict(new Date(createdAt));
  const hue = stringToHue(displayName);
  const avatarInitial = displayName.charAt(0).toUpperCase();

  return (
    <article
      className="group border border-neutral-800 rounded-xl p-4 bg-neutral-950 hover:border-neutral-700/80 hover:bg-neutral-900/60 transition-all duration-200"
      aria-label={`Comment by ${displayName}`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Avatar */}
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-semibold"
            style={{
              backgroundColor: `hsl(${hue}, 30%, 20%)`,
              color: `hsl(${hue}, 60%, 65%)`,
              border: `1px solid hsl(${hue}, 30%, 28%)`,
            }}
            aria-hidden="true"
          >
            {avatarInitial}
          </div>
          <span className="text-sm font-medium text-neutral-200 truncate">
            {displayName}
          </span>
        </div>

        {/* Timestamp + report button */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <time
            className="text-xs text-neutral-500 whitespace-nowrap tabular-nums"
            dateTime={createdAt}
            title={new Date(createdAt).toLocaleString()}
          >
            {timeAgo}
          </time>

          {onReport && (
            <button
              type="button"
              onClick={() => onReport(txid)}
              aria-label={`Report comment by ${displayName}`}
              className={[
                "w-6 h-6 flex items-center justify-center rounded-md",
                "text-neutral-600 hover:text-red-400",
                "transition-colors duration-150",
                "focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:ring-offset-1 focus:ring-offset-neutral-950",
                // Desktop: only show on group hover or keyboard focus. Mobile: always visible.
                "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100",
              ].join(" ")}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 14 14"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M2.5 1.5V12.5M2.5 1.5H10.5L8.5 5L10.5 8.5H2.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Comment text */}
      <p className="mt-3 text-sm text-neutral-300 leading-relaxed whitespace-pre-wrap break-words">
        {commentText}
      </p>

      {/* Footer — on-chain badge */}
      <div className="mt-3 pt-2.5 border-t border-neutral-800/60 flex items-center justify-between gap-2">
        <a
          href={`https://whatsonchain.com/tx/${txid}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-neutral-600 hover:text-emerald-400 transition-colors font-mono group/link"
          title={`View full transaction on WhatsOnChain: ${txid}`}
          aria-label={`View transaction ${txid} on WhatsOnChain`}
        >
          {/* On-chain dot */}
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-emerald-900/60 bg-emerald-950/40 text-emerald-500 font-sans font-medium tracking-wide"
            style={{ fontSize: "10px" }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" aria-hidden="true" />
            on-chain
          </span>

          <span className="text-neutral-700 group-hover/link:text-emerald-500/60 transition-colors">
            {shortTxid}
          </span>

          {/* External link icon */}
          <svg
            width="10"
            height="10"
            viewBox="0 0 12 12"
            fill="none"
            className="opacity-40 group-hover/link:opacity-70 transition-opacity flex-shrink-0"
            aria-hidden="true"
          >
            <path
              d="M3.5 3H9V8.5M9 3L3 9"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </a>

        {/* Tip button (only shown when commenter provided a tip address) */}
        <div className="flex items-center gap-2">
          {comment.tipAddress && <TipButton tipAddress={comment.tipAddress} />}
          <span
            className="text-neutral-800 font-mono hidden sm:inline"
            style={{ fontSize: "10px" }}
          >
            BSV
          </span>
        </div>
      </div>
    </article>
  );
}

/** Skeleton placeholder while comments are loading */
export function CommentItemSkeleton() {
  return (
    <div
      className="border border-neutral-800 rounded-xl p-4 bg-neutral-950 space-y-3 animate-pulse"
      aria-hidden="true"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-neutral-800" />
          <div className="h-3 w-24 bg-neutral-800 rounded-full" />
        </div>
        <div className="h-3 w-12 bg-neutral-800 rounded-full" />
      </div>
      <div className="space-y-2 pt-1">
        <div className="h-3 w-full bg-neutral-800/80 rounded-full" />
        <div className="h-3 w-4/5 bg-neutral-800/60 rounded-full" />
      </div>
      <div className="pt-2 border-t border-neutral-800/60">
        <div className="h-3 w-28 bg-neutral-800/60 rounded-full" />
      </div>
    </div>
  );
}
