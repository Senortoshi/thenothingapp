# Standby Manifest

All files in this directory are on standby for the scoped-down BSV comment box launch.
None of these are compiled, tested, or deployed while on standby.

The active codebase is under `src/`. Vitest excludes `standby/**` via `vitest.config.ts`.

---

## Files on Standby

### Admin Routes

#### `src/app/api/admin/blocklist/route.ts`
**What it does**: GET/POST/DELETE endpoint for the `txid_blocklist` table. Admins use it
to add or remove on-chain txids from the display blocklist (DMCA, CSAM, court orders, etc.).

**Dependencies**
- npm: `drizzle-orm`, `zod`, `next`
- env vars: `ADMIN_API_KEY`
- DB tables: `txid_blocklist`
- imports: `@/lib/auth` (requireAdmin), `@/db`, `@/db/schema` (txidBlocklist), `@/services/ncmec.service`

**Re-integration steps**
1. Move file back to `src/app/api/admin/blocklist/route.ts`
2. Restore `ncmec.service.ts` to `src/services/ncmec.service.ts`
3. Restore the import in this file: `import { reportToNcmec } from "@/services/ncmec.service";`
4. Set `ADMIN_API_KEY` env var in Vercel
5. Ensure `txid_blocklist` table exists (it is in `schema.ts` already)

---

#### `src/app/api/admin/health/route.ts`
**What it does**: Admin-only diagnostic endpoint. Returns wallet address, UTXO pool stats,
balances, stale lock recovery count, alert thresholds, and overall status.

**Dependencies**
- npm: `next`
- env vars: `ADMIN_API_KEY`, `ALERT_UTXO_MIN_FREE`, `ALERT_WALLET_MIN_SATS`
- imports: `@/services/utxo-pool.service`, `@/services/wallet.service`, `@/lib/alerts`, `@/lib/auth`, `@/lib/errors`

**Re-integration steps**
1. Move file back to `src/app/api/admin/health/route.ts`
2. Set `ADMIN_API_KEY` env var

---

#### `src/app/api/admin/reconcile/route.ts`
**What it does**: Admin-triggered JungleBus reconciliation for a given block range.
Calls `reconcile()` or `backfillFromBlock()` from `junglebus.service.ts`.

**Dependencies**
- npm: `zod`, `next`
- env vars: `ADMIN_API_KEY`, `JUNGLEBUS_SUBSCRIPTION_ID`, `JUNGLEBUS_URL`, `JUNGLEBUS_API_KEY`
- imports: `@/services/junglebus.service`, `@/lib/auth`, `@/lib/errors`

**Re-integration steps**
1. Move `junglebus.service.ts` back to `src/services/junglebus.service.ts`
2. Move this file back to `src/app/api/admin/reconcile/route.ts`
3. Set required env vars

---

#### `src/app/api/admin/comments/[txid]/pii/route.ts`
**What it does**: GDPR Right-to-Erasure endpoint. Sets `display_name` to "Deleted" for
a given comment txid (soft erasure of PII without destroying the on-chain mirror).

**Dependencies**
- npm: `drizzle-orm`, `next`
- env vars: `ADMIN_API_KEY`
- DB tables: `comments`
- imports: `@/db`, `@/db/schema` (comments), `@/lib/auth`

**Re-integration steps**
1. Re-create directory `src/app/api/admin/comments/[txid]/pii/`
2. Move file back to `src/app/api/admin/comments/[txid]/pii/route.ts`
3. Set `ADMIN_API_KEY` env var

---

### Cron Routes

#### `src/app/api/cron/replenish/route.ts`
**What it does**: Thin HTTP wrapper around `runReplenishment()`. Triggered every 5 minutes
by Vercel Cron. Checks pool health and splits UTXOs from the funding wallet when low.

**Dependencies**
- env vars: `CRON_SECRET`, `BSV_FUNDING_KEY`, `UPSTASH_REDIS_REST_URL`
- imports: `@/lib/auth` (verifyCronSecret), `@/lib/errors`, `@/services/replenish.service`

**Re-integration steps**
1. Move `replenish.service.ts` back to `src/services/replenish.service.ts`
2. Move this file back to `src/app/api/cron/replenish/route.ts`
3. Add cron entry to `vercel.json`:
   ```json
   { "path": "/api/cron/replenish", "schedule": "*/5 * * * *" }
   ```
4. Add function config to `vercel.json`:
   ```json
   "src/app/api/cron/replenish/route.ts": { "maxDuration": 30 }
   ```
5. Move test back from `standby/src/services/__tests__/replenish.service.test.ts`
   to `src/services/__tests__/replenish.service.test.ts`
6. Remove `standby/**` from vitest `exclude` (or leave it — the test will run from `src/`)

---

#### `src/app/api/cron/reconcile/route.ts`
**What it does**: JungleBus reconciliation cron. Runs every 15 minutes. Fetches the last
~100 blocks from JungleBus and backfills any missing comments.

**Dependencies**
- env vars: `CRON_SECRET`, `JUNGLEBUS_SUBSCRIPTION_ID`, `JUNGLEBUS_URL`, `JUNGLEBUS_API_KEY`
- imports: `@/services/junglebus.service`, `@/lib/alerts`, `@/lib/auth`, `@/lib/errors`

**Re-integration steps**
1. Move `junglebus.service.ts` back to `src/services/junglebus.service.ts`
2. Move this file back to `src/app/api/cron/reconcile/route.ts`
3. Add cron entry to `vercel.json`:
   ```json
   { "path": "/api/cron/reconcile", "schedule": "*/15 * * * *" }
   ```
4. Register a JungleBus subscription by calling `createSubscription()` once, then set
   `JUNGLEBUS_SUBSCRIPTION_ID` in Vercel env vars

---

#### `src/app/api/cron/purge-pii/route.ts`
**What it does**: Daily scaffolding cron for future PII table purges. Currently a no-op
(Redis keys have their own TTLs; no off-chain PII tables exist yet). Kept so adding a
future PII table requires only adding the DELETE statement, not new infrastructure.

**Note**: PRIV-001 in the safety audit requires this to either be implemented or the
Privacy Policy updated before public launch.

**Dependencies**
- env vars: `CRON_SECRET`, `GDPR_DATA_RETENTION_DAYS` (default 90)
- imports: `@/lib/auth`, `@/lib/constants`, `@/lib/errors`

**Re-integration steps**
1. Move file back to `src/app/api/cron/purge-pii/route.ts`
2. Add cron entry to `vercel.json`:
   ```json
   { "path": "/api/cron/purge-pii", "schedule": "0 0 * * *" }
   ```
3. Implement actual PII purge logic (PRIV-001) before launch

---

### Report Feature

#### `src/app/api/report/route.ts`
**What it does**: POST endpoint for user content reports. Rate-limited (5/hour/IP via
Upstash). Stores reports in the `content_reports` table.

**Dependencies**
- npm: `@upstash/ratelimit`, `@upstash/redis`, `zod`, `next`
- env vars: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- DB tables: `content_reports`
- imports: `@/lib/ip`, `@/db`, `@/db/schema` (contentReports)

**Re-integration steps**
1. Move file back to `src/app/api/report/route.ts`
2. Move `report-modal.tsx` back to `src/components/report-modal.tsx`
3. Add the ReportModal to `comment-item.tsx` or wherever the report button should live
4. Ensure `content_reports` table exists (it is in `schema.ts` already)

---

#### `src/components/report-modal.tsx`
**What it does**: Client-side modal component for submitting content reports. Posts to
`/api/report`. Has focus trap, keyboard navigation (Escape to close), and scroll lock.

**Dependencies**
- npm: `react`
- No env vars
- Calls: `POST /api/report`

**Re-integration steps**
See `src/app/api/report/route.ts` re-integration steps above.

---

### Services

#### `src/services/ncmec.service.ts`
**What it does**: CSAM incident reporting pipeline. Logs incidents, fires admin webhook
alerts, and submits to the NCMEC CyberTipline API (with retry/backoff).

**CRITICAL LEGAL NOTE**: This is required by 18 U.S.C. § 2258A before public launch.
NCMEC ESP registration must be completed at:
https://www.missingkids.org/gethelpnow/cybertipline

**Dependencies**
- npm: none (uses `fetch`, `crypto.subtle`)
- env vars: `NCMEC_ESP_ID`, `NCMEC_API_TOKEN`, `NCMEC_API_URL` (optional override),
  `ADMIN_ALERT_WEBHOOK_URL` (optional)

**Re-integration steps**
1. Move file back to `src/services/ncmec.service.ts`
2. In `src/services/moderation.service.ts`, replace the inline no-op stub:
   ```typescript
   // STANDBY: NCMEC reporting — re-enable when ESP registration is complete
   async function reportToNcmec(_incident: unknown): Promise<void> {
     console.warn("[moderation] NCMEC reporting is on standby. Incident logged only.");
   }
   ```
   with the real import:
   ```typescript
   import { reportToNcmec } from "./ncmec.service";
   ```
3. In `src/app/api/admin/blocklist/route.ts`, restore:
   ```typescript
   import { reportToNcmec } from "@/services/ncmec.service";
   ```
4. Set `NCMEC_ESP_ID` and `NCMEC_API_TOKEN` env vars in Vercel
5. Update the moderation test mock path if needed (currently mocks `@/services/ncmec.service`)

---

#### `src/services/replenish.service.ts`
**What it does**: UTXO pool replenishment logic. Fetches UTXOs from the funding wallet
via WhatsOnChain, builds and broadcasts a split transaction, and inserts new UTXOs into
the pool. Includes mutex locking via `wallet_state.is_replenishing`.

**Dependencies**
- npm: `@bsv/sdk`, `drizzle-orm`
- env vars: `BSV_FUNDING_KEY`, `DATABASE_URL`
- DB tables: `utxo_pool`, `wallet_state`
- imports: `@/services/utxo-pool.service`, `@/services/wallet.service`,
  `@/services/broadcast.service`, `@/lib/alerts`, `@/lib/constants`, `@/lib/errors`, `@/db`

**Re-integration steps**
1. Move file back to `src/services/replenish.service.ts`
2. Move `standby/src/services/__tests__/replenish.service.test.ts` back to
   `src/services/__tests__/replenish.service.test.ts`
3. Move the cron route back (see `cron/replenish` above)
4. Verify `wallet_state` table exists and has the `is_replenishing` column

---

#### `src/services/junglebus.service.ts`
**What it does**: JungleBus BSV indexer integration. Fetches blocks and transactions
matching the NothingApp OP_RETURN prefix. Used for on-chain reconciliation and backfill.

**Dependencies**
- npm: `drizzle-orm`
- env vars: `JUNGLEBUS_URL`, `JUNGLEBUS_API_KEY`, `JUNGLEBUS_SUBSCRIPTION_ID`
- DB tables: `comments`
- imports: `@/db`, `@/db/schema`, `@/lib/constants`, `@/lib/op-return`

**Re-integration steps**
1. Move file back to `src/services/junglebus.service.ts`
2. Move admin and cron routes back (see their sections above)
3. Register a JungleBus subscription via `createSubscription()` once, store result
   in `JUNGLEBUS_SUBSCRIPTION_ID` env var

---

### Tests

#### `src/services/__tests__/replenish.service.test.ts`
**What it does**: 26 unit tests covering `replenishPool` and `runReplenishment`.
Tests WhatsOnChain error handling, insufficient balance, lock acquisition/release,
happy path broadcast and pool insert.

**Re-integration steps**
Move back to `src/services/__tests__/replenish.service.test.ts` when `replenish.service.ts`
is restored. The vitest `exclude` in `vitest.config.ts` does not need updating — the file
will be picked up automatically from `src/`.

---

### Planning Docs

#### `docs/utxo-concurrency.plan.md`
**What it does**: Integration test plan (not runnable unit tests) for verifying
`FOR UPDATE SKIP LOCKED` behaviour under real Postgres concurrency. Requires a live
Postgres instance and a manual test harness.

**Re-integration steps**
Move back to `src/services/__tests__/utxo-concurrency.plan.md` when running
infrastructure-level concurrency validation.

---

### Dead Code (UI)

#### `src/components/theme-toggle.tsx`
**What it does**: Light/dark mode toggle button. Persists theme preference in
`localStorage`. Import in `layout.tsx` is already commented out pending full light-mode
CSS work.

**Re-integration steps**
1. Move back to `src/components/theme-toggle.tsx`
2. Uncomment in `src/app/layout.tsx`:
   ```typescript
   import { ThemeToggle } from "@/components/theme-toggle";
   ```
3. Render `<ThemeToggle />` in the header
4. Complete light-mode Tailwind CSS before enabling

---

### Dead Code (DB)

#### `src/db/queries.ts`
**What it does**: Raw Drizzle SQL query constants (CHECKOUT_UTXO, MARK_UTXO_SPENT,
RECOVER_STALE_LOCKS, FETCH_COMMENTS_PAGE, UTXO_POOL_STATS). These were superseded by the
ORM-based methods in `utxo-pool.service.ts` and `comment-read.service.ts`.

**Re-integration steps**
Move back to `src/db/queries.ts` only if reverting to raw SQL execution patterns.
No other active file imports from this module — it is safe to leave on standby.

---

## DB Schema Tables on Standby

These tables remain in `src/db/schema.ts` since schema definitions are free — no code
runs against them unless the feature routes are active.

| Table | Used by |
|-------|---------|
| `txid_blocklist` | `src/app/api/admin/blocklist/route.ts` |
| `content_reports` | `src/app/api/report/route.ts` |

Both tables are already in the Drizzle migration at `src/db/migrate.sql`. No migration
changes are needed when re-activating these features.

---

## Launch Blockers (from CLAUDE.md — unchanged)

These must be resolved before public launch regardless of standby status:

1. NCMEC ESP registration + credentials (`LEGAL-001`) — required before any public traffic
2. IP hash purge implementation or Privacy Policy correction (`PRIV-001`)
3. Contact emails (abuse@, dmca@, legal@, privacy@nothing.app) created and monitored
4. All items in `docs/pre-launch-safety-checklist.md` signed off
