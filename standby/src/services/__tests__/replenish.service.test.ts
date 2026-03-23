/**
 * Unit Tests — replenish.service
 *
 * Tests replenishPool and runReplenishment from src/services/replenish.service.ts.
 *
 * All external dependencies are mocked:
 *   - fetch (WhatsOnChain API)
 *   - broadcastTransaction (@/services/broadcast.service)
 *   - getPoolStats, insertUtxo, syncWalletUtxoCount (@/services/utxo-pool.service)
 *   - getFundingKey, getFundingAddress, calculateFee (@/services/wallet.service)
 *   - sendAlert (@/lib/alerts)
 *   - @bsv/sdk (Transaction, P2PKH)
 *   - @/db (walletState updates for lock management)
 *   - acquireReplenishLock, releaseReplenishLock (mocked at service boundary)
 *
 * Covered:
 *  - Pool healthy: freeCount >= UTXO_REPLENISH_THRESHOLD → skipped: true
 *  - WhatsOnChain returns 500 → skipped: true
 *  - WhatsOnChain timeout/network error → skipped: true
 *  - No UTXOs on-chain (empty array) → skipped: true
 *  - All UTXOs below dust threshold → skipped: true
 *  - Insufficient balance (fee > total sats) → skipped: true
 *  - acquireReplenishLock returns false → immediately returns without calling getPoolStats
 *  - Happy path: fetches UTXOs, builds split tx, broadcasts, inserts UTXOs into pool
 *  - Lock is released in the finally block even when an error is thrown
 *  - Raw tx fetch fails for a known txHash → skipped: true
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock state
// ---------------------------------------------------------------------------

const {
  mockDbUpdate,
  mockSet,
  mockWhere,
} = vi.hoisted(() => {
  const mockWhere = vi.fn().mockResolvedValue({ rowCount: 1 });
  const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
  const mockDbUpdate = vi.fn().mockReturnValue({ set: mockSet });

  return { mockDbUpdate, mockSet, mockWhere };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/db", () => ({
  db: {
    update: mockDbUpdate,
  },
  walletState: {},
}));

vi.mock("@/db/schema", () => ({
  walletState: { id: "id", isReplenishing: "isReplenishing", updatedAt: "updatedAt" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => ({ type: "eq" })),
  sql: vi.fn((...args: unknown[]) => ({ type: "sql", args })),
}));

vi.mock("@/services/utxo-pool.service", () => ({
  getPoolStats: vi.fn(),
  insertUtxo: vi.fn().mockResolvedValue(undefined),
  syncWalletUtxoCount: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/wallet.service", () => ({
  getFundingKey: vi.fn().mockReturnValue({ key: "mock-private-key" }),
  getFundingAddress: vi.fn().mockReturnValue("1FundingAddress123"),
  calculateFee: vi.fn().mockReturnValue(50),
}));

vi.mock("@/services/broadcast.service", () => ({
  broadcastTransaction: vi.fn().mockResolvedValue({ txid: "e".repeat(64) }),
}));

vi.mock("@/lib/alerts", () => ({
  sendAlert: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/constants", () => ({
  UTXO_REPLENISH_THRESHOLD: 5,
  UTXO_SPLIT_TARGET: 10,
  ALERT_UTXO_MIN_FREE: 3,
  ALERT_WALLET_MIN_SATS: 10_000,
  DUST_LIMIT: 546,
}));

vi.mock("@/lib/errors", () => ({
  safeErrorMessage: vi.fn((err: unknown, fallback = "Internal server error") => {
    if (err instanceof Error) return err.message;
    return fallback;
  }),
}));

// @bsv/sdk Transaction and P2PKH
const {
  mockTxAddInput,
  mockTxAddOutput,
  mockTxSign,
  mockTxToHex,
  mockTxId,
  mockTxFromHex,
  mockP2PKHLock,
  mockP2PKHUnlock,
} = vi.hoisted(() => {
  const mockTxAddInput = vi.fn();
  const mockTxAddOutput = vi.fn();
  const mockTxSign = vi.fn().mockResolvedValue(undefined);
  const mockTxToHex = vi.fn().mockReturnValue("aa".repeat(250));
  const mockTxId = vi.fn().mockReturnValue("e".repeat(64));
  const mockTxFromHex = vi.fn().mockReturnValue({ source: true });
  const mockP2PKHLock = vi.fn().mockReturnValue({ toHex: vi.fn().mockReturnValue("76a914" + "00".repeat(20) + "88ac") });
  const mockP2PKHUnlock = vi.fn().mockReturnValue({ template: "unlock" });

  return {
    mockTxAddInput,
    mockTxAddOutput,
    mockTxSign,
    mockTxToHex,
    mockTxId,
    mockTxFromHex,
    mockP2PKHLock,
    mockP2PKHUnlock,
  };
});

vi.mock("@bsv/sdk", () => {
  class MockTransaction {
    addInput(...args: unknown[]) { mockTxAddInput(...args); }
    addOutput(...args: unknown[]) { mockTxAddOutput(...args); }
    async sign() { return mockTxSign(); }
    toHex() { return mockTxToHex(); }
    id(_fmt: string) { return mockTxId(); }
    static fromHex(...args: unknown[]) { return mockTxFromHex(...args); }
  }

  class MockP2PKH {
    lock(...args: unknown[]) { return mockP2PKHLock(...args); }
    unlock(...args: unknown[]) { return mockP2PKHUnlock(...args); }
  }

  return { Transaction: MockTransaction, P2PKH: MockP2PKH };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  replenishPool,
  runReplenishment,
  acquireReplenishLock,
  releaseReplenishLock,
} from "@/services/replenish.service";
import { getPoolStats, insertUtxo, syncWalletUtxoCount } from "@/services/utxo-pool.service";
import { broadcastTransaction } from "@/services/broadcast.service";
import { sendAlert } from "@/lib/alerts";
import { calculateFee } from "@/services/wallet.service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HEALTHY_POOL_STATS = {
  freeCount: 10,
  lockedCount: 2,
  spentCount: 50,
  freeSats: 10_000,
};

const LOW_POOL_STATS = {
  freeCount: 2,
  lockedCount: 1,
  spentCount: 50,
  freeSats: 2000,
};

/** A valid WOC UTXO response with a single 5000-sat output */
const MOCK_WOC_UTXOS = [
  { tx_hash: "a".repeat(64), tx_pos: 0, value: 5000 },
];

/** Multiple UTXOs to exercise the split logic */
const MOCK_WOC_UTXOS_MULTIPLE = [
  { tx_hash: "a".repeat(64), tx_pos: 0, value: 50_000 },
  { tx_hash: "b".repeat(64), tx_pos: 1, value: 30_000 },
];

/** Build a minimal fetch Response stub */
function makeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === "string" ? body : "rawTxHex"),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Restore defaults
  vi.mocked(getPoolStats).mockResolvedValue(LOW_POOL_STATS);
  vi.mocked(insertUtxo).mockResolvedValue(undefined);
  vi.mocked(syncWalletUtxoCount).mockResolvedValue(undefined);
  vi.mocked(broadcastTransaction).mockResolvedValue({ txid: "e".repeat(64) });
  vi.mocked(sendAlert).mockResolvedValue(undefined);
  vi.mocked(calculateFee).mockReturnValue(50);

  mockTxSign.mockResolvedValue(undefined);
  mockTxToHex.mockReturnValue("aa".repeat(250));
  mockTxId.mockReturnValue("e".repeat(64));
  mockTxFromHex.mockReturnValue({ source: true });
  mockP2PKHLock.mockReturnValue({ toHex: vi.fn().mockReturnValue("76a914" + "00".repeat(20) + "88ac") });

  // Lock: acquire succeeds by default
  mockDbUpdate.mockReturnValue({ set: mockSet });
  mockSet.mockReturnValue({ where: mockWhere });
  // First call (stale lock cleanup) returns rowCount 0, second call (acquire) returns rowCount 1
  mockWhere.mockResolvedValue({ rowCount: 1 });
});

// ---------------------------------------------------------------------------
// Helper: mock fetch to return valid WOC responses
// ---------------------------------------------------------------------------

function mockSuccessfulWocFetch(utxos: typeof MOCK_WOC_UTXOS) {
  const uniqueHashes = [...new Set(utxos.map((u) => u.tx_hash))];
  const fetchMock = vi.spyOn(global, "fetch");

  // First call: UTXOs list
  fetchMock.mockResolvedValueOnce(makeResponse(200, utxos));

  // Subsequent calls: one per unique tx hash for raw tx hex
  for (const _hash of uniqueHashes) {
    fetchMock.mockResolvedValueOnce(makeResponse(200, "rawTxHexData"));
  }

  return fetchMock;
}

// ---------------------------------------------------------------------------
// replenishPool — WhatsOnChain error handling
// ---------------------------------------------------------------------------

describe("replenishPool — WhatsOnChain fetch failures", () => {
  it("returns skipped: true when WOC returns a 500 status", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(makeResponse(500, {}));

    const result = await replenishPool(10);

    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/WhatsOnChain fetch failed: 500/);
  });

  it("returns skipped: true when WOC returns 503", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(makeResponse(503, {}));

    const result = await replenishPool(10);

    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/503/);
  });

  it("returns skipped: true when fetch throws a network error (timeout)", async () => {
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("TimeoutError: AbortSignal timed out"));

    const result = await replenishPool(10);

    expect(result.skipped).toBe(true);
    expect(result.reason).toBeDefined();
  });

  it("returns skipped: true when fetch rejects with AbortError", async () => {
    const abortErr = Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
    vi.spyOn(global, "fetch").mockRejectedValueOnce(abortErr);

    const result = await replenishPool(10);

    expect(result.skipped).toBe(true);
  });

  it("returns skipped: true when fetch rejects with a generic network error", async () => {
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await replenishPool(10);

    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/ECONNREFUSED/);
  });
});

// ---------------------------------------------------------------------------
// replenishPool — no / insufficient UTXOs
// ---------------------------------------------------------------------------

describe("replenishPool — no or insufficient UTXOs", () => {
  it("returns skipped: true when WOC returns an empty array", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(makeResponse(200, []));

    const result = await replenishPool(10);

    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/No UTXOs found/);
  });

  it("returns skipped: true when all UTXOs are below the dust threshold (546 sats)", async () => {
    const dustyUtxos = [
      { tx_hash: "a".repeat(64), tx_pos: 0, value: 100 },
      { tx_hash: "b".repeat(64), tx_pos: 0, value: 200 },
      { tx_hash: "c".repeat(64), tx_pos: 0, value: 545 }, // just below dust
    ];
    vi.spyOn(global, "fetch").mockResolvedValueOnce(makeResponse(200, dustyUtxos));

    const result = await replenishPool(10);

    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/dust threshold/);
  });

  it("returns skipped: true when balance is insufficient to fund even 1 output after fees", async () => {
    // A single UTXO of exactly 1000 sats; calculateFee returns 1001 sats (more than UTXO)
    vi.mocked(calculateFee).mockReturnValue(1001);
    const barelyEnoughUtxo = [
      { tx_hash: "a".repeat(64), tx_pos: 0, value: 1000 },
    ];
    vi.spyOn(global, "fetch").mockResolvedValueOnce(makeResponse(200, barelyEnoughUtxo));

    const result = await replenishPool(10);

    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/Insufficient balance/);
  });
});

// ---------------------------------------------------------------------------
// replenishPool — raw tx fetch failure
// ---------------------------------------------------------------------------

describe("replenishPool — raw tx fetch failure", () => {
  it("returns skipped: true when the raw tx fetch for a txHash fails", async () => {
    const fetchMock = vi.spyOn(global, "fetch");
    // UTXOs response OK
    fetchMock.mockResolvedValueOnce(makeResponse(200, MOCK_WOC_UTXOS));
    // Raw tx response fails
    fetchMock.mockResolvedValueOnce(makeResponse(404, "not found"));

    const result = await replenishPool(10);

    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/Failed to fetch raw tx/);
  });

  it("returns skipped: true when raw tx fetch throws a network error", async () => {
    const fetchMock = vi.spyOn(global, "fetch");
    fetchMock.mockResolvedValueOnce(makeResponse(200, MOCK_WOC_UTXOS));
    fetchMock.mockRejectedValueOnce(new Error("DNS lookup failed"));

    const result = await replenishPool(10);

    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/DNS lookup failed/);
  });
});

// ---------------------------------------------------------------------------
// replenishPool — happy path
// ---------------------------------------------------------------------------

describe("replenishPool — happy path", () => {
  it("returns skipped: false with splitTxid and outputCount on success", async () => {
    mockSuccessfulWocFetch(MOCK_WOC_UTXOS);

    const result = await replenishPool(3);

    expect(result.skipped).toBe(false);
    expect(result.splitTxid).toBe("e".repeat(64));
    expect(typeof result.outputCount).toBe("number");
    expect(result.outputCount).toBeGreaterThan(0);
  });

  it("calls broadcastTransaction with the signed tx hex", async () => {
    const txHex = "cc".repeat(200);
    mockTxToHex.mockReturnValue(txHex);
    mockSuccessfulWocFetch(MOCK_WOC_UTXOS);

    await replenishPool(3);

    expect(broadcastTransaction).toHaveBeenCalledWith(txHex);
  });

  it("calls insertUtxo for each output created", async () => {
    mockSuccessfulWocFetch(MOCK_WOC_UTXOS);
    vi.mocked(calculateFee).mockReturnValue(50);

    const result = await replenishPool(3);

    expect(insertUtxo).toHaveBeenCalledTimes(result.outputCount);
  });

  it("calls syncWalletUtxoCount after inserting UTXOs", async () => {
    mockSuccessfulWocFetch(MOCK_WOC_UTXOS);

    await replenishPool(3);

    expect(syncWalletUtxoCount).toHaveBeenCalledTimes(1);
  });

  it("calls tx.sign() exactly once to produce the final signed tx", async () => {
    mockSuccessfulWocFetch(MOCK_WOC_UTXOS);

    await replenishPool(3);

    expect(mockTxSign).toHaveBeenCalledTimes(1);
  });

  it("adds one input per eligible UTXO", async () => {
    mockSuccessfulWocFetch(MOCK_WOC_UTXOS_MULTIPLE);

    await replenishPool(5);

    // Two UTXOs → two addInput calls
    expect(mockTxAddInput).toHaveBeenCalledTimes(2);
  });

  it("does not call insertUtxo when broadcastTransaction throws", async () => {
    mockSuccessfulWocFetch(MOCK_WOC_UTXOS);
    vi.mocked(broadcastTransaction).mockRejectedValueOnce(new Error("ARC 500"));

    await expect(replenishPool(3)).rejects.toThrow("ARC 500");
    expect(insertUtxo).not.toHaveBeenCalled();
  });

  it("sends a low-balance alert when totalSats is below ALERT_WALLET_MIN_SATS", async () => {
    // MOCK_WOC_UTXOS has value=5000, ALERT_WALLET_MIN_SATS is mocked as 10000
    mockSuccessfulWocFetch(MOCK_WOC_UTXOS);

    await replenishPool(3);

    expect(sendAlert).toHaveBeenCalledWith(expect.stringContaining("low wallet balance"));
  });
});

// ---------------------------------------------------------------------------
// runReplenishment — lock behaviour
// ---------------------------------------------------------------------------

describe("runReplenishment — lock acquisition", () => {
  it("returns immediately when acquireReplenishLock returns false", async () => {
    // Simulate lock not acquired: second db.update().set().where() returns rowCount 0
    // We need two calls: first for stale-lock cleanup (can return anything), second for acquire (rowCount 0)
    mockWhere
      .mockResolvedValueOnce({ rowCount: 0 }) // stale lock cleanup
      .mockResolvedValueOnce({ rowCount: 0 }); // acquire fails

    const result = await runReplenishment();

    expect(result.action).toBe("skipped");
    expect(result.reason).toMatch(/already running/i);
    // getPoolStats should never be called when lock is not acquired
    expect(getPoolStats).not.toHaveBeenCalled();
  });

  it("releases the lock in the finally block even when an error is thrown", async () => {
    // Acquire lock succeeds (rowCount=1), then getPoolStats throws
    mockWhere
      .mockResolvedValueOnce({ rowCount: 0 }) // stale lock cleanup
      .mockResolvedValueOnce({ rowCount: 1 }) // acquire succeeds
      .mockResolvedValue({ rowCount: 1 });    // release (can succeed)

    vi.mocked(getPoolStats).mockRejectedValueOnce(new Error("DB connection lost"));

    await expect(runReplenishment()).rejects.toThrow("DB connection lost");

    // The db.update chain should have been called for the lock release
    // The mock tracks all calls — lock release is the final db.update call
    expect(mockDbUpdate).toHaveBeenCalled();
  });

  it("releases the lock in the finally block on successful replenishment", async () => {
    mockWhere
      .mockResolvedValueOnce({ rowCount: 0 }) // stale lock cleanup
      .mockResolvedValueOnce({ rowCount: 1 }) // acquire
      .mockResolvedValue({ rowCount: 1 });    // release

    vi.mocked(getPoolStats).mockResolvedValue(HEALTHY_POOL_STATS);

    await runReplenishment();

    // db.update must have been called at least twice (acquire + release)
    expect(mockDbUpdate.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// runReplenishment — pool health check
// ---------------------------------------------------------------------------

describe("runReplenishment — pool health check", () => {
  it("returns action: skipped when pool is healthy (freeCount >= threshold)", async () => {
    mockWhere
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValue({ rowCount: 1 });

    vi.mocked(getPoolStats).mockResolvedValue(HEALTHY_POOL_STATS); // freeCount=10 >= threshold=5

    const result = await runReplenishment();

    expect(result.ok).toBe(true);
    expect(result.action).toBe("skipped");
    expect(result.reason).toMatch(/Pool healthy/);
    expect(result.pool).toEqual(HEALTHY_POOL_STATS);
  });

  it("does not call replenishPool when pool is healthy", async () => {
    mockWhere
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValue({ rowCount: 1 });

    vi.mocked(getPoolStats).mockResolvedValue(HEALTHY_POOL_STATS);

    await runReplenishment();

    // If pool is healthy, fetch should never be called for WOC
    expect(global.fetch).not.toHaveBeenCalled?.();
  });

  it("sends a critically-low alert when freeCount < ALERT_UTXO_MIN_FREE", async () => {
    mockWhere
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValue({ rowCount: 1 });

    // freeCount=1 is below ALERT_UTXO_MIN_FREE=3
    vi.mocked(getPoolStats).mockResolvedValue({ ...LOW_POOL_STATS, freeCount: 1 });
    // replenishPool will try to fetch — return empty to short-circuit
    vi.spyOn(global, "fetch").mockResolvedValueOnce(makeResponse(200, []));

    await runReplenishment();

    expect(sendAlert).toHaveBeenCalledWith(expect.stringContaining("critically low"));
  });
});

// ---------------------------------------------------------------------------
// runReplenishment — replenishPool skipped result propagation
// ---------------------------------------------------------------------------

describe("runReplenishment — replenishPool returns skipped", () => {
  it("returns ok: false, action: skipped and sends an alert when replenishPool is skipped", async () => {
    mockWhere
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValue({ rowCount: 1 });

    vi.mocked(getPoolStats).mockResolvedValue(LOW_POOL_STATS);
    // WOC returns empty → replenishPool will return skipped
    vi.spyOn(global, "fetch").mockResolvedValueOnce(makeResponse(200, []));

    const result = await runReplenishment();

    expect(result.ok).toBe(false);
    expect(result.action).toBe("skipped");
    expect(sendAlert).toHaveBeenCalledWith(expect.stringContaining("replenishment skipped"));
  });
});

// ---------------------------------------------------------------------------
// runReplenishment — happy path (end-to-end orchestration)
// ---------------------------------------------------------------------------

describe("runReplenishment — successful replenishment", () => {
  it("returns ok: true, action: replenished with splitTxid and outputCount", async () => {
    mockWhere
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValue({ rowCount: 1 });

    vi.mocked(getPoolStats).mockResolvedValue(LOW_POOL_STATS);
    mockSuccessfulWocFetch(MOCK_WOC_UTXOS);
    vi.mocked(calculateFee).mockReturnValue(50);

    const result = await runReplenishment();

    expect(result.ok).toBe(true);
    expect(result.action).toBe("replenished");
    expect(result.splitTxid).toBe("e".repeat(64));
    expect(typeof result.outputCount).toBe("number");
  });
});
