-- ============================================================================
-- Nothing App — Comment Box Schema
-- Run once against your Supabase Postgres instance.
-- Drizzle migrations will handle this going forward, but this is the
-- reference SQL for review and manual setup.
-- ============================================================================

-- Enum for UTXO lifecycle
CREATE TYPE utxo_status AS ENUM ('free', 'locked', 'spent');

-- ---------------------------------------------------------------------------
-- comments
-- ---------------------------------------------------------------------------

CREATE TABLE comments (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    txid           TEXT NOT NULL UNIQUE,
    display_name   TEXT NOT NULL DEFAULT 'Anonymous',
    comment_text   TEXT NOT NULL,
    parent_txid    TEXT,                              -- NULL = top-level
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cursor-based pagination: WHERE (created_at, id) < ($cursor_ts, $cursor_id)
CREATE INDEX idx_comments_cursor ON comments (created_at, id);

-- Thread lookups
CREATE INDEX idx_comments_parent ON comments (parent_txid);

-- ---------------------------------------------------------------------------
-- utxo_pool
-- ---------------------------------------------------------------------------

CREATE TABLE utxo_pool (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    txid           TEXT NOT NULL,
    vout           INTEGER NOT NULL,
    satoshis       BIGINT NOT NULL,
    script_hex     TEXT NOT NULL,

    status         utxo_status NOT NULL DEFAULT 'free',
    locked_at      TIMESTAMPTZ,
    locked_by      TEXT,

    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (txid, vout)                               -- no duplicate outpoints
);

-- Checkout query filters on status
CREATE INDEX idx_utxo_status ON utxo_pool (status);

-- ---------------------------------------------------------------------------
-- wallet_state (single-row)
-- ---------------------------------------------------------------------------

CREATE TABLE wallet_state (
    id                  INTEGER PRIMARY KEY DEFAULT 1,
    funding_address     TEXT NOT NULL,
    funding_txid        TEXT,
    total_balance       BIGINT NOT NULL DEFAULT 0,
    free_utxo_count     INTEGER NOT NULL DEFAULT 0,
    last_replenished_at TIMESTAMPTZ,
    is_replenishing     BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Enforce single-row
    CONSTRAINT single_row CHECK (id = 1)
);

-- ---------------------------------------------------------------------------
-- The UTXO checkout query (for reference — used from application code)
-- ---------------------------------------------------------------------------
-- Must be run inside a transaction:
--
--   BEGIN;
--
--   UPDATE utxo_pool
--   SET status = 'locked', locked_at = NOW(), locked_by = $request_id
--   WHERE id = (
--       SELECT id FROM utxo_pool
--       WHERE status = 'free'
--       ORDER BY satoshis ASC
--       LIMIT 1
--       FOR UPDATE SKIP LOCKED
--   )
--   RETURNING id, txid, vout, satoshis, script_hex;
--
--   -- ... sign tx, broadcast to ARC ...
--
--   UPDATE utxo_pool SET status = 'spent' WHERE id = $utxo_id;
--   INSERT INTO comments (txid, display_name, comment_text, parent_txid)
--   VALUES ($broadcast_txid, $name, $text, $parent);
--
--   COMMIT;

-- ---------------------------------------------------------------------------
-- Stale lock recovery (cron — every 1-2 minutes)
-- ---------------------------------------------------------------------------
--
--   UPDATE utxo_pool
--   SET status = 'free', locked_at = NULL, locked_by = NULL
--   WHERE status = 'locked'
--     AND locked_at < NOW() - INTERVAL '60 seconds'
--   RETURNING id, txid, vout;

-- ---------------------------------------------------------------------------
-- txid_blocklist — legal content delisting (MAX-3)
-- ---------------------------------------------------------------------------
-- Add this after the initial schema has been applied.
-- ---------------------------------------------------------------------------

CREATE TYPE blocklist_reason AS ENUM (
    'dmca',
    'csam',
    'court_order',
    'hate_speech',
    'violence',
    'spam',
    'other'
);

CREATE TABLE txid_blocklist (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    txid        TEXT NOT NULL UNIQUE,
    reason      blocklist_reason NOT NULL,
    notes       TEXT,                             -- case number, URL, etc.
    added_by    TEXT NOT NULL DEFAULT 'admin',
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup when filtering the comment feed
CREATE INDEX idx_blocklist_txid_active ON txid_blocklist (txid, is_active);
