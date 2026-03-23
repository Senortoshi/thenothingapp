import { WOC_BASE_URL, WOC_TIMEOUT_MS } from "@/lib/constants";

export interface WocTxHistoryItem {
  tx_hash: string;
  height: number;
}

export interface WocUtxo {
  tx_hash: string;
  tx_pos: number;
  value: number;
  height: number;
}

async function wocFetch(path: string): Promise<Response> {
  const url = `${WOC_BASE_URL}${path}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(WOC_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(
      `WhatsOnChain request failed: ${res.status} ${res.statusText} — GET ${url}`
    );
  }
  return res;
}

export async function getAddressTxHistory(
  address: string
): Promise<WocTxHistoryItem[]> {
  const res = await wocFetch(`/address/${encodeURIComponent(address)}/history`);
  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error(
      `WhatsOnChain getAddressTxHistory: unexpected response shape for address ${address}`
    );
  }
  return data as WocTxHistoryItem[];
}

export async function getTxHex(txid: string): Promise<string> {
  const res = await wocFetch(`/tx/${encodeURIComponent(txid)}/hex`);
  const raw = await res.text();
  if (!raw || typeof raw !== "string") {
    throw new Error(
      `WhatsOnChain getTxHex: empty or invalid response for txid ${txid}`
    );
  }
  // WhatsOnChain wraps the hex string in JSON double-quotes on this endpoint.
  // Strip them before returning so Buffer.from(hex, "hex") gets clean input.
  const hex = raw.trim().replace(/^"|"$/g, "");
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(
      `WhatsOnChain getTxHex: response is not valid hex for txid ${txid} — got: ${raw.slice(0, 40)}`
    );
  }
  return hex;
}

export interface WocBalance {
  confirmed: number;
  unconfirmed: number;
}

export async function getAddressBalance(address: string): Promise<WocBalance> {
  const res = await wocFetch(`/address/${encodeURIComponent(address)}/balance`);
  const data = await res.json();
  return {
    confirmed: data.confirmed ?? 0,
    unconfirmed: data.unconfirmed ?? 0,
  };
}

export async function getAddressUtxos(address: string): Promise<WocUtxo[]> {
  const res = await wocFetch(
    `/address/${encodeURIComponent(address)}/unspent`
  );
  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error(
      `WhatsOnChain getAddressUtxos: unexpected response shape for address ${address}`
    );
  }
  return data as WocUtxo[];
}
