#!/usr/bin/env bun
/**
 * Nothing App — One-shot setup script.
 * Generates a BSV keypair, waits for funding, splits UTXOs, seeds the pool.
 *
 * Usage:  bun run scripts/setup.ts
 */

import { PrivateKey, P2PKH, Transaction, Script, type LockingScript } from "@bsv/sdk";
import { randomBytes } from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const UTXO_SIZE = 1000; // sats per pool UTXO
const FEE_PER_KB = 500;
const MIN_FEE = 5;
const POLL_INTERVAL = 10_000; // ms
const WOC = "https://api.whatsonchain.com/v1/bsv/main";
const ARC_URL = "https://arc.taal.com/v1/tx";
const ARC_FALLBACK = "https://arc.gorillapool.io/v1/tx";
const ENV_PATH = resolve(process.cwd(), ".env.local");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function log(msg: string) { console.log(`\n  ${msg}`); }
function die(msg: string): never { console.error(`\n  ERROR: ${msg}`); process.exit(1); }

function calcFee(bytes: number): number {
  return Math.max(Math.ceil((bytes * FEE_PER_KB) / 1000), MIN_FEE);
}

function readEnv(): Record<string, string> {
  if (!existsSync(ENV_PATH)) return {};
  const lines = readFileSync(ENV_PATH, "utf-8").split("\n");
  const env: Record<string, string> = {};
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

function writeEnv(updates: Record<string, string>) {
  const existing = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf-8") : "";
  const lines = existing ? existing.split("\n") : [];
  for (const [key, val] of Object.entries(updates)) {
    const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (idx >= 0) lines[idx] = `${key}=${val}`;
    else lines.push(`${key}=${val}`);
  }
  writeFileSync(ENV_PATH, lines.join("\n"));
}

interface WocUtxo { tx_hash: string; tx_pos: number; value: number; }

async function fetchUtxos(address: string): Promise<WocUtxo[]> {
  const res = await fetch(`${WOC}/address/${address}/unspent`);
  if (!res.ok) die(`WhatsOnChain returned ${res.status}`);
  return res.json();
}

async function broadcast(txHex: string): Promise<string> {
  for (const url of [ARC_URL, ARC_FALLBACK]) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ rawTx: txHex }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = await res.json();
      if (body.txid) return body.txid as string;
      if (!res.ok) throw new Error(body.detail ?? JSON.stringify(body));
    } catch (e) {
      console.warn(`    ARC ${url} failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  die("Broadcast failed on both ARC endpoints.");
}

// ---------------------------------------------------------------------------
// Step 1 — Key generation & .env.local
// ---------------------------------------------------------------------------
log("=== Nothing App Setup ===");

const env = readEnv();
let wif = env.BSV_FUNDING_KEY;
let keyIsNew = false;

if (wif && wif !== "your-wif-private-key-here") {
  log("BSV_FUNDING_KEY already set in .env.local — reusing existing key.");
} else {
  const key = PrivateKey.fromRandom();
  wif = key.toWif();
  keyIsNew = true;
  log("Generated new BSV private key.");
}

const updates: Record<string, string> = {};
if (keyIsNew || !env.BSV_FUNDING_KEY || env.BSV_FUNDING_KEY === "your-wif-private-key-here") {
  updates.BSV_FUNDING_KEY = wif!;
}
if (!env.RATE_LIMIT_SALT || env.RATE_LIMIT_SALT === "your-random-32-byte-hex-salt-here") {
  updates.RATE_LIMIT_SALT = randomBytes(32).toString("hex");
}
if (!env.CRON_SECRET || env.CRON_SECRET === "your-cron-secret-here") {
  updates.CRON_SECRET = randomBytes(32).toString("hex");
}
if (!env.ADMIN_API_KEY || env.ADMIN_API_KEY === "your-admin-api-key-here") {
  updates.ADMIN_API_KEY = randomBytes(32).toString("hex");
}

if (Object.keys(updates).length > 0) {
  writeEnv(updates);
  log(`Wrote ${Object.keys(updates).join(", ")} to .env.local`);
}

const privateKey = PrivateKey.fromWif(wif!);
const address = privateKey.toAddress().toString();

log(`Funding address: ${address}`);
log("Send BSV to this address to fund the UTXO pool.");
log("Minimum recommended: 0.001 BSV (100,000 sats) for ~95 pool UTXOs.");

// ---------------------------------------------------------------------------
// Step 2 — Wait for funding
// ---------------------------------------------------------------------------
log("Checking for UTXOs...");

let utxos: WocUtxo[] = [];
while (true) {
  utxos = await fetchUtxos(address);
  if (utxos.length > 0) break;
  process.stdout.write(`  Waiting for funding (polling every ${POLL_INTERVAL / 1000}s)...\r`);
  await new Promise((r) => setTimeout(r, POLL_INTERVAL));
}

const totalSats = utxos.reduce((s, u) => s + u.value, 0);
log(`Found ${utxos.length} UTXO(s) totaling ${totalSats} sats.`);

// ---------------------------------------------------------------------------
// Step 3 — Build split transaction
// ---------------------------------------------------------------------------
const p2pkh = new P2PKH();
const lockingScript: LockingScript = p2pkh.lock(address);
const lockingHex = lockingScript.toHex();

// Calculate how many pool UTXOs we can create
// Each output is ~34 bytes; each input ~148 bytes; overhead ~10 bytes
const estOutputBytes = 34;
const estInputBytes = 148;
const overhead = 10 + utxos.length * estInputBytes;

// Binary search for max outputs that fit within budget
let maxOutputs = Math.floor(totalSats / UTXO_SIZE);
while (maxOutputs > 1) {
  const txSize = overhead + maxOutputs * estOutputBytes;
  const fee = calcFee(txSize);
  if (maxOutputs * UTXO_SIZE + fee <= totalSats) break;
  maxOutputs--;
}

if (maxOutputs < 1) die(`Not enough sats. Need at least ${UTXO_SIZE + calcFee(overhead + estOutputBytes)} sats.`);

const txSize = overhead + maxOutputs * estOutputBytes;
const fee = calcFee(txSize);
const change = totalSats - maxOutputs * UTXO_SIZE - fee;

log(`Splitting into ${maxOutputs} UTXOs of ${UTXO_SIZE} sats each (fee: ${fee} sats${change > 0 ? `, change: ${change} sats` : ""}).`);

// Build the transaction
const tx = new Transaction();

for (const u of utxos) {
  const srcScript = lockingScript; // all UTXOs pay to our address
  tx.addInput({
    sourceTXID: u.tx_hash,
    sourceOutputIndex: u.tx_pos,
    unlockingScriptTemplate: p2pkh.unlock(privateKey, "all", false, u.value, srcScript),
  });
}

for (let i = 0; i < maxOutputs; i++) {
  tx.addOutput({ satoshis: UTXO_SIZE, lockingScript });
}

// Add change output if meaningful (above dust)
if (change >= 546) {
  tx.addOutput({ satoshis: change, lockingScript });
}

await tx.sign();

// Recalculate fee with actual size
const actualBytes = tx.toHex().length / 2;
const actualFee = calcFee(actualBytes);
if (actualFee > fee) {
  // Adjust last pool output down to cover the difference
  const diff = actualFee - fee;
  tx.outputs[maxOutputs - 1].satoshis -= diff;
  await tx.sign();
}

const txHex = tx.toHex();
const txid = tx.id("hex");

log(`Split tx built: ${txid} (${txHex.length / 2} bytes)`);

// ---------------------------------------------------------------------------
// Step 4 — Broadcast
// ---------------------------------------------------------------------------
log("Broadcasting split transaction...");
const broadcastTxid = await broadcast(txHex);
log(`Broadcast successful! txid: ${broadcastTxid}`);

// ---------------------------------------------------------------------------
// Step 5 — Insert UTXOs into database
// ---------------------------------------------------------------------------
log("Inserting UTXOs into the database pool...");

if (!process.env.DATABASE_URL && !env.DATABASE_URL) {
  log("DATABASE_URL not set. Printing INSERT statements instead:");
  console.log("");
  for (let i = 0; i < maxOutputs; i++) {
    const sats = tx.outputs[i].satoshis;
    console.log(
      `INSERT INTO utxo_pool (txid, vout, satoshis, script_hex, status) VALUES ('${broadcastTxid}', ${i}, ${sats}, '${lockingHex}', 'free') ON CONFLICT DO NOTHING;`
    );
  }
  console.log("");
  console.log(
    `INSERT INTO wallet_state (id, funding_address, total_balance, free_utxo_count) VALUES (1, '${address}', ${totalSats}, ${maxOutputs}) ON CONFLICT (id) DO UPDATE SET funding_address = '${address}', total_balance = ${totalSats}, free_utxo_count = ${maxOutputs}, updated_at = NOW();`
  );
  log("Copy-paste the SQL above into your Supabase SQL editor, then run `bun run dev`.");
} else {
  // Load DATABASE_URL into env if it came from .env.local
  if (!process.env.DATABASE_URL && env.DATABASE_URL) {
    process.env.DATABASE_URL = env.DATABASE_URL;
  }

  const postgres = (await import("postgres")).default;
  const sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 1 });

  for (let i = 0; i < maxOutputs; i++) {
    const sats = tx.outputs[i].satoshis;
    await sql`
      INSERT INTO utxo_pool (txid, vout, satoshis, script_hex, status)
      VALUES (${broadcastTxid}, ${i}, ${sats}, ${lockingHex}, 'free')
      ON CONFLICT DO NOTHING
    `;
  }

  await sql`
    INSERT INTO wallet_state (id, funding_address, total_balance, free_utxo_count)
    VALUES (1, ${address}, ${totalSats}, ${maxOutputs})
    ON CONFLICT (id) DO UPDATE SET
      funding_address = ${address},
      total_balance = ${totalSats},
      free_utxo_count = ${maxOutputs},
      updated_at = NOW()
  `;

  await sql.end();
  log(`Inserted ${maxOutputs} UTXOs and updated wallet_state.`);
}

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------
log("=== Setup complete ===");
log(`Address:    ${address}`);
log(`Pool UTXOs: ${maxOutputs}`);
log(`Run:        bun run dev`);
console.log("");
