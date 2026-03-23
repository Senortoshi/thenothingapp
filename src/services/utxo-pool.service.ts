import { getTip } from "@/lib/utxo-tip";

export interface PoolStats {
  freeCount: number;
  lockedCount: number;
  spentCount: number;
  freeSats: number;
}

/**
 * Returns pool statistics derived from the Redis tip.
 * With the tip-chain model there is at most one free UTXO at any time.
 */
export async function getPoolStats(): Promise<PoolStats> {
  const tip = await getTip();
  return {
    freeCount: tip ? 1 : 0,
    lockedCount: 0,
    spentCount: 0,
    freeSats: tip?.satoshis ?? 0,
  };
}

/**
 * No-op: stale lock recovery is handled automatically by the Redis mutex TTL.
 */
export async function recoverStaleLocks(): Promise<number> {
  return 0;
}
