// OP_RETURN protocol identifiers
export const APP_PREFIX = "BSVibes";
// Legacy prefix used in earlier versions — accepted when reading, never written
export const LEGACY_APP_PREFIX = "NothingApp";
export const PROTOCOL_VERSION = "1.0";
export const ACTION_COMMENT = "comment";

// ARC broadcast endpoints
export const ARC_URL = "https://arc.taal.com/v1/tx";
export const GORILLAPOOL_ARC_URL = "https://arc.gorillapool.io/v1/tx";

// Dust / fee constants
export const DUST_LIMIT = 546; // satoshis — operational dust threshold for P2PKH outputs
export const FEE_PER_KB = 500; // satoshis per 1000 bytes (BSV mainnet standard relay fee)
export const APPROX_TX_BYTES = 300; // conservative estimate for a 1-in, 2-out tx
export const MIN_FEE = 5; // absolute minimum fee in satoshis

// Comment constraints
// Hard ceiling prevents operator misconfiguration from allowing oversized
// transactions that could drain the wallet in a single request.
const HARD_MAX_COMMENT_LENGTH = 2048;
export const MAX_COMMENT_LENGTH = Math.min(
  parseInt(process.env.NEXT_PUBLIC_MAX_COMMENT_LENGTH ?? "512", 10),
  HARD_MAX_COMMENT_LENGTH
);
export const MAX_DISPLAY_NAME_LENGTH = 64;

// WhatsOnChain API
export const WOC_BASE_URL = "https://api.whatsonchain.com/v1/bsv/main";
export const WOC_TIMEOUT_MS = 8000;

// Feed cache
export const FEED_CACHE_TTL_SECONDS = 30;
export const FEED_CACHE_MAX_ITEMS = 200;

// Pagination
export const COMMENTS_PAGE_SIZE = 20;

// Rate limiting — per-IP
export const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX ?? "5", 10);
export const RATE_LIMIT_WINDOW_SECONDS = parseInt(
  process.env.RATE_LIMIT_WINDOW ?? "60",
  10
);

// Rate limiting — global (single source of truth; consumed by rate-limiter.ts)
export const GLOBAL_RATE_LIMIT_MAX = parseInt(
  process.env.GLOBAL_RATE_LIMIT_MAX ?? "500",
  10
);
export const GLOBAL_RATE_LIMIT_WINDOW = parseInt(
  process.env.GLOBAL_RATE_LIMIT_WINDOW ?? "3600",
  10
);

// Daily on-chain spend cap
export const DAILY_SPEND_CAP_SATS = parseInt(
  process.env.DAILY_SPEND_CAP_SATS ?? "50000",
  10
);

// Per-IP daily comment limit (prevents a single actor from burning the global cap)
export const RATE_LIMIT_DAILY_MAX = parseInt(
  process.env.RATE_LIMIT_DAILY_MAX ?? "100",
  10
);

// Circuit breaker
export const CIRCUIT_BREAKER_THRESHOLD = parseInt(
  process.env.CIRCUIT_BREAKER_THRESHOLD ?? "10",
  10
);
export const CIRCUIT_BREAKER_COOLDOWN_SECONDS = parseInt(
  process.env.CIRCUIT_BREAKER_COOLDOWN_SECONDS ?? "300",
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
