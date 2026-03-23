import { NextRequest, NextResponse } from "next/server";
import { getAddressBalance } from "@/lib/woc";
import { getRedis } from "@/lib/redis";

const TIP_CACHE_TTL_SECONDS = 30;
const MAX_ADDRESSES_PER_REQUEST = 20;

/**
 * GET /api/tips?addresses=addr1,addr2,...
 *
 * Returns the total received satoshis for each BSV address.
 * Used to display tip totals on comments in the feed.
 * Results are cached in Redis for 30 seconds.
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("addresses");
  if (!raw) {
    return NextResponse.json(
      { error: "Missing 'addresses' query parameter" },
      { status: 400 }
    );
  }

  const addresses = raw
    .split(",")
    .map((a) => a.trim())
    .filter((a) => /^1[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(a))
    .slice(0, MAX_ADDRESSES_PER_REQUEST);

  if (addresses.length === 0) {
    return NextResponse.json(
      { error: "No valid BSV addresses provided" },
      { status: 400 }
    );
  }

  const redis = getRedis();
  const results: Record<string, number> = {};

  // Check Redis cache first, collect misses
  const uncached: string[] = [];

  for (const addr of addresses) {
    if (redis) {
      const cached = await redis.get<number>(`nothing_app:tip_balance:${addr}`);
      if (cached !== null) {
        results[addr] = cached;
        continue;
      }
    }
    uncached.push(addr);
  }

  // Fetch uncached balances from WhatsOnChain (sequential to respect rate limits)
  for (const addr of uncached) {
    try {
      const balance = await getAddressBalance(addr);
      const total = balance.confirmed + balance.unconfirmed;
      results[addr] = total;

      // Cache in Redis
      if (redis) {
        await redis.set(`nothing_app:tip_balance:${addr}`, total, {
          ex: TIP_CACHE_TTL_SECONDS,
        }).catch(() => {});
      }
    } catch {
      // WoC failure for this address — return 0 rather than failing the whole request
      results[addr] = 0;
    }
  }

  return NextResponse.json(
    { balances: results },
    {
      headers: {
        "Cache-Control": "public, s-maxage=5, stale-while-revalidate=30",
      },
    }
  );
}
