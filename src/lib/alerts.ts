/**
 * Alert dispatcher
 *
 * Sends a plain-text alert message to a configured webhook (Slack or Discord).
 * Used by health checks and cron jobs when thresholds are breached.
 *
 * Set ALERT_WEBHOOK_URL in environment variables to enable.
 * If not set, alerts are logged to console only (never throws).
 *
 * Slack format:   POST { text: "..." }
 * Discord format: POST { content: "..." }
 * Both accept the same payload — Slack ignores unknown keys.
 */

export async function sendAlert(message: string): Promise<void> {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;

  if (!webhookUrl) {
    // No webhook configured — log to console only
    console.warn("[alert]", message);
    return;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: message,     // Slack
        content: message,  // Discord
      }),
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      console.error(
        `[alert] Webhook delivery failed (${res.status}): ${message}`
      );
    }
  } catch (err) {
    // Alert delivery failure must never crash the calling code
    console.error("[alert] Webhook request threw:", err);
  }
}
