/**
 * src/lib/blocklist.ts
 *
 * File-backed txid blocklist. Stored in data/blocklist.json, loaded into
 * an in-memory Set for O(1) lookups. Survives restarts via the JSON file.
 * No Redis, no database.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";

// ---------------------------------------------------------------------------
// File path
// ---------------------------------------------------------------------------

const BLOCKLIST_PATH = join(process.cwd(), "data", "blocklist.json");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BlocklistEntry {
  txid: string;
  reason: string;
  addedAt: string;
}

// ---------------------------------------------------------------------------
// In-memory state (loaded from file on first access)
// ---------------------------------------------------------------------------

let entries: BlocklistEntry[] | null = null;
let txidSet: Set<string> | null = null;

function load(): void {
  if (entries !== null) return;
  try {
    if (existsSync(BLOCKLIST_PATH)) {
      entries = JSON.parse(readFileSync(BLOCKLIST_PATH, "utf-8"));
    } else {
      entries = [];
    }
  } catch {
    entries = [];
  }
  txidSet = new Set(entries!.map((e) => e.txid));
}

function save(): void {
  const dir = dirname(BLOCKLIST_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(BLOCKLIST_PATH, JSON.stringify(entries, null, 2));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Returns true if the txid is on the blocklist. */
export async function isBlocklisted(txid: string): Promise<boolean> {
  load();
  return txidSet!.has(txid);
}

/** Adds a txid to the blocklist with a reason string. */
export async function addToBlocklist(txid: string, reason: string): Promise<void> {
  load();
  if (txidSet!.has(txid)) return;
  const entry: BlocklistEntry = { txid, reason, addedAt: new Date().toISOString() };
  entries!.push(entry);
  txidSet!.add(txid);
  save();
}

/** Removes a txid from the blocklist. */
export async function removeFromBlocklist(txid: string): Promise<void> {
  load();
  entries = entries!.filter((e) => e.txid !== txid);
  txidSet!.delete(txid);
  save();
}

/** Returns all blocked txids with their reason and addedAt metadata. */
export async function getBlocklist(): Promise<BlocklistEntry[]> {
  load();
  return [...entries!];
}
