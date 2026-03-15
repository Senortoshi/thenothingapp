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
// NCMEC API stub — replace this when you register as an ESP
// ---------------------------------------------------------------------------

async function submitToNcmecApi(
  _reportId: string,
  _incident: NcmecIncident
): Promise<{ submitted: boolean; ncmecReportId?: string }> {
  const espId = process.env.NCMEC_ESP_ID;
  const apiToken = process.env.NCMEC_API_TOKEN;

  if (!espId || !apiToken) {
    // Not yet registered — log and return unsubmitted
    console.warn(
      "[ncmec] NCMEC_ESP_ID and NCMEC_API_TOKEN not configured. " +
        "Register at https://www.missingkids.org/gethelpnow/cybertipline " +
        "to enable automated CyberTipline reporting."
    );
    return { submitted: false };
  }

  // TODO: Replace with actual NCMEC CyberTipline API call once registered.
  // NCMEC provides an XML-based API. Documentation is provided upon ESP registration.
  // Example endpoint (not real, for reference only):
  //   POST https://api.missingkids.org/cybertipline/v1/report
  //
  // return { submitted: true, ncmecReportId: response.data.reportId };

  console.warn("[ncmec] NCMEC ESP credentials present but API not yet wired. Update ncmec.service.ts.");
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
