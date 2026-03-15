// OP_RETURN protocol identifiers
export const APP_PREFIX = "NothingApp";
export const PROTOCOL_VERSION = "1.0";
export const ACTION_COMMENT = "comment";

// ARC broadcast endpoint
export const ARC_URL = "https://arc.taal.com/v1/tx";

// Dust / fee constants
export const DUST_LIMIT = 1; // satoshis — OP_RETURN outputs are 0, P2PKH min is 1
export const FEE_PER_KB = 10; // satoshis per 1000 bytes (BSV mainnet standard)
export const APPROX_TX_BYTES = 300; // conservative estimate for a 1-in, 2-out tx
export const MIN_FEE = 5; // absolute minimum fee in satoshis

// Comment constraints
export const MAX_COMMENT_LENGTH = parseInt(
  process.env.NEXT_PUBLIC_MAX_COMMENT_LENGTH ?? "512",
  10
);
export const MAX_DISPLAY_NAME_LENGTH = 64;

// UTXO pool
export const UTXO_LOCK_TIMEOUT_SECONDS = 60;
export const UTXO_REPLENISH_THRESHOLD = 5; // replenish when free count drops below this
export const UTXO_SPLIT_TARGET = 20; // how many UTXOs to maintain

// Pagination
export const COMMENTS_PAGE_SIZE = 20;

// Rate limiting
export const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX ?? "5", 10);
export const RATE_LIMIT_WINDOW_SECONDS = parseInt(
  process.env.RATE_LIMIT_WINDOW ?? "60",
  10
);

// Monitoring alert thresholds
// Alert fires when free UTXO count drops below this value
export const ALERT_UTXO_MIN_FREE = parseInt(
  process.env.ALERT_UTXO_MIN_FREE ?? "3",
  10
);
// Alert fires when wallet balance drops below this value (satoshis)
export const ALERT_WALLET_MIN_SATS = parseInt(
  process.env.ALERT_WALLET_MIN_SATS ?? "10000",
  10
);
