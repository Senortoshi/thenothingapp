# IRI-5 (Extended): Rate Limiting Integration Test Plan

**Status**: Infrastructure-dependent. Requires a real Upstash Redis instance.
**Framework**: HTTP-level tests against a running Next.js dev server.

---

## Why These Cannot Run in the Unit Suite

The Upstash `Ratelimit` class relies on Upstash Redis for its sliding-window
counter. The window enforcement is server-side inside Upstash. Mocking the
library in unit tests can verify the route's *response handling* (which the
route.test.ts already covers), but cannot verify that:

- The window resets correctly after the configured period
- The same IP is counted across multiple serverless invocations
- X-Forwarded-For is evaluated consistently per request

The tests below are designed to run against a live server pointing at a
real (or local emulated) Upstash Redis instance.

---

## Prerequisites

```bash
# .env.test.local — point at a real or emulated Upstash Redis
UPSTASH_REDIS_REST_URL=https://your-test-db.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-test-token
RATE_LIMIT_MAX=3
RATE_LIMIT_WINDOW=10       # 10-second window for fast test iteration
RATE_LIMIT_HOURLY_MAX=100
DATABASE_URL=...
BSV_FUNDING_KEY=...
```

---

## Test TC-5-1: Per-IP Limit Enforced

**Goal**: Verify that the 4th POST from the same IP within the window
returns 429.

**Procedure**:

```bash
BASE_URL=http://localhost:3000

# First 3 requests should succeed (201)
for i in 1 2 3; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$BASE_URL/api/comments" \
    -H "Content-Type: application/json" \
    -H "X-Forwarded-For: 1.2.3.4" \
    -d '{"commentText":"test comment '$i'"}')
  echo "Request $i: $STATUS"
  [ "$STATUS" = "201" ] || echo "FAIL: expected 201, got $STATUS"
done

# 4th request should be rate limited (429)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE_URL/api/comments" \
  -H "Content-Type: application/json" \
  -H "X-Forwarded-For: 1.2.3.4" \
  -d '{"commentText":"rate limited comment"}')
echo "Request 4: $STATUS"
[ "$STATUS" = "429" ] || echo "FAIL: expected 429, got $STATUS"
```

**Pass criterion**: Requests 1–3 return 201; request 4 returns 429.

---

## Test TC-5-2: Rate Limit Headers Present on 429

**Goal**: Verify the 429 response includes required headers.

**Procedure**:

```bash
# Exhaust the window first (see TC-5-1)

curl -s -i \
  -X POST "http://localhost:3000/api/comments" \
  -H "Content-Type: application/json" \
  -H "X-Forwarded-For: 1.2.3.4" \
  -d '{"commentText":"another one"}' | grep -iE "x-ratelimit|retry-after|HTTP/"
```

**Expected headers on 429 response**:
- `X-RateLimit-Limit: 3`
- `X-RateLimit-Remaining: 0`
- `X-RateLimit-Reset: <unix timestamp>`
- `Retry-After: <positive integer seconds>`

**Pass criterion**: All four headers are present with correct values.
`Retry-After` must be a positive integer.

---

## Test TC-5-3: Different IPs Have Independent Counters

**Goal**: Verify that requests from IP `2.2.2.2` are not affected by the
rate limit consumed by IP `1.2.3.4`.

**Procedure**:

```bash
# Exhaust IP 1.2.3.4 (see TC-5-1)

# IP 2.2.2.2 should still succeed
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "http://localhost:3000/api/comments" \
  -H "Content-Type: application/json" \
  -H "X-Forwarded-For: 2.2.2.2" \
  -d '{"commentText":"from different IP"}')
echo "Different IP: $STATUS"
[ "$STATUS" = "201" ] || echo "FAIL: expected 201, got $STATUS"
```

**Pass criterion**: Returns 201.

---

## Test TC-5-4: Cannot Bypass via X-Forwarded-For Spoofing With Multiple IPs

**Goal**: Verify that adding extra trusted IPs after the client IP in
X-Forwarded-For does not bypass rate limiting. The rate limiter uses only
the first value.

**Rationale**: An attacker might send `X-Forwarded-For: 127.0.0.1,
attacker-ip` hoping the server uses a different value. The route's
`getClientIp` always takes the first value (`127.0.0.1` in this case),
which means:

1. If the attacker sends their real IP first, they are correctly rate-limited.
2. If the attacker spoofs `127.0.0.1` as their IP, ALL requests claiming
   that IP share the same bucket — so the spoofed address itself gets rate
   limited.

A deployment that places Vercel's edge in front correctly overwrites
X-Forwarded-For with the verified client IP.

**Procedure**:

```bash
# 3 requests with spoofed first IP — fill the bucket for 10.0.0.1
for i in 1 2 3; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST "http://localhost:3000/api/comments" \
    -H "Content-Type: application/json" \
    -H "X-Forwarded-For: 10.0.0.1, real-attacker-99.1.2.3" \
    -d '{"commentText":"spoof attempt '$i'"}'
done

# 4th request with same spoofed first IP — should be blocked
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "http://localhost:3000/api/comments" \
  -H "Content-Type: application/json" \
  -H "X-Forwarded-For: 10.0.0.1, real-attacker-99.1.2.3" \
  -d '{"commentText":"spoof bypass"}')
[ "$STATUS" = "429" ] || echo "FAIL: spoofed IP should be rate-limited, got $STATUS"
```

**Pass criterion**: The 4th request from the same spoofed first IP returns 429.

**Security note**: True bypass prevention requires deploying behind a trusted
reverse proxy (e.g., Vercel Edge or Cloudflare) that rewrites
X-Forwarded-For. The application-level check is a best-effort defence.

---

## Test TC-5-5: Window Resets After the Configured Period

**Goal**: Verify requests succeed again after the rate limit window expires.

**Procedure**:

```bash
# Exhaust the window (see TC-5-1)

# Wait for the window to expire (RATE_LIMIT_WINDOW + 1 seconds)
echo "Waiting 11 seconds for window to reset..."
sleep 11

# First request after window should succeed
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "http://localhost:3000/api/comments" \
  -H "Content-Type: application/json" \
  -H "X-Forwarded-For: 1.2.3.4" \
  -d '{"commentText":"after window reset"}')
[ "$STATUS" = "201" ] || echo "FAIL: expected 201 after window reset, got $STATUS"
```

**Pass criterion**: Returns 201.

---

## Test TC-5-6: Rate Limit Headers Present on Success (with Redis configured)

**Goal**: Verify that X-RateLimit-* headers are returned on successful
201 responses when Redis is configured.

**Procedure**:

```bash
curl -s -i \
  -X POST "http://localhost:3000/api/comments" \
  -H "Content-Type: application/json" \
  -H "X-Forwarded-For: 5.5.5.5" \
  -d '{"commentText":"check headers"}' | grep -iE "x-ratelimit|HTTP/"
```

**Expected headers on 201 response**:
- `X-RateLimit-Limit: 3`
- `X-RateLimit-Remaining: 2` (decremented)
- `X-RateLimit-Reset: <unix timestamp>`

**Pass criterion**: All three headers are present.

---

## Automation With Node.js

For CI, use the `undici` fetch client to avoid shell scripting limits:

```typescript
// src/app/api/comments/__tests__/rate-limiting.integration.ts
// Run with: DATABASE_URL=... npx tsx rate-limiting.integration.ts

import { fetch } from "undici";

const BASE = "http://localhost:3000";
const IP = `test-${Date.now()}.0.0.1`; // unique per run to avoid cross-run pollution

async function post(ip: string) {
  const res = await fetch(`${BASE}/api/comments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": ip,
    },
    body: JSON.stringify({ commentText: `Test from ${ip}` }),
  });
  return res.status;
}

// TC-5-1
const statuses = await Promise.all([post(IP), post(IP), post(IP)]);
console.assert(statuses.every((s) => s === 201), "First 3 should be 201");

const limited = await post(IP);
console.assert(limited === 429, `4th request should be 429, got ${limited}`);

console.log("Rate limiting tests passed.");
```
