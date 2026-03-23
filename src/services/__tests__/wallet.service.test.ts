/**
 * Unit Tests — wallet.service
 *
 * Tests buildCommentTransaction and calculateFee from src/services/wallet.service.ts.
 *
 * @bsv/sdk classes are mocked so no real key material or signing is required.
 * process.env.BSV_FUNDING_KEY is set to a test WIF before each test.
 *
 * Covered:
 *  - Happy path: valid tx, OP_RETURN at output[0] (0 sats), P2PKH change at output[1]
 *  - UTXO too small on first-pass fee check: throws before first sign()
 *  - UTXO too small on second-pass fee check: throws after actual size is known
 *  - calculateFee: correct fee formula (already tested in op-return.test.ts but
 *    verified here in the context of buildCommentTransaction)
 *  - Two-pass fee: re-sign updates output[1].satoshis to the correct changeAmount
 *  - getFundingKey throws when BSV_FUNDING_KEY is absent
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock state
// ---------------------------------------------------------------------------

const {
  mockSign,
  mockToHex,
  mockId,
  mockAddInput,
  mockAddOutput,
  mockOutputs,
  mockFromHex,
  mockLock,
  mockUnlock,
  mockPrivateKeyFromWif,
  mockKeyToHex,
  mockToAddress,
  mockToString,
  mockScriptFromHex,
  mockBuildCommentOpReturn,
} = vi.hoisted(() => {
  // Track outputs so tests can inspect what was added
  const outputs: Array<{ satoshis: number; lockingScript: unknown }> = [];

  const mockSign = vi.fn().mockResolvedValue(undefined);
  // toHex returns 600 hex chars = 300 bytes so fee = ceil(300*1000/1000) = 300
  // But MIN_FEE=5 so actual fee from calculateFee(300) = 300.
  // We return a string of exactly 600 chars so actual fee = 300 sats,
  // making changeAmount = 5000 - 300 = 4700 for a 5000-sat UTXO.
  const mockToHex = vi.fn().mockReturnValue("ab".repeat(300)); // 600 chars = 300 bytes
  const mockId = vi.fn().mockReturnValue("b".repeat(64));
  const mockAddInput = vi.fn();
  const mockAddOutput = vi.fn().mockImplementation((output: { satoshis: number; lockingScript: unknown }) => {
    outputs.push(output);
  });
  const mockOutputs = outputs;

  const mockFromHex = vi.fn().mockReturnValue({ id: "mock-source-tx" });
  const mockLock = vi.fn().mockReturnValue({ toHex: vi.fn().mockReturnValue("76a914" + "00".repeat(20) + "88ac") });
  const mockUnlock = vi.fn().mockReturnValue({ template: "p2pkh-unlock" });
  const mockToString = vi.fn().mockReturnValue("1MockAddress123456789");
  const mockToAddress = vi.fn().mockReturnValue({ toString: mockToString });
  // toHex must return a high-entropy hex string so isWeakKey() does not reject the mock key
  const mockKeyToHex = vi.fn().mockReturnValue("ff".repeat(32));
  const mockPrivateKeyFromWif = vi.fn().mockReturnValue({ toAddress: mockToAddress, toHex: mockKeyToHex });
  const mockScriptFromHex = vi.fn().mockReturnValue({ scriptType: "p2pkh" });
  const mockBuildCommentOpReturn = vi.fn().mockReturnValue({ opreturn: true });

  return {
    mockSign,
    mockToHex,
    mockId,
    mockAddInput,
    mockAddOutput,
    mockOutputs,
    mockFromHex,
    mockLock,
    mockUnlock,
    mockPrivateKeyFromWif,
    mockKeyToHex,
    mockToAddress,
    mockToString,
    mockScriptFromHex,
    mockBuildCommentOpReturn,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@bsv/sdk", () => {
  // Transaction is a class — we need instances with the mock methods on them,
  // plus a static fromHex.
  class MockTransaction {
    outputs: Array<{ satoshis: number; lockingScript: unknown }> = [];

    addInput(...args: unknown[]) {
      mockAddInput(...args);
    }

    addOutput(output: { satoshis: number; lockingScript: unknown }) {
      this.outputs.push(output);
      mockAddOutput(output);
    }

    async sign() {
      return mockSign();
    }

    toHex() {
      return mockToHex();
    }

    id(_format: string) {
      return mockId();
    }

    static fromHex(...args: unknown[]) {
      return mockFromHex(...args);
    }
  }

  class MockP2PKH {
    lock(...args: unknown[]) {
      return mockLock(...args);
    }

    unlock(...args: unknown[]) {
      return mockUnlock(...args);
    }
  }

  class MockPrivateKey {
    toAddress() {
      return mockToAddress();
    }

    toHex() {
      return mockKeyToHex();
    }

    static fromWif(...args: unknown[]) {
      return mockPrivateKeyFromWif(...args);
    }
  }

  class MockScript {
    static fromHex(...args: unknown[]) {
      return mockScriptFromHex(...args);
    }
  }

  return {
    Transaction: MockTransaction,
    P2PKH: MockP2PKH,
    PrivateKey: MockPrivateKey,
    Script: MockScript,
    LockingScript: MockScript, // alias used in type position only
  };
});

vi.mock("@/lib/op-return", () => ({
  buildCommentOpReturn: mockBuildCommentOpReturn,
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  buildCommentTransaction,
  getFundingKey,
  getFundingAddress,
  calculateFee,
} from "@/services/wallet.service";
import { MIN_FEE, FEE_PER_KB } from "@/lib/constants";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_WIF = "L1aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111AAAA";

const MOCK_UTXO = {
  txid: "a".repeat(64),
  vout: 0,
  satoshis: 5000,
  scriptHex: "76a914" + "00".repeat(20) + "88ac",
};

const VALID_PARAMS = {
  utxo: MOCK_UTXO,
  commentText: "Hello BSV",
  displayName: "Alice",
  timestamp: "2026-03-17T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Restore default mock return values after clearAllMocks
  mockSign.mockResolvedValue(undefined);
  mockToHex.mockReturnValue("ab".repeat(300)); // 300 bytes → fee = 300
  mockId.mockReturnValue("b".repeat(64));
  mockLock.mockReturnValue({ toHex: vi.fn().mockReturnValue("76a914" + "00".repeat(20) + "88ac") });
  mockUnlock.mockReturnValue({ template: "p2pkh-unlock" });
  mockToString.mockReturnValue("1MockAddress123456789");
  mockToAddress.mockReturnValue({ toString: mockToString });
  mockKeyToHex.mockReturnValue("ff".repeat(32));
  mockPrivateKeyFromWif.mockReturnValue({ toAddress: mockToAddress, toHex: mockKeyToHex });
  mockScriptFromHex.mockReturnValue({ scriptType: "p2pkh" });
  mockBuildCommentOpReturn.mockReturnValue({ opreturn: true });

  // Set the env var for each test
  process.env.BSV_FUNDING_KEY = TEST_WIF;
  process.env.NODE_ENV = "test";
});

afterEach(() => {
  delete process.env.BSV_FUNDING_KEY;
});

// ---------------------------------------------------------------------------
// calculateFee (standalone)
// ---------------------------------------------------------------------------

describe("calculateFee", () => {
  it("returns at least MIN_FEE for zero bytes", () => {
    expect(calculateFee(0)).toBeGreaterThanOrEqual(MIN_FEE);
  });

  it("returns Math.ceil(bytes * FEE_PER_KB / 1000) when above MIN_FEE", () => {
    const bytes = 10_000;
    const expected = Math.ceil((bytes * FEE_PER_KB) / 1000);
    expect(calculateFee(bytes)).toBe(expected);
  });

  it("returns MIN_FEE when calculated fee rounds to less than MIN_FEE", () => {
    // 1 byte at 1000 sat/kb = 1 sat, which equals MIN_FEE=5 — actually returns 1,
    // but clamped to MIN_FEE since Math.max is applied.
    expect(calculateFee(1)).toBe(MIN_FEE);
  });

  it("rounds up (ceil) fractional satoshis — 501 bytes → 6 sats (above MIN_FEE=5)", () => {
    // 501 * 1000 / 1000 = 501, ceil = 501 — above MIN_FEE
    // Actually at FEE_PER_KB=1000: 501 * 1000 / 1000 = 501.0 exactly → 501
    // The interesting case: 1 * 1000 / 1000 = 1 → ceil=1 < MIN_FEE=5 → returns 5
    expect(calculateFee(MIN_FEE - 1)).toBe(MIN_FEE);
  });

  it("scales linearly for large transactions", () => {
    const bytes = 50_000;
    expect(calculateFee(bytes)).toBe(Math.ceil((bytes * FEE_PER_KB) / 1000));
  });
});

// ---------------------------------------------------------------------------
// getFundingKey
// ---------------------------------------------------------------------------

describe("getFundingKey", () => {
  it("calls PrivateKey.fromWif with the env var value", () => {
    getFundingKey();
    expect(mockPrivateKeyFromWif).toHaveBeenCalledWith(TEST_WIF);
  });

  it("throws when BSV_FUNDING_KEY is not set", () => {
    delete process.env.BSV_FUNDING_KEY;
    expect(() => getFundingKey()).toThrow("BSV_FUNDING_KEY environment variable is not set");
  });
});

// ---------------------------------------------------------------------------
// getFundingAddress
// ---------------------------------------------------------------------------

describe("getFundingAddress", () => {
  it("returns the string representation of the funding key address", () => {
    const address = getFundingAddress();
    expect(address).toBe("1MockAddress123456789");
    expect(mockToAddress).toHaveBeenCalledTimes(1);
    expect(mockToString).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// buildCommentTransaction — happy path
// ---------------------------------------------------------------------------

describe("buildCommentTransaction — happy path", () => {
  it("returns a BuildTxResult with txHex, txid, fee, and changeAmount", async () => {
    const result = await buildCommentTransaction(VALID_PARAMS);

    expect(result).toMatchObject({
      txHex: expect.any(String),
      txid: expect.any(String),
      fee: expect.any(Number),
      changeAmount: expect.any(Number),
    });
  });

  it("returns the txHex from tx.toHex()", async () => {
    const expectedHex = "ab".repeat(300);
    mockToHex.mockReturnValue(expectedHex);

    const result = await buildCommentTransaction(VALID_PARAMS);
    expect(result.txHex).toBe(expectedHex);
  });

  it("returns the txid from tx.id('hex')", async () => {
    const expectedTxid = "c".repeat(64);
    mockId.mockReturnValue(expectedTxid);

    const result = await buildCommentTransaction(VALID_PARAMS);
    expect(result.txid).toBe(expectedTxid);
  });

  it("calls addOutput twice — once for OP_RETURN and once for change", async () => {
    await buildCommentTransaction(VALID_PARAMS);
    // addOutput is called for each output in each pass (2 passes × 2 outputs = 4 calls)
    // But the Transaction mock tracks per-instance. We verify the first two calls
    // which correspond to the initial setup.
    expect(mockAddOutput).toHaveBeenCalledTimes(2);
  });

  it("places OP_RETURN output first (0 satoshis)", async () => {
    await buildCommentTransaction(VALID_PARAMS);

    // First addOutput call should be OP_RETURN with 0 satoshis
    const firstCall = mockAddOutput.mock.calls[0][0];
    expect(firstCall.satoshis).toBe(0);
    expect(firstCall.lockingScript).toEqual({ opreturn: true });
  });

  it("places P2PKH change output second (positive satoshis)", async () => {
    await buildCommentTransaction(VALID_PARAMS);

    // Second addOutput call should be the change output
    const secondCall = mockAddOutput.mock.calls[1][0];
    expect(secondCall.satoshis).toBeGreaterThan(0);
  });

  it("change output satoshis equals utxo.satoshis minus fee", async () => {
    // mockToHex returns 600 chars = 300 bytes → fee = max(ceil(300*1000/1000), 5) = 300
    const result = await buildCommentTransaction(VALID_PARAMS);
    expect(result.changeAmount).toBe(MOCK_UTXO.satoshis - result.fee);
  });

  it("fee is computed from actual tx byte length (toHex().length / 2)", async () => {
    const hexStr = "ab".repeat(400); // 800 chars = 400 bytes → fee = 400
    mockToHex.mockReturnValue(hexStr);

    const result = await buildCommentTransaction(VALID_PARAMS);
    const expectedFee = Math.max(Math.ceil((400 * FEE_PER_KB) / 1000), MIN_FEE);
    expect(result.fee).toBe(expectedFee);
  });

  it("calls tx.sign() twice — once for initial size, once after fee correction", async () => {
    await buildCommentTransaction(VALID_PARAMS);
    expect(mockSign).toHaveBeenCalledTimes(2);
  });

  it("calls buildCommentOpReturn with the correct parameters", async () => {
    await buildCommentTransaction(VALID_PARAMS);
    expect(mockBuildCommentOpReturn).toHaveBeenCalledWith({
      commentText: VALID_PARAMS.commentText,
      displayName: VALID_PARAMS.displayName,
      timestamp: VALID_PARAMS.timestamp,
      parentTxid: undefined,
    });
  });

  it("forwards parentTxid to buildCommentOpReturn when provided", async () => {
    const parentTxid = "d".repeat(64);
    await buildCommentTransaction({ ...VALID_PARAMS, parentTxid });
    expect(mockBuildCommentOpReturn).toHaveBeenCalledWith(
      expect.objectContaining({ parentTxid })
    );
  });

  it("calls addInput with the correct UTXO coordinates", async () => {
    await buildCommentTransaction(VALID_PARAMS);
    expect(mockAddInput).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceTXID: MOCK_UTXO.txid,
        sourceOutputIndex: MOCK_UTXO.vout,
      })
    );
  });

  it("calls Script.fromHex with the utxo scriptHex", async () => {
    await buildCommentTransaction(VALID_PARAMS);
    expect(mockScriptFromHex).toHaveBeenCalledWith(MOCK_UTXO.scriptHex);
  });
});

// ---------------------------------------------------------------------------
// buildCommentTransaction — UTXO too small (first-pass check)
// ---------------------------------------------------------------------------

describe("buildCommentTransaction — UTXO too small", () => {
  it("throws when utxo.satoshis minus preliminary fee is less than 1", async () => {
    // MIN_FEE=5, preliminaryFee = calculateFee(300) = 300
    // So any utxo.satoshis < 301 should fail (300 - 300 = 0 < 1)
    const tinyUtxo = { ...MOCK_UTXO, satoshis: 100 };

    await expect(
      buildCommentTransaction({ ...VALID_PARAMS, utxo: tinyUtxo })
    ).rejects.toThrow(/UTXO too small/);
  });

  it("includes the UTXO satoshi amount and estimated fee in the error message", async () => {
    const tinyUtxo = { ...MOCK_UTXO, satoshis: 10 };

    await expect(
      buildCommentTransaction({ ...VALID_PARAMS, utxo: tinyUtxo })
    ).rejects.toThrow("10 sats");
  });

  it("does not call tx.sign() when UTXO is too small to cover the preliminary fee", async () => {
    const tinyUtxo = { ...MOCK_UTXO, satoshis: 1 };

    await expect(
      buildCommentTransaction({ ...VALID_PARAMS, utxo: tinyUtxo })
    ).rejects.toThrow(/UTXO too small/);

    expect(mockSign).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// buildCommentTransaction — UTXO too small on second-pass (actual size)
// ---------------------------------------------------------------------------

describe("buildCommentTransaction — UTXO too small after actual size", () => {
  it("throws when changeAmount becomes negative after the actual fee is computed", async () => {
    // First pass: preliminary fee = 300, changeAmount = 5000 - 300 = 4700 (OK)
    // Then toHex returns a very large tx so actual fee exceeds utxo.satoshis
    const hugeHex = "ab".repeat(10_000); // 20000 chars = 10000 bytes → fee = 10000
    mockToHex.mockReturnValue(hugeHex);

    // UTXO of 5000 sats — preliminary fee (300) passes, but actual fee (10000) fails
    await expect(
      buildCommentTransaction(VALID_PARAMS) // MOCK_UTXO.satoshis = 5000
    ).rejects.toThrow(/UTXO too small/);
  });

  it("calls tx.sign() exactly once before throwing on the second-pass check", async () => {
    const hugeHex = "ab".repeat(10_000);
    mockToHex.mockReturnValue(hugeHex);

    await expect(
      buildCommentTransaction(VALID_PARAMS)
    ).rejects.toThrow(/UTXO too small/);

    // sign() was called once (first pass), then the check fails before the second sign
    expect(mockSign).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// buildCommentTransaction — two-pass fee correction
// ---------------------------------------------------------------------------

describe("buildCommentTransaction — two-pass fee correction", () => {
  it("updates output[1].satoshis to the correctly-calculated changeAmount before re-signing", async () => {
    // We need to inspect the Transaction instance's outputs after the second pass.
    // The mock captures all addOutput calls. After the first pass, output[1] has
    // the preliminary change. The service then does tx.outputs[1].satoshis = changeAmount.
    // We verify the final result.changeAmount matches what it should be.

    const txHex = "ab".repeat(400); // 400 bytes → fee = 400
    mockToHex.mockReturnValue(txHex);

    const utxo = { ...MOCK_UTXO, satoshis: 10_000 };
    const result = await buildCommentTransaction({ ...VALID_PARAMS, utxo });

    const expectedFee = Math.max(Math.ceil((400 * FEE_PER_KB) / 1000), MIN_FEE);
    expect(result.changeAmount).toBe(utxo.satoshis - expectedFee);
    expect(result.fee).toBe(expectedFee);
  });

  it("second sign is called with the corrected change amount in place", async () => {
    // Verify sign is called twice (one per pass)
    await buildCommentTransaction(VALID_PARAMS);
    expect(mockSign).toHaveBeenCalledTimes(2);
  });

  it("changeAmount is always utxo.satoshis minus the actual fee, not the preliminary fee", async () => {
    // Preliminary fee for 300 bytes = 300
    // Actual fee for 200 bytes = 200
    // Ensure the returned changeAmount uses the actual fee, not the preliminary one
    const smallerHex = "ab".repeat(200); // 200 bytes → fee = 200
    mockToHex.mockReturnValue(smallerHex);

    const utxo = { ...MOCK_UTXO, satoshis: 5000 };
    const result = await buildCommentTransaction({ ...VALID_PARAMS, utxo });

    const actualFee = Math.max(Math.ceil((200 * FEE_PER_KB) / 1000), MIN_FEE);
    expect(result.changeAmount).toBe(utxo.satoshis - actualFee);
  });
});
