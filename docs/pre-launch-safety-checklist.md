# Pre-Launch Safety Checklist

This checklist must be completed in full before the Nothing App is made publicly accessible. Each item specifies what to do, how to confirm it works, who is accountable, and the consequence of skipping it.

Items marked **LEGAL OBLIGATION** are not optional under U.S. federal law or applicable state law.

---

## How to Use This Document

Work through every section in order. Do not mark an item complete until the verification step passes. Keep a signed and dated copy of this completed checklist as evidence of due diligence.

---

## Section 1: Content Moderation Infrastructure

---

### 1.1 OpenAI Moderation API

**What to do**

Set `OPENAI_API_KEY` in the production environment (Vercel Environment Variables or equivalent). The key must belong to an account with access to `text-moderation-latest` or `omni-moderation-latest`.

**How to verify**

1. Deploy to a staging environment with the key set.
2. Submit a comment containing an obvious policy violation via `POST /api/comments`.
3. Confirm the response is `400` with `"code": "CONTENT_VIOLATION:*"`.
4. Submit a benign comment. Confirm it succeeds with `201`.
5. Temporarily remove the key and submit any comment. Confirm the response is `503` with `"code": "MODERATION_UNAVAILABLE"` — this confirms fail-closed behavior is working.

**Who is accountable**

The operator deploying to production.

**Consequence of skipping**

The app falls back to a keyword filter only. The keyword filter catches a narrow set of high-confidence CSAM and threat phrases. The vast majority of policy violations — hate speech, harassment, graphic violence — will reach the blockchain unscreened. Once on-chain, they cannot be deleted. The operator will be liable for that content.

---

### 1.2 ADMIN_ALERT_WEBHOOK_URL for CSAM Incidents

**What to do**

Create a dedicated Slack or Discord channel accessible only to personnel authorized to handle CSAM-related incidents. Set `ADMIN_ALERT_WEBHOOK_URL` to the incoming webhook URL for that channel. This channel must be monitored during all hours the app is publicly accessible.

**How to verify**

1. With the environment variable set, call the NCMEC pipeline manually (or trigger a test alert via the health endpoint with a staged CSAM detection).
2. Confirm the alert appears in the target channel within 60 seconds.
3. Confirm the channel is not accessible to personnel who are not cleared for this material.

**Who is accountable**

The operator. A named individual must be designated as the CSAM incident responder before launch.

**Consequence of skipping**

CSAM detections will still be rejected and logged, but no human will be alerted. A delayed human response to a CSAM incident may constitute a failure to act on a known violation, which carries legal and reputational risk under 18 U.S.C. § 2258A.

---

### 1.3 ADMIN_API_KEY

**What to do**

Generate a cryptographically random secret of at least 32 characters. Set it as `ADMIN_API_KEY` in the production environment. Store it in a secrets manager (e.g., 1Password, AWS Secrets Manager). Do not commit it to source control.

**How to verify**

1. Call `GET /api/admin/blocklist` without an Authorization header. Confirm `401 Unauthorized`.
2. Call with `Authorization: Bearer wrongkey`. Confirm `401 Unauthorized`.
3. Call with the correct key. Confirm `200 OK`.

**Who is accountable**

The operator.

**Consequence of skipping**

If `ADMIN_API_KEY` is not set, the admin routes return `503 Service Unavailable`. The blocklist cannot be managed, meaning prohibited content that makes it past pre-broadcast screening cannot be delisted.

---

## Section 2: NCMEC ESP Registration (LEGAL OBLIGATION)

**THIS SECTION IS A LEGAL PREREQUISITE. THE APP MUST NOT BE LAUNCHED PUBLICLY UNTIL ALL ITEMS IN THIS SECTION ARE COMPLETE.**

Under 18 U.S.C. § 2258A, any Electronic Service Provider (ESP) that obtains knowledge of an apparent violation involving child sexual abuse material (CSAM) must report it to the NCMEC CyberTipline. Failure to report is a federal crime. The Nothing App is an ESP by virtue of allowing users to transmit content.

---

### 2.1 Register as an ESP with NCMEC

**What to do**

1. Go to [https://www.missingkids.org/gethelpnow/cybertipline](https://www.missingkids.org/gethelpnow/cybertipline).
2. Click "Electronic Service Providers" and follow the link to the ESP registration portal.
3. Complete the organization registration form. You will need:
   - Legal name of the operating entity
   - Primary contact name, title, and email address
   - Business address
   - Description of the service (a public on-chain comment platform)
   - Estimate of monthly active users
4. NCMEC will review the application and issue an ESP ID and API token. This process typically takes 3-10 business days.
5. Do not launch publicly while registration is pending.

**How to verify**

You have received a confirmation email from NCMEC and have been issued:
- An ESP ID (numeric)
- An API token (string)

**Who is accountable**

A named officer or legal representative of the operating entity must submit and sign the registration. This is not a task that can be delegated to a developer.

**Consequence of skipping**

Operating without NCMEC registration is a federal criminal offense under 18 U.S.C. § 2258A. Any detection of CSAM during operation without registration is an unreported known violation. This is not a risk that can be mitigated by technical measures.

---

### 2.2 Configure NCMEC Credentials in Production

**What to do**

Set `NCMEC_ESP_ID` and `NCMEC_API_TOKEN` in the production environment using the credentials received from NCMEC in step 2.1.

**How to verify**

1. Review `src/services/ncmec.service.ts`. Confirm that the service reads `NCMEC_ESP_ID` and `NCMEC_API_TOKEN` from environment variables.
2. Confirm both variables are set in the Vercel Environment Variables panel (or equivalent) before the production deployment.
3. Using NCMEC's test environment (if available), trigger a test report and confirm receipt. If no test environment is available, confirm with NCMEC staff that the integration is correctly configured before launch.

**Who is accountable**

The operator (technical lead).

**Consequence of skipping**

The `ncmec.service.ts` stub will log CSAM incidents and fire admin alerts but will not file a CyberTipline report. This means detected CSAM is known to the operator but not reported — the worst possible legal position. See Section 2.1.

---

### 2.3 Establish a CSAM Incident Response Process

**What to do**

Before launch, write and distribute a brief internal procedure covering:

1. Who receives CSAM alerts (the monitored webhook channel from 1.2).
2. What that person does within the first 30 minutes: confirm the alert, verify the txid in the blocklist, confirm the NCMEC report was filed.
3. Who they escalate to if the automated NCMEC report failed.
4. How the incident is logged internally.

**How to verify**

The procedure document exists, has been reviewed by legal counsel, and has been shared with every person who has access to the CSAM alert channel.

**Who is accountable**

The operator.

**Consequence of skipping**

Even with the technical pipeline working, an unread alert is an unhandled incident. If the automated NCMEC report fails for any reason (API outage, misconfiguration), there is no human fallback, and the failure may not be discovered for days.

---

## Section 3: DMCA and Legal Process Procedures

---

### 3.1 DMCA Designated Agent Registration

**What to do**

If the Service is subject to the DMCA (17 U.S.C. § 512), the operator must register a Designated Agent with the U.S. Copyright Office at [https://www.copyright.gov/dmca-directory/](https://www.copyright.gov/dmca-directory/). The registration fee is $6 per agent, valid for three years.

The registered agent's contact information must be published in an accessible location on the Service.

**How to verify**

The agent appears in the Copyright Office online directory search. The contact information is published on the site and/or in the Terms of Service.

**Who is accountable**

The operator's legal representative.

**Consequence of skipping**

The operator loses safe harbor protection under the DMCA, meaning it can be held liable for infringing content posted by users even when it had no prior knowledge.

---

### 3.2 DMCA Response Process

**What to do**

Establish a written process for responding to DMCA takedown notices. The process must result in delisting within a legally defensible timeframe (courts have accepted "expeditious" to mean hours to a few days, not weeks). The process must include:

- A designated inbox for receiving DMCA notices
- A named person responsible for processing each notice
- Use of `POST /api/admin/blocklist` with `reason: "dmca"` to delist the identified txid
- A template counter-notice response to the original reporter

**How to verify**

The process document exists and has been reviewed by legal counsel.

**Who is accountable**

The operator.

**Consequence of skipping**

Failure to respond expeditiously to valid DMCA notices removes safe harbor protection for that specific content and opens the operator to direct infringement liability.

---

### 3.3 Court Order Response Process

**What to do**

Establish a contact point (email or physical address) that law enforcement and courts can use to serve orders. Designate a person responsible for receiving and acting on court orders. Use `POST /api/admin/blocklist` with `reason: "court_order"` to delist content subject to a valid order.

**How to verify**

The contact point is published on the site. A named person is assigned.

**Who is accountable**

The operator.

**Consequence of skipping**

Failing to act on a valid court order is contempt of court.

---

## Section 4: Published Legal Policies

---

### 4.1 Terms of Service Live at /terms

**What to do**

The Terms of Service page at `/terms` must be live on the production domain before launch. Verify the "Last updated" date matches the most recent material revision.

**How to verify**

`curl -I https://your-production-domain.com/terms` returns `200 OK`.

**Who is accountable**

The operator.

**Consequence of skipping**

Without published Terms, users have no notice of the permanence of content, the conduct rules, or the fee structure. This exposes the operator to user disputes and may affect enforceability of the Terms themselves.

---

### 4.2 Privacy Policy Live at /privacy

**What to do**

The Privacy Policy page at `/privacy` must be live on the production domain before launch. The contact address (`privacy@nothing.app`) must resolve to a monitored inbox.

**How to verify**

1. `curl -I https://your-production-domain.com/privacy` returns `200 OK`.
2. Send a test email to `privacy@nothing.app` and confirm receipt.

**Who is accountable**

The operator.

**Consequence of skipping**

A published privacy policy is required by CalOPPA, GDPR, and many other privacy frameworks. Operating without one exposes the operator to regulatory action.

---

### 4.3 Contact and Report Mechanism Visible to Users

**What to do**

A contact email address for content reports must appear:

1. In the site footer (every page, via `layout.tsx`)
2. In the Privacy Policy (already present as `privacy@nothing.app`)
3. In the Moderation Policy (currently says "Contact the operator at the address listed in the app" — replace with the actual address)

See the separate deliverable in this audit for exact copy.

**How to verify**

Load the production homepage. Without clicking any link, a user can see or easily locate a way to report content.

**Who is accountable**

The operator.

**Consequence of skipping**

Users who witness abuse have no escalation path. Regulators view the absence of a report mechanism as evidence of inadequate moderation. The DMCA safe harbor also requires a published contact for rights holders.

---

## Section 5: Data Retention Verification

---

### 5.1 Verify Hashed IP Deletion Is Implemented

**What to do**

Read `src/app/api/cron/purge-pii/route.ts`. Confirm it executes actual `DELETE` statements against any table that stores hashed IP addresses. If the cron is a no-op (it currently is — see audit finding PRIV-001), the hashed IP column must either be deleted from the schema on schedule, or the Privacy Policy must be corrected to remove the 7-day deletion promise.

**How to verify**

1. Identify the database column(s) that store hashed IP addresses.
2. Confirm `purge-pii` executes `DELETE FROM <table> WHERE created_at < cutoff` against those columns.
3. Confirm the Vercel Cron schedule for `purge-pii` runs at least once daily.
4. In staging, insert a row with a timestamp older than 7 days. Trigger the cron manually. Confirm the row is deleted.

**Who is accountable**

The developer responsible for the database schema.

**Consequence of skipping**

The Privacy Policy currently promises that hashed IPs are deleted after 7 days. If this is not implemented, that promise is false. This is a GDPR Article 5(1)(e) violation (storage limitation) and, in California, a violation of the CCPA's accuracy and minimization principles. See audit finding PRIV-001 for full details.

---

## Checklist Sign-Off

| Section | Item | Complete | Verified by | Date |
|---------|------|----------|-------------|------|
| 1 | OpenAI Moderation API configured and fail-closed | | | |
| 1 | ADMIN_ALERT_WEBHOOK_URL set and tested | | | |
| 1 | ADMIN_API_KEY set and access-controlled | | | |
| 2 | NCMEC ESP registration submitted | | | |
| 2 | NCMEC credentials received and configured | | | |
| 2 | CSAM incident response process written and distributed | | | |
| 3 | DMCA Designated Agent registered with Copyright Office | | | |
| 3 | DMCA response process written and reviewed by counsel | | | |
| 3 | Court order contact point published | | | |
| 4 | Terms of Service live at /terms | | | |
| 4 | Privacy Policy live at /privacy | | | |
| 4 | Contact/report mechanism visible to users | | | |
| 5 | Hashed IP deletion implemented and tested | | | |

Signed: _________________________ Date: _____________

Title: __________________________
