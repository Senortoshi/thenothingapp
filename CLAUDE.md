# Nothing App (BSVibes)

Anonymous comment platform where every post becomes a permanent OP_RETURN transaction on BSV mainnet. The app absorbs all fees — no wallet or account required.

## Stack
- **Framework**: Next.js 14.2 (App Router) on Vercel
- **Database**: Supabase Postgres via Drizzle ORM (port 6543, Transaction Pooler)
- **Cache/Rate Limiting**: Upstash Redis (sliding window, per-IP + global)
- **BSV**: @bsv/sdk — TAAL ARC + GorillaPool ARC for broadcast
- **Moderation**: OpenAI Moderation API (primary), keyword filter (fallback)
- **Testing**: Vitest
- **Language**: TypeScript, Tailwind CSS

## Commands
- `bun run dev` — local dev server
- `bun run build` — production build
- `bun run test` — run all tests (vitest)
- `bun run test:watch` — watch mode
- `bun run test:coverage` — coverage report
- `bun run db:generate` — generate Drizzle migrations
- `bun run db:migrate` — apply migrations

## Key Architecture Decisions
- **UTXO pool**: Pre-funded UTXOs, `FOR UPDATE SKIP LOCKED` for concurrent serverless access. Replenish threshold: 5, split target: 100. Stale lock recovery: 60s.
- **Fail-closed moderation**: If OpenAI is unreachable, reject the post. In production, missing API key = hard error (keyword fallback does NOT run).
- **OP_RETURN format**: `OP_FALSE OP_RETURN | NothingApp | 1.0 | comment | text | name | timestamp [| parentTxid]`
- **Fee calculation**: `ceil(bytes * FEE_PER_KB / 1000)`, minimum 5 sat
- **Blocklist**: Soft-delete only, preserves audit trail. Reasons: dmca, csam, court_order, hate_speech, violence, spam, other.
- **Circuit breaker**: 10 consecutive broadcast failures trips the breaker for 5 min.
- **Daily spend cap**: 50,000 sats/day (configurable). Returns 503 when hit.
- **Domain**: bsvibes.com (7-1 team vote, see docs/bsvibes-domain-decision.md)

## Important Files
- `src/services/wallet.service.ts` — BSV key management, transaction building
- `src/services/comment-write.service.ts` — full comment submission pipeline
- `src/services/comment-read.service.ts` — comment fetching
- `src/services/utxo-pool.service.ts` — UTXO lifecycle (checkout, release, replenish)
- `src/services/broadcast.service.ts` — ARC broadcast with fallback
- `src/services/moderation.service.ts` — content screening
- `src/services/ncmec.service.ts` — CSAM reporting to NCMEC CyberTipline
- `src/services/replenish.service.ts` — UTXO split/replenishment logic
- `src/lib/constants.ts` — all magic numbers and env var defaults
- `src/lib/rate-limiter.ts` — per-IP + global rate limiting
- `src/lib/errors.ts` — typed error classes
- `src/app/api/comments/route.ts` — main POST/GET endpoint
- `src/app/api/admin/blocklist/route.ts` — admin blocklist management
- `src/app/api/cron/replenish/route.ts` — UTXO replenishment cron
- `src/app/api/cron/purge-pii/route.ts` — GDPR data purge cron

## Key Documentation
- `docs/moderation-policy.md` — content policy, NCMEC requirements, CSAM pipeline
- `docs/pre-launch-safety-checklist.md` — legal/ops checklist with sign-off
- `docs/safety-audit-findings.md` — audit findings (PRIV-001, LEGAL-001, etc.)
- `docs/faq.md` — user-facing FAQ
- `docs/bsvibes-domain-decision.md` — domain name rationale

## Rules
- **On-chain only**: No mock or simulated blockchain data in product paths; use real on-chain reads, broadcasts, and indexer/API data only. Tests may isolate pure logic but must not fake chain truth for integration surfaces.
- Never skip moderation checks. Content on BSV is permanent.
- UTXO pool must always have free UTXOs. Monitor replenishment.
- All wallet/identity work follows the security roadmap in memory.
- Run tests before committing: `bun run test`
- The purge-pii cron is currently a no-op (PRIV-001). Must be fixed before launch.
- NCMEC ESP registration is a federal legal requirement before public launch.

## Launch Blockers
1. NCMEC ESP registration + credentials (LEGAL-001)
2. IP hash purge implementation or Privacy Policy correction (PRIV-001)
3. Contact emails (abuse@, dmca@, legal@, privacy@nothing.app) created and monitored
4. All items in docs/pre-launch-safety-checklist.md signed off
