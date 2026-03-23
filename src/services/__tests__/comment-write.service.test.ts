/**
 * Tests writeComment — tip-chain architecture (no Postgres).
 *
 * Mocks: moderation, utxo-tip (mutex + tip CRUD), wallet, broadcast, rate-limiter, comment-read (cache).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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

const MOCK_CRISIS_RESOURCES = {
  message: "If you or someone you know is struggling, help is available.",
  resources: [
    { name: "988 Suicide & Crisis Lifeline", contact: "Call or text 988", url: "https://988lifeline.org" },
    { name: "Crisis Text Line", contact: "Text HOME to 741741", url: "https://www.crisistextline.org" },
  ],
};

vi.mock("@/lib/utxo-tip", () => ({
  acquireTipMutex: vi.fn(),
  releaseTipMutex: vi.fn().mockResolvedValue(undefined),
  getTip: vi.fn(),
  setTip: vi.fn().mockResolvedValue(undefined),
  recoverTipFromChain: vi.fn(),
}));

vi.mock("@/services/wallet.service", () => ({
  buildCommentTransaction: vi.fn(),
}));

vi.mock("@/services/broadcast.service", () => ({
  broadcastTransaction: vi.fn(),
}));

vi.mock("@/lib/rate-limiter", () => ({
  recordSpend: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./comment-read.service", () => ({
  invalidateFeedCache: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { writeComment, ServiceError } from "@/services/comment-write.service";
import { moderateComment } from "@/services/moderation.service";
import { ModerationUnavailableError } from "@/services/moderation.service";
import { acquireTipMutex, releaseTipMutex, getTip, setTip, recoverTipFromChain } from "@/lib/utxo-tip";
import { buildCommentTransaction } from "@/services/wallet.service";
import { broadcastTransaction } from "@/services/broadcast.service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_TIP = {
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
  changeScriptHex: "76a914" + "00".repeat(20) + "88ac",
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
  vi.mocked(acquireTipMutex).mockResolvedValue(true);
  vi.mocked(getTip).mockResolvedValue(MOCK_TIP);
  vi.mocked(buildCommentTransaction).mockResolvedValue(MOCK_TX_RESULT);
  vi.mocked(broadcastTransaction).mockResolvedValue({ txid: MOCK_TX_RESULT.txid });
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
    expect(moderateComment).toHaveBeenCalledWith(
      expect.stringContaining(VALID_INPUT.commentText)
    );
  });

  it("acquires the tip mutex", async () => {
    await writeComment(VALID_INPUT, "req-1");
    expect(acquireTipMutex).toHaveBeenCalledWith("req-1");
  });

  it("reads the current tip", async () => {
    await writeComment(VALID_INPUT, "req-1");
    expect(getTip).toHaveBeenCalled();
  });

  it("calls buildCommentTransaction with tip and text params", async () => {
    await writeComment(VALID_INPUT, "req-1");
    expect(buildCommentTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        utxo: MOCK_TIP,
        commentText: VALID_INPUT.commentText,
        displayName: VALID_INPUT.displayName,
      })
    );
  });

  it("calls broadcastTransaction with the built txHex", async () => {
    await writeComment(VALID_INPUT, "req-1");
    expect(broadcastTransaction).toHaveBeenCalledWith(MOCK_TX_RESULT.txHex);
  });

  it("advances the tip to the change output", async () => {
    await writeComment(VALID_INPUT, "req-1");
    expect(setTip).toHaveBeenCalledWith({
      txid: MOCK_TX_RESULT.txid,
      vout: 1,
      satoshis: MOCK_TX_RESULT.changeAmount,
      scriptHex: MOCK_TX_RESULT.changeScriptHex,
    });
  });

  it("releases the mutex after success", async () => {
    await writeComment(VALID_INPUT, "req-1");
    expect(releaseTipMutex).toHaveBeenCalledWith("req-1");
  });

  it("prefers ARC txid over locally computed txid", async () => {
    const arcTxid = "c".repeat(64);
    vi.mocked(broadcastTransaction).mockResolvedValueOnce({ txid: arcTxid });
    const result = await writeComment(VALID_INPUT, "req-1");
    expect(result.txid).toBe(arcTxid);
  });

  it("forwards parentTxid to buildCommentTransaction", async () => {
    const input = { ...VALID_INPUT, parentTxid: "d".repeat(64) };
    await writeComment(input, "req-1");
    expect(buildCommentTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ parentTxid: input.parentTxid })
    );
  });
});

// ---------------------------------------------------------------------------
// Mutex / tip failures
// ---------------------------------------------------------------------------

describe("writeComment — mutex and tip failures", () => {
  it("throws BUSY when mutex cannot be acquired", async () => {
    vi.mocked(acquireTipMutex).mockResolvedValue(false);
    await expect(writeComment(VALID_INPUT, "req-1")).rejects.toThrow(ServiceError);
    try {
      await writeComment(VALID_INPUT, "req-1");
    } catch (err) {
      expect((err as ServiceError).code).toBe("BUSY");
      expect((err as ServiceError).statusCode).toBe(503);
    }
  });

  it("throws NO_UTXOS when tip is null and recovery returns null", async () => {
    vi.mocked(getTip).mockResolvedValue(null);
    vi.mocked(recoverTipFromChain).mockResolvedValue(null);
    await expect(writeComment(VALID_INPUT, "req-1")).rejects.toThrow(ServiceError);
    try {
      await writeComment(VALID_INPUT, "req-1");
    } catch (err) {
      expect((err as ServiceError).code).toBe("NO_UTXOS");
    }
  });

  it("recovers tip from chain when getTip returns null", async () => {
    vi.mocked(getTip).mockResolvedValue(null);
    vi.mocked(recoverTipFromChain).mockResolvedValue(MOCK_TIP);
    const result = await writeComment(VALID_INPUT, "req-1");
    expect(recoverTipFromChain).toHaveBeenCalled();
    expect(result.txid).toBe(MOCK_TX_RESULT.txid);
  });
});

// ---------------------------------------------------------------------------
// Broadcast failures
// ---------------------------------------------------------------------------

describe("writeComment — broadcast failures", () => {
  it("releases the mutex when broadcast throws", async () => {
    vi.mocked(broadcastTransaction).mockRejectedValue(new Error("ARC down"));
    await expect(writeComment(VALID_INPUT, "req-1")).rejects.toThrow(ServiceError);
    expect(releaseTipMutex).toHaveBeenCalledWith("req-1");
  });

  it("throws BROADCAST_FAILED on ARC error", async () => {
    vi.mocked(broadcastTransaction).mockRejectedValue(new Error("ARC down"));
    try {
      await writeComment(VALID_INPUT, "req-1");
    } catch (err) {
      expect(err).toBeInstanceOf(ServiceError);
      expect((err as ServiceError).code).toBe("BROADCAST_FAILED");
      expect((err as ServiceError).statusCode).toBe(502);
    }
  });

  it("releases the mutex when buildCommentTransaction throws", async () => {
    vi.mocked(buildCommentTransaction).mockRejectedValue(new Error("Build failed"));
    await expect(writeComment(VALID_INPUT, "req-1")).rejects.toThrow(ServiceError);
    expect(releaseTipMutex).toHaveBeenCalledWith("req-1");
  });
});

// ---------------------------------------------------------------------------
// Moderation failures (unchanged from old architecture)
// ---------------------------------------------------------------------------

describe("writeComment — moderation rejections", () => {
  it("throws CONTENT_VIOLATION when moderation rejects", async () => {
    vi.mocked(moderateComment).mockResolvedValue({
      approved: false,
      violationCategory: "hate",
      violationDetails: "Hate speech detected",
    });

    try {
      await writeComment(VALID_INPUT, "req-1");
    } catch (err) {
      expect(err).toBeInstanceOf(ServiceError);
      expect((err as ServiceError).code).toContain("CONTENT_VIOLATION");
      expect((err as ServiceError).statusCode).toBe(400);
    }
  });

  it("does not acquire mutex when moderation rejects", async () => {
    vi.mocked(moderateComment).mockResolvedValue({ approved: false, violationCategory: "spam" });
    await expect(writeComment(VALID_INPUT, "req-1")).rejects.toThrow();
    expect(acquireTipMutex).not.toHaveBeenCalled();
  });

  it("throws MODERATION_UNAVAILABLE when moderation service is down", async () => {
    vi.mocked(moderateComment).mockRejectedValue(
      new ModerationUnavailableError("OpenAI unreachable")
    );

    try {
      await writeComment(VALID_INPUT, "req-1");
    } catch (err) {
      expect(err).toBeInstanceOf(ServiceError);
      expect((err as ServiceError).code).toBe("MODERATION_UNAVAILABLE");
      expect((err as ServiceError).statusCode).toBe(503);
    }
  });

  it("includes crisis resources for self-harm violations", async () => {
    vi.mocked(moderateComment).mockResolvedValue({
      approved: false,
      violationCategory: "self_harm",
      violationDetails: "Content flagged for self-harm",
      crisisResources: MOCK_CRISIS_RESOURCES,
    });

    try {
      await writeComment(VALID_INPUT, "req-1");
    } catch (err) {
      expect(err).toBeInstanceOf(ServiceError);
      expect((err as ServiceError).code).toContain("self_harm");
      expect((err as ServiceError).crisisResources).toBeDefined();
    }
  });
});
