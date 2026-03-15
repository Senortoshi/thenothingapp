# IRI-4: UTXO Locking Concurrency Test Plan

**Status**: Infrastructure-dependent. Requires a real Postgres instance.
**Framework**: Run with `psql` + a Node.js concurrency harness or `pgbench`.

---

## Why These Cannot Run in the Unit Suite

`checkoutUtxo` in `src/services/utxo-pool.service.ts` uses:

```sql
SELECT id FROM utxo_pool
WHERE status = 'free'
ORDER BY satoshis ASC
LIMIT 1
FOR UPDATE SKIP LOCKED
```

`FOR UPDATE SKIP LOCKED` is a Postgres-specific locking mechanism. It only
provides isolation guarantees inside a real Postgres transaction. Mocking `db`
would test nothing real here — the correctness claim is precisely that Postgres
serialises concurrent checkouts.

---

## Setup

```sql
-- Create a test schema with 10 UTXOs
INSERT INTO utxo_pool (txid, vout, satoshis, script_hex, status)
SELECT
  md5(generate_series::text) || md5(generate_series::text), -- 64-char hex
  0,
  5000,
  '76a91400000000000000000000000000000000000000088ac',
  'free'
FROM generate_series(1, 10);
```

---

## Test TC-4-1: 10 Concurrent Requests Get Unique UTXOs

**Goal**: Verify `FOR UPDATE SKIP LOCKED` prevents two requests from locking
the same UTXO.

**Procedure**:

```typescript
// Run 10 concurrent checkoutUtxo calls
const results = await Promise.all(
  Array.from({ length: 10 }, (_, i) =>
    checkoutUtxo(`req-${i}`)
  )
);

// All 10 should succeed
const succeeded = results.filter(Boolean);
assert(succeeded.length === 10, "Expected 10 successful checkouts");

// All txids must be unique
const txids = succeeded.map((u) => u!.txid);
const uniqueTxids = new Set(txids);
assert(uniqueTxids.size === 10, "Expected 10 unique UTXO txids — double-spend detected if <10");
```

**Pass criterion**: All 10 `LockedUtxo` objects have distinct `txid` values.

**Fail criterion**: Any two results share a `txid` (double-spend).

---

## Test TC-4-2: 11th Request Gets null When Pool Has 10 UTXOs

**Goal**: Verify pool exhaustion returns `null` rather than reusing a locked UTXO.

**Procedure**:

```typescript
// First exhaust the pool
await Promise.all(
  Array.from({ length: 10 }, (_, i) => checkoutUtxo(`req-${i}`))
);

// 11th request
const result = await checkoutUtxo("req-overflow");
assert(result === null, "Expected null when pool is exhausted");
```

**Pass criterion**: `checkoutUtxo` returns `null`.

**Fail criterion**: Returns a UTXO (would mean a locked UTXO was double-issued).

---

## Test TC-4-3: Stale Lock Recovery

**Goal**: Verify `recoverStaleLocks` frees locks older than
`UTXO_LOCK_TIMEOUT_SECONDS` (60s by default).

**Procedure**:

```sql
-- Manually create a stale lock 2 minutes old
UPDATE utxo_pool
SET status = 'locked',
    locked_at = NOW() - INTERVAL '2 minutes',
    locked_by = 'stale-req-id'
WHERE id = 1;
```

```typescript
const recovered = await recoverStaleLocks();
assert(recovered === 1, "Expected 1 stale lock recovered");

// Verify it is free again
const utxo = await checkoutUtxo("new-req");
assert(utxo !== null, "Pool should have a free UTXO after recovery");
```

**Pass criterion**: `recoverStaleLocks()` returns `1` and the UTXO is
available again.

---

## Test TC-4-4: SKIP LOCKED Under True Concurrent DB Connections

**Goal**: Verify that SKIP LOCKED works across separate DB connections (simulates
two serverless function instances running simultaneously).

**Procedure** (using two separate Postgres connections):

```typescript
import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Connection A: start transaction and lock row 1
const clientA = await pool.connect();
await clientA.query("BEGIN");
const rowA = await clientA.query(`
  UPDATE utxo_pool SET status = 'locked'
  WHERE id = (
    SELECT id FROM utxo_pool WHERE status = 'free'
    ORDER BY satoshis ASC LIMIT 1 FOR UPDATE SKIP LOCKED
  ) RETURNING id
`);

// Connection B: should skip the row locked by A
const clientB = await pool.connect();
await clientB.query("BEGIN");
const rowB = await clientB.query(`
  UPDATE utxo_pool SET status = 'locked'
  WHERE id = (
    SELECT id FROM utxo_pool WHERE status = 'free'
    ORDER BY satoshis ASC LIMIT 1 FOR UPDATE SKIP LOCKED
  ) RETURNING id
`);

assert(rowA.rows[0].id !== rowB.rows[0].id, "Connections A and B must lock different rows");

await clientA.query("ROLLBACK");
await clientB.query("ROLLBACK");
```

**Pass criterion**: `rowA.rows[0].id !== rowB.rows[0].id`.

---

## Test TC-4-5: UTXO Release on Error Path

**Goal**: Verify that `releaseUtxo` correctly returns a UTXO to `free` status
so subsequent requests can use it.

**Procedure**:

```typescript
// Lock a UTXO, then release it
const utxo = await checkoutUtxo("req-to-fail");
assert(utxo !== null);

// Simulate broadcast failure — release the UTXO
await releaseUtxo(utxo.id);

// Verify it is free and re-acquirable
const reLocked = await checkoutUtxo("req-retry");
assert(reLocked !== null, "Released UTXO should be available again");
assert(reLocked.id === utxo.id, "Same UTXO should be re-acquired");
```

---

## Running Against a Local Postgres Instance

```bash
# Start a local Postgres (Docker)
docker run -d \
  --name nothing-app-test-db \
  -e POSTGRES_PASSWORD=testpass \
  -e POSTGRES_DB=nothing_app_test \
  -p 5432:5432 \
  postgres:16

# Apply the schema
DATABASE_URL=postgresql://postgres:testpass@localhost:5432/nothing_app_test \
  npx drizzle-kit migrate

# Seed the UTXO pool
psql postgresql://postgres:testpass@localhost:5432/nothing_app_test \
  -c "INSERT INTO utxo_pool (txid, vout, satoshis, script_hex, status)
      SELECT repeat(md5(i::text), 2), 0, 5000,
             '76a91400000000000000000000000000000000000000088ac', 'free'
      FROM generate_series(1,20) AS s(i);"

# Run the concurrency harness
DATABASE_URL=postgresql://postgres:testpass@localhost:5432/nothing_app_test \
  npx tsx src/services/__tests__/utxo-concurrency.harness.ts
```
