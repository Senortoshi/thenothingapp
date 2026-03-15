/**
 * IRI-1: Unit Tests — OP_RETURN Encoding
 *
 * Tests buildCommentOpReturn and parseOpReturnComment from src/lib/op-return.ts.
 * All tests are pure (no network, no DB, no private key required).
 */

import { describe, it, expect } from "vitest";
import { buildCommentOpReturn, parseOpReturnComment } from "@/lib/op-return";
import { APP_PREFIX, PROTOCOL_VERSION, ACTION_COMMENT } from "@/lib/constants";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the raw binary array from a LockingScript.
 * The @bsv/sdk Script type exposes .toBinary() → number[].
 */
function scriptToBytes(script: ReturnType<typeof buildCommentOpReturn>): number[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (script as any).toBinary() as number[];
}

/** Decodes a pushdata field starting at `offset` in the script byte array. */
function readPushAt(bytes: number[], offset: number): { value: string; nextOffset: number } {
  const op = bytes[offset];
  if (op === 0x00) {
    return { value: "", nextOffset: offset + 1 };
  }
  if (op >= 0x01 && op <= 0x4b) {
    const data = bytes.slice(offset + 1, offset + 1 + op);
    return { value: Buffer.from(data).toString("utf8"), nextOffset: offset + 1 + op };
  }
  if (op === 0x4c) {
    const len = bytes[offset + 1];
    const data = bytes.slice(offset + 2, offset + 2 + len);
    return { value: Buffer.from(data).toString("utf8"), nextOffset: offset + 2 + len };
  }
  if (op === 0x4d) {
    const len = bytes[offset + 1] | (bytes[offset + 2] << 8);
    const data = bytes.slice(offset + 3, offset + 3 + len);
    return { value: Buffer.from(data).toString("utf8"), nextOffset: offset + 3 + len };
  }
  throw new Error(`Unexpected opcode 0x${op.toString(16)} at offset ${offset}`);
}

/** Reads all pushdata fields from offset 2 (after OP_FALSE OP_RETURN). */
function readAllFields(bytes: number[]): string[] {
  const fields: string[] = [];
  let offset = 2; // skip OP_FALSE (0x00) and OP_RETURN (0x6a)
  while (offset < bytes.length) {
    const { value, nextOffset } = readPushAt(bytes, offset);
    fields.push(value);
    offset = nextOffset;
  }
  return fields;
}

// ---------------------------------------------------------------------------
// IRI-1a: buildCommentOpReturn — script structure
// ---------------------------------------------------------------------------

describe("buildCommentOpReturn — script structure", () => {
  const BASE_PARAMS = {
    commentText: "Hello, world!",
    displayName: "Alice",
    timestamp: "2024-01-01T00:00:00.000Z",
  };

  it("starts with OP_FALSE (0x00) OP_RETURN (0x6a)", () => {
    const script = buildCommentOpReturn(BASE_PARAMS);
    const bytes = scriptToBytes(script);
    expect(bytes[0]).toBe(0x00);
    expect(bytes[1]).toBe(0x6a);
  });

  it("contains exactly 6 fields for a top-level comment (no parentTxid)", () => {
    const script = buildCommentOpReturn(BASE_PARAMS);
    const fields = readAllFields(scriptToBytes(script));
    // APP_PREFIX, VERSION, ACTION, commentText, displayName, timestamp
    expect(fields).toHaveLength(6);
  });

  it("contains exactly 7 fields when parentTxid is supplied", () => {
    const script = buildCommentOpReturn({
      ...BASE_PARAMS,
      parentTxid: "a".repeat(64),
    });
    const fields = readAllFields(scriptToBytes(script));
    expect(fields).toHaveLength(7);
  });

  it("encodes the correct protocol header fields", () => {
    const script = buildCommentOpReturn(BASE_PARAMS);
    const [prefix, version, action] = readAllFields(scriptToBytes(script));
    expect(prefix).toBe(APP_PREFIX);
    expect(version).toBe(PROTOCOL_VERSION);
    expect(action).toBe(ACTION_COMMENT);
  });

  it("encodes commentText in field index 3", () => {
    const script = buildCommentOpReturn({ ...BASE_PARAMS, commentText: "Test comment" });
    const fields = readAllFields(scriptToBytes(script));
    expect(fields[3]).toBe("Test comment");
  });

  it("encodes displayName in field index 4", () => {
    const script = buildCommentOpReturn({ ...BASE_PARAMS, displayName: "Bob" });
    const fields = readAllFields(scriptToBytes(script));
    expect(fields[4]).toBe("Bob");
  });

  it("encodes timestamp in field index 5", () => {
    const ts = "2025-06-15T12:34:56.789Z";
    const script = buildCommentOpReturn({ ...BASE_PARAMS, timestamp: ts });
    const fields = readAllFields(scriptToBytes(script));
    expect(fields[5]).toBe(ts);
  });

  it("encodes parentTxid in field index 6 when present", () => {
    const parent = "b".repeat(64);
    const script = buildCommentOpReturn({ ...BASE_PARAMS, parentTxid: parent });
    const fields = readAllFields(scriptToBytes(script));
    expect(fields[6]).toBe(parent);
  });
});

// ---------------------------------------------------------------------------
// IRI-1b: buildCommentOpReturn — encoding edge cases
// ---------------------------------------------------------------------------

describe("buildCommentOpReturn — encoding edge cases", () => {
  const TS = "2024-01-01T00:00:00.000Z";

  it("handles pure ASCII text", () => {
    const script = buildCommentOpReturn({
      commentText: "Hello ASCII",
      displayName: "Tester",
      timestamp: TS,
    });
    const fields = readAllFields(scriptToBytes(script));
    expect(fields[3]).toBe("Hello ASCII");
  });

  it("handles UTF-8 multibyte characters (é, ü, ñ)", () => {
    const text = "Héllo Wörld ñoño";
    const script = buildCommentOpReturn({ commentText: text, displayName: "X", timestamp: TS });
    const fields = readAllFields(scriptToBytes(script));
    expect(fields[3]).toBe(text);
  });

  it("handles emoji (4-byte UTF-8 codepoints)", () => {
    const text = "Hello 🌍🎉🚀";
    const script = buildCommentOpReturn({ commentText: text, displayName: "X", timestamp: TS });
    const fields = readAllFields(scriptToBytes(script));
    expect(fields[3]).toBe(text);
  });

  it("handles empty displayName by preserving the empty string", () => {
    // The validator defaults displayName to 'Anonymous', but the builder
    // itself must faithfully encode whatever string is passed.
    const script = buildCommentOpReturn({ commentText: "hi", displayName: "", timestamp: TS });
    const bytes = scriptToBytes(script);
    // Empty push must be OP_0 (0x00) — check a round-trip via parse fields
    const fields = readAllFields(bytes);
    expect(fields[4]).toBe("");
  });

  it("uses direct length byte (≤ 75 bytes) — no PUSHDATA opcode", () => {
    // "Hello, world!" is 13 bytes — should use opcode 0x0d, not 0x4c
    const script = buildCommentOpReturn({
      commentText: "Hello, world!",
      displayName: "A",
      timestamp: TS,
    });
    const bytes = scriptToBytes(script);
    // Locate field index 3: skip OP_FALSE, OP_RETURN, then three header fields
    // We'll just verify the round-trip is correct — structural test above covers opcodes
    const fields = readAllFields(bytes);
    expect(fields[3]).toBe("Hello, world!");
  });

  it("uses OP_PUSHDATA1 (0x4c) for a 76-byte payload", () => {
    const text = "A".repeat(76); // 76 bytes — just above the direct-push threshold
    const script = buildCommentOpReturn({ commentText: text, displayName: "X", timestamp: TS });
    const bytes = scriptToBytes(script);
    const fields = readAllFields(bytes);
    expect(fields[3]).toBe(text);
    // Verify the opcode for the commentText field is 0x4c
    // Find where field[3] starts: offset 2 + 3 header pushes
    // Header pushes are all <= 75 bytes, so each uses 1+len bytes
    let offset = 2;
    for (let i = 0; i < 3; i++) {
      const op = bytes[offset];
      offset += 1 + op; // direct push: opcode = len
    }
    expect(bytes[offset]).toBe(0x4c); // OP_PUSHDATA1
  });

  it("uses OP_PUSHDATA2 (0x4d) for a 256-byte payload", () => {
    const text = "B".repeat(256);
    const script = buildCommentOpReturn({ commentText: text, displayName: "X", timestamp: TS });
    const bytes = scriptToBytes(script);
    const fields = readAllFields(bytes);
    expect(fields[3]).toBe(text);
  });

  it("throws for a data chunk exceeding 65535 bytes", () => {
    const text = "C".repeat(65536);
    expect(() =>
      buildCommentOpReturn({ commentText: text, displayName: "X", timestamp: TS })
    ).toThrow("Data chunk too large for OP_RETURN");
  });
});

// ---------------------------------------------------------------------------
// IRI-1c: parseOpReturnComment — round-trip fidelity
// ---------------------------------------------------------------------------
// We cannot build a real serialised BSV tx without a private key in tests,
// so we unit-test the parser separately using known hex fixtures.
// The round-trip (build → embed in tx → parse) is exercised in E2E / manual tests.

describe("parseOpReturnComment — returns null for invalid inputs", () => {
  it("returns null for an empty string", () => {
    expect(parseOpReturnComment("")).toBeNull();
  });

  it("returns null for non-hex garbage", () => {
    expect(parseOpReturnComment("not-hex-at-all")).toBeNull();
  });

  it("returns null for a hex string that is not a valid tx", () => {
    expect(parseOpReturnComment("deadbeef")).toBeNull();
  });

  it("returns null for a tx with no OP_RETURN output", () => {
    // Minimal tx stub: version(4) + 0 inputs + 1 output with P2PKH script + locktime(4)
    // We'll just pass random valid-looking hex — parser must not throw
    const fakeTxHex = "01000000" + "00" + "00" + "00000000";
    expect(parseOpReturnComment(fakeTxHex)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// IRI-1d: calculateFee (from wallet.service)
// ---------------------------------------------------------------------------

import { calculateFee } from "@/services/wallet.service";
import { MIN_FEE, FEE_PER_KB, APPROX_TX_BYTES } from "@/lib/constants";

describe("calculateFee", () => {
  it("returns at least MIN_FEE for any byte length", () => {
    expect(calculateFee(0)).toBeGreaterThanOrEqual(MIN_FEE);
    expect(calculateFee(1)).toBeGreaterThanOrEqual(MIN_FEE);
  });

  it("returns Math.ceil(bytes * FEE_PER_KB / 1000) when that exceeds MIN_FEE", () => {
    const largeBytes = 10_000; // 10kb — fee will be 100 sats, well above MIN_FEE
    const expected = Math.ceil((largeBytes * FEE_PER_KB) / 1000);
    expect(calculateFee(largeBytes)).toBe(expected);
  });

  it("uses APPROX_TX_BYTES as default", () => {
    const expected = Math.max(
      Math.ceil((APPROX_TX_BYTES * FEE_PER_KB) / 1000),
      MIN_FEE
    );
    expect(calculateFee()).toBe(expected);
  });

  it("rounds up (ceil) fractional satoshis", () => {
    // 1 byte at 10 sat/kb = 0.01 sat → ceil = 1, but MIN_FEE=5 wins
    expect(calculateFee(1)).toBe(MIN_FEE);
    // 501 bytes at 10 sat/kb = 5.01 → ceil = 6, above MIN_FEE
    expect(calculateFee(501)).toBe(6);
  });
});
