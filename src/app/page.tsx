import { CommentFeedServer } from "@/components/comment-feed";
import { CommentFeedClient } from "@/components/comment-feed-client";

// Force dynamic rendering — page reads from the database on each request
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { initialComments, nextCursor } = await CommentFeedServer();

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="space-y-3 pb-6 border-b border-neutral-800/60">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-100 leading-tight">
          The Nothing App
        </h1>
        <p className="text-sm text-neutral-400 leading-relaxed max-w-lg">
          A public comment box. Every message is written to{" "}
          <span className="text-neutral-200 font-medium">BSV mainnet</span> as
          an{" "}
          <code className="text-xs bg-neutral-800 px-1.5 py-0.5 rounded font-[family-name:var(--font-geist-mono)] text-neutral-300">
            OP_RETURN
          </code>{" "}
          output &mdash; permanent, uncensorable, and free to post.
        </p>

        {/* Trust indicators */}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <TrustBadge icon="lock" label="Immutable" />
          <TrustBadge icon="globe" label="Public" />
          <TrustBadge icon="zap" label="Free to post" />
        </div>
      </div>

      {/* Main feed + form */}
      <CommentFeedClient
        initialComments={initialComments}
        initialNextCursor={nextCursor}
      />
    </div>
  );
}

function TrustBadge({
  icon,
  label,
}: {
  icon: "lock" | "globe" | "zap";
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-neutral-500 font-medium">
      {icon === "lock" && (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <rect x="2" y="5" width="8" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.25" />
          <path d="M4 5V3.5a2 2 0 1 1 4 0V5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        </svg>
      )}
      {icon === "globe" && (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.25" />
          <path d="M6 1.5C6 1.5 4.5 3.5 4.5 6s1.5 4.5 1.5 4.5M6 1.5C6 1.5 7.5 3.5 7.5 6S6 10.5 6 10.5M1.5 6h9" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        </svg>
      )}
      {icon === "zap" && (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M7 1.5L3 7h4l-2 3.5L11 5H7L7 1.5z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
        </svg>
      )}
      {label}
    </span>
  );
}
