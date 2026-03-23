/**
 * NCMEC CyberTipline Reporting Pipeline
 *
 * If CSAM is detected, we are legally required to report to the National
 * Center for Missing & Exploited Children (NCMEC) CyberTipline.
 *
 * CURRENT IMPLEMENTATION: Logging + alerting placeholder.
 * Actual NCMEC API integration requires registration at:
 *   https://www.missingkids.org/gethelpnow/cybertipline
 *
 * When you receive your NCMEC ESP ID and API credentials, replace the
 * submitToNcmecApi() stub with the real HTTP call.
 *
 * Required NCMEC report fields (for when you integrate):
 *   - ESP name and contact information
 *   - Incident date/time (UTC)
 *   - Content description (do NOT include the actual CSAM)
 *   - IP address of uploader if known
 *   - Any identifying information about the uploader
 *   - URL or location where content was found
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NcmecIncident {
  content: string; // the comment text that was flagged
  detectedBy: string; // "openai_moderation" | "keyword_filter"
  detectedAt: string; // ISO 8601 timestamp
  ipAddress?: string; // submitter IP, if known
  txid?: string; // BSV txid, if the comment was already broadcast (should never happen)
}

export interface NcmecReportResult {
  logged: boolean;
  reportId: string; // internal log ID
  ncmecSubmitted: boolean; // true only when real API is wired up
  ncmecReportId?: string; // returned by NCMEC API when integrated
}

// ---------------------------------------------------------------------------
// Internal logging
// ---------------------------------------------------------------------------

function buildReportId(): string {
  return `NCMEC-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function logIncident(reportId: string, incident: NcmecIncident): void {
  // Log to structured stderr so it's captured by Vercel/server log aggregators.
  // NOTE: We intentionally DO NOT log the content itself to avoid storing CSAM
  // in log systems. Only log metadata.
  console.error(
    JSON.stringify({
      severity: "CRITICAL",
      event: "CSAM_DETECTED",
      reportId,
      detectedBy: incident.detectedBy,
      detectedAt: incident.detectedAt,
      ipAddress: incident.ipAddress ?? "unknown",
      txid: incident.txid ?? null,
      contentLength: incident.content.length,
      // DO NOT include incident.content here
      action: "comment_blocked_and_reported",
      message:
        "CSAM detected in comment submission. Comment has been blocked. Report this incident to NCMEC immediately.",
    })
  );
}

function alertAdmin(reportId: string, incident: NcmecIncident): void {
  // When ADMIN_ALERT_EMAIL or ADMIN_ALERT_WEBHOOK_URL are configured,
  // this function should send an out-of-band alert.
  // For now, emit a prominent log entry that monitoring systems can pick up.

  const webhookUrl = process.env.ADMIN_ALERT_WEBHOOK_URL;
  if (webhookUrl) {
    // Fire-and-forget webhook alert — e.g. Slack, Discord, PagerDuty
    const payload = {
      text: `CRITICAL: CSAM detected and blocked. Report ID: ${reportId}. Detected by: ${incident.detectedBy}. Review logs immediately and file NCMEC CyberTipline report.`,
      reportId,
      detectedAt: incident.detectedAt,
    };

    fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch((err) =>
      console.error("[ncmec] Admin webhook alert failed:", err)
    );
  }

  console.error(
    `[ncmec] ADMIN ALERT — CSAM report ID ${reportId} requires immediate attention. ` +
      `File a CyberTipline report at https://www.missingkids.org/gethelpnow/cybertipline`
  );
}

// ---------------------------------------------------------------------------
// NCMEC CyberTipline API — real implementation
// ---------------------------------------------------------------------------

/**
 * NCMEC CyberTipline API endpoint.
 * ESP registrants receive the production URL during onboarding.
 * Override via NCMEC_API_URL env var if NCMEC updates the endpoint.
 *
 * Sandbox: https://cybertiplineapi-staging.missingkids.org/submit
 * Production: provided by NCMEC upon ESP registration
 */
const NCMEC_API_URL =
  process.env.NCMEC_API_URL ??
  "https://cybertiplineapi.missingkids.org/submit";

/** Maximum number of submission attempts before giving up. */
const NCMEC_MAX_RETRIES = 3;

/** Base delay (ms) for exponential backoff between retries. */
const NCMEC_BACKOFF_BASE_MS = 1000;

/**
 * Build a SHA-256 hex hash of the flagged content.
 * We send the hash — never the raw content — so NCMEC can de-duplicate
 * reports without us transmitting CSAM over the wire.
 */
async function hashContent(content: string): Promise<string> {
  // Use the Web Crypto API (available in Node 18+ and all edge runtimes).
  const encoded = new TextEncoder().encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Serialise a NCMEC CyberTipline XML report payload.
 *
 * Field mapping follows the NCMEC Electronic Service Provider (ESP)
 * XML submission spec (v3.1). Credentials and the exact schema are
 * provided to ESPs upon registration.
 *
 * We deliberately omit the raw content and send only its hash so that
 * CSAM is never transmitted through our own infrastructure.
 */
async function buildNcmecXml(
  reportId: string,
  incident: NcmecIncident,
  espId: string
): Promise<string> {
  const contentHash = await hashContent(incident.content);

  // Escape any XML special characters in free-text fields.
  const escapeXml = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");

  const ipElement = incident.ipAddress
    ? `<uploaderIPAddress>${escapeXml(incident.ipAddress)}</uploaderIPAddress>`
    : "";

  const txidElement = incident.txid
    ? `<incidentUrl>bsv:${escapeXml(incident.txid)}</incidentUrl>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<CyberTiplineReport xmlns="http://www.ncmec.org/cybertipline/v3">
  <ESP>
    <ESPId>${escapeXml(espId)}</ESPId>
    <reportingESPName>Nothing App</reportingESPName>
  </ESP>
  <Incident>
    <incidentType>CSAM</incidentType>
    <internalReportId>${escapeXml(reportId)}</internalReportId>
    <incidentDateTime>${escapeXml(incident.detectedAt)}</incidentDateTime>
    <detectionMethod>${escapeXml(incident.detectedBy)}</detectionMethod>
    ${ipElement}
    ${txidElement}
  </Incident>
  <Content>
    <contentHashSHA256>${contentHash}</contentHashSHA256>
    <contentLengthBytes>${incident.content.length}</contentLengthBytes>
    <!-- Raw content is intentionally omitted. Only the hash is submitted. -->
  </Content>
</CyberTiplineReport>`;
}

/**
 * Wait for `ms` milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Attempt one HTTP POST to the NCMEC CyberTipline API.
 * Throws on network error or non-2xx response.
 */
async function postToNcmec(
  xml: string,
  espId: string,
  apiToken: string
): Promise<{ ncmecReportId: string }> {
  const response = await fetch(NCMEC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      Accept: "application/xml",
      // HTTP Basic auth: ESP ID as username, token as password.
      Authorization:
        "Basic " +
        Buffer.from(`${espId}:${apiToken}`, "utf8").toString("base64"),
      "X-Internal-Report-Id": xml.includes("<internalReportId>")
        ? xml.match(/<internalReportId>([^<]+)<\/internalReportId>/)?.[1] ?? ""
        : "",
    },
    body: xml,
  });

  let body = "";
  try {
    body = await response.text();
  } catch {
    // Ignore body-parse errors — status code is sufficient for error handling.
  }

  if (!response.ok) {
    const err = new Error(
      `[ncmec] API responded ${response.status}: ${body.slice(0, 200)}`
    ) as Error & { status: number };
    err.status = response.status;
    throw err;
  }

  // Parse the report ID from the XML response.
  // NCMEC returns <reportId>...</reportId> in the success body.
  const match = body.match(/<reportId>([^<]+)<\/reportId>/);
  const ncmecReportId = match?.[1] ?? `NCMEC-EXT-${Date.now()}`;

  return { ncmecReportId };
}

async function submitToNcmecApi(
  reportId: string,
  incident: NcmecIncident
): Promise<{ submitted: boolean; ncmecReportId?: string }> {
  const espId = process.env.NCMEC_ESP_ID;
  const apiToken = process.env.NCMEC_API_TOKEN;

  if (!espId || !apiToken) {
    if (process.env.NODE_ENV === "production") {
      // CRITICAL: In production, missing NCMEC credentials means CSAM detections
      // are NOT being reported to the CyberTipline. This is a federal legal
      // obligation under 18 U.S.C. § 2258A. Surfacing this loudly so it cannot
      // be silently ignored.
      const missingVars = [
        !espId ? "NCMEC_ESP_ID" : null,
        !apiToken ? "NCMEC_API_TOKEN" : null,
      ]
        .filter(Boolean)
        .join(", ");

      console.error(
        JSON.stringify({
          severity: "CRITICAL",
          event: "NCMEC_CREDENTIALS_MISSING",
          missingVars,
          message:
            "PRODUCTION MISCONFIGURATION: NCMEC CyberTipline credentials are not set. " +
            "CSAM detections WILL NOT be reported to NCMEC. " +
            "This is a federal legal obligation under 18 U.S.C. § 2258A. " +
            "Register as an ESP at https://www.missingkids.org/gethelpnow/cybertipline " +
            "and set " + missingVars + " immediately.",
          reportId,
          detectedAt: incident.detectedAt,
        })
      );

      // Fire the admin alert webhook so the ops team is paged immediately.
      const webhookUrl = process.env.ADMIN_ALERT_WEBHOOK_URL;
      if (webhookUrl) {
        const payload = {
          text:
            `CRITICAL PRODUCTION MISCONFIGURATION: NCMEC credentials missing (${missingVars}). ` +
            `CSAM report ID ${reportId} was NOT filed with NCMEC. ` +
            `This is a federal legal obligation. Set credentials and verify all prior detections were reported manually.`,
          reportId,
          detectedAt: incident.detectedAt,
          event: "NCMEC_CREDENTIALS_MISSING",
        };
        fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).catch((err) =>
          console.error("[ncmec] Failed to send credentials-missing alert:", err)
        );
      }
    } else {
      // Development/staging — a warning is sufficient
      console.warn(
        "[ncmec] NCMEC_ESP_ID and NCMEC_API_TOKEN not configured. " +
          "Register at https://www.missingkids.org/gethelpnow/cybertipline " +
          "to enable automated CyberTipline reporting."
      );
    }
    return { submitted: false };
  }

  let xml: string;
  try {
    xml = await buildNcmecXml(reportId, incident, espId);
  } catch (err) {
    console.error("[ncmec] Failed to build XML payload:", err);
    return { submitted: false };
  }

  // Retry loop with exponential backoff.
  for (let attempt = 1; attempt <= NCMEC_MAX_RETRIES; attempt++) {
    try {
      const result = await postToNcmec(xml, espId, apiToken);
      console.error(
        JSON.stringify({
          severity: "INFO",
          event: "NCMEC_REPORT_SUBMITTED",
          reportId,
          ncmecReportId: result.ncmecReportId,
          attempt,
        })
      );
      return { submitted: true, ncmecReportId: result.ncmecReportId };
    } catch (err) {
      const isClientError =
        err instanceof Error &&
        (err as Error & { status?: number }).status !== undefined &&
        (err as Error & { status: number }).status < 500;

      if (isClientError) {
        // 4xx — retrying will not help (bad credentials, schema error, etc.)
        console.error(
          `[ncmec] Non-retriable API error on attempt ${attempt}:`,
          err instanceof Error ? err.message : String(err)
        );
        return { submitted: false };
      }

      const isLastAttempt = attempt === NCMEC_MAX_RETRIES;
      if (isLastAttempt) {
        console.error(
          `[ncmec] All ${NCMEC_MAX_RETRIES} submission attempts failed. ` +
            `Falling back to alert-only path. Last error:`,
          err instanceof Error ? err.message : String(err)
        );
        return { submitted: false };
      }

      const backoffMs = NCMEC_BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
      console.warn(
        `[ncmec] Attempt ${attempt} failed — retrying in ${backoffMs}ms:`,
        err instanceof Error ? err.message : String(err)
      );
      await sleep(backoffMs);
    }
  }

  // Should be unreachable, but TypeScript requires a return.
  return { submitted: false };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reports a CSAM incident to NCMEC.
 *
 * Steps:
 *   1. Log incident with structured metadata (never logs actual content)
 *   2. Alert admin via webhook if configured
 *   3. Attempt NCMEC CyberTipline API submission (stub until registered)
 *
 * This function should be called BEFORE the comment is rejected,
 * ensuring we always have a log trail even if the caller crashes.
 */
export async function reportToNcmec(
  incident: NcmecIncident
): Promise<NcmecReportResult> {
  const reportId = buildReportId();

  // Step 1: Log immediately — this must not fail
  try {
    logIncident(reportId, incident);
  } catch (err) {
    console.error("[ncmec] Failed to log CSAM incident:", err);
  }

  // Step 2: Alert admin
  try {
    alertAdmin(reportId, incident);
  } catch (err) {
    console.error("[ncmec] Failed to alert admin:", err);
  }

  // Step 3: NCMEC API (non-blocking — don't fail the rejection if this errors)
  let ncmecSubmitted = false;
  let ncmecReportId: string | undefined;
  try {
    const apiResult = await submitToNcmecApi(reportId, incident);
    ncmecSubmitted = apiResult.submitted;
    ncmecReportId = apiResult.ncmecReportId;
  } catch (err) {
    console.error("[ncmec] API submission failed:", err);
  }

  return {
    logged: true,
    reportId,
    ncmecSubmitted,
    ncmecReportId,
  };
}
