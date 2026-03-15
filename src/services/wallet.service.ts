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
}

/**
 * Returns the PrivateKey loaded from BSV_FUNDING_KEY env var (WIF format).
 */
export function getFundingKey(): PrivateKey {
  const wif = process.env.BSV_FUNDING_KEY;
  if (!wif) {
    throw new Error("BSV_FUNDING_KEY environment variable is not set");
  }
  return PrivateKey.fromWif(wif);
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
}): Promise<BuildTxResult> {
  const { utxo, commentText, displayName, timestamp, parentTxid } = params;

  const privateKey = getFundingKey();
  const address = privateKey.toAddress().toString();

  // 1. Build the OP_RETURN locking script
  const opReturnScript = buildCommentOpReturn({
    commentText,
    displayName,
    timestamp,
    parentTxid,
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

  return { txHex, txid, fee, changeAmount };
}
