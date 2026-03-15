import { ARC_URL, GORILLAPOOL_ARC_URL } from "@/lib/constants";

export interface ArcResponse {
  txid: string;
  txStatus?: string;
  extraInfo?: string;
}

/**
 * Attempts to broadcast via a single ARC endpoint.
 * Returns the parsed response on success, or throws on failure.
 */
async function broadcastToArc(
  url: string,
  txHex: string
): Promise<ArcResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ rawTx: txHex }),
  });

  let body: Record<string, unknown>;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      `ARC returned non-JSON response (status ${response.status})`
    );
  }

  if (!response.ok) {
    const detail =
      (body.detail as string) ??
      (body.message as string) ??
      JSON.stringify(body);
    const err = new Error(
      `ARC broadcast failed (${response.status}): ${detail}`
    );
    (err as Error & { status: number }).status = response.status;
    throw err;
  }

  const txid = body.txid as string;
  if (!txid) {
    throw new Error(`ARC response missing txid: ${JSON.stringify(body)}`);
  }

  return {
    txid,
    txStatus: body.txStatus as string | undefined,
    extraInfo: body.extraInfo as string | undefined,
  };
}

/**
 * Returns true if the error is retriable (network failure or 5xx).
 * 4xx errors are tx-level rejections and should NOT be retried.
 */
function isRetriableError(err: unknown): boolean {
  if (!(err instanceof Error)) return true; // unknown error — treat as retriable
  const status = (err as Error & { status?: number }).status;
  // No status means network-level failure (fetch threw) — retriable
  if (status === undefined) return true;
  // 5xx = server error — retriable; 4xx = client/tx rejection — not retriable
  return status >= 500;
}

/**
 * Broadcasts a raw transaction hex to ARC.
 *
 * Strategy: try TAAL ARC first. If it fails with a network error or 5xx,
 * fall back to GorillaPool ARC. 4xx errors (tx-level rejections such as
 * double-spend, invalid script, etc.) are NOT retried — they would fail
 * on any miner.
 */
export async function broadcastTransaction(txHex: string): Promise<ArcResponse> {
  try {
    return await broadcastToArc(ARC_URL, txHex);
  } catch (taalError) {
    // 4xx = tx-level rejection — do not retry on another endpoint
    if (!isRetriableError(taalError)) {
      throw taalError;
    }

    console.warn(
      `[broadcast] TAAL ARC failed (retriable), falling back to GorillaPool:`,
      taalError instanceof Error ? taalError.message : String(taalError)
    );

    // Fallback to GorillaPool — let errors propagate naturally
    return await broadcastToArc(GORILLAPOOL_ARC_URL, txHex);
  }
}
