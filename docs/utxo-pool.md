# UTXO Pool Management

This guide explains what UTXOs are, how the pool works, how to tune it, and how to diagnose problems.

---

## What Is a UTXO?

A UTXO (Unspent Transaction Output) is Bitcoin/BSV's unit of spendable funds. Think of each UTXO as a coin: it has a specific value and can only be spent once.

When the Nothing App posts a comment, it must spend a UTXO as the transaction input. Serverless functions present a challenge here: many requests arrive simultaneously, and each one needs its own UTXO. If two functions tried to spend the same UTXO at the same time, one transaction would be invalid.

The solution is a **pre-split pool**: the replenishment cron takes one large UTXO and splits it into many small ones before any comment traffic arrives. When a comment request comes in, it atomically checks out one UTXO from the pool, uses it, and marks it as spent.

---

## Pool Lifecycle

Each UTXO in the `utxo_pool` table moves through three states:

```
free → locked → spent
  ↑       |
  └───────┘  (stale lock recovery after 60 seconds)
```

| State | Meaning |
|-------|---------|
| `free` | Available for checkout |
| `locked` | Reserved by an in-flight request. Holds a `locked_at` timestamp and `locked_by` request ID. |
| `spent` | The UTXO was successfully used in a broadcast transaction. Terminal state. |

The checkout uses Postgres `FOR UPDATE SKIP LOCKED`. This means concurrent serverless functions never queue behind each other — each one grabs a different free row instantly.

---

## Pool Parameters

All parameters are set in `src/lib/constants.ts` and can be overridden via environment variables:

| Parameter | Env var | Default | Description |
|-----------|---------|---------|-------------|
| Replenish threshold | `UTXO_REPLENISH_THRESHOLD` | `5` | The cron replenishes the pool when free UTXOs drop below this. |
| Split target | `UTXO_SPLIT_TARGET` | `20` | The number of UTXOs to create during replenishment. |
| Lock timeout | — | `60 seconds` | How long a UTXO can stay locked before it is considered stale and recovered. Hardcoded to be safely above Vercel's function timeout (30s Pro). |
| Alert min free | `ALERT_UTXO_MIN_FREE` | `3` | Alert fires when free count drops below this. |
| Alert min sats | `ALERT_WALLET_MIN_SATS` | `10000` | Alert fires when wallet balance drops below this many satoshis. |

---

## How Replenishment Works

The replenishment cron (`GET /api/cron/replenish`) runs every 5 minutes via Vercel Cron.

**Step by step:**

1. Count free UTXOs in the pool
2. If count >= `UTXO_REPLENISH_THRESHOLD` (5), skip — pool is healthy
3. Fetch the funding wallet's UTXOs from WhatsOnChain
4. Pick the largest UTXO as the input
5. Estimate fees: `150 + (UTXO_SPLIT_TARGET × 34)` bytes ≈ 830 bytes for 20 outputs = ~9 satoshis fee
6. Calculate per-output amount: `floor((input_sats - fee) / UTXO_SPLIT_TARGET)`
7. Reject if per-output amount < 546 satoshis (dust limit)
8. Build, sign, and broadcast the split transaction
9. Insert each new output into `utxo_pool` as `free`

The cron only uses **one UTXO as input** per run (the largest one), regardless of how many UTXOs are in the wallet. This keeps the transaction simple and predictable.

---

## Adjusting for Traffic

### Low traffic / dev environment

Defaults are fine. `UTXO_SPLIT_TARGET = 20` handles bursts comfortably.

### Sustained high traffic

If you expect more than 20 concurrent comment submissions at any moment, raise the split target:

```
UTXO_SPLIT_TARGET=50
UTXO_REPLENISH_THRESHOLD=10
```

This means each replenishment run creates 50 UTXOs, and replenishment triggers earlier (when 10 are left instead of 5).

**Practical ceiling:** The split transaction has one input and `UTXO_SPLIT_TARGET` outputs. BSV has no meaningful limit here, but keep split targets below 1,000 to keep transaction sizes reasonable.

### Estimating the right pool size

A good rule of thumb: `UTXO_SPLIT_TARGET` should be at least 2× your expected concurrent requests per 5-minute window. The replenishment cron runs every 5 minutes, so you need the pool to last at least that long under peak load.

For 100 comments per minute peak: 100 × 5 = 500 comments between replenishments. Set `UTXO_SPLIT_TARGET = 600` with some headroom.

---

## Troubleshooting

### Pool Exhaustion (`503 NO_UTXOS`)

Users see errors. New comments cannot be posted.

**Diagnose:**

```bash
curl https://your-app.vercel.app/api/health | jq '.pool, .wallet'
```

Look for `pool.free == 0` and check `wallet.totalBalance`.

**Causes and fixes:**

| Cause | Fix |
|-------|-----|
| Wallet is empty | Top up. See [Wallet Top-Up Guide](wallet-topup.md). |
| Replenishment cron not running | Check Vercel Cron logs. Ensure `CRON_SECRET` is set. |
| WhatsOnChain unreachable | Temporary — the cron will retry in 5 minutes. |
| All UTXOs are stuck in `locked` state | Stale locks — see below. |

**Emergency manual replenishment:**

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://your-app.vercel.app/api/cron/replenish
```

### Stuck Locks

UTXOs can get stuck in `locked` if a serverless function times out or crashes after checkout but before marking the UTXO as `spent` or `free`.

The `clear-locks` cron runs every 2 minutes and automatically releases locks older than 60 seconds. In most cases, this resolves itself.

If you see `pool.locked` is high and not decreasing:

```bash
# Manually trigger lock clearing
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://your-app.vercel.app/api/cron/clear-locks
```

You can also directly query the database to inspect stuck locks:

```sql
-- See all locked UTXOs and how long they have been locked
SELECT id, txid, vout, satoshis, locked_at, locked_by,
       NOW() - locked_at AS lock_age
FROM utxo_pool
WHERE status = 'locked'
ORDER BY locked_at ASC;

-- Force-release all locks older than 60 seconds
UPDATE utxo_pool
SET status = 'free', locked_at = NULL, locked_by = NULL
WHERE status = 'locked'
  AND locked_at < NOW() - INTERVAL '60 seconds';
```

### Reconciliation Issues

If the `comments` table is missing entries that exist on-chain, trigger a manual reconciliation:

```bash
curl -X POST https://your-app.vercel.app/api/admin/reconcile \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"fromBlock": 880000, "dryRun": true}'
```

Run with `dryRun: true` first to see what would be backfilled. Then run without it.

`JUNGLEBUS_SUBSCRIPTION_ID` must be set for reconciliation to work. If it is not set, the reconcile cron silently skips. See [Architecture](architecture.md) for setup instructions.

### Checking the Pool Directly

Use Drizzle Studio to browse the pool live:

```bash
npm run db:studio
```

Or run SQL via Supabase's dashboard:

```sql
-- Current pool summary
SELECT
  status,
  COUNT(*) as count,
  SUM(satoshis) as total_sats
FROM utxo_pool
GROUP BY status;

-- Last 10 spent UTXOs (to verify recent activity)
SELECT txid, vout, satoshis, created_at
FROM utxo_pool
WHERE status = 'spent'
ORDER BY created_at DESC
LIMIT 10;
```

---

## Pool Health Reference

| `pool.free` | `status` | Action needed |
|-------------|----------|---------------|
| ≥ `UTXO_SPLIT_TARGET` | `ok` | None |
| ≥ `ALERT_UTXO_MIN_FREE` (3) | `ok` | Monitor — replenishment will run soon |
| < `ALERT_UTXO_MIN_FREE` (3) | `degraded` | Alert fires. Replenishment in progress. |
| `0` | `critical` | Comments failing. Top up immediately. |
