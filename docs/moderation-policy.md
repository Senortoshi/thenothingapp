# Content Moderation Policy

Nothing App is an open comment box that writes every comment permanently to the BSV blockchain. Because on-chain data cannot be deleted, content moderation happens **before broadcast**. There is no editing or deletion after a comment is submitted.

This document explains what content is prohibited, how the app enforces that, and what happens when prohibited content is detected.

---

## LAUNCH BLOCKER: NCMEC ESP Registration Required

**This app must not be made publicly accessible until NCMEC Electronic Service Provider registration is complete and `NCMEC_ESP_ID` and `NCMEC_API_TOKEN` are configured in the production environment.**

Nothing App is an Electronic Service Provider (ESP) under 18 U.S.C. § 2258A. U.S. federal law requires ESPs to report apparent CSAM violations to the NCMEC CyberTipline. Operating without this registration is a federal criminal offense. There is no grace period and no safe harbor for unregistered providers.

**Steps to register:**

1. Go to [https://www.missingkids.org/gethelpnow/cybertipline](https://www.missingkids.org/gethelpnow/cybertipline).
2. Click "Electronic Service Providers" and follow the link to the ESP registration portal.
3. Complete the organization registration form. Required information:
   - Legal name of the operating entity
   - Primary contact name, title, and direct email address
   - Business address
   - Brief description of the service (public on-chain comment platform)
   - Estimated monthly active users
4. A legal representative or officer of the entity must submit and sign the registration. This is not a developer task.
5. Registration review typically takes 3–10 business days. Do not launch while it is pending.
6. Upon approval, you will receive an ESP ID and API token.
7. Set `NCMEC_ESP_ID` and `NCMEC_API_TOKEN` in the production environment.
8. Verify the integration by reviewing `src/services/ncmec.service.ts` and confirming both variables are read and sent to the CyberTipline API on each CSAM detection.

See also: [Pre-Launch Safety Checklist](pre-launch-safety-checklist.md) Section 2.

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

**NCMEC reporting is a legal obligation** for Electronic Service Providers (ESPs) in the United States under 18 U.S.C. § 2258A. See the LAUNCH BLOCKER section at the top of this document.

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

To report a comment that violates this policy:

1. Note the BSV transaction ID (`txid`) shown on the comment.
2. Email **abuse@nothing.app** with the txid, the reason for the report, and any supporting evidence.
3. DMCA (copyright) takedown requests should be directed to **dmca@nothing.app**.
4. Law enforcement and government legal process should be directed to **legal@nothing.app**.

We aim to review reports within 24 hours. Credible safety threats are treated as priority.

---

## Operator Responsibilities Before Launch

The operator must complete all items in the [Pre-Launch Safety Checklist](pre-launch-safety-checklist.md) before making this app publicly accessible.

Summary of required steps:

- Configure `OPENAI_API_KEY` for content moderation. Without it, only the keyword filter runs.
- Register with NCMEC as an ESP and configure `NCMEC_ESP_ID` and `NCMEC_API_TOKEN`. **This is a federal legal requirement. It is not optional.**
- Configure `ADMIN_ALERT_WEBHOOK_URL` to receive CSAM alerts in a monitored channel.
- Establish a written process for responding to DMCA takedown notices within a legally defensible timeframe.
- Establish a written process for responding to court orders.
- Publish Terms of Service and Privacy Policy at `/terms` and `/privacy`.
- Publish a contact address for abuse reports, DMCA notices, and law enforcement requests.
- Register a DMCA Designated Agent with the U.S. Copyright Office to preserve safe harbor protection.

---

## Moderation Configuration Reference

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | Enables the primary moderation scanner. Without it, only the keyword filter runs. |
| `NCMEC_ESP_ID` | Your NCMEC ESP identifier. Required for automated CyberTipline reporting. **Required before launch.** |
| `NCMEC_API_TOKEN` | Your NCMEC API token. Required for automated CyberTipline reporting. **Required before launch.** |
| `ADMIN_ALERT_WEBHOOK_URL` | Slack or Discord webhook for CSAM incident alerts. Must go to a monitored channel with a named responder. |
| `ADMIN_API_KEY` | Protects the blocklist management API. Required for any production deployment. |
