import { ARC_URL } from "@/lib/constants";

export interface ArcResponse {
  txid: string;
  txStatus?: string;
  extraInfo?: string;
}

/**
 * Broadcasts a raw transaction hex to TAAL ARC.
 *
 * ARC endpoint: POST https://arc.taal.com/v1/tx
 * Body: { rawTx: "<hex>" }
 * On success: 200 or 201 with { txid, txStatus, ... }
 * On failure: 4xx/5xx with { detail, ... }
 */
export async function broadcastTransaction(txHex: string): Promise<ArcResponse> {
  const response = await fetch(ARC_URL, {
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
    throw new Error(`ARC broadcast failed (${response.status}): ${detail}`);
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
