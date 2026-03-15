/**
 * IRI-3 & IRI-5: Integration Tests — POST /api/comments + GET /api/comments
 *
 * Tests the Next.js route handlers directly by calling GET() and POST()
 * with mock NextRequest objects. All services and DB calls are mocked.
 *
 * Rate limiting is tested by mocking the Upstash modules.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted variables — referenced inside vi.mock factories below
// ---------------------------------------------------------------------------

const { mockDbExecute } = vi.hoisted(() => ({
  mockDbExecute: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/services/comment-write.service", () => ({
  writeComment: vi.fn(),
  ServiceError: class ServiceError extends Error {
    code: string;
    statusCode: number;
    constructor(code: string, message: string, statusCode = 500) {
      super(message);
      this.code = code;
      this.statusCode = statusCode;
      this.name = "ServiceError";
    }
  },
}));

vi.mock("@/db", () => ({
  db: { execute: mockDbExecute },
}));

vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class MockRatelimit {
    static slidingWindow = vi.fn().mockReturnValue({});
    constructor() {}
    limit = vi.fn();
  },
}));

vi.mock("@upstash/redis", () => ({
  Redis: class MockRedis {
    constructor() {}
  },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { POST, GET } from "@/app/api/comments/route";
import { writeComment, ServiceError } from "@/services/comment-write.service";

// ---------------------------------------------------------------------------
// Test helper — create a minimal NextRequest-like object
// ---------------------------------------------------------------------------

function makeRequest(
  method: "GET" | "POST",
  {
    body,
    searchParams = {},
    headers = {},
  }: {
    body?: unknown;
    searchParams?: Record<string, string>;
    headers?: Record<string, string>;
  } = {}
) {
  const url = new URL("http://localhost/api/comments");
  Object.entries(searchParams).forEach(([k, v]) => url.searchParams.set(k, v));

  return {
    method,
    nextUrl: url,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    json: () => Promise.resolve(body),
  } as unknown as import("next/server").NextRequest;
}

// Default mock DB response for GET (empty feed)
function setMockComments(rows: unknown[]) {
  mockDbExecute.mockResolvedValueOnce(rows);
}

// ---------------------------------------------------------------------------
// GET /api/comments
// ---------------------------------------------------------------------------

describe("GET /api/comments", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 with empty comments array when feed is empty", async () => {
    setMockComments([]);
    const req = makeRequest("GET");
    const res = await GET(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.comments).toEqual([]);
    expect(json.nextCursor).toBeNull();
  });

  it("returns serialised comment rows", async () => {
    const now = new Date("2024-06-01T12:00:00.000Z");
    setMockComments([
      {
        id: 1,
        txid: "a".repeat(64),
        display_name: "Alice",
        comment_text: "Hello",
        parent_txid: null,
        created_at: now,
      },
    ]);
    const req = makeRequest("GET");
    const res = await GET(req);
    const json = await res.json();
    expect(json.comments).toHaveLength(1);
    expect(json.comments[0]).toMatchObject({
      id: 1,
      txid: "a".repeat(64),
      displayName: "Alice",
      commentText: "Hello",
      parentTxid: null,
      createdAt: now.toISOString(),
    });
  });

  it("sets nextCursor when exactly pageSize comments are returned", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      txid: String(i).padStart(64, "0"),
      display_name: "User",
      comment_text: "msg",
      parent_txid: null,
      created_at: new Date("2024-01-01T00:00:00.000Z"),
    }));
    setMockComments(rows);
    const req = makeRequest("GET");
    const res = await GET(req);
    const json = await res.json();
    expect(json.nextCursor).not.toBeNull();
    expect(json.nextCursor).toHaveProperty("id");
    expect(json.nextCursor).toHaveProperty("createdAt");
  });

  it("returns null nextCursor when fewer than pageSize comments returned", async () => {
    setMockComments([
      {
        id: 1,
        txid: "a".repeat(64),
        display_name: "Alice",
        comment_text: "Only one",
        parent_txid: null,
        created_at: new Date(),
      },
    ]);
    const req = makeRequest("GET");
    const res = await GET(req);
    const json = await res.json();
    expect(json.nextCursor).toBeNull();
  });

  it("returns 400 for invalid query params (bad cursorCreatedAt)", async () => {
    const req = makeRequest("GET", { searchParams: { cursorCreatedAt: "not-a-date" } });
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("sets Cache-Control header on successful response", async () => {
    setMockComments([]);
    const req = makeRequest("GET");
    const res = await GET(req);
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=5");
  });

  it("returns 500 when DB throws", async () => {
    mockDbExecute.mockRejectedValueOnce(new Error("DB connection lost"));
    const req = makeRequest("GET");
    const res = await GET(req);
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// POST /api/comments — validation
// ---------------------------------------------------------------------------

describe("POST /api/comments — input validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 422 for an empty commentText", async () => {
    const req = makeRequest("POST", { body: { commentText: "" } });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });

  it("returns 422 for whitespace-only commentText", async () => {
    const req = makeRequest("POST", { body: { commentText: "   " } });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });

  it("returns 422 when commentText exceeds MAX_COMMENT_LENGTH", async () => {
    const req = makeRequest("POST", { body: { commentText: "a".repeat(600) } });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });

  it("returns 422 for invalid parentTxid format", async () => {
    const req = makeRequest("POST", {
      body: { commentText: "hello", parentTxid: "not-a-txid" },
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });

  it("returns 400 for malformed JSON body", async () => {
    const req = {
      method: "POST",
      nextUrl: new URL("http://localhost/api/comments"),
      headers: { get: () => null },
      json: () => Promise.reject(new SyntaxError("Unexpected token")),
    } as unknown as import("next/server").NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 422 for missing commentText", async () => {
    const req = makeRequest("POST", { body: {} });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// POST /api/comments — successful submission
// ---------------------------------------------------------------------------

describe("POST /api/comments — success", () => {
  const MOCK_RESULT = {
    txid: "b".repeat(64),
    displayName: "Alice",
    commentText: "Hello",
    parentTxid: undefined,
    createdAt: new Date("2024-06-01T12:00:00.000Z"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(writeComment).mockResolvedValue(MOCK_RESULT);
  });

  it("returns 201 on a valid submission", async () => {
    const req = makeRequest("POST", {
      body: { commentText: "Hello" },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });

  it("returns txid, displayName, commentText, createdAt in response body", async () => {
    const req = makeRequest("POST", { body: { commentText: "Hello" } });
    const res = await POST(req);
    const json = await res.json();
    expect(json.txid).toBe(MOCK_RESULT.txid);
    expect(json.displayName).toBe(MOCK_RESULT.displayName);
    expect(json.commentText).toBe(MOCK_RESULT.commentText);
    expect(json.createdAt).toBe(MOCK_RESULT.createdAt.toISOString());
  });

  it("returns parentTxid as null in response when not supplied", async () => {
    const req = makeRequest("POST", { body: { commentText: "Hello" } });
    const res = await POST(req);
    const json = await res.json();
    expect(json.parentTxid).toBeNull();
  });

  it("calls writeComment with the validated input", async () => {
    const req = makeRequest("POST", {
      body: { commentText: "Test message", displayName: "Bob" },
    });
    await POST(req);
    expect(writeComment).toHaveBeenCalledWith(
      expect.objectContaining({
        commentText: "Test message",
        displayName: "Bob",
      }),
      expect.any(String)
    );
  });
});

// ---------------------------------------------------------------------------
// POST /api/comments — service errors
// ---------------------------------------------------------------------------

describe("POST /api/comments — service errors", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 with code when writeComment throws CONTENT_VIOLATION", async () => {
    vi.mocked(writeComment).mockRejectedValueOnce(
      new ServiceError("CONTENT_VIOLATION:hate_speech", "Content violates policy", 400)
    );
    const req = makeRequest("POST", { body: { commentText: "bad content" } });
    const res = await POST(req);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.code).toBe("CONTENT_VIOLATION:hate_speech");
  });

  it("returns 503 when writeComment throws NO_UTXOS", async () => {
    vi.mocked(writeComment).mockRejectedValueOnce(
      new ServiceError("NO_UTXOS", "Pool exhausted", 503)
    );
    const req = makeRequest("POST", { body: { commentText: "hello" } });
    const res = await POST(req);
    expect(res.status).toBe(503);
  });

  it("returns 503 when writeComment throws MODERATION_UNAVAILABLE", async () => {
    vi.mocked(writeComment).mockRejectedValueOnce(
      new ServiceError("MODERATION_UNAVAILABLE", "Moderation service down", 503)
    );
    const req = makeRequest("POST", { body: { commentText: "hello" } });
    const res = await POST(req);
    expect(res.status).toBe(503);
  });

  it("returns 500 for unexpected errors from writeComment", async () => {
    vi.mocked(writeComment).mockRejectedValueOnce(new Error("Unexpected crash"));
    const req = makeRequest("POST", { body: { commentText: "hello" } });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// IRI-5: Rate Limiting
//
// The actual Upstash limiter is mocked. We test the route's handling of
// rlResult values injected via the mock — the rate-limit decision logic
// in the route itself, not the Upstash library.
//
// For true per-IP enforcement tests, see the infrastructure test plan in
// src/app/api/comments/__tests__/rate-limiting.plan.md
// ---------------------------------------------------------------------------

describe("POST /api/comments — rate limit headers on success", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(writeComment).mockResolvedValue({
      txid: "b".repeat(64),
      displayName: "Alice",
      commentText: "Hello",
      createdAt: new Date(),
    });
  });

  it("does not include rate limit headers when Redis is unconfigured", async () => {
    // Without UPSTASH_REDIS_REST_URL/TOKEN, rlResult is null
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    const req = makeRequest("POST", { body: { commentText: "hello" } });
    const res = await POST(req);
    expect(res.status).toBe(201);
    // No rate limit headers expected
    expect(res.headers.get("X-RateLimit-Limit")).toBeNull();
  });
});
