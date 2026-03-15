# Architecture Overview

Nothing App is a Next.js application with a Postgres-backed UTXO pool. Every submitted comment becomes a permanent BSV mainnet transaction. The app absorbs all transaction fees.

---

## System Diagram

```
                        Browser / API client
                               |
                    POST /api/comments
                               |
                    ┌──────────▼──────────┐
                    │   Rate Limiter       │
                    │  (Upstash Redis)     │
                    │  5/min · 50/hr       │
                    └──────────┬──────────┘
                               |
                    ┌──────────▼──────────┐
                    │  Content Moderation  │
                    │  OpenAI API (primary)│
                    │  Keyword filter      │
                    │  (fallback)          │
                    └──────────┬──────────┘
                               |
                    ┌──────────▼──────────┐
                    │   UTXO Pool          │◄─── Vercel Cron: replenish (5 min)
                    │  (Postgres)          │◄─── Vercel Cron: clear-locks (2 min)
                    │  FOR UPDATE          │
                    │  SKIP LOCKED         │
                    └──────────┬──────────┘
                               |
                    ┌──────────▼──────────┐
                    │  Transaction Builder │
                    │  (@bsv/sdk)          │
                    │  P2PKH input         │
                    │  OP_RETURN output    │
                    │  Change output       │
                    └──────────┬──────────┘
                               |
                    ┌──────────▼──────────┐
                    │   TAAL ARC           │
                    │   (BSV mainnet)      │
                    └──────────┬──────────┘
                               |
                    ┌──────────▼──────────┐
                    │   Postgres           │
                    │  (Supabase)          │
                    │  comments table      │
                    └─────────────────────┘
                               |
            ┌──────────────────┘
            │   Vercel Cron: reconcile (15 min)
            ▼
    ┌─────────────────┐
    │   JungleBus     │
    │   (BSV indexer) │
    │  cross-check    │
    │  + backfill     │
    └─────────────────┘
```

---

## Comment Submission Data Flow

This is the sequence executed on every `POST /api/comments`:

### Step 0 — Rate Limiting

Two sliding windows are checked in parallel against the client IP:
- Per-minute: 5 requests / 60 seconds
- Per-hour: 50 requests / 3600 seconds

Both run via Upstash Redis. If Redis is unreachable, the check is skipped and the request proceeds (graceful degradation).

### Step 1 — Content Moderation

The comment text is submitted to the OpenAI Moderation API before any on-chain work begins. This is non-negotiable: content that reaches ARC cannot be recalled.

The system is **fail-closed**: if `OPENAI_API_KEY` is set and the API is unreachable, the comment is rejected with `503 MODERATION_UNAVAILABLE`. An API error never silently allows the post through.

If `OPENAI_API_KEY` is not set, a keyword filter runs as a fallback. The keyword filter is not a substitute for proper moderation.

If the OpenAI API flags `sexual/minors`, the NCMEC reporting pipeline is triggered immediately before the rejection is returned.

### Step 2 — UTXO Checkout

The app maintains a pool of pre-funded UTXOs in the `utxo_pool` table. Each comment consumes one UTXO.

The checkout uses `FOR UPDATE SKIP LOCKED` — a Postgres pattern that lets concurrent serverless invocations each grab a different row without blocking each other. If no free UTXOs exist, the request fails with `503 NO_UTXOS`.

The UTXO is immediately set to `locked` with a request ID and timestamp.

### Step 3 — Transaction Building

`wallet.service.ts` builds a standard BSV transaction:

```
Input:  Locked UTXO (P2PKH, signed with BSV_FUNDING_KEY)
Output 0: OP_RETURN comment data (0 satoshis, unspendable)
Output 1: Change back to funding address
```

**OP_RETURN format** (each field is a separate pushdata):

```
OP_FALSE OP_RETURN | NothingApp | 1.0 | comment | <text> | <displayName> | <ISO8601> [| <parentTxid>]
```

Fees: `ceil(bytes * 10 / 1000)` satoshis, minimum 5 satoshis. Approximately 300 bytes per transaction = ~3 satoshis fee, so the practical minimum is 5 satoshis.

### Step 4 — ARC Broadcast

The signed transaction hex is posted to TAAL ARC (`https://arc.taal.com/v1/tx`). ARC relays it to the BSV network and returns a `txid`.

If broadcast fails, the UTXO is released back to `free` so the next request can use it.

### Step 5 — Persist

The comment is written to the `comments` table with the canonical `txid` from ARC. Then the UTXO is marked `spent`.

If the database write fails after a successful broadcast, the error is logged but the API returns success — the comment exists on-chain and the reconciliation cron will backfill it.

---

## UTXO Pool Lifecycle

```
         ┌─────────┐
         │  free   │◄──── inserted by: cron/replenish
         └────┬────┘
              │ checkoutUtxo() — FOR UPDATE SKIP LOCKED
         ┌────▼────┐
         │ locked  │◄──── released by: cron/clear-locks (stale locks > 60s)
         └────┬────┘      also: releaseUtxo() on broadcast failure
              │ markUtxoSpent() — after successful broadcast
         ┌────▼────┐
         │ spent   │      terminal state
         └─────────┘
```

**Replenishment** runs every 5 minutes via `GET /api/cron/replenish`. When the free count drops below `UTXO_REPLENISH_THRESHOLD` (default: 5), the cron fetches the funding wallet's UTXOs from WhatsOnChain, picks the largest one, and splits it into `UTXO_SPLIT_TARGET` (default: 20) equal outputs in a single BSV transaction.

**Stale lock recovery** runs every 2 minutes via `GET /api/cron/clear-locks`. Any UTXO that has been `locked` for more than 60 seconds is reset to `free`. The 60-second window is intentionally longer than the maximum Vercel function timeout (30 seconds on Pro) so in-flight requests are never cancelled by the recovery cron.

---

## Security Architecture

### Rate Limiting

Two layers of rate limiting sit in front of comment creation:

1. **Per-minute window** — 5 requests per IP per 60 seconds (configurable via `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW`)
2. **Per-hour window** — 50 requests per IP per 3600 seconds (configurable via `RATE_LIMIT_HOURLY_MAX`)

IP is read from `X-Forwarded-For` (Vercel sets this). If Upstash Redis is unreachable, rate limiting is bypassed rather than blocking legitimate traffic.

### Content Moderation

The moderation check runs before UTXO checkout and before any BSV work. This is the only opportunity to screen content before it becomes permanent.

Priority order:
1. OpenAI Moderation API (fail-closed when configured)
2. Keyword filter (runs when no API key is set)

CSAM detection triggers the NCMEC reporting pipeline immediately and synchronously before the rejection is returned.

### Blocklist

The `txid_blocklist` table enables post-hoc delisting. Because BSV transactions are immutable, delisting only removes content from this app's UI — the transaction remains on-chain.

- `GET /api/comments` excludes blocklisted txids via a `NOT EXISTS` subquery
- `GET /api/comments/:txid` returns `410 Gone` for blocklisted txids

Blocklist entries use soft-delete (`is_active = false`) to preserve audit history. Entries are never hard-deleted.

### Admin Auth

Admin routes (`/api/admin/*`) check `Authorization: Bearer <ADMIN_API_KEY>`. The key is compared via strict equality. There is no token refresh or rotation mechanism built in — rotate the key via environment variable.

### Cron Auth

Cron routes (`/api/cron/*`) check `Authorization: Bearer <CRON_SECRET>`. Vercel sets this header automatically when invoking scheduled jobs. In development with no `CRON_SECRET` set, requests are allowed without auth.

---

## Database Schema

Four tables:

| Table | Purpose |
|-------|---------|
| `comments` | One row per posted comment. Cursor-paginated by `(created_at, id)`. |
| `utxo_pool` | Pre-funded UTXOs. Lifecycle: `free → locked → spent`. |
| `wallet_state` | Single-row table tracking the funding wallet balance and UTXO count. |
| `txid_blocklist` | Legal delisting. Soft-delete only. |

See `src/db/schema.ts` for column definitions and indexes, or `src/db/migrate.sql` for raw SQL.

---

## JungleBus Reconciliation

JungleBus is a BSV transaction indexer. The app subscribes to `OP_RETURN` transactions matching the `NothingApp` prefix, then periodically cross-references on-chain data against the local `comments` table.

**Setup (one-time):**

```bash
# Trigger subscription creation via the admin reconcile endpoint
curl -X POST http://localhost:3000/api/admin/reconcile \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"fromBlock": 880000, "dryRun": true}'
```

The `createSubscription()` function in `junglebus.service.ts` creates the subscription and returns an ID. Store it as `JUNGLEBUS_SUBSCRIPTION_ID`.

Once configured, `GET /api/cron/reconcile` runs every 15 minutes, scanning the last 100 blocks and backfilling any comments the app missed during downtime.

---

## External Dependencies

| Service | Usage | Required |
|---------|-------|----------|
| Supabase (Postgres) | All persistent data | Yes |
| Upstash Redis | Rate limiting | Recommended |
| TAAL ARC | Transaction broadcast | Yes |
| WhatsOnChain | UTXO fetch during replenishment | Yes |
| OpenAI API | Content moderation | Recommended |
| JungleBus | Reconciliation and backfill | Optional |
| Vercel Cron | Scheduled tasks | Production only |
| Slack / Discord webhook | Alerts | Optional |
