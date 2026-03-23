# Safety Documentation Audit Findings

Audit commissioned by: Martha
Auditor: Flow (documentation specialist)
Date: 2026-03-15
Scope: User safety documentation — protections promised vs. protections implemented

---

## Summary Table

| ID | Finding | Severity | Status |
|----|---------|----------|--------|
| LEGAL-001 | NCMEC ESP registration buried in markdown, no launch blocker | LAUNCH BLOCKER | Fixed |
| PRIV-001 | Privacy Policy promises 7-day IP deletion; cron is a no-op | LAUNCH BLOCKER | Flagged (code fix required) |
| SAFE-001 | Operator checklist is developer notes, not a safety checklist | High | Fixed |
| CONTACT-001 | No contact address visible to users; report path is broken | High | Fixed |
| TERMS-001 | Fee change clause gives users zero notice or recourse | Medium | Fixed |
| DOC-001 | No user-facing FAQ covering permanence, privacy, harassment | Medium | Fixed |

---

## LEGAL-001: NCMEC Registration — Launch Blocker

**Severity: LAUNCH BLOCKER**

**Description**

The previous `docs/moderation-policy.md` contained this sentence in the middle of the CSAM Detection section:

> "You must register as an ESP and complete the NCMEC integration before launching this app publicly."

This is the only place this legal requirement appeared. It was buried after five paragraphs of technical implementation detail, formatted as a plain sentence with no visual emphasis, and immediately followed by a developer note about environment variables.

Under 18 U.S.C. § 2258A, any Electronic Service Provider that becomes aware of an apparent CSAM violation must report it to the NCMEC CyberTipline. Operating as an ESP without registration is a federal criminal offense. A sentence in a markdown file does not constitute adequate notice to anyone involved in launching this app.

**User impact**

If the app launches without NCMEC registration:

1. Any CSAM detection that triggers the reporting pipeline will silently fail (the `ncmec.service.ts` stub runs but cannot file a report without credentials).
2. The operator is in violation of federal law from the moment the first comment is submitted, regardless of whether any CSAM is actually detected.
3. Users who submit CSAM (attempting to harm the platform or others) face no federal consequence pipeline.

**Deliverable**

`docs/moderation-policy.md` has been rewritten. The document now opens with a section titled "LAUNCH BLOCKER: NCMEC ESP Registration Required" in bold. It contains:

- The specific legal citation (18 U.S.C. § 2258A)
- Step-by-step registration instructions including what information is needed and who must sign
- The 3–10 business day timeline warning
- Instructions for configuring the credentials once received
- A cross-reference to the Pre-Launch Safety Checklist (Section 2)

`docs/pre-launch-safety-checklist.md` (new file) contains Section 2 in full: three items covering registration submission, credential configuration, and incident response process, each with verification steps, accountability, and consequence language.

---

## PRIV-001: Promised IP Deletion Is Not Implemented

**Severity: LAUNCH BLOCKER**

**Description**

The Privacy Policy (`src/app/privacy/page.tsx`) states in two separate places:

> "We store a one-way hash of your IP address for abuse prevention purposes. These hashes are automatically deleted after 7 days."

> "Request deletion of off-chain data (hashed IP addresses). These are automatically purged after 7 days."

The GDPR section of the same page also states the operator will honor erasure requests for off-chain data.

`src/app/api/cron/purge-pii/route.ts` is the cron job responsible for this deletion. Reading the file reveals:

```
// -----------------------------------------------------------------
// Purge future PII tables here. Example:
//   const deleted = await db.execute(sql`
//     DELETE FROM user_sessions
//     WHERE created_at < ${cutoffDate.toISOString()}
//   `);
//
// For now, no off-chain PII tables exist beyond comments (which are
// on-chain mirrors) and Redis keys (which have their own TTLs).
// -----------------------------------------------------------------
```

The cron calculates a cutoff date, logs a message, and returns `{ purged: {} }`. It executes zero database operations. It does not delete anything.

**The Privacy Policy makes a specific, timed, legally significant promise — "deleted after 7 days" — that the code does not fulfill.**

**User impact**

- Users in the EEA, UK, and California are entitled to rely on stated retention periods. A false retention promise is a violation of GDPR Article 5(1)(e) (storage limitation) and Article 13(2)(a) (retention period disclosure).
- Under CCPA Section 1798.100, California residents have a right to deletion. The policy creates an expectation that this happens automatically. It does not.
- If a regulator audits this app after a complaint, the gap between the privacy policy and the code is direct evidence of non-compliance.
- Users who posted with the understanding that their IP hash would be deleted in 7 days have been misled.

**This is not a documentation problem. The code must be fixed.**

The fix requires identifying which database column(s) store hashed IP addresses and adding a DELETE statement to `purge-pii/route.ts`. If hashed IPs are not currently stored in any table (which the code comment suggests may be the case — the comment says "no off-chain PII tables exist"), then one of two things must happen:

**Option A (preferred):** Implement hashed IP storage with a `created_at` column and add the DELETE statement to the cron.

**Option B:** Remove the "deleted after 7 days" promise from the Privacy Policy entirely, replacing it with: "We process your IP address for rate limiting and abuse prevention. This processing is handled by our Redis cache provider (Upstash), which applies its own TTLs to rate limit keys. We do not store your IP address or a hash of it in our primary database."

Neither option can be completed by a documentation writer. This finding must be assigned to the developer responsible for the database schema.

**Immediate action required**

Until Option A or Option B is implemented and verified, the Privacy Policy contains a false statement. The operator should not launch publicly with this gap in place.

---

## SAFE-001: Operator Checklist Rewritten as Safety Checklist

**Severity: High**

**Description**

The "Operator Responsibilities" section in the previous moderation policy was a six-item markdown checklist with unchecked boxes. Example:

```
- [ ] Configure `OPENAI_API_KEY` for content moderation
- [ ] Register with NCMEC as an ESP and configure `NCMEC_ESP_ID` + `NCMEC_API_TOKEN`
```

Each item was a single line. There was no verification step, no accountability assignment, no consequence description, and no explanation of what each item actually requires. An operator unfamiliar with the regulatory landscape would not know that "Register with NCMEC" is a federal legal prerequisite, or that "Establish a process for DMCA responses" requires registering a Designated Agent with the Copyright Office.

**User impact**

An operator who works through this checklist by reading the items literally — without understanding the legal significance of each — could launch the app with critical gaps. The consequences fall on users: undetected CSAM goes unreported, harassment has no report path, and users' data is not protected as promised.

**Deliverable**

`docs/pre-launch-safety-checklist.md` (new file, 200+ lines) replaces the inline checklist. Each item includes:

- A "What to do" section with numbered steps
- A "How to verify" section that describes a specific, testable confirmation (not "confirm it is set" but "submit a test comment with X content and confirm response Y")
- A "Who is accountable" designation
- A "Consequence of skipping" section that names the specific legal or operational risk

The document ends with a sign-off table that must be physically signed and dated before launch.

---

## CONTACT-001: No Visible Contact Address for Reports

**Severity: High**

**Description**

The moderation policy instructed users to "Contact the operator at the address listed in the app." No address was listed anywhere in the app. Searching all pages:

- `src/app/page.tsx` (homepage): No contact information.
- `src/app/layout.tsx` (footer, all pages): Terms and Privacy links only. No contact address.
- `src/app/privacy/page.tsx`: `privacy@nothing.app` appears in section 7 — but only for "privacy-related inquiries." No general abuse or report address.
- `src/app/terms/page.tsx`: No contact address anywhere.
- `docs/moderation-policy.md`: Directed users to "the address listed in the app." No address listed.

A user who witnesses harassment, a credible threat, or CSAM and wants to report it has no path to do so. They cannot find a contact address. This is not a minor UX gap — it is a structural failure in the safety architecture.

The Privacy Policy also references children's privacy concerns ("If you believe a child under 13 has used this Service, please contact us") without providing a contact address.

**User impact**

- Victims of harassment or targeted threats have no way to report the content.
- Law enforcement responding to a complaint about content on the platform has no published contact for legal process.
- Rightsholders seeking DMCA takedowns have no published address, which weakens DMCA safe harbor protection.
- Regulators expect a visible report mechanism. Absence of one is a signal of inadequate governance.

**Deliverable**

Three contact addresses are defined for the app:

| Purpose | Address |
|---------|---------|
| Abuse and content reports | abuse@nothing.app |
| DMCA takedown requests | dmca@nothing.app |
| Law enforcement and legal process | legal@nothing.app |
| Privacy and data requests | privacy@nothing.app (already in Privacy Policy) |

These addresses must be created and monitored before launch.

Changes made:

1. `src/app/layout.tsx`: Footer updated to display "Report harmful content: abuse@nothing.app · DMCA: dmca@nothing.app" as clickable mailto links on every page. FAQ link also added.

2. `docs/moderation-policy.md`: "Reporting Prohibited Content" section now lists all four contact addresses with descriptions instead of the broken "contact the operator at the address listed in the app."

3. `docs/faq.md` (new file): "How do I report a comment?" section provides step-by-step instructions with all four contact addresses.

The Privacy Policy section on children's privacy still says "please contact us" without an email address in the source. It should be updated to reference `privacy@nothing.app` or `abuse@nothing.app`. This requires a small edit to `src/app/privacy/page.tsx` section 6.

---

## TERMS-001: Fee Change Notice Inadequate

**Severity: Medium**

**Description**

The Terms of Service (section 4, "Fee Sponsorship") previously read:

> "This sponsorship is provided voluntarily and may be revoked, limited, or modified at any time without prior notice."

The phrase "without prior notice" is the problem. This is a free-to-post platform where users submit permanent content — content that, once on the blockchain, cannot be deleted. A user who posts content under the assumption it is free cannot retract that content if fees are later introduced.

The current wording means:

- A user posts a comment today expecting it to be free.
- Tomorrow, fees are introduced with no notice.
- The user's content is permanently on-chain. They cannot undo the transaction.
- They have no recourse other than "stop using the Service."

For most SaaS products, a no-notice fee change is merely annoying. For a blockchain posting app where the act of posting is irreversible, it creates an asymmetric risk that users cannot mitigate after the fact.

**User impact**

Users who post content in good faith under a free model, then face fees for content they can no longer delete, have been misled about the economic terms at the time of their action. This is a potential consumer protection exposure in jurisdictions with unfair terms laws (EU Directive 93/13, UK Consumer Rights Act 2015, California Business and Professions Code § 17200).

**Deliverable**

`src/app/terms/page.tsx` section 4 has been rewritten to:

1. Remove "without prior notice."
2. Commit to 14 days' advance notice posted on the homepage before any fee change takes effect for new submissions.
3. Explicitly clarify that already-posted content incurs no future fees (because blockchain transactions are final).
4. Clarify that if a user objects to a fee change, their remedy is to stop posting before the effective date — not to request content removal.

The 14-day notice commitment is a concrete, measurable protection rather than a vague "we will let you know." It also sets a legal baseline: if fees are introduced with less than 14 days' notice, the operator is in breach of their own Terms.

---

## DOC-001: No User-Facing FAQ

**Severity: Medium**

**Description**

Nothing App has a significant conceptual gap between what it does and what a typical user understands. The concepts of blockchain permanence, OP_RETURN, on-chain vs. off-chain, and the limits of content moderation are not obvious to a non-technical user. The existing Terms and Privacy Policy explain these concepts with reasonable clarity, but:

- Legal documents are written for liability protection, not for user understanding.
- Users in distress (being harassed, having accidentally posted personal information) will not read a Privacy Policy to find help.
- Common questions — "can I delete this?", "what happens if I post my phone number?", "can I report this user?" — are not answered anywhere a user would naturally look.

**User impact**

- Users post personal information without understanding permanence, then request deletion that is technically impossible.
- Users being harassed do not know how to report it or what to expect.
- Users outside technical communities do not understand what "on-chain" means and cannot make an informed decision about whether to post.
- "If you believe a child under 13 has used this Service, please contact us" (Privacy Policy) has no contact address — a parent in that situation has nowhere to go.

**Deliverable**

`docs/faq.md` (new file) covers:

- What "on-chain" means (plain language, no blockchain background assumed)
- What "permanent" means in practice
- Whether anything can be deleted after posting
- What happens if you post your phone number or personal information
- What the app can and cannot do if you are being harassed
- How to report content
- Whether fees will always be free
- What OP_RETURN is (optional technical detail for curious users)
- How to look up your own comment on a block explorer
- Whether an account or wallet is required

The FAQ references abuse@nothing.app, dmca@nothing.app, and privacy@nothing.app for specific request types.

A link to `/faq` has been added to the footer in `src/app/layout.tsx`.

A `/faq` page must be created in `src/app/faq/page.tsx` to render this content. The FAQ content in `docs/faq.md` should be used as the source. This requires a developer to create the page component.

---

## Files Changed

| File | Action | Reason |
|------|--------|--------|
| `docs/moderation-policy.md` | Rewritten | Launch blocker notice, contact addresses, operator checklist replaced with checklist reference |
| `docs/pre-launch-safety-checklist.md` | Created | Formal safety checklist with verification steps, accountability, consequences |
| `docs/faq.md` | Created | User-facing FAQ covering permanence, privacy, harassment, reporting |
| `src/app/layout.tsx` | Edited | Footer now shows abuse@nothing.app, dmca@nothing.app, and FAQ link |
| `src/app/terms/page.tsx` | Edited | Fee change clause now includes 14-day advance notice commitment |
| `docs/safety-audit-findings.md` | Created | This document |

## Files Requiring Code Changes (Not Documentation)

| File | Required Change | Finding |
|------|----------------|---------|
| `src/app/api/cron/purge-pii/route.ts` | Implement actual DELETE statement for hashed IP records, or remove the 7-day deletion promise from the Privacy Policy | PRIV-001 |
| `src/app/privacy/page.tsx` | Add contact address (abuse@nothing.app or privacy@nothing.app) to section 6 "Children's Privacy" | CONTACT-001 |
| `src/app/faq/page.tsx` | Create page component to render FAQ content | DOC-001 |

---

## Launch Readiness

**Do not launch publicly until:**

1. PRIV-001 is resolved — either the IP deletion is implemented and tested, or the Privacy Policy is corrected to remove the deletion promise.
2. LEGAL-001 is resolved — NCMEC registration is complete and `NCMEC_ESP_ID` and `NCMEC_API_TOKEN` are set in production.
3. The contact email addresses (abuse@nothing.app, dmca@nothing.app, legal@nothing.app, privacy@nothing.app) exist and are monitored by named individuals.
4. All items in `docs/pre-launch-safety-checklist.md` are checked and signed.
