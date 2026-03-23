/**
 * Tests — POST /api/comments + GET /api/comments
 *
 * Tests the Next.js route handlers. All services are mocked.
 * Updated for the on-chain architecture (no Postgres).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/services/comment-write.service", () => ({
  writeComment: vi.fn(),
  ServiceError: class ServiceError extends Error {
    code: string;
    statusCode: number;
    crisisResources?: unknown;
    constructor(code: string, message: string, statusCode = 500) {
      super(message);
      this.code = code;
      this.statusCode = statusCode;
      this.name = "ServiceError";
    }
  },
}));

vi.mock("@/services/comment-read.service", () => ({
  getComments: vi.fn(),
  invalidateFeedCache: vi.fn(),
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

vi.mock("@/lib/rate-limiter", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, headers: {} }),
  recordBroadcastSuccess: vi.fn().mockResolvedValue(undefined),
  recordBroadcastFailure: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { POST, GET } from "@/app/api/comments/route";
import { writeComment, ServiceError } from "@/services/comment-write.service";
import { getComments } from "@/services/comment-read.service";

// ---------------------------------------------------------------------------
// Test helper
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

// ---------------------------------------------------------------------------
// GET /api/comments
// ---------------------------------------------------------------------------

describe("GET /api/comments", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 with empty comments array when feed is empty", async () => {
    vi.mocked(getComments).mockResolvedValue({ comments: [], nextCursor: null });
    const req = makeRequest("GET");
    const res = await GET(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.comments).toEqual([]);
    expect(json.nextCursor).toBeNull();
  });

  it("returns comment data from the read service", async () => {
    vi.mocked(getComments).mockResolvedValue({
      comments: [
        {
          txid: "a".repeat(64),
          displayName: "Alice",
          commentText: "Hello",
          parentTxid: null,
          createdAt: "2024-06-01T12:00:00.000Z",
        },
      ],
      nextCursor: null,
    });
    const req = makeRequest("GET");
    const res = await GET(req);
    const json = await res.json();
    expect(json.comments).toHaveLength(1);
    expect(json.comments[0]).toMatchObject({
      txid: "a".repeat(64),
      displayName: "Alice",
      commentText: "Hello",
    });
  });

  it("returns nextCursor with offset when more comments exist", async () => {
    vi.mocked(getComments).mockResolvedValue({
      comments: Array.from({ length: 20 }, (_, i) => ({
        txid: String(i).padStart(64, "0"),
        displayName: "User",
        commentText: "msg",
        parentTxid: null,
        createdAt: "2024-01-01T00:00:00.000Z",
      })),
      nextCursor: { offset: 20 },
    });
    const req = makeRequest("GET");
    const res = await GET(req);
    const json = await res.json();
    expect(json.nextCursor).toEqual({ offset: 20 });
  });

  it("returns null nextCursor when no more comments", async () => {
    vi.mocked(getComments).mockResolvedValue({
      comments: [{ txid: "a".repeat(64), displayName: "Alice", commentText: "Only one", parentTxid: null, createdAt: new Date().toISOString() }],
      nextCursor: null,
    });
    const req = makeRequest("GET");
    const res = await GET(req);
    const json = await res.json();
    expect(json.nextCursor).toBeNull();
  });

  it("returns 400 for invalid query params (negative offset)", async () => {
    const req = makeRequest("GET", { searchParams: { cursorOffset: "-1" } });
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("sets Cache-Control header on successful response", async () => {
    vi.mocked(getComments).mockResolvedValue({ comments: [], nextCursor: null });
    const req = makeRequest("GET");
    const res = await GET(req);
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=5");
  });

  it("returns 500 when read service throws", async () => {
    vi.mocked(getComments).mockRejectedValue(new Error("WoC unreachable"));
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
    const req = makeRequest("POST", { body: { commentText: "Hello" } });
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

  it("returns parentTxid as null when not supplied", async () => {
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

  it("returns 500 for unexpected errors from writeComment", async () => {
    vi.mocked(writeComment).mockRejectedValueOnce(new Error("Unexpected crash"));
    const req = makeRequest("POST", { body: { commentText: "hello" } });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// POST /api/comments — crisis resources
// ---------------------------------------------------------------------------

const MOCK_CRISIS_RESOURCES = {
  message: "If you or someone you know is struggling, help is available.",
  resources: [
    { name: "988 Suicide & Crisis Lifeline", contact: "Call or text 988", url: "https://988lifeline.org" },
    { name: "Crisis Text Line", contact: "Text HOME to 741741", url: "https://www.crisistextline.org" },
  ],
};

describe("POST /api/comments — self-harm crisis resources", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns crisisResources when ServiceError carries them", async () => {
    const err = new ServiceError("CONTENT_VIOLATION:self_harm", "Content violates policy", 400);
    (err as ServiceError & { crisisResources: unknown }).crisisResources = MOCK_CRISIS_RESOURCES;
    vi.mocked(writeComment).mockRejectedValueOnce(err);

    const req = makeRequest("POST", { body: { commentText: "self harm content" } });
    const res = await POST(req);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.crisisResources).toEqual(MOCK_CRISIS_RESOURCES);
  });

  it("does NOT include crisisResources for non-self-harm violations", async () => {
    vi.mocked(writeComment).mockRejectedValueOnce(
      new ServiceError("CONTENT_VIOLATION:hate_speech", "Content violates policy", 400)
    );
    const req = makeRequest("POST", { body: { commentText: "hate speech" } });
    const res = await POST(req);
    const json = await res.json();
    expect(json.crisisResources).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// POST /api/comments — rate limit headers
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
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    const req = makeRequest("POST", { body: { commentText: "hello" } });
    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(res.headers.get("X-RateLimit-Limit")).toBeNull();
  });
});
