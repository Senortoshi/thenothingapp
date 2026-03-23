/**
 * src/lib/utxo-tip.ts
 *
 * Single-UTXO chain tip tracked in Upstash Redis.
 *
 * Model: every comment transaction spends the current tip and produces a
 * change output that becomes the new tip. A Redis-based distributed mutex
 * serialises access across Vercel serverless isolates.
 *
 * Recovery: if the tip is missing (first boot, Redis flush), recoverTipFromChain()
 * queries WhatsOnChain for the funding address's UTXOs and picks the largest one.
 *
 * Dev fallback: when Redis is not configured, falls back to in-memory storage
 * (single-process only — not safe for production).
 */

import { P2PKH } from "@bsv/sdk";
import { getAddressUtxos } from "@/lib/woc";
import { getFundingAddress } from "@/services/wallet.service";
import { getRedis } from "@/lib/redis";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UtxoTip {
  txid: string;
  vout: number;
  satoshis: number;
  scriptHex: string;
}

// ---------------------------------------------------------------------------
// Redis keys
// ---------------------------------------------------------------------------

const TIP_KEY = "nothing_app:utxo:tip";
const MUTEX_KEY = "nothing_app:utxo:mutex";
const MUTEX_TTL_MS = 15_000; // 15 seconds

// ---------------------------------------------------------------------------
// In-memory fallback (dev only)
// ---------------------------------------------------------------------------

let _memTip: UtxoTip | null = null;
let _memMutex: string | null = null;

// ---------------------------------------------------------------------------
// Mutex (Redis-based distributed lock)
// ---------------------------------------------------------------------------

/**
 * Acquire the tip mutex for this request. Returns true if acquired.
 * Uses Redis SET NX PX for distributed locking across Vercel isolates.
 * Falls back to in-memory lock when Redis is not configured (dev only).
 */
export async function acquireTipMutex(requestId: string): Promise<boolean> {
  const redis = getRedis();

  if (!redis) {
    // In-memory fallback (dev only)
    if (_memMutex !== null) return false;
    _memMutex = requestId;
    return true;
  }

  // SET key value NX PX ttl — atomic acquire with auto-expiry
  const result = await redis.set(MUTEX_KEY, requestId, {
    nx: true,
    px: MUTEX_TTL_MS,
  });
  return result === "OK";
}

/**
 * Release the tip mutex, only if still held by this request.
 * Uses a Lua script for atomic compare-and-delete.
 */
export async function releaseTipMutex(requestId: string): Promise<void> {
  const redis = getRedis();

  if (!redis) {
    // In-memory fallback (dev only)
    if (_memMutex === requestId) _memMutex = null;
    return;
  }

  // Atomic: only delete if the value matches our requestId
  const script = `if redis.call("get",KEYS[1]) == ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end`;
  await redis.eval(script, [MUTEX_KEY], [requestId]);
}

// ---------------------------------------------------------------------------
// Tip CRUD (Redis-backed)
// ---------------------------------------------------------------------------

/** Read the current UTXO tip from Redis. */
export async function getTip(): Promise<UtxoTip | null> {
  const redis = getRedis();

  if (!redis) return _memTip;

  const data = await redis.get<UtxoTip>(TIP_KEY);
  return data ?? null;
}

/** Store a new UTXO tip in Redis. */
export async function setTip(tip: UtxoTip): Promise<void> {
  const redis = getRedis();

  if (!redis) {
    _memTip = tip;
    return;
  }

  await redis.set(TIP_KEY, tip);
}

// ---------------------------------------------------------------------------
// Chain recovery
// ---------------------------------------------------------------------------

/**
 * Recover the tip by querying the funding address's UTXOs on-chain.
 * Picks the largest UTXO, derives the P2PKH scriptHex, stores it, and returns it.
 * Returns null if the address has no UTXOs.
 */
export async function recoverTipFromChain(): Promise<UtxoTip | null> {
  const address = getFundingAddress();
  const utxos = await getAddressUtxos(address);

  if (!utxos || utxos.length === 0) {
    return null;
  }

  if (utxos.length > 1) {
    console.warn(
      `[utxo-tip] Found ${utxos.length} UTXOs at funding address. ` +
      `Picking the largest. Consider consolidating the others manually.`
    );
  }

  const largest = utxos.reduce((best, u) => (u.value > best.value ? u : best));

  const p2pkh = new P2PKH();
  const lockingScript = p2pkh.lock(address);
  const scriptHex = lockingScript.toHex();

  const tip: UtxoTip = {
    txid: largest.tx_hash,
    vout: largest.tx_pos,
    satoshis: largest.value,
    scriptHex,
  };

  await setTip(tip);
  return tip;
}
