# Content Moderation Policy

Nothing App is an open comment box that writes every comment permanently to the BSV blockchain. Because on-chain data cannot be deleted, content moderation happens **before broadcast**. There is no editing or deletion after a comment is submitted.

This document explains what content is prohibited, how the app enforces that, and what happens when prohibited content is detected.

---

## Prohibited Content

The following content will be rejected before being posted:

- **Child sexual abuse material (CSAM)** — any content involving the sexual exploitation of minors. This is the highest-priority category.
- **Credible threats of violence** — explicit threats to harm specific people or groups.
- **Hate speech** — content that attacks people based on protected characteristics.
- **Harassment** — targeted abuse directed at individuals.
- **Graphic violence** — content depicting extreme or gratuitous violence.
- **Illegal content** — content subject to a valid court order or DMCA takedown.
- **Spam** — repetitive or automated bulk submissions.

---

## Pre-Broadcast Scanning

Every comment is scanned before the BSV transaction is built. No prohibited content reaches the blockchain.

The scanning process:

1. **OpenAI Moderation API** (primary): If `OPENAI_API_KEY` is configured, the comment text is sent to OpenAI's moderation endpoint. This detects the full range of prohibited categories.

2. **Keyword filter** (fallback): If no API key is set, a built-in keyword filter checks for high-confidence indicators of CSAM and explicit threats of violence.

**Fail-closed policy:** If the OpenAI API is configured but temporarily unreachable, the comment is rejected with an error asking the user to try again. A moderation outage never silently allows comments through.

---

## What Happens When a Comment Is Rejected

The user receives an HTTP `400` response with a `code` field indicating the violation category:

```json
{
  "error": "Comment violates content policy.",
  "code": "CONTENT_VIOLATION:hate_speech"
}
```

The rejection happens before any UTXO is checked out, so no BSV transaction is created.

---

## CSAM Detection

When content matching CSAM indicators is detected:

1. The comment is immediately rejected.
2. An internal incident report is generated with a unique `NCMEC-*` report ID.
3. Structured metadata is written to logs (content itself is never logged).
4. An admin alert fires via `ADMIN_ALERT_WEBHOOK_URL` if configured.
5. The NCMEC CyberTipline API is called to file a report.

**NCMEC reporting is a legal obligation** for Electronic Service Providers (ESPs) in the United States under 18 U.S.C. § 2258A. You must register as an ESP and complete the NCMEC integration before launching this app publicly.

Registration: [https://www.missingkids.org/gethelpnow/cybertipline](https://www.missingkids.org/gethelpnow/cybertipline)

The `ncmec.service.ts` file contains a stub that logs the incident and alerts admins. Set `NCMEC_ESP_ID` and `NCMEC_API_TOKEN` to enable automated reporting once registered.

---

## Post-Broadcast Delisting

If prohibited content makes it onto the blockchain despite pre-broadcast screening (for example, content reported after posting, or a DMCA takedown), it can be delisted from this app's UI.

Delisting does not remove the transaction from the BSV blockchain. It prevents the content from appearing in the comment feed and causes direct lookup to return `410 Gone`.

To delist a comment:

```bash
curl -X POST https://your-app.vercel.app/api/admin/blocklist \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "txid": "7f3a9b2c...",
    "reason": "dmca",
    "notes": "DMCA takedown ref #12345",
    "addedBy": "admin"
  }'
```

Valid reasons: `dmca`, `csam`, `court_order`, `hate_speech`, `violence`, `spam`, `other`.

Adding a CSAM reason via the admin API also triggers the NCMEC pipeline automatically.

---

## Reporting Prohibited Content

To report a comment:

1. Note the BSV transaction ID (`txid`) shown on the comment
2. Contact the operator at the address listed in the app
3. Provide: the txid, the reason for the report, and any supporting evidence

Law enforcement and DMCA agents can contact the operator directly to request expedited delisting.

---

## Operator Responsibilities

Before launching this app publicly, the operator must:

- [ ] Configure `OPENAI_API_KEY` for content moderation
- [ ] Register with NCMEC as an ESP and configure `NCMEC_ESP_ID` + `NCMEC_API_TOKEN`
- [ ] Configure `ADMIN_ALERT_WEBHOOK_URL` to receive CSAM alerts immediately
- [ ] Establish a process for responding to DMCA takedown notices within the legally required timeframe
- [ ] Establish a process for responding to court orders
- [ ] Publish a Terms of Service and Privacy Policy

---

## Moderation Configuration Reference

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | Enables the primary moderation scanner. Without it, only the keyword filter runs. |
| `NCMEC_ESP_ID` | Your NCMEC ESP identifier. Required for automated CyberTipline reporting. |
| `NCMEC_API_TOKEN` | Your NCMEC API token. Required for automated CyberTipline reporting. |
| `ADMIN_ALERT_WEBHOOK_URL` | Slack or Discord webhook for CSAM incident alerts. Should go to a monitored channel. |
| `ADMIN_API_KEY` | Protects the blocklist management API. |
