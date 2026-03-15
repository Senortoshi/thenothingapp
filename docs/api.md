# API Reference

Base URL (local): `http://localhost:3000`

All request and response bodies are JSON. All timestamps are ISO 8601 UTC strings.

---

## Table of Contents

- [POST /api/comments](#post-apicomments)
- [GET /api/comments](#get-apicomments)
- [GET /api/comments/:txid](#get-apicommentstxid)
- [GET /api/health](#get-apihealth)
- [POST /api/admin/blocklist](#post-apiadminblocklist)
- [GET /api/admin/blocklist](#get-apiadminblocklist)
- [DELETE /api/admin/blocklist](#delete-apiadminblocklist)
- [POST /api/admin/reconcile](#post-apiadminreconcile)
- [GET /api/cron/replenish](#get-apicronreplenish)
- [GET /api/cron/clear-locks](#get-apicronclear-locks)
- [GET /api/cron/reconcile](#get-apicronreconcile)
- [Error Codes](#error-codes)

---

## POST /api/comments

Creates a new comment. The server moderates the text, checks out a UTXO, builds and signs a BSV transaction with an `OP_RETURN` output, broadcasts it to TAAL ARC, and persists the result.

**Rate limited:** 5 requests per IP per minute, 50 per hour (sliding window via Upstash Redis).

### Request

```
POST /api/comments
Content-Type: application/json
```

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `commentText` | string | Yes | 1–512 characters (trimmed) |
| `displayName` | string | No | Max 64 characters. Defaults to `"Anonymous"` |
| `parentTxid` | string | No | 64-character hex txid of the parent comment. Omit for top-level comments. |

```json
{
  "commentText": "This is permanent.",
  "displayName": "Alice",
  "parentTxid": "a1b2c3d4..."
}
```

### Response — 201 Created

```json
{
  "txid": "7f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a",
  "displayName": "Alice",
  "commentText": "This is permanent.",
  "parentTxid": "a1b2c3d4...",
  "createdAt": "2026-03-15T10:00:00.000Z"
}
```

Rate limit headers are included on every response when Upstash is configured:

```
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 4
X-RateLimit-Reset: 1710500460000
```

### Error Responses

| Status | Code | Cause |
|--------|------|-------|
| 400 | — | Invalid JSON body |
| 422 | — | Validation failed (field-level errors in `details`) |
| 429 | — | Rate limit exceeded. `window` field indicates which window (`"minute"` or `"hour"`). Includes `Retry-After` header. |
| 400 | `CONTENT_VIOLATION:*` | Comment rejected by moderation. `code` includes the violation category. |
| 503 | `MODERATION_UNAVAILABLE` | OpenAI API is configured but unreachable. Try again later. |
| 503 | `NO_UTXOS` | UTXO pool is empty. The replenishment cron will recover the pool within 5 minutes. |
| 502 | `BROADCAST_FAILED` | ARC rejected the transaction. |
| 500 | — | Internal server error. |

```bash
curl -X POST http://localhost:3000/api/comments \
  -H "Content-Type: application/json" \
  -d '{"commentText": "hello world", "displayName": "Dev"}'
```

---

## GET /api/comments

Returns a paginated list of comments, newest first. Blocklisted txids are excluded from the results.

Cached with `Cache-Control: public, s-maxage=5, stale-while-revalidate=30`.

### Request

```
GET /api/comments?pageSize=20
```

| Query param | Type | Required | Description |
|-------------|------|----------|-------------|
| `pageSize` | integer | No | Results per page. 1–50. Default: `20`. |
| `cursorCreatedAt` | ISO 8601 string | No | Timestamp cursor from previous page's `nextCursor`. |
| `cursorId` | integer | No | ID cursor from previous page's `nextCursor`. Both cursor params must be provided together. |

### Response — 200 OK

```json
{
  "comments": [
    {
      "id": 42,
      "txid": "7f3a9b2c...",
      "displayName": "Alice",
      "commentText": "This is permanent.",
      "parentTxid": null,
      "createdAt": "2026-03-15T10:00:00.000Z"
    }
  ],
  "nextCursor": {
    "createdAt": "2026-03-15T10:00:00.000Z",
    "id": 42
  }
}
```

`nextCursor` is `null` when you have reached the last page.

### Pagination Example

```bash
# First page
curl "http://localhost:3000/api/comments?pageSize=20"

# Next page — pass both cursor values from the previous response
curl "http://localhost:3000/api/comments?pageSize=20&cursorCreatedAt=2026-03-15T10:00:00.000Z&cursorId=42"
```

---

## GET /api/comments/:txid

Fetch a single comment by its BSV transaction ID.

### Request

```
GET /api/comments/7f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a
```

The `:txid` parameter must be a 64-character lowercase hex string.

### Response — 200 OK

```json
{
  "id": 42,
  "txid": "7f3a9b2c...",
  "displayName": "Alice",
  "commentText": "This is permanent.",
  "parentTxid": null,
  "createdAt": "2026-03-15T10:00:00.000Z"
}
```

### Error Responses

| Status | Cause |
|--------|-------|
| 400 | `txid` is not a valid 64-character hex string. |
| 404 | Comment not found in the database. |
| 410 | Comment exists on-chain but has been delisted. The transaction is still visible on the BSV blockchain. |

```bash
curl http://localhost:3000/api/comments/7f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a
```

---

## GET /api/health

Returns pool and wallet status. Also opportunistically recovers any stale UTXO locks.

Safe to poll from external uptime monitors. Does not expose private key material.

### Response — 200 OK

```json
{
  "status": "ok",
  "wallet": {
    "address": "1ExampleBsvAddress...",
    "freeUtxoCount": 18,
    "freeSats": 9180,
    "totalBalance": 9180,
    "isReplenishing": false,
    "lastReplenishedAt": "2026-03-15T09:55:00.000Z"
  },
  "pool": {
    "free": 18,
    "locked": 0,
    "spent": 247,
    "freeSats": 9180
  },
  "staleLockRecoveries": 0,
  "thresholds": {
    "utxoMinFree": 3,
    "walletMinSats": 10000
  },
  "timestamp": "2026-03-15T10:00:00.000Z"
}
```

`status` values:

| Value | Meaning |
|-------|---------|
| `"ok"` | Pool and wallet are healthy. |
| `"degraded"` | At least one alert threshold has been crossed but the pool is not empty. Comments still work. |
| `"critical"` | Pool has zero free UTXOs. Comment submissions will fail until replenishment completes. |

When alert thresholds are crossed, an `alerts` array is included with human-readable messages, and a webhook is fired to `ALERT_WEBHOOK_URL` if configured.

```bash
curl http://localhost:3000/api/health | jq .status
```

---

## Admin Routes

All admin routes require:

```
Authorization: Bearer <ADMIN_API_KEY>
```

Returns `401 Unauthorized` if the key is missing or wrong. Returns `503 Service Unavailable` if `ADMIN_API_KEY` is not configured in the environment.

---

## POST /api/admin/blocklist

Adds a txid to the blocklist. Once blocklisted:
- The comment disappears from `GET /api/comments`
- `GET /api/comments/:txid` returns `410 Gone`
- The transaction remains permanently on the BSV blockchain

If the txid was previously blocklisted and then deactivated, it is reactivated.

If `reason` is `"csam"`, the NCMEC reporting pipeline is triggered automatically.

### Request

```json
{
  "txid": "7f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a",
  "reason": "dmca",
  "notes": "DMCA takedown ref #12345",
  "addedBy": "admin"
}
```

| Field | Type | Required | Values |
|-------|------|----------|--------|
| `txid` | string | Yes | 64-character hex |
| `reason` | string | Yes | `dmca`, `csam`, `court_order`, `hate_speech`, `violence`, `spam`, `other` |
| `notes` | string | No | Max 1000 characters. Case number, URL, etc. |
| `addedBy` | string | No | Who added the entry. Defaults to `"admin"`. |

### Response — 201 Created

```json
{ "txid": "7f3a9b2c...", "action": "blocklisted" }
```

Returns `200` with `"action": "reactivated"` if the entry already existed but was inactive.

Returns `409 Conflict` if the txid is already actively blocklisted.

```bash
curl -X POST http://localhost:3000/api/admin/blocklist \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"txid":"7f3a...","reason":"spam","notes":"repeat spammer"}'
```

---

## GET /api/admin/blocklist

Lists blocklist entries, newest first.

### Request

```
GET /api/admin/blocklist?limit=50&includeInactive=false
```

| Query param | Default | Description |
|-------------|---------|-------------|
| `limit` | `50` | Max entries to return (ceiling: 200). |
| `includeInactive` | `false` | Set to `true` to include soft-deleted entries. |

### Response — 200 OK

```json
{
  "entries": [
    {
      "id": 1,
      "txid": "7f3a9b2c...",
      "reason": "dmca",
      "notes": "DMCA ref #12345",
      "added_by": "admin",
      "is_active": true,
      "created_at": "2026-03-15T10:00:00.000Z",
      "updated_at": "2026-03-15T10:00:00.000Z"
    }
  ],
  "count": 1
}
```

```bash
curl http://localhost:3000/api/admin/blocklist \
  -H "Authorization: Bearer $ADMIN_API_KEY"
```

---

## DELETE /api/admin/blocklist

Soft-deactivates a blocklist entry. The row is kept for audit purposes (`is_active` is set to `false`). The comment reappears in the feed and is no longer 410.

### Request

```json
{
  "txid": "7f3a9b2c...",
  "notes": "Takedown request withdrawn"
}
```

### Response — 200 OK

```json
{ "txid": "7f3a9b2c...", "action": "delisted" }
```

Returns `404` if no active blocklist entry exists for that txid.

```bash
curl -X DELETE http://localhost:3000/api/admin/blocklist \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"txid":"7f3a...","notes":"Takedown withdrawn"}'
```

---

## POST /api/admin/reconcile

Triggers a manual JungleBus reconciliation for a block range. Cross-references on-chain transactions against the local `comments` table and backfills any missing rows.

Requires `JUNGLEBUS_SUBSCRIPTION_ID` to be set. See [Architecture](architecture.md).

### Request

```json
{
  "fromBlock": 880000,
  "toBlock": 880100,
  "dryRun": false
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `fromBlock` | integer | Yes | Starting block height (inclusive). |
| `toBlock` | integer | No | Ending block height (inclusive). Omit to scan to the current chain tip. |
| `dryRun` | boolean | No | Default `false`. When `true`, counts what would be backfilled without writing to the DB. |

### Response — 200 OK

```json
{
  "report": {
    "blocksScanned": 100,
    "transactionsFound": 47,
    "backfilled": 2,
    "discrepancies": [],
    "errors": []
  }
}
```

```bash
curl -X POST http://localhost:3000/api/admin/reconcile \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"fromBlock": 880000, "dryRun": true}'
```

---

## Cron Routes

These routes are invoked by Vercel Cron on a schedule. They require:

```
Authorization: Bearer <CRON_SECRET>
```

In `NODE_ENV=development` with no `CRON_SECRET` set, requests are allowed without auth.

You can trigger them manually for testing:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/replenish
```

---

## GET /api/cron/replenish

**Schedule:** every 5 minutes

Checks the free UTXO count. If it drops below `UTXO_REPLENISH_THRESHOLD` (default: 5), fetches the funding wallet's UTXOs from WhatsOnChain, picks the largest one, and splits it into `UTXO_SPLIT_TARGET` (default: 20) equal outputs. Broadcasts the split transaction via ARC and inserts the new UTXOs into `utxo_pool`.

### Response — 200 OK (pool healthy, skipped)

```json
{
  "ok": true,
  "action": "skipped",
  "reason": "Pool healthy: 18 free UTXOs (threshold: 5)",
  "pool": { "freeCount": 18, "lockedCount": 0, "spentCount": 247, "freeSats": 9180 }
}
```

### Response — 200 OK (replenished)

```json
{
  "ok": true,
  "action": "replenished",
  "splitTxid": "abc123...",
  "outputCount": 20
}
```

### Response — 200 OK (skipped due to insufficient balance)

```json
{
  "ok": false,
  "action": "skipped",
  "reason": "Insufficient balance: 100 sats cannot fund 20 outputs (need 10920 sats minimum)"
}
```

---

## GET /api/cron/clear-locks

**Schedule:** every 2 minutes

Releases UTXO locks that are older than 60 seconds back to `free` status. Recovers UTXOs from serverless invocations that crashed or timed out.

### Response — 200 OK

```json
{
  "ok": true,
  "recovered": 0,
  "timestamp": "2026-03-15T10:00:00.000Z"
}
```

`recovered` is the number of stale locks that were released.

---

## GET /api/cron/reconcile

**Schedule:** every 15 minutes

Scans the last 100 BSV blocks via JungleBus, parses any `NothingApp` `OP_RETURN` transactions, and backfills any missing rows in the `comments` table. Fires an alert if discrepancies are found.

No-op if `JUNGLEBUS_SUBSCRIPTION_ID` is not set.

### Response — 200 OK

```json
{
  "ok": true,
  "fromBlock": 880000,
  "toBlock": 880100,
  "blocksScanned": 100,
  "transactionsFound": 12,
  "backfilled": 0,
  "discrepancies": 0,
  "errors": 0
}
```

---

## Error Codes

Service errors from `POST /api/comments` include a `code` field:

| Code | HTTP | Meaning |
|------|------|---------|
| `CONTENT_VIOLATION:<category>` | 400 | Comment blocked by moderation. Category is one of: `csam`, `hate_speech`, `violence`, `harassment`, `sexual_content`, etc. |
| `MODERATION_UNAVAILABLE` | 503 | OpenAI API is configured but unreachable. |
| `MODERATION_ERROR` | 503 | Unexpected error in the moderation pipeline. |
| `NO_UTXOS` | 503 | UTXO pool is empty. Retry after ~5 minutes. |
| `BROADCAST_FAILED` | 502 | TAAL ARC rejected the transaction. |
