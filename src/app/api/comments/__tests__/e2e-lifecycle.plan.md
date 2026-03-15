# IRI-7: E2E Test Plan — Full Comment Lifecycle

**Status**: Infrastructure-dependent. Requires the deployed app + BSV mainnet
(or signet) funds + a live Upstash Redis + Postgres.

**Scope**: Verifies that a comment posted through the UI completes the full
on-chain lifecycle:
  1. User submits comment via the form
  2. Comment appears in the feed immediately (optimistic or DB-read)
  3. The `txid` resolves on a BSV explorer (WhatsonChain)
  4. GET /api/comments/:txid returns the correct data
  5. The comment persists after a page refresh

---

## Prerequisites

| Requirement | Value |
|---|---|
| Deployed URL | `https://nothing-app.vercel.app` (or staging) |
| BSV wallet | Pre-funded (> 100 UTXOs at 5000 sats each) |
| Postgres | Healthy, migration applied |
| Upstash Redis | Connected |
| OpenAI API Key | Set (or keyword filter acceptable for test content) |

---

## TC-7-1: Happy Path — Post Comment, Verify Feed Entry

**Tool**: Playwright + `@playwright/test`

```typescript
// tests/e2e/comment-lifecycle.spec.ts
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const UNIQUE_TEXT = `E2E test comment ${Date.now()}`;

test("post a comment and see it appear in the feed", async ({ page }) => {
  await page.goto(BASE_URL);

  // Fill in the comment form
  const textarea = page.getByPlaceholder(/say something/i);
  await textarea.fill(UNIQUE_TEXT);

  // Submit
  await page.getByRole("button", { name: /post/i }).click();

  // Wait for success confirmation (txid visible or comment visible in feed)
  await expect(page.getByText(UNIQUE_TEXT)).toBeVisible({ timeout: 15_000 });
});
```

**Pass criterion**: The posted comment text appears in the feed within 15 seconds.

---

## TC-7-2: txid Resolves via API

**Tool**: `fetch` or Playwright `request` fixture

```typescript
test("posted comment txid resolves via GET /api/comments/:txid", async ({ request }) => {
  // Post the comment via API
  const postRes = await request.post(`${BASE_URL}/api/comments`, {
    data: { commentText: UNIQUE_TEXT },
  });
  expect(postRes.status()).toBe(201);

  const { txid } = await postRes.json();
  expect(txid).toMatch(/^[0-9a-f]{64}$/);

  // Fetch by txid
  const getRes = await request.get(`${BASE_URL}/api/comments/${txid}`);
  expect(getRes.status()).toBe(200);

  const comment = await getRes.json();
  expect(comment.txid).toBe(txid);
  expect(comment.commentText).toBe(UNIQUE_TEXT);
});
```

**Pass criterion**: GET returns 200 with matching `commentText`.

---

## TC-7-3: txid Appears in Feed (Cursor Pagination)

**Tool**: `fetch` / Playwright `request`

```typescript
test("posted comment appears in GET /api/comments feed", async ({ request }) => {
  // Post
  const postRes = await request.post(`${BASE_URL}/api/comments`, {
    data: { commentText: UNIQUE_TEXT },
  });
  const { txid } = await postRes.json();

  // Fetch first page of feed — newest comments first
  const feedRes = await request.get(`${BASE_URL}/api/comments`);
  const { comments } = await feedRes.json();

  const found = comments.find((c: { txid: string }) => c.txid === txid);
  expect(found).toBeDefined();
  expect(found.commentText).toBe(UNIQUE_TEXT);
});
```

**Pass criterion**: The new txid appears in the first page of the feed.

---

## TC-7-4: txid Verified On-Chain via WhatsonChain

**Tool**: Node.js `fetch` — external call to BSV explorer API

```typescript
test("txid is confirmed on BSV mainnet within 60 seconds", async () => {
  // Post comment
  const postRes = await fetch(`${BASE_URL}/api/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commentText: UNIQUE_TEXT }),
  });
  const { txid } = await postRes.json();

  // Poll WhatsonChain for up to 60s
  const explorerUrl = `https://api.whatsonchain.com/v1/bsv/main/tx/${txid}`;
  let confirmed = false;

  for (let attempt = 0; attempt < 12; attempt++) {
    await new Promise((r) => setTimeout(r, 5000));
    const res = await fetch(explorerUrl);
    if (res.ok) {
      confirmed = true;
      break;
    }
  }

  expect(confirmed).toBe(true);
}, 70_000); // 70s timeout
```

**Pass criterion**: WhatsonChain returns 200 for the txid within 60 seconds.

**Note**: This test requires BSV mainnet connectivity and ARC broadcast
success. It will fail in environments without a funded wallet.

---

## TC-7-5: Blocklisted txid Returns 410 Gone

**Tool**: Playwright `request` + admin API

```typescript
test("blocklisted comment returns 410 Gone from the API", async ({ request }) => {
  // Post comment
  const postRes = await request.post(`${BASE_URL}/api/comments`, {
    data: { commentText: "comment to be blocklisted" },
  });
  const { txid } = await postRes.json();

  // Block it via admin API
  const blockRes = await request.post(`${BASE_URL}/api/admin/blocklist`, {
    headers: { Authorization: `Bearer ${process.env.ADMIN_API_KEY}` },
    data: { txid, reason: "other", notes: "E2E test blocklist" },
  });
  expect(blockRes.status()).toBe(201);

  // Verify it's gone
  const getRes = await request.get(`${BASE_URL}/api/comments/${txid}`);
  expect(getRes.status()).toBe(410);

  // Also verify it's not in the feed
  const feedRes = await request.get(`${BASE_URL}/api/comments`);
  const { comments } = await feedRes.json();
  const found = comments.find((c: { txid: string }) => c.txid === txid);
  expect(found).toBeUndefined();
});
```

**Pass criterion**: GET /api/comments/:txid returns 410; txid absent from feed.

---

## TC-7-6: Reply (parentTxid) Links to Parent

```typescript
test("reply comment links to its parent", async ({ request }) => {
  // Post parent
  const parentRes = await request.post(`${BASE_URL}/api/comments`, {
    data: { commentText: "Parent comment" },
  });
  const { txid: parentTxid } = await parentRes.json();

  // Post reply
  const replyRes = await request.post(`${BASE_URL}/api/comments`, {
    data: { commentText: "Reply comment", parentTxid },
  });
  expect(replyRes.status()).toBe(201);

  const { txid: replyTxid } = await replyRes.json();

  // Fetch reply and verify parentTxid
  const getRes = await request.get(`${BASE_URL}/api/comments/${replyTxid}`);
  const reply = await getRes.json();
  expect(reply.parentTxid).toBe(parentTxid);
});
```

---

## Running the E2E Suite

```bash
# Install Playwright
npx playwright install chromium

# Run against staging
E2E_BASE_URL=https://your-staging.vercel.app \
ADMIN_API_KEY=your-admin-key \
npx playwright test tests/e2e/

# Run locally (requires `npm run dev` running)
E2E_BASE_URL=http://localhost:3000 \
ADMIN_API_KEY=your-admin-key \
npx playwright test tests/e2e/ --headed
```

---

## Notes on Test Isolation

- Each test posts a unique comment text (`${Date.now()}`) to avoid
  cross-test pollution.
- The admin blocklist test should clean up after itself or use a dedicated
  test-only txid prefix.
- For mainnet tests, keep comment text clearly marked as test data
  (`[E2E-TEST]`) so it can be blocklisted in production if needed.
- BSV mainnet comments are **permanent**. Do not post sensitive data in E2E tests.
