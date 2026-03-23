/**
 * scripts/fund-wallet.ts
 *
 * Wallet funding helper for the BSVibes Nothing App.
 *
 * Usage:
 *   bun run scripts/fund-wallet.ts
 *
 * What it does:
 *   1. If BSV_FUNDING_KEY is set in .env.local, loads that key.
 *      Otherwise, generates a new random PrivateKey and prints the WIF.
 *   2. Shows the P2PKH funding address.
 *   3. Queries WhatsOnChain for the address's current UTXOs.
 *   4. Reports balance and tip readiness.
 */

import { PrivateKey, P2PKH } from "@bsv/sdk";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WOC_BASE = "https://api.whatsonchain.com/v1/bsv/main";
const MIN_RECOMMENDED_SATS = 10_000; // 10k sats recommended minimum

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface WocUtxo {
  tx_hash: string;
  tx_pos: number;
  value: number;
  height: number;
}

async function fetchUtxos(address: string): Promise<WocUtxo[]> {
  const url = `${WOC_BASE}/address/${encodeURIComponent(address)}/unspent`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    throw new Error(
      `WhatsOnChain request failed: ${res.status} ${res.statusText} -- GET ${url}`
    );
  }
  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error("Unexpected response shape from WhatsOnChain UTXO endpoint");
  }
  return data as WocUtxo[];
}

async function fetchBalance(address: string): Promise<{ confirmed: number; unconfirmed: number }> {
  const url = `${WOC_BASE}/address/${encodeURIComponent(address)}/balance`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    throw new Error(
      `WhatsOnChain request failed: ${res.status} ${res.statusText} -- GET ${url}`
    );
  }
  const data = await res.json();
  return {
    confirmed: data.confirmed ?? 0,
    unconfirmed: data.unconfirmed ?? 0,
  };
}

function loadEnvFile(): Record<string, string> {
  const envVars: Record<string, string> = {};
  // Try .env.local first, then .env
  const candidates = [".env.local", ".env"];
  for (const name of candidates) {
    const envPath = path.resolve(process.cwd(), name);
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, "utf8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        envVars[key] = val;
      }
    }
  }
  return envVars;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=".repeat(60));
  console.log("  BSVibes -- Wallet Funding Helper");
  console.log("=".repeat(60));
  console.log();

  // Step 1: Load or generate key
  const envVars = loadEnvFile();
  const existingWif =
    process.env.BSV_FUNDING_KEY ?? envVars["BSV_FUNDING_KEY"];

  let privateKey: PrivateKey;
  let isNewKey = false;

  if (
    existingWif &&
    existingWif !== "your-wif-private-key-here" &&
    existingWif.length > 10
  ) {
    try {
      privateKey = PrivateKey.fromWif(existingWif);
      console.log("[OK] Loaded existing BSV_FUNDING_KEY from environment.");
    } catch {
      console.error(
        "[ERROR] BSV_FUNDING_KEY is set but invalid (WIF parse failed)."
      );
      console.error(
        "        Fix the value in .env.local or delete it to generate a new key."
      );
      process.exit(1);
    }
  } else {
    privateKey = PrivateKey.fromRandom();
    isNewKey = true;
    console.log("[NEW] No valid BSV_FUNDING_KEY found. Generated a new key.");
    console.log();
    console.log(
      "  IMPORTANT: Save this WIF to your .env.local file as BSV_FUNDING_KEY."
    );
    console.log(
      "  Also set it in Vercel as a Production-only encrypted variable."
    );
    console.log();
    console.log("  WIF Private Key (KEEP SECRET):");
    console.log(`  ${privateKey.toWif()}`);
    console.log();
    console.log(
      '  Add to .env.local:  BSV_FUNDING_KEY=' + privateKey.toWif()
    );
  }

  // Step 2: Derive and show address
  const address = privateKey.toAddress().toString();
  const p2pkh = new P2PKH();
  const lockingScript = p2pkh.lock(address);
  const scriptHex = lockingScript.toHex();

  console.log();
  console.log("  Funding Address (P2PKH):");
  console.log(`  ${address}`);
  console.log();
  console.log("  Locking Script Hex:");
  console.log(`  ${scriptHex}`);
  console.log();

  if (isNewKey) {
    console.log("-".repeat(60));
    console.log(
      "  Send BSV to the address above to fund the wallet."
    );
    console.log(
      `  Recommended minimum: ${MIN_RECOMMENDED_SATS} sats (${(MIN_RECOMMENDED_SATS / 1e8).toFixed(8)} BSV)`
    );
    console.log(
      "  Each comment costs ~150-250 sats in fees, so 10k sats funds ~40-60 comments."
    );
    console.log("-".repeat(60));
    console.log();
  }

  // Step 3: Check on-chain balance
  console.log("Checking WhatsOnChain for current balance...");
  console.log();

  try {
    const [balance, utxos] = await Promise.all([
      fetchBalance(address),
      fetchUtxos(address),
    ]);

    const totalSats = balance.confirmed + balance.unconfirmed;

    console.log(`  Confirmed:   ${balance.confirmed} sats`);
    console.log(`  Unconfirmed: ${balance.unconfirmed} sats`);
    console.log(`  Total:       ${totalSats} sats (${(totalSats / 1e8).toFixed(8)} BSV)`);
    console.log(`  UTXOs:       ${utxos.length}`);
    console.log();

    if (utxos.length === 0) {
      console.log("[WAITING] No UTXOs found. The address has not been funded yet.");
      console.log("          Send BSV to the address above, then run this script again.");
      console.log();
      if (isNewKey) {
        console.log("  Quick fund options:");
        console.log("    - Send from Yours Wallet, HandCash, or any BSV wallet");
        console.log("    - Use a BSV faucet for testing (small amounts)");
        console.log(`    - Buy BSV on an exchange and withdraw to: ${address}`);
      }
    } else {
      // Show UTXO details
      console.log("  UTXO Details:");
      const sorted = [...utxos].sort((a, b) => b.value - a.value);
      for (const u of sorted) {
        const confirmed = u.height > 0 ? `block ${u.height}` : "unconfirmed";
        console.log(
          `    ${u.tx_hash}:${u.tx_pos}  ${u.value} sats  (${confirmed})`
        );
      }
      console.log();

      // Identify the tip candidate
      const largest = sorted[0];
      console.log(
        `  Tip candidate (largest UTXO): ${largest.tx_hash}:${largest.tx_pos} (${largest.value} sats)`
      );

      if (utxos.length > 1) {
        console.log();
        console.log(
          `  [NOTE] ${utxos.length} UTXOs found. The app uses a single-UTXO tip chain.`
        );
        console.log(
          "         Only the largest UTXO will be used as the tip."
        );
        console.log(
          "         The others are idle. Consider consolidating them into one UTXO."
        );
      }

      // Step 4: Readiness assessment
      console.log();
      if (totalSats >= MIN_RECOMMENDED_SATS) {
        const estComments = Math.floor(totalSats / 200); // ~200 sats avg fee
        console.log("[READY] Wallet is funded and ready for deployment.");
        console.log(
          `        Estimated capacity: ~${estComments} comments at current fee rates.`
        );
      } else {
        console.log(
          `[LOW] Wallet balance (${totalSats} sats) is below the recommended minimum (${MIN_RECOMMENDED_SATS} sats).`
        );
        console.log(
          "      The app will work but may run out of funds quickly."
        );
        console.log(
          `      Send at least ${MIN_RECOMMENDED_SATS - totalSats} more sats to reach the minimum.`
        );
      }
    }
  } catch (err) {
    console.error(
      "[ERROR] Failed to check WhatsOnChain:",
      err instanceof Error ? err.message : String(err)
    );
    console.error("        This could be a network issue. The key/address are still valid.");
    console.error("        Try again in a moment, or check manually at:");
    console.error(`        https://whatsonchain.com/address/${address}`);
  }

  console.log();
  console.log("=".repeat(60));
  console.log("  Next steps:");
  if (isNewKey) {
    console.log("  1. Save the WIF to .env.local (BSV_FUNDING_KEY=...)");
    console.log(`  2. Send BSV to ${address}`);
    console.log("  3. Run this script again to verify funding");
    console.log("  4. Set BSV_FUNDING_KEY in Vercel env vars (Production only)");
  } else {
    console.log("  1. Verify the wallet is funded (see above)");
    console.log("  2. Deploy to Vercel with all required env vars");
    console.log("  3. The app will auto-recover the tip on first POST");
  }
  console.log("  5. Monitor at /api/health after deploy");
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
