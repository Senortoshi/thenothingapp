/**
 * IRI-2: Unit Tests — Input Validation (Zod schemas)
 *
 * Tests postCommentSchema and getCommentsSchema from src/lib/validators.ts.
 * All tests are pure — no I/O required.
 */

import { describe, it, expect } from "vitest";
import { postCommentSchema, getCommentsSchema } from "@/lib/validators";
import { MAX_COMMENT_LENGTH, MAX_DISPLAY_NAME_LENGTH } from "@/lib/constants";

// ---------------------------------------------------------------------------
// postCommentSchema — commentText field
// ---------------------------------------------------------------------------

describe("postCommentSchema — commentText", () => {
  const valid = (commentText: unknown, extra?: object) =>
    postCommentSchema.safeParse({ commentText, ...extra });

  it("accepts a normal one-line comment", () => {
    const result = valid("Hello, world!");
    expect(result.success).toBe(true);
  });

  it("rejects an empty string", () => {
    const result = valid("");
    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.commentText).toBeDefined();
  });

  it("rejects a whitespace-only string (trim + min(1))", () => {
    const result = valid("   ");
    expect(result.success).toBe(false);
  });

  it("rejects a tab-only string", () => {
    const result = valid("\t\t");
    expect(result.success).toBe(false);
  });

  it("accepts a comment of exactly MAX_COMMENT_LENGTH characters", () => {
    const text = "a".repeat(MAX_COMMENT_LENGTH);
    expect(valid(text).success).toBe(true);
  });

  it("rejects a comment one character over MAX_COMMENT_LENGTH", () => {
    const text = "a".repeat(MAX_COMMENT_LENGTH + 1);
    const result = valid(text);
    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.commentText).toBeDefined();
  });

  it("trims leading/trailing whitespace before applying min(1)", () => {
    // " a " → trimmed to "a" → passes min(1)
    const result = valid("  a  ");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.commentText).toBe("a");
    }
  });

  it("rejects null", () => {
    expect(valid(null).success).toBe(false);
  });

  it("rejects undefined", () => {
    expect(postCommentSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a number", () => {
    expect(valid(42).success).toBe(false);
  });

  it("accepts a multi-line comment", () => {
    expect(valid("Line one\nLine two").success).toBe(true);
  });

  it("accepts emoji characters", () => {
    expect(valid("Hello 🌍").success).toBe(true);
  });

  // XSS payloads — stored raw, validated as text (not sanitised at schema level)
  it("accepts XSS payload as raw text (sanitisation happens at render time)", () => {
    const xss = '<script>alert("xss")</script>';
    const result = valid(xss);
    expect(result.success).toBe(true);
    if (result.success) {
      // Schema must NOT alter the text — it is stored verbatim
      expect(result.data.commentText).toBe(xss);
    }
  });

  it("accepts <img onerror=> XSS payload as raw text", () => {
    const xss = '<img src=x onerror="alert(1)">';
    expect(valid(xss).success).toBe(true);
  });

  it("accepts javascript: URI as raw text", () => {
    const xss = "javascript:alert(1)";
    expect(valid(xss).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// postCommentSchema — displayName field
// ---------------------------------------------------------------------------

describe("postCommentSchema — displayName", () => {
  const valid = (displayName: unknown) =>
    postCommentSchema.safeParse({ commentText: "hello", displayName });

  it("defaults to 'Anonymous' when omitted", () => {
    const result = postCommentSchema.safeParse({ commentText: "hi" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.displayName).toBe("Anonymous");
    }
  });

  it("accepts a typical display name", () => {
    expect(valid("Alice").success).toBe(true);
  });

  it("accepts exactly MAX_DISPLAY_NAME_LENGTH characters", () => {
    expect(valid("a".repeat(MAX_DISPLAY_NAME_LENGTH)).success).toBe(true);
  });

  it("rejects a name one character over MAX_DISPLAY_NAME_LENGTH", () => {
    const result = valid("a".repeat(MAX_DISPLAY_NAME_LENGTH + 1));
    expect(result.success).toBe(false);
  });

  it("trims the display name", () => {
    const result = valid("  Bob  ");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.displayName).toBe("Bob");
    }
  });

  it("treats empty string as falsy — Zod uses default only when undefined/null, so empty string stays as empty", () => {
    // .optional().default('Anonymous') kicks in only when the field is undefined.
    // An explicit "" passes trim() but is 0 chars — no min constraint on displayName.
    const result = valid("");
    // displayName has no min(1), so empty string is valid
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.displayName).toBe(""); // trimmed empty stays ""
    }
  });
});

// ---------------------------------------------------------------------------
// postCommentSchema — parentTxid field
// ---------------------------------------------------------------------------

describe("postCommentSchema — parentTxid", () => {
  const valid = (parentTxid: unknown) =>
    postCommentSchema.safeParse({ commentText: "hello", parentTxid });

  it("is optional — omitting it succeeds", () => {
    expect(postCommentSchema.safeParse({ commentText: "hi" }).success).toBe(true);
  });

  it("accepts a valid 64-char lowercase hex txid", () => {
    expect(valid("a".repeat(64)).success).toBe(true);
  });

  it("accepts a valid 64-char uppercase hex txid", () => {
    expect(valid("A".repeat(64)).success).toBe(true);
  });

  it("accepts a mixed-case txid", () => {
    expect(valid("aAbBcCdDeEfF0123456789" + "a".repeat(42)).success).toBe(true);
  });

  it("rejects a 63-character txid (too short)", () => {
    expect(valid("a".repeat(63)).success).toBe(false);
  });

  it("rejects a 65-character txid (too long)", () => {
    expect(valid("a".repeat(65)).success).toBe(false);
  });

  it("rejects a txid with non-hex characters", () => {
    expect(valid("g".repeat(64)).success).toBe(false);
  });

  it("rejects a txid with spaces", () => {
    expect(valid("a".repeat(32) + " " + "a".repeat(31)).success).toBe(false);
  });

  it("rejects null (treated as absent but null !== undefined → coerce fails)", () => {
    // null is not undefined, so .optional() does not kick in — Zod rejects it
    expect(valid(null).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getCommentsSchema — pagination parameters
// ---------------------------------------------------------------------------

describe("getCommentsSchema", () => {
  it("accepts empty params, defaulting pageSize to 20", () => {
    const result = getCommentsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pageSize).toBe(20);
    }
  });

  it("accepts pageSize=1 (minimum)", () => {
    expect(getCommentsSchema.safeParse({ pageSize: 1 }).success).toBe(true);
  });

  it("accepts pageSize=50 (maximum)", () => {
    expect(getCommentsSchema.safeParse({ pageSize: 50 }).success).toBe(true);
  });

  it("rejects pageSize=0 (below minimum)", () => {
    expect(getCommentsSchema.safeParse({ pageSize: 0 }).success).toBe(false);
  });

  it("rejects pageSize=51 (above maximum)", () => {
    expect(getCommentsSchema.safeParse({ pageSize: 51 }).success).toBe(false);
  });

  it("coerces string pageSize to number", () => {
    const result = getCommentsSchema.safeParse({ pageSize: "10" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pageSize).toBe(10);
    }
  });

  it("rejects a non-integer pageSize", () => {
    expect(getCommentsSchema.safeParse({ pageSize: 3.5 }).success).toBe(false);
  });

  it("accepts a valid cursorOffset", () => {
    const result = getCommentsSchema.safeParse({ cursorOffset: 20 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cursorOffset).toBe(20);
    }
  });

  it("accepts cursorOffset=0", () => {
    expect(getCommentsSchema.safeParse({ cursorOffset: 0 }).success).toBe(true);
  });

  it("rejects a negative cursorOffset", () => {
    expect(getCommentsSchema.safeParse({ cursorOffset: -1 }).success).toBe(false);
  });

  it("coerces string cursorOffset to number", () => {
    const result = getCommentsSchema.safeParse({ cursorOffset: "40" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cursorOffset).toBe(40);
    }
  });
});
