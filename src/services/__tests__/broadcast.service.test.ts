/**
 * Unit tests for src/services/broadcast.service.ts
 *
 * Covers the TAAL → GorillaPool fallback strategy in broadcastTransaction:
 *   - TAAL succeeds → return txid, GorillaPool never called
 *   - TAAL 5xx → fallback to GorillaPool, GorillaPool succeeds → return txid
 *   - TAAL 4xx → throw immediately, no fallback
 *   - Both TAAL and GorillaPool fail → throw GorillaPool's error
 *
 * fetch is mocked via vi.spyOn(global, "fetch") so no network calls are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ARC_URL, GORILLAPOOL_ARC_URL } from "@/lib/constants";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal fetch Response stub. */
function makeResponse(status: number, body: object): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const FAKE_TXID = "a".repeat(64);
const TX_HEX = "deadbeef";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("broadcastTransaction", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn<typeof globalThis, "fetch">>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
    vi.resetModules();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns the txid when TAAL succeeds (2xx)", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeResponse(200, { txid: FAKE_TXID, txStatus: "SEEN_ON_NETWORK" })
    );

    const { broadcastTransaction } = await import("@/services/broadcast.service");
    const result = await broadcastTransaction(TX_HEX);

    expect(result.txid).toBe(FAKE_TXID);
    expect(result.txStatus).toBe("SEEN_ON_NETWORK");

    // GorillaPool must not have been contacted
    const calls = fetchSpy.mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(ARC_URL);
  });

  it("falls back to GorillaPool when TAAL returns 5xx, and returns GorillaPool txid", async () => {
    // First call → TAAL 503
    fetchSpy.mockResolvedValueOnce(
      makeResponse(503, { detail: "Service Unavailable" })
    );
    // Second call → GorillaPool 200
    fetchSpy.mockResolvedValueOnce(
      makeResponse(200, { txid: FAKE_TXID })
    );

    const { broadcastTransaction } = await import("@/services/broadcast.service");
    const result = await broadcastTransaction(TX_HEX);

    expect(result.txid).toBe(FAKE_TXID);

    const calls = fetchSpy.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toBe(ARC_URL);
    expect(calls[1][0]).toBe(GORILLAPOOL_ARC_URL);
  });

  it("falls back to GorillaPool when TAAL throws a network error (fetch rejects)", async () => {
    // Simulate a DNS/timeout failure — fetch itself throws
    fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    fetchSpy.mockResolvedValueOnce(
      makeResponse(200, { txid: FAKE_TXID })
    );

    const { broadcastTransaction } = await import("@/services/broadcast.service");
    const result = await broadcastTransaction(TX_HEX);

    expect(result.txid).toBe(FAKE_TXID);
    expect(fetchSpy.mock.calls).toHaveLength(2);
  });

  it("throws immediately on TAAL 4xx without calling GorillaPool", async () => {
    // 400 Bad Request — tx-level rejection (e.g. invalid script)
    fetchSpy.mockResolvedValueOnce(
      makeResponse(400, { detail: "invalid transaction" })
    );

    const { broadcastTransaction } = await import("@/services/broadcast.service");

    await expect(broadcastTransaction(TX_HEX)).rejects.toThrow(
      /ARC broadcast failed \(400\)/
    );

    // GorillaPool must never be called
    expect(fetchSpy.mock.calls).toHaveLength(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(ARC_URL);
  });

  it("throws immediately on TAAL 409 (double-spend) without fallback", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeResponse(409, { detail: "double spend" })
    );

    const { broadcastTransaction } = await import("@/services/broadcast.service");

    await expect(broadcastTransaction(TX_HEX)).rejects.toThrow(
      /ARC broadcast failed \(409\)/
    );

    expect(fetchSpy.mock.calls).toHaveLength(1);
  });

  it("throws GorillaPool's error when both TAAL and GorillaPool fail", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeResponse(503, { detail: "TAAL down" })
    );
    fetchSpy.mockResolvedValueOnce(
      makeResponse(500, { detail: "GorillaPool also down" })
    );

    const { broadcastTransaction } = await import("@/services/broadcast.service");

    await expect(broadcastTransaction(TX_HEX)).rejects.toThrow(
      /ARC broadcast failed \(500\)/
    );

    expect(fetchSpy.mock.calls).toHaveLength(2);
  });

  it("throws when both providers return 200 but with no txid in the response body", async () => {
    // A missing-txid error carries no .status so it is treated as retriable —
    // the service falls through to GorillaPool. We stub both calls to return
    // a body without a txid so the final throw comes from GorillaPool.
    const noTxidBody = { txStatus: "SEEN_ON_NETWORK" };
    fetchSpy.mockResolvedValueOnce(makeResponse(200, noTxidBody)); // TAAL
    fetchSpy.mockResolvedValueOnce(makeResponse(200, noTxidBody)); // GorillaPool

    const { broadcastTransaction } = await import("@/services/broadcast.service");

    await expect(broadcastTransaction(TX_HEX)).rejects.toThrow(
      /ARC response missing txid/
    );

    expect(fetchSpy.mock.calls).toHaveLength(2);
  });

  it("sends the raw tx hex as rawTx in the POST body to TAAL", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeResponse(200, { txid: FAKE_TXID })
    );

    const { broadcastTransaction } = await import("@/services/broadcast.service");
    await broadcastTransaction(TX_HEX);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ rawTx: TX_HEX });
  });
});
