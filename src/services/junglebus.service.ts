/**
 * JungleBus Indexer Integration (MAX-5)
 *
 * JungleBus is a BSV transaction indexer that lets you subscribe to
 * transactions matching a specific OP_RETURN prefix.
 *
 * We use it to:
 *   1. Reconcile our local DB against on-chain data
 *   2. Backfill any comments we missed (e.g. during downtime)
 *   3. Flag discrepancies for investigation
 *
 * JungleBus docs: https://junglebus.gorillapool.io/
 * Subscription model: subscribe to an address or OP_RETURN prefix,
 * receive blocks of matching transactions via SSE or polling.
 *
 * Env vars:
 *   JUNGLEBUS_URL           - JungleBus endpoint (default: https://junglebus.gorillapool.io)
 *   JUNGLEBUS_API_KEY       - API key (optional for public subscriptions)
 *   JUNGLEBUS_SUBSCRIPTION_ID - Your subscription ID (created via the JungleBus API)
 */

import { db } from "@/db";
import { comments } from "@/db/schema";
import { sql } from "drizzle-orm";
import { APP_PREFIX } from "@/lib/constants";
import { parseOpReturnComment } from "@/lib/op-return";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const JUNGLEBUS_BASE_URL =
  process.env.JUNGLEBUS_URL ?? "https://junglebus.gorillapool.io";

const JUNGLEBUS_API_KEY = process.env.JUNGLEBUS_API_KEY ?? "";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JungleBusTransaction {
  id: string; // txid
  transaction: string; // raw tx hex
  block_height: number;
  block_time: number;
  block_hash: string;
}

export interface JungleBusBlock {
  block_height: number;
  block_hash: string;
  block_time: number;
  transactions: JungleBusTransaction[];
}

export interface ReconciliationReport {
  blocksScanned: number;
  transactionsFound: number;
  backfilled: number;
  discrepancies: Discrepancy[];
  errors: string[];
}

export interface Discrepancy {
  txid: string;
  issue: string;
  details?: string;
}

// ---------------------------------------------------------------------------
// JungleBus HTTP client
// ---------------------------------------------------------------------------

function jbHeaders(): HeadersInit {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (JUNGLEBUS_API_KEY) {
    headers["Authorization"] = `Bearer ${JUNGLEBUS_API_KEY}`;
  }
  return headers;
}

/**
 * Fetches a range of blocks from JungleBus for a given subscription.
 * Uses the subscription's OP_RETURN prefix filter.
 */
async function fetchBlockRange(
  subscriptionId: string,
  fromBlock: number,
  toBlock: number
): Promise<JungleBusBlock[]> {
  const url = `${JUNGLEBUS_BASE_URL}/v1/block_header/list/${fromBlock}`;

  const response = await fetch(url, {
    headers: jbHeaders(),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "(unreadable)");
    throw new Error(
      `JungleBus block fetch failed (${response.status}): ${body}`
    );
  }

  // JungleBus returns an array of block headers; we then fetch txs per block
  const blockHeaders: Array<{
    height: number;
    hash: string;
    time: number;
  }> = await response.json();

  const blocks: JungleBusBlock[] = [];

  for (const header of blockHeaders) {
    if (header.height > toBlock) break;

    try {
      const txs = await fetchTransactionsForBlock(
        subscriptionId,
        header.height
      );
      blocks.push({
        block_height: header.height,
        block_hash: header.hash,
        block_time: header.time,
        transactions: txs,
      });
    } catch (err) {
      console.warn(
        `[junglebus] Failed to fetch txs for block ${header.height}:`,
        err
      );
    }
  }

  return blocks;
}

async function fetchTransactionsForBlock(
  subscriptionId: string,
  blockHeight: number
): Promise<JungleBusTransaction[]> {
  const url = `${JUNGLEBUS_BASE_URL}/v1/subscription/${subscriptionId}/block/${blockHeight}`;

  const response = await fetch(url, {
    headers: jbHeaders(),
    signal: AbortSignal.timeout(15_000),
  });

  if (response.status === 404) {
    return []; // No matching transactions in this block
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "(unreadable)");
    throw new Error(
      `JungleBus tx fetch failed for block ${blockHeight} (${response.status}): ${body}`
    );
  }

  const data: { transactions?: JungleBusTransaction[] } = await response.json();
  return data.transactions ?? [];
}

// ---------------------------------------------------------------------------
// Subscription management
// ---------------------------------------------------------------------------

/**
 * Creates (or retrieves) a JungleBus subscription for our OP_RETURN prefix.
 * Returns the subscription ID.
 *
 * Call this once during setup. Store the result in JUNGLEBUS_SUBSCRIPTION_ID.
 */
export async function createSubscription(): Promise<string> {
  const url = `${JUNGLEBUS_BASE_URL}/v1/subscription`;

  const response = await fetch(url, {
    method: "POST",
    headers: jbHeaders(),
    body: JSON.stringify({
      query: {
        // Filter for OP_RETURN outputs containing our app prefix
        // JungleBus query syntax — matches OP_RETURN data starting with our prefix
        find: {
          "out.b0.op": 106, // OP_RETURN opcode
          "out.s1": APP_PREFIX, // First push data matches our prefix
        },
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "(unreadable)");
    throw new Error(
      `JungleBus subscription creation failed (${response.status}): ${body}`
    );
  }

  const data: { id: string } = await response.json();
  console.log("[junglebus] Subscription created:", data.id);
  return data.id;
}

// ---------------------------------------------------------------------------
// On-chain transaction parser
// ---------------------------------------------------------------------------

/**
 * Parses a raw JungleBus transaction and extracts comment data.
 * Returns null if the transaction is not a valid NothingApp comment.
 */
function parseCommentFromTx(tx: JungleBusTransaction): {
  txid: string;
  displayName: string;
  commentText: string;
  parentTxid: string | null;
  createdAt: Date;
} | null {
  try {
    // Use the existing op-return parser from lib
    const parsed = parseOpReturnComment(tx.transaction);
    if (!parsed) return null;

    return {
      txid: tx.id,
      displayName: parsed.displayName ?? "Anonymous",
      commentText: parsed.commentText,
      parentTxid: parsed.parentTxid ?? null,
      // Use block time if available, otherwise now
      createdAt: tx.block_time
        ? new Date(tx.block_time * 1000)
        : new Date(),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/**
 * Reconciles local DB comments against JungleBus for a block range.
 *
 * Steps:
 *   1. Fetch transactions from JungleBus for the range
 *   2. Parse each transaction as a NothingApp comment
 *   3. Check if each on-chain comment exists in our DB
 *   4. Backfill missing comments
 *   5. Report discrepancies (e.g. DB has comment with wrong text vs on-chain)
 */
export async function reconcile(options: {
  fromBlock: number;
  toBlock: number;
  dryRun?: boolean;
}): Promise<ReconciliationReport> {
  const subscriptionId = process.env.JUNGLEBUS_SUBSCRIPTION_ID;
  if (!subscriptionId) {
    throw new Error(
      "JUNGLEBUS_SUBSCRIPTION_ID is not set. " +
        "Run createSubscription() and store the returned ID."
    );
  }

  const report: ReconciliationReport = {
    blocksScanned: 0,
    transactionsFound: 0,
    backfilled: 0,
    discrepancies: [],
    errors: [],
  };

  let blocks: JungleBusBlock[];
  try {
    blocks = await fetchBlockRange(
      subscriptionId,
      options.fromBlock,
      options.toBlock
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    report.errors.push(`Failed to fetch blocks from JungleBus: ${msg}`);
    return report;
  }

  report.blocksScanned = blocks.length;

  for (const block of blocks) {
    for (const tx of block.transactions) {
      report.transactionsFound++;

      const parsed = parseCommentFromTx(tx);
      if (!parsed) continue;

      // Check if we have this comment in our DB
      let existingRows: unknown[];
      try {
        existingRows = (await db.execute(sql`
          SELECT id, comment_text, display_name
          FROM comments
          WHERE txid = ${parsed.txid}
          LIMIT 1
        `)) as unknown[];
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        report.errors.push(`DB lookup failed for ${parsed.txid}: ${msg}`);
        continue;
      }

      type DbRow = {
        id: number;
        comment_text: string;
        display_name: string;
      };

      const existing = (existingRows as DbRow[])[0];

      if (!existing) {
        // Missing from DB — backfill
        if (!options.dryRun) {
          try {
            await db.insert(comments).values({
              txid: parsed.txid,
              displayName: parsed.displayName,
              commentText: parsed.commentText,
              parentTxid: parsed.parentTxid,
              createdAt: parsed.createdAt,
            });
            report.backfilled++;
            console.log("[junglebus] Backfilled comment", { txid: parsed.txid });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            report.errors.push(`Backfill insert failed for ${parsed.txid}: ${msg}`);
          }
        } else {
          report.backfilled++; // dry run count
          console.log("[junglebus] [dry-run] Would backfill", { txid: parsed.txid });
        }
      } else {
        // Exists — check for discrepancies
        if (existing.comment_text !== parsed.commentText) {
          report.discrepancies.push({
            txid: parsed.txid,
            issue: "comment_text_mismatch",
            details: `DB: "${existing.comment_text.slice(0, 50)}" | On-chain: "${parsed.commentText.slice(0, 50)}"`,
          });
        }
        if (existing.display_name !== parsed.displayName) {
          report.discrepancies.push({
            txid: parsed.txid,
            issue: "display_name_mismatch",
            details: `DB: "${existing.display_name}" | On-chain: "${parsed.displayName}"`,
          });
        }
      }
    }
  }

  if (report.discrepancies.length > 0) {
    console.warn("[junglebus] Reconciliation discrepancies found:", {
      count: report.discrepancies.length,
      discrepancies: report.discrepancies,
    });
  }

  return report;
}

// ---------------------------------------------------------------------------
// Backfill from genesis
// ---------------------------------------------------------------------------

/**
 * Convenience wrapper: backfill all comments from a starting block
 * up to the current chain tip.
 *
 * Fetches the current block height from JungleBus before starting.
 */
export async function backfillFromBlock(fromBlock: number, dryRun = false): Promise<ReconciliationReport> {
  // Get current block height
  let toBlock: number;
  try {
    const response = await fetch(`${JUNGLEBUS_BASE_URL}/v1/block_header/tip`, {
      headers: jbHeaders(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Block tip fetch failed: ${response.status}`);
    }
    const tip: { height: number } = await response.json();
    toBlock = tip.height;
  } catch (err) {
    console.warn("[junglebus] Could not fetch chain tip, using fromBlock + 1000:", err);
    toBlock = fromBlock + 1000;
  }

  console.log(`[junglebus] Starting backfill from block ${fromBlock} to ${toBlock} (dryRun=${dryRun})`);
  return reconcile({ fromBlock, toBlock, dryRun });
}
