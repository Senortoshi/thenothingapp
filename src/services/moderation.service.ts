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

import { reportToNcmec } from "./ncmec.service";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModerationResult {
  approved: boolean;
  violationCategory?: string;
  violationDetails?: string;
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
    // No API key — fall through to keyword filter
    return { approved: true };
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
      signal: AbortSignal.timeout(8000), // 8s timeout
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

  return {
    approved: false,
    violationCategory: label,
    violationDetails: `Flagged by content policy: ${flaggedCategories.join(", ")}`,
  };
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

function runKeywordFilter(text: string): ModerationResult {
  for (const tier of KEYWORD_TIERS) {
    for (const pattern of tier.patterns) {
      if (pattern.test(text)) {
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
 * If no API key is set, falls back to keyword filter (fail-OPEN on API,
 * fail-CLOSED on keywords).
 */
export async function moderateComment(
  text: string
): Promise<ModerationResult> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (apiKey) {
    // Primary: OpenAI — throws on unavailability (fail CLOSED)
    return runOpenAIModeration(text);
  }

  // Fallback: keyword filter
  console.warn(
    "[moderation] OPENAI_API_KEY not set — using keyword filter fallback"
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
