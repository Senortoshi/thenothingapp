# Nothing App (BSVibes)

Anonymous comment platform where every post becomes a permanent OP_RETURN transaction on BSV mainnet. The app absorbs all fees — no wallet or account required.

## Current Scope: MVP On-Chain Comment Box
The app is scoped to ONLY the core comment flow. All other features (admin, reporting, NCMEC, replenishment, reconciliation) are moved to `standby/` with a reconstruction manifest at `standby/MANIFEST.md`.

## Stack
- **Framework**: Next.js 14.2 (App Router) on Vercel
- **Chain reads**: WhatsOnChain API (address tx history, raw tx hex)
- **Cache/Rate Limiting**: Upstash Redis (sliding window per-IP + global; tip mutex; feed cache)
- **BSV**: @bsv/sdk — TAAL ARC + GorillaPool ARC for broadcast
- **Moderation**: OpenAI Moderation API (primary), keyword filter (fallback in dev)
- **Testing**: Vitest
- **Language**: TypeScript, Tailwind CSS

## Commands
- `bun run dev` — local dev server
- `bun run build` — production build
- `bun run test` — run all tests (vitest)
- `bun run test:watch` — watch mode
- `bun run test:coverage` — coverage report
- `npm run fund-wallet` — check wallet status or generate a new funding key

## Key Architecture Decisions
- **Tip-chain UTXO model**: A single UTXO is tracked in Upstash Redis (`nothing_app:utxo:tip`). Each comment transaction spends the tip and the change output becomes the new tip. A Redis distributed mutex (`nothing_app:utxo:mutex`, SET NX PX 15000) serialises concurrent access across Vercel serverless isolates — no Postgres needed.
- **Optimistic tip update**: The tip is set to the expected change output BEFORE broadcast. On broadcast failure, the tip is rolled back. This prevents stale tips if the function crashes after a successful broadcast.
- **Chain recovery**: If the Redis tip is missing (first boot, flush, stuck state), `recoverTipFromChain()` queries WhatsOnChain for the funding address's UTXOs and picks the largest one.
- **Redis-backed rate limiting**: All rate limits (per-IP, global, daily spend cap, circuit breaker) are stored in Upstash Redis via `@upstash/ratelimit`, persisting across Vercel cold starts. In-memory fallback exists for local dev only.
- **Feed from chain**: Comments are read by fetching the funding address tx history from WhatsOnChain, then parsing each OP_RETURN. First-page results are cached in Redis for `FEED_CACHE_TTL_SECONDS` (30 s).
- **Fail-closed moderation**: If OpenAI is unreachable, reject the post. In production, missing API key = hard error (keyword fallback does NOT run). Inner `runOpenAIModeration()` also throws on missing key (defense in depth).
- **OP_RETURN format**: `OP_FALSE OP_RETURN | BSVibes | 1.0 | comment | text | name | timestamp [| parentTxid]`
- **Fee calculation**: `ceil(bytes * FEE_PER_KB / 1000)`, FEE_PER_KB=500, minimum 5 sat
- **Circuit breaker**: 10 consecutive broadcast failures trips the breaker for 5 min. State in Redis (`nothing_app:cb:*`).
- **Daily spend cap**: 50,000 sats/day (configurable). Redis key `nothing_app:spend:daily:YYYY-MM-DD` with 25h auto-expiry. Returns 503 when hit.
- **Domain**: bsvibes.com

## Active Files (MVP)
- `src/services/wallet.service.ts` — BSV key management, transaction building (cached key)
- `src/services/comment-write.service.ts` — full comment submission pipeline (tip-chain model)
- `src/services/comment-read.service.ts` — comment fetching from WhatsOnChain with Redis cache
- `src/services/utxo-pool.service.ts` — thin facade over Redis tip (for health route compatibility)
- `src/services/broadcast.service.ts` — ARC broadcast with dual-endpoint fallback
- `src/services/moderation.service.ts` — content screening (NCMEC stubbed as no-op)
- `src/lib/redis.ts` — shared Upstash Redis client (singleton per invocation)
- `src/lib/utxo-tip.ts` — Redis tip CRUD + distributed mutex + chain recovery
- `src/lib/woc.ts` — WhatsOnChain API client (address history, UTXO list, raw tx hex)
- `src/lib/blocklist.ts` — Redis-backed txid blocklist (soft-delete)
- `src/lib/constants.ts` — all magic numbers and env var defaults
- `src/lib/rate-limiter.ts` — Redis-backed per-IP + global rate limiting, circuit breaker, spend cap
- `src/lib/ip.ts` — shared IP extraction (x-real-ip first) + HMAC hashing
- `src/lib/errors.ts` — typed error classes, safe error messages
- `src/lib/validators.ts` — Zod schemas for POST/GET (cursor: offset-based)
- `src/lib/op-return.ts` — OP_RETURN script builder + parser
- `src/lib/auth.ts` — timing-safe auth for cron routes
- `src/lib/startup-checks.ts` — production env var validation
- `src/app/api/comments/route.ts` — main POST/GET endpoint
- `src/app/api/health/route.ts` — public health endpoint

## Standby Features (in `standby/`)
See `standby/MANIFEST.md` for full reconstruction guide. Includes:
- Admin routes (blocklist, reconcile, PII erasure, admin health)
- Report endpoint + report modal
- NCMEC CyberTipline service
- UTXO replenish service + cron
- JungleBus reconciliation service + cron
- PII purge cron
- Theme toggle component

## Rules
- **On-chain only**: No mock or simulated blockchain data in product paths; use real on-chain reads, broadcasts, and indexer/API data only. Tests may isolate pure logic but must not fake chain truth for integration surfaces.
- Never skip moderation checks. Content on BSV is permanent.
- The Redis tip must always be funded. Seed the tip manually before deploy.
- Run tests before committing: `bun run test`
- Standby features live in `standby/` — do not delete, use `standby/MANIFEST.md` to re-integrate.

## Pre-Deploy Checklist
1. Fund wallet with BSV; send one UTXO to the funding address (becomes the initial tip)
2. Set env vars in Vercel: `BSV_FUNDING_KEY`, `OPENAI_API_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `RATE_LIMIT_SALT`, `CRON_SECRET`
3. (Optional) Seed the Redis tip via `recoverTipFromChain()` or let it auto-recover on first POST
4. Set up `abuse@` email forwarding
5. Point uptime monitor at `/api/health`
