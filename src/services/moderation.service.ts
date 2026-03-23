/**
 * Content Moderation Service
 *
 * Every comment MUST pass moderation BEFORE being broadcast to BSV.
 * Once on-chain, content cannot be removed.
 *
 * Strategy (in order):
 *   1. OpenAI Moderation API (free tier, uses OPENAI_API_KEY)
 *   2. Keyword-based fallback filter
 *
 * Fail-CLOSED policy: if the primary API is configured but unreachable,
 * the comment is REJECTED. If no API key is set, the keyword fallback runs.
 */

// STANDBY: NCMEC reporting — re-enable when ESP registration is complete
async function reportToNcmec(_incident: unknown): Promise<void> {
  console.warn("[moderation] NCMEC reporting is on standby. Incident logged only.");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CrisisResource {
  name: string;
  contact: string;
  url: string;
}

export interface CrisisResources {
  message: string;
  resources: CrisisResource[];
}

export interface ModerationResult {
  approved: boolean;
  violationCategory?: string;
  violationDetails?: string;
  crisisResources?: CrisisResources;
}

// ---------------------------------------------------------------------------
// Self-harm categories that trigger crisis resource display
// ---------------------------------------------------------------------------

const SELF_HARM_CATEGORIES = new Set([
  "self_harm",
  "self_harm_intent",
  "self_harm_instructions",
]);

export function buildCrisisResources(): CrisisResources {
  return {
    message: "If you or someone you know is struggling, help is available.",
    resources: [
      {
        name: "988 Suicide & Crisis Lifeline",
        contact: "Call or text 988",
        url: "https://988lifeline.org",
      },
      {
        name: "Crisis Text Line",
        contact: "Text HOME to 741741",
        url: "https://www.crisistextline.org",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// OpenAI Moderation API
// ---------------------------------------------------------------------------

interface OpenAIModerationResponse {
  id: string;
  model: string;
  results: Array<{
    flagged: boolean;
    categories: Record<string, boolean>;
    category_scores: Record<string, number>;
  }>;
}

// Maps OpenAI category names to our violation labels
const OPENAI_CATEGORY_LABELS: Record<string, string> = {
  sexual: "sexual_content",
  "sexual/minors": "csam",
  hate: "hate_speech",
  "hate/threatening": "hate_threatening",
  harassment: "harassment",
  "harassment/threatening": "harassment_threatening",
  "self-harm": "self_harm",
  "self-harm/intent": "self_harm_intent",
  "self-harm/instructions": "self_harm_instructions",
  violence: "violence",
  "violence/graphic": "violence_graphic",
  illicit: "illicit",
  "illicit/violent": "illicit_violent",
};

async function runOpenAIModeration(text: string): Promise<ModerationResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Defense in depth: never silently approve — the public moderateComment()
    // function guards this for production, but this inner function must not
    // have a hidden bypass path if call flow ever changes.
    throw new ModerationUnavailableError("OPENAI_API_KEY not configured");
  }

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ input: text }),
      signal: AbortSignal.timeout(5000), // 5s timeout — budget: mod(5s) + ARC1(10s) + ARC2(10s) = 25s < 30s maxDuration
    });
  } catch (err) {
    // Network failure — fail CLOSED
    console.error("[moderation] OpenAI API unreachable:", err);
    throw new ModerationUnavailableError(
      "Content moderation service is temporarily unavailable. Please try again."
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "(unreadable)");
    console.error(
      `[moderation] OpenAI API error ${response.status}: ${body}`
    );
    throw new ModerationUnavailableError(
      "Content moderation service returned an error. Please try again."
    );
  }

  const data: OpenAIModerationResponse = await response.json();
  const result = data.results[0];

  if (!result) {
    throw new ModerationUnavailableError(
      "Content moderation service returned an unexpected response."
    );
  }

  if (!result.flagged) {
    return { approved: true };
  }

  // Find the highest-scoring flagged category
  const flaggedCategories = Object.entries(result.categories)
    .filter(([, flagged]) => flagged)
    .map(([category]) => category);

  // CSAM must be handled immediately — report and blocklist
  if (flaggedCategories.includes("sexual/minors")) {
    await handleCsamDetection(text, "openai_moderation");
  }

  const primaryCategory = flaggedCategories[0] ?? "policy_violation";
  const label = OPENAI_CATEGORY_LABELS[primaryCategory] ?? primaryCategory;

  const moderationResult: ModerationResult = {
    approved: false,
    violationCategory: label,
    violationDetails: `Flagged by content policy: ${flaggedCategories.join(", ")}`,
  };

  if (SELF_HARM_CATEGORIES.has(label)) {
    moderationResult.crisisResources = buildCrisisResources();
  }

  return moderationResult;
}

// ---------------------------------------------------------------------------
// Keyword fallback filter
// ---------------------------------------------------------------------------
// This is NOT a replacement for proper moderation. It is a last-resort
// filter when no API key is configured.
// ---------------------------------------------------------------------------

// Split into tiers so we can use the right violation category
const KEYWORD_TIERS: Array<{ category: string; patterns: RegExp[] }> = [
  {
    // Tier 1: CSAM indicators — must be checked first
    category: "csam",
    patterns: [
      /\bcsam\b/i,
      /child\s*(sex|porn|nude|naked|abuse)/i,
      /\bpedoph/i,
      /loli(ta|con)?\s*(sex|nude|porn)/i,
    ],
  },
  {
    // Tier 2: Credible threats
    category: "violence_threatening",
    patterns: [
      /i\s+will\s+kill\s+you/i,
      /i\s+will\s+hurt\s+you/i,
      /bomb\s*(threat|attack|school|building)/i,
    ],
  },
];

/**
 * Strip zero-width and invisible Unicode characters (category Cf) and apply
 * NFKC normalization to collapse homoglyphs. Without this, attackers can
 * insert U+200B etc. between letters of banned terms to bypass keyword regex.
 */
function stripInvisibleChars(text: string): string {
  return text
    .replace(/[\u200B-\u200F\u2028-\u202F\u2060-\u2064\uFEFF\u00AD\u034F\u061C\u180E]/g, '')
    .normalize('NFKC');
}

function runKeywordFilter(text: string): ModerationResult {
  const sanitized = stripInvisibleChars(text);

  for (const tier of KEYWORD_TIERS) {
    for (const pattern of tier.patterns) {
      if (pattern.test(sanitized)) {
        if (tier.category === "csam") {
          // Fire CSAM handler asynchronously — don't block the rejection
          handleCsamDetection(text, "keyword_filter").catch((err) =>
            console.error("[moderation] CSAM handler error:", err)
          );
        }
        return {
          approved: false,
          violationCategory: tier.category,
          violationDetails: `Matched content policy filter (${tier.category})`,
        };
      }
    }
  }

  return { approved: true };
}

// ---------------------------------------------------------------------------
// CSAM handler — calls NCMEC reporting pipeline
// ---------------------------------------------------------------------------

async function handleCsamDetection(
  content: string,
  detectedBy: string
): Promise<void> {
  console.error("[moderation] CSAM DETECTED", { detectedBy });
  try {
    await reportToNcmec({
      content,
      detectedBy,
      detectedAt: new Date().toISOString(),
    });
  } catch (err) {
    // NCMEC reporting failure must not swallow the underlying rejection
    console.error("[moderation] NCMEC report submission failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scans comment text for policy violations.
 *
 * Fail-CLOSED: if OPENAI_API_KEY is set and the API is unreachable,
 * throws ModerationUnavailableError. Callers must treat this as a rejection.
 *
 * In production, OPENAI_API_KEY is required. Missing key throws
 * ModerationUnavailableError immediately — no fallback is attempted.
 *
 * In development/test, missing key falls back to the keyword filter.
 */
export async function moderateComment(
  text: string
): Promise<ModerationResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  const isProduction = process.env.NODE_ENV === "production";

  if (!apiKey && isProduction) {
    throw new ModerationUnavailableError(
      "Content moderation service not configured"
    );
  }

  if (apiKey) {
    // Primary: OpenAI — throws on unavailability (fail CLOSED)
    return runOpenAIModeration(text);
  }

  // Fallback: keyword filter — development/test only
  console.warn(
    "[moderation] OPENAI_API_KEY not set — using keyword filter fallback (dev/test only)"
  );
  return runKeywordFilter(text);
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ModerationUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModerationUnavailableError";
  }
}
