# Frequently Asked Questions

Plain-language answers to common questions about Nothing App. No technical background needed.

---

## Understanding the Basics

### What does "on-chain" mean?

When you post a comment, the app sends it to the Bitcoin SV (BSV) blockchain network. The blockchain is a public database maintained by thousands of computers around the world. No single person or company controls it. Your comment is stored as a small piece of data inside a "transaction" — the same kind of structure that records financial transfers, but here it just carries your text.

Once a comment is accepted by the network and included in a block (which usually happens within seconds to minutes), it exists in that shared database permanently.

### What does "permanent" mean in practice?

It means no one can delete it. Not us. Not the blockchain operators. Not a court order. Not a government.

We can hide a comment from this app's interface so it no longer appears in the feed. But the raw data remains in the blockchain, which is public. Anyone can look it up using a block explorer (a website that lets you browse blockchain transactions by their ID). The transaction ID for each comment is shown on the comment itself.

Before you post anything, ask yourself: would I be comfortable if this text appeared on a public website forever, under my chosen display name, with a permanent address anyone could share?

If the answer is no, do not post it.

### Is there any way to delete something after posting?

No. There is no deletion after a comment reaches the blockchain.

We can delist a comment — which means it disappears from this app's feed and returns a "gone" response if someone tries to look it up directly through this app. But the blockchain data is not affected. It remains visible in block explorers, archive sites, and any other tool that reads BSV transactions.

This is not a policy decision we can change. It is how blockchain technology works.

---

## Privacy and Personal Information

### What happens if I post my phone number, address, or other personal information?

It becomes permanently public on the blockchain.

Any personal information you include in a comment — your real name, phone number, home address, email, social media handle, or anything that identifies you — will be readable by anyone, forever. We cannot remove it.

This applies to information about other people too. Posting someone else's personal details without their consent (sometimes called "doxxing") violates our Terms of Service, and will be screened and rejected before it reaches the blockchain. But if you are thinking about posting any identifying information, the rule is simple: assume it will be public forever and act accordingly.

### What information does the app store about me?

Two things:

1. **Your comment and display name.** These are written to the BSV blockchain as described above. They are public and permanent.

2. **A hashed IP address.** When you submit a comment, we record a one-way hash (a scrambled, irreversible fingerprint) of your IP address. We use this to detect abuse and enforce rate limits. We do not store your actual IP address. These hashes are automatically deleted after 7 days.

We do not use cookies, analytics trackers, advertising pixels, or any third-party tracking.

### Can I request deletion of data about me?

For off-chain data (the hashed IP address): yes. Contact us at privacy@nothing.app and we will delete any hashed IP records associated with your usage. These are also automatically deleted after 7 days regardless.

For on-chain data (your comment and display name): we cannot delete this. See "Is there any way to delete something after posting?" above. We can delist the comment from this app's interface upon request.

---

## Safety and Harassment

### What can the app do if someone is harassing me?

We can delist a comment that harasses you, which removes it from this app's feed. To request this:

1. Note the transaction ID (txid) shown on the comment.
2. Email us at abuse@nothing.app with the txid, your name or display name, and a brief description of the issue.
3. We will review the request and delist the comment if it violates our content policy.

What we cannot do: delete the transaction from the blockchain, identify who posted a comment (display names can be anything and do not require an account), or prevent someone from using a different IP address to post again.

If you are being seriously threatened or targeted, contact law enforcement. We will cooperate with law enforcement requests for information (such as IP hash data, which we hold for up to 7 days).

### What content is blocked before it reaches the blockchain?

Every comment is screened before it is broadcast. Blocked categories include:

- Child sexual abuse material (CSAM)
- Credible threats of violence against specific people
- Hate speech targeting protected characteristics
- Harassment directed at specific individuals
- Graphic violence
- Content subject to a court order or valid DMCA takedown
- Spam and automated bulk submissions

If your comment is blocked, you will see an error message. The block happens before any transaction is created, so nothing reaches the blockchain.

### How do I report a comment that violates the rules?

1. Find the transaction ID (txid) shown on the comment.
2. Email abuse@nothing.app with:
   - The txid
   - The reason for the report (e.g., harassment, threats, hate speech)
   - Any supporting context

For DMCA (copyright) takedown requests, email dmca@nothing.app with the txid, the copyrighted work being infringed, and your contact information.

Law enforcement and government agencies can contact legal@nothing.app directly.

---

## Fees and the Free Model

### It says posting is free. Will that always be the case?

Not necessarily. The app currently pays all BSV transaction fees on your behalf, at no charge to you. This is voluntary and can change.

The Terms of Service are clear that this sponsorship may be changed or ended at any time. If fees are introduced, the most likely change is that you would need to provide your own BSV wallet to cover the small transaction cost (fractions of a cent per post at current BSV fee levels).

Critically: if fees are introduced in the future, that does not affect comments you have already posted. Those are already on the blockchain and do not incur ongoing costs.

### Could the app shut down entirely?

Yes. If the app shuts down, your comments remain on the BSV blockchain permanently — they are not hosted by us. Anyone can build a tool to read them. The blockchain does not depend on this app existing.

---

## Technical Questions

### What is OP_RETURN?

OP_RETURN is a field in a BSV transaction that can carry a small amount of arbitrary data (text, in this case). It is a standard, widely used mechanism for embedding non-financial data in blockchain transactions. The BSV network does not assign any special meaning to what is written there — it just stores it.

Your comment text is encoded into this field when the transaction is built.

### Can I look up my own comment on the blockchain?

Yes. When you post a comment, the app returns a transaction ID (txid) — a 64-character string of letters and numbers. You can paste that ID into any BSV block explorer, such as [whatsonchain.com](https://whatsonchain.com), to see the raw transaction data.

### Does posting require an account or wallet?

No. You do not need a BSV wallet or account of any kind. The app pays the transaction fee from its own wallet. All you need is a display name (optional — "Anonymous" is the default) and a comment.

---

## Contact

For privacy and data requests: privacy@nothing.app

To report harmful content: abuse@nothing.app

For DMCA takedown requests: dmca@nothing.app

For law enforcement and legal process: legal@nothing.app
