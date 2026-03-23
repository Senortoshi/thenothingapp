import {
  PrivateKey,
  Transaction,
  P2PKH,
  Script,
  LockingScript,
} from "@bsv/sdk";
import { buildCommentOpReturn } from "@/lib/op-return";
import { FEE_PER_KB, MIN_FEE } from "@/lib/constants";

export interface UtxoInput {
  txid: string;
  vout: number;
  satoshis: number;
  scriptHex: string;
}

export interface BuildTxResult {
  txHex: string;
  txid: string;
  fee: number;
  changeAmount: number;
  changeScriptHex: string;
}

// Minimum entropy threshold: reject keys whose numeric value is below this.
// Any key < 2^128 is dangerously weak (brute-forceable) and likely a mistake.
const MIN_KEY_HEX = "00000000000000000000000000000001" + "0".repeat(32); // 2^128

/**
 * Returns true if a PrivateKey has dangerously low entropy (e.g., small integers,
 * all-zeros, or any value below 2^128). These keys are publicly known or trivially
 * brute-forceable and MUST NOT be used for real funds.
 */
function isWeakKey(key: PrivateKey): boolean {
  const hex = key.toHex();
  // Reject all-zeros (the "new PrivateKey()" default)
  if (hex === "0".repeat(64)) return true;
  // Reject anything below 2^128 — impossibly low for a random 256-bit key
  if (hex < MIN_KEY_HEX) return true;
  return false;
}

// Module-level cache — avoids re-parsing WIF on every request within a serverless invocation
let _cachedKey: PrivateKey | null = null;
let _cachedWif: string | null = null;

/**
 * Returns the PrivateKey loaded from BSV_FUNDING_KEY env var (WIF format).
 * Cached per invocation to avoid redundant base58 decoding.
 * Invalidates cache if the env var changes (e.g., in tests).
 * Error messages are sanitized to prevent WIF leaking into logs/stack traces.
 *
 * SECURITY: Rejects keys with dangerously low entropy (small integers, zero, etc.)
 * to prevent funds from being sent to publicly-known addresses.
 */
export function getFundingKey(): PrivateKey {
  const wif = process.env.BSV_FUNDING_KEY;
  if (!wif) {
    _cachedKey = null;
    _cachedWif = null;
    throw new Error("BSV_FUNDING_KEY environment variable is not set");
  }
  if (_cachedKey && _cachedWif === wif) return _cachedKey;
  try {
    const key = PrivateKey.fromWif(wif);
    if (isWeakKey(key)) {
      throw new Error(
        "CRITICAL: BSV_FUNDING_KEY is a weak/known private key (value too small). " +
        "Generate a new key with: PrivateKey.fromRandom().toWif()"
      );
    }
    _cachedKey = key;
    _cachedWif = wif;
    return _cachedKey;
  } catch (e) {
    _cachedKey = null;
    _cachedWif = null;
    if (e instanceof Error && e.message.startsWith("CRITICAL:")) throw e;
    throw new Error("BSV_FUNDING_KEY is invalid (WIF parse failed)");
  }
}

/**
 * Returns the P2PKH address string for the funding wallet.
 */
export function getFundingAddress(): string {
  return getFundingKey().toAddress().toString();
}

/**
 * Calculates the miner fee for a transaction of the given byte length.
 */
export function calculateFee(byteLength: number): number {
  const fee = Math.ceil((byteLength * FEE_PER_KB) / 1000);
  return Math.max(fee, MIN_FEE);
}

/**
 * Builds, signs, and serializes a BSV transaction that:
 *   1. Spends the given UTXO (P2PKH input)
 *   2. Writes an OP_RETURN comment output (0 satoshis)
 *   3. Returns change to the funding address
 */
export async function buildCommentTransaction(params: {
  utxo: UtxoInput;
  commentText: string;
  displayName: string;
  timestamp: string;
  parentTxid?: string;
  tipAddress?: string;
}): Promise<BuildTxResult> {
  const { utxo, commentText, displayName, timestamp, parentTxid, tipAddress } = params;

  const privateKey = getFundingKey();
  const address = privateKey.toAddress().toString();

  // 1. Build the OP_RETURN locking script
  const opReturnScript = buildCommentOpReturn({
    commentText,
    displayName,
    timestamp,
    parentTxid,
    tipAddress,
  });

  // 2. P2PKH change locking script
  const p2pkh = new P2PKH();
  const changeLockingScript: LockingScript = p2pkh.lock(address);

  // 3. Build the source transaction output for signing
  //    @bsv/sdk requires sourceTransaction OR (sourceSatoshis + lockingScript) on unlock()
  const sourceLockingScript = Script.fromHex(utxo.scriptHex) as LockingScript;

  // 4. Build the transaction with a placeholder change amount (will adjust after sizing)
  const preliminaryFee = calculateFee(300); // conservative initial estimate
  let changeAmount = utxo.satoshis - preliminaryFee;

  if (changeAmount < 1) {
    throw new Error(
      `UTXO too small: ${utxo.satoshis} sats — estimated fee is ${preliminaryFee} sats`
    );
  }

  const tx = new Transaction();

  tx.addInput({
    sourceTXID: utxo.txid,
    sourceOutputIndex: utxo.vout,
    unlockingScriptTemplate: p2pkh.unlock(
      privateKey,
      "all",
      false,
      utxo.satoshis,
      sourceLockingScript
    ),
  });

  // Output 0: OP_RETURN comment (0 satoshis, unspendable data carrier)
  tx.addOutput({
    satoshis: 0,
    lockingScript: opReturnScript,
  });

  // Output 1: Change back to funding wallet
  tx.addOutput({
    satoshis: changeAmount,
    lockingScript: changeLockingScript,
  });

  // 5. Sign to get actual tx size
  await tx.sign();

  // 6. Calculate fee from actual serialized size, then rebuild if fee changed
  const actualTxBytes = tx.toHex().length / 2; // hex chars / 2 = bytes
  const fee = calculateFee(actualTxBytes);
  changeAmount = utxo.satoshis - fee;

  if (changeAmount < 1) {
    throw new Error(
      `UTXO too small: ${utxo.satoshis} sats — actual fee is ${fee} sats`
    );
  }

  // Update the change output with the correct amount and re-sign
  tx.outputs[1].satoshis = changeAmount;
  await tx.sign();

  const txHex = tx.toHex();
  const txid = tx.id("hex");

  return { txHex, txid, fee, changeAmount, changeScriptHex: changeLockingScript.toHex() };
}
