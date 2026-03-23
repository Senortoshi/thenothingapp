import { CommentFeedServer } from "@/components/comment-feed";
import { CommentFeedClient } from "@/components/comment-feed-client";

// Force dynamic rendering — page reads from the database on each request
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { initialComments, nextCursor } = await CommentFeedServer();

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="space-y-2 pb-6 border-b border-neutral-800/60">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-100 leading-tight">
          <span className="text-amber-400">BS</span>Vibes
        </h1>
        <p className="text-sm text-neutral-500 leading-relaxed">
          A public comment box on BSV mainnet. Free to post.
        </p>
      </div>

      {/* Main feed + form */}
      <CommentFeedClient
        initialComments={initialComments}
        initialNextCursor={nextCursor}
      />
    </div>
  );
}
