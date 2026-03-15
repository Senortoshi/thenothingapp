/**
 * IRI-3 / IRI-6: Integration Tests — comment-write.service
 *
 * Tests writeComment by mocking all external dependencies:
 *   - moderateComment (moderation.service)
 *   - checkoutUtxo, markUtxoSpent, releaseUtxo (utxo-pool.service)
 *   - buildCommentTransaction (wallet.service)
 *   - broadcastTransaction (broadcast.service)
 *   - db.insert (db)
 *
 * This exercises the full orchestration logic in isolation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted variables — vi.mock factories are hoisted to the top of the file,
// so any variables they reference must also be hoisted via vi.hoisted().
// ---------------------------------------------------------------------------

const { mockInsert } = vi.hoisted(() => ({
  mockInsert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/services/moderation.service", () => ({
  moderateComment: vi.fn(),
  ModerationUnavailableError: class ModerationUnavailableError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "ModerationUnavailableError";
    }
  },
}));

vi.mock("@/services/utxo-pool.service", () => ({
  checkoutUtxo: vi.fn(),
  markUtxoSpent: vi.fn(),
  releaseUtxo: vi.fn(),
}));

vi.mock("@/services/wallet.service", () => ({
  buildCommentTransaction: vi.fn(),
}));

vi.mock("@/services/broadcast.service", () => ({
  broadcastTransaction: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    insert: mockInsert,
  },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { writeComment, ServiceError } from "@/services/comment-write.service";
import { moderateComment } from "@/services/moderation.service";
import {
  checkoutUtxo,
  markUtxoSpent,
  releaseUtxo,
} from "@/services/utxo-pool.service";
import { buildCommentTransaction } from "@/services/wallet.service";
import { broadcastTransaction } from "@/services/broadcast.service";
import { ModerationUnavailableError } from "@/services/moderation.service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_UTXO = {
  id: 1,
  txid: "a".repeat(64),
  vout: 0,
  satoshis: 5000,
  scriptHex: "76a914" + "00".repeat(20) + "88ac",
};

const MOCK_TX_RESULT = {
  txHex: "0100000001" + "00".repeat(100),
  txid: "b".repeat(64),
  fee: 3,
  changeAmount: 4997,
};

const VALID_INPUT = {
  commentText: "Hello, BSV world!",
  displayName: "Alice",
  parentTxid: undefined,
} as const;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Default happy-path stubs
  vi.mocked(moderateComment).mockResolvedValue({ approved: true });
  vi.mocked(checkoutUtxo).mockResolvedValue(MOCK_UTXO);
  vi.mocked(buildCommentTransaction).mockResolvedValue(MOCK_TX_RESULT);
  vi.mocked(broadcastTransaction).mockResolvedValue({ txid: MOCK_TX_RESULT.txid });
  vi.mocked(markUtxoSpent).mockResolvedValue(undefined);
  vi.mocked(releaseUtxo).mockResolvedValue(undefined);
  mockInsert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("writeComment — happy path", () => {
  it("returns the txid from ARC broadcast", async () => {
    const result = await writeComment(VALID_INPUT, "req-1");
    expect(result.txid).toBe(MOCK_TX_RESULT.txid);
  });

  it("returns the correct commentText and displayName", async () => {
    const result = await writeComment(VALID_INPUT, "req-1");
    expect(result.commentText).toBe(VALID_INPUT.commentText);
    expect(result.displayName).toBe(VALID_INPUT.displayName);
  });

  it("returns a createdAt Date", async () => {
    const result = await writeComment(VALID_INPUT, "req-1");
    expect(result.createdAt).toBeInstanceOf(Date);
  });

  it("calls moderateComment with the comment text", async () => {
    await writeComment(VALID_INPUT, "req-1");
    expect(moderateComment).toHaveBeenCalledWith(VALID_INPUT.commentText);
  });

  it("calls checkoutUtxo with the requestId", async () => {
    await writeComment(VALID_INPUT, "req-abc");
    expect(checkoutUtxo).toHaveBeenCalledWith("req-abc");
  });

  it("calls buildCommentTransaction with utxo and text params", async () => {
    await writeComment(VALID_INPUT, "req-1");
    expect(buildCommentTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        utxo: MOCK_UTXO,
        commentText: VALID_INPUT.commentText,
        displayName: VALID_INPUT.displayName,
      })
    );
  });

  it("calls broadcastTransaction with the built txHex", async () => {
    await writeComment(VALID_INPUT, "req-1");
    expect(broadcastTransaction).toHaveBeenCalledWith(MOCK_TX_RESULT.txHex);
  });

  it("marks the UTXO spent after a successful broadcast", async () => {
    await writeComment(VALID_INPUT, "req-1");
    expect(markUtxoSpent).toHaveBeenCalledWith(MOCK_UTXO.id);
  });

  it("does not release the UTXO on success", async () => {
    await writeComment(VALID_INPUT, "req-1");
    expect(releaseUtxo).not.toHaveBeenCalled();
  });

  it("prefers ARC txid over locally computed txid", async () => {
    const arcTxid = "c".repeat(64);
    vi.mocked(broadcastTransaction).mockResolvedValueOnce({ txid: arcTxid });
    const result = await writeComment(VALID_INPUT, "req-1");
    expect(result.txid).toBe(arcTxid);
  });

  it("forwards parentTxid to buildCommentTransaction", async () => {
    const parent = "d".repeat(64);
    await writeComment({ ...VALID_INPUT, parentTxid: parent }, "req-1");
    expect(buildCommentTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ parentTxid: parent })
    );
  });
});

// ---------------------------------------------------------------------------
// Moderation failures
// ---------------------------------------------------------------------------

describe("writeComment — moderation rejection", () => {
  it("throws ServiceError with code CONTENT_VIOLATION when moderation rejects", async () => {
    vi.mocked(moderateComment).mockResolvedValueOnce({
      approved: false,
      violationCategory: "hate_speech",
      violationDetails: "Flagged by hate speech filter",
    });

    await expect(writeComment(VALID_INPUT, "req-1")).rejects.toMatchObject({
      code: "CONTENT_VIOLATION:hate_speech",
      statusCode: 400,
    });
  });

  it("does not checkout a UTXO when moderation rejects", async () => {
    vi.mocked(moderateComment).mockResolvedValueOnce({
      approved: false,
      violationCategory: "violence",
    });

    await expect(writeComment(VALID_INPUT, "req-1")).rejects.toBeInstanceOf(ServiceError);
    expect(checkoutUtxo).not.toHaveBeenCalled();
  });

  it("throws ServiceError MODERATION_UNAVAILABLE when OpenAI is unreachable — fail CLOSED", async () => {
    vi.mocked(moderateComment).mockRejectedValueOnce(
      new ModerationUnavailableError("Service down")
    );

    await expect(writeComment(VALID_INPUT, "req-1")).rejects.toMatchObject({
      code: "MODERATION_UNAVAILABLE",
      statusCode: 503,
    });
  });

  it("throws ServiceError MODERATION_ERROR on unexpected moderation error — fail CLOSED", async () => {
    vi.mocked(moderateComment).mockRejectedValueOnce(new Error("Unexpected crash"));

    await expect(writeComment(VALID_INPUT, "req-1")).rejects.toMatchObject({
      code: "MODERATION_ERROR",
      statusCode: 503,
    });
  });
});

// ---------------------------------------------------------------------------
// UTXO exhaustion
// ---------------------------------------------------------------------------

describe("writeComment — UTXO pool exhaustion", () => {
  it("throws ServiceError NO_UTXOS when pool is empty", async () => {
    vi.mocked(checkoutUtxo).mockResolvedValueOnce(null);

    await expect(writeComment(VALID_INPUT, "req-1")).rejects.toMatchObject({
      code: "NO_UTXOS",
      statusCode: 503,
    });
  });

  it("does not call buildCommentTransaction when no UTXO is available", async () => {
    vi.mocked(checkoutUtxo).mockResolvedValueOnce(null);
    await expect(writeComment(VALID_INPUT, "req-1")).rejects.toBeInstanceOf(ServiceError);
    expect(buildCommentTransaction).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Broadcast failures — UTXO release
// ---------------------------------------------------------------------------

describe("writeComment — broadcast failure", () => {
  it("releases the UTXO when broadcast throws", async () => {
    vi.mocked(broadcastTransaction).mockRejectedValueOnce(
      new Error("ARC rejected tx")
    );

    await expect(writeComment(VALID_INPUT, "req-1")).rejects.toBeInstanceOf(ServiceError);
    expect(releaseUtxo).toHaveBeenCalledWith(MOCK_UTXO.id);
  });

  it("throws ServiceError BROADCAST_FAILED on ARC error", async () => {
    vi.mocked(broadcastTransaction).mockRejectedValueOnce(
      new Error("ARC 500: internal error")
    );

    await expect(writeComment(VALID_INPUT, "req-1")).rejects.toMatchObject({
      code: "BROADCAST_FAILED",
      statusCode: 502,
    });
  });

  it("releases the UTXO when buildCommentTransaction throws", async () => {
    vi.mocked(buildCommentTransaction).mockRejectedValueOnce(
      new Error("UTXO too small")
    );

    await expect(writeComment(VALID_INPUT, "req-1")).rejects.toBeInstanceOf(ServiceError);
    expect(releaseUtxo).toHaveBeenCalledWith(MOCK_UTXO.id);
  });
});

// ---------------------------------------------------------------------------
// DB persistence failure — degraded success
// ---------------------------------------------------------------------------

describe("writeComment — DB persistence failure after broadcast", () => {
  it("still returns a result (degraded success) when DB insert fails", async () => {
    mockInsert.mockReturnValueOnce({
      values: vi.fn().mockRejectedValueOnce(new Error("DB connection lost")),
    });

    // Should not throw — on-chain write succeeded
    const result = await writeComment(VALID_INPUT, "req-1");
    expect(result.txid).toBe(MOCK_TX_RESULT.txid);
  });

  it("still marks UTXO spent even when DB insert fails", async () => {
    mockInsert.mockReturnValueOnce({
      values: vi.fn().mockRejectedValueOnce(new Error("DB down")),
    });

    await writeComment(VALID_INPUT, "req-1");
    expect(markUtxoSpent).toHaveBeenCalledWith(MOCK_UTXO.id);
  });
});

// ---------------------------------------------------------------------------
// ServiceError class contract
// ---------------------------------------------------------------------------

describe("ServiceError", () => {
  it("is an instance of Error", () => {
    const err = new ServiceError("TEST_CODE", "message", 400);
    expect(err).toBeInstanceOf(Error);
  });

  it("exposes code, message, and statusCode", () => {
    const err = new ServiceError("MY_CODE", "my message", 422);
    expect(err.code).toBe("MY_CODE");
    expect(err.message).toBe("my message");
    expect(err.statusCode).toBe(422);
  });

  it("defaults statusCode to 500", () => {
    const err = new ServiceError("E", "msg");
    expect(err.statusCode).toBe(500);
  });

  it("has name 'ServiceError'", () => {
    expect(new ServiceError("E", "m").name).toBe("ServiceError");
  });
});
