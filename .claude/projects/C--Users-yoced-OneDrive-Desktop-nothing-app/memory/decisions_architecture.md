---
name: Architecture Decisions
description: Key technical and business decisions for the Nothing App — UTXO pool, moderation, OP_RETURN format, domain, rate limiting, spend caps
type: project
---

## UTXO Pool (decided pre-launch)
- Pattern: `FOR UPDATE SKIP LOCKED` for concurrent serverless access
- Must use Supabase Transaction Pooler (port 6543), NOT Session Pooler
- Replenish threshold: 5 free UTXOs triggers replenishment
- Split target: 100 UTXOs (configurable via `UTXO_SPLIT_TARGET`)
- Stale lock recovery: 60s timeout (safely above Vercel's 30s function limit)
- **Why:** Serverless functions can't share connections; skip-locked prevents double-spend of the same UTXO

## Moderation (decided pre-launch)
- Fail-closed: reject if OpenAI API unreachable in production
- In production, missing `OPENAI_API_KEY` = hard error, keyword fallback does NOT run
- In development, missing key = keyword fallback runs (convenience)
- CSAM detection triggers NCMEC CyberTipline pipeline synchronously before rejection
- Keyword filter is fallback only in dev, not a substitute for API moderation
- **Why:** On-chain content is permanent — false negatives are irreversible

## Domain (decided 2026-03-15)
- bsvibes.com chosen (7-1 team vote)
- "Vibes" plural fits crypto culture, scales to platform, better typographic rhythm
- Dissent: bsvibe.com is 1 char shorter for mobile recall (narrow concern)
- **Why:** See docs/bsvibes-domain-decision.md for full rationale

## OP_RETURN Format
- `OP_FALSE OP_RETURN | NothingApp | 1.0 | comment | text | name | timestamp [| parentTxid]`
- Fee: `ceil(bytes * 1000 / 1000)`, minimum 5 sat
- **Why:** Standard OP_RETURN pattern, prefix enables indexing by app

## Rate Limiting
- Per-IP: 5 requests / 60s window (sliding window via Upstash)
- Per-IP daily: 100 comments/day
- Global: 500 comments/hour across all IPs
- IP addresses hashed with salt before storage in Redis (never raw)
- **Why:** Prevents single-actor and coordinated distributed spam; salt protects IPs if Redis is compromised

## Spend Protection
- Daily spend cap: 50,000 sats (configurable). Returns 503 when hit.
- Circuit breaker: 10 consecutive broadcast failures trips for 5 min
- **Why:** Prevents fee waste during ARC outages and caps exposure from spam

## Blocklist Design
- Soft-delete only: comments hidden from feed, direct lookup returns 410 Gone
- Blockchain data unaffected (permanent by design)
- Reasons enum: dmca, csam, court_order, hate_speech, violence, spam, other
- Adding csam reason auto-triggers NCMEC pipeline
- **Why:** Audit trail preserved; blockchain can't be modified anyway

## Privacy / Data Retention
- Hashed IP stored for abuse prevention, promised 7-day auto-delete
- PRIV-001: purge-pii cron is currently a no-op — LAUNCH BLOCKER
- No cookies, no analytics trackers, no advertising pixels
- **Why:** Minimal data footprint; GDPR/CCPA compliance requirement
