import {
  pgTable,
  text,
  timestamp,
  bigint,
  integer,
  pgEnum,
  index,
  uniqueIndex,
  boolean,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const blocklistReasonEnum = pgEnum("blocklist_reason", [
  "dmca",
  "csam",
  "court_order",
  "hate_speech",
  "violence",
  "spam",
  "other",
]);

export const utxoStatusEnum = pgEnum("utxo_status", [
  "free",
  "locked",
  "spent",
]);

// ---------------------------------------------------------------------------
// comments
// ---------------------------------------------------------------------------
// Every row = one on-chain OP_RETURN comment.
// txid is the BSV transaction ID (hex string, 64 chars).
// cursor-based pagination uses (created_at, id) — monotonic, no offset.
// ---------------------------------------------------------------------------

export const comments = pgTable(
  "comments",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    txid: text("txid").notNull().unique(),
    displayName: text("display_name").notNull().default("Anonymous"),
    commentText: text("comment_text").notNull(),
    parentTxid: text("parent_txid"), // null = top-level comment
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Cursor-based pagination: ORDER BY created_at DESC, id DESC
    index("idx_comments_cursor").on(t.createdAt, t.id),
    // Thread lookups: fetch replies to a parent
    index("idx_comments_parent").on(t.parentTxid),
  ]
);

// ---------------------------------------------------------------------------
// utxo_pool
// ---------------------------------------------------------------------------
// Pre-split UTXOs that fund comment broadcasts.
// FOR UPDATE SKIP LOCKED checkout pattern — serverless safe.
//
// Lifecycle: free -> locked (checkout) -> spent (after broadcast)
//                     \-> free (stale lock recovery by cron)
// ---------------------------------------------------------------------------

export const utxoPool = pgTable(
  "utxo_pool",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    txid: text("txid").notNull(),
    vout: integer("vout").notNull(),
    satoshis: bigint("satoshis", { mode: "number" }).notNull(),
    scriptHex: text("script_hex").notNull(), // locking script for signing

    status: utxoStatusEnum("status").notNull().default("free"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"), // request id or serverless invocation id

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The checkout query filters on status='free' — this index makes it instant
    index("idx_utxo_status").on(t.status),
    // Prevent double-insert of the same outpoint
    uniqueIndex("idx_utxo_outpoint").on(t.txid, t.vout),
  ]
);

// ---------------------------------------------------------------------------
// wallet_state
// ---------------------------------------------------------------------------
// Single-row table tracking the funding wallet.
// Only one row should ever exist (id = 1).
// ---------------------------------------------------------------------------

export const walletState = pgTable("wallet_state", {
  id: integer("id").primaryKey().default(1),
  fundingAddress: text("funding_address").notNull(),
  fundingTxid: text("funding_txid"), // last known funding tx
  totalBalance: bigint("total_balance", { mode: "number" }).notNull().default(0),
  freeUtxoCount: integer("free_utxo_count").notNull().default(0),
  lastReplenishedAt: timestamp("last_replenished_at", { withTimezone: true }),
  isReplenishing: boolean("is_replenishing").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// txid_blocklist
// ---------------------------------------------------------------------------
// Legal content delisting. Once a txid is here:
//   - GET /api/comments filters it out of the feed
//   - GET /api/comments/:txid returns 410 Gone
//   - Entries are never deleted (audit trail) — use is_active to deactivate
// ---------------------------------------------------------------------------

export const txidBlocklist = pgTable(
  "txid_blocklist",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    txid: text("txid").notNull().unique(),
    reason: blocklistReasonEnum("reason").notNull(),
    notes: text("notes"), // free-text details (case number, URL, etc.)
    addedBy: text("added_by").notNull().default("admin"), // who added it
    isActive: boolean("is_active").notNull().default(true), // false = soft-removed
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Fast lookup when filtering the feed
    index("idx_blocklist_txid_active").on(t.txid, t.isActive),
  ]
);
