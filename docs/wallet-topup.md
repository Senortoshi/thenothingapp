# Wallet Top-Up Guide

The Nothing App pays BSV transaction fees on behalf of users. This requires a funded BSV wallet configured via the `BSV_FUNDING_KEY` environment variable.

This guide covers: checking your balance, deriving your funding address, topping up, and understanding the cost model.

---

## How the Wallet Works

The app does not use a traditional wallet. Instead, it maintains a pool of pre-split UTXOs (Unspent Transaction Outputs) in the database. Each comment consumes one UTXO: the app signs a transaction spending that UTXO, writes the comment to `OP_RETURN`, and returns the change to the funding address.

This means the wallet is essentially self-recycling: most of the satoshis come back after each comment. Only the miner fee is permanently consumed.

---

## Checking Your Balance

```bash
curl https://your-app.vercel.app/api/health | jq .wallet
```

Response:

```json
{
  "address": "1YourFundingAddressHere...",
  "freeUtxoCount": 18,
  "freeSats": 9180,
  "totalBalance": 9180,
  "isReplenishing": false,
  "lastReplenishedAt": "2026-03-15T09:55:00.000Z"
}
```

Key fields:

| Field | Meaning |
|-------|---------|
| `address` | Send BSV to this address to top up. |
| `freeUtxoCount` | UTXOs ready to use. Should be above 5 under normal load. |
| `freeSats` | Total satoshis available in the free pool. |
| `totalBalance` | Total satoshis tracked in `wallet_state`. |

If `status` in the response is `"critical"`, the pool is empty and comments will fail until replenishment completes.

---

## Deriving the Funding Address

The funding address is derived automatically from `BSV_FUNDING_KEY` on startup. You never need to compute it manually — `GET /api/health` always shows the current address.

If you need to verify the address independently:

1. Take your WIF private key from `BSV_FUNDING_KEY`
2. Use any BSV wallet tool or the `@bsv/sdk` library to derive the P2PKH address

```typescript
import { PrivateKey } from "@bsv/sdk";
const key = PrivateKey.fromWif(process.env.BSV_FUNDING_KEY!);
console.log(key.toAddress().toString());
```

**Keep `BSV_FUNDING_KEY` secret.** It controls the wallet. Never commit it to source control. Rotate it by generating a new key, funding the new address, and updating the environment variable.

---

## Generating a Fresh Key (New Deployments)

If you are setting up for the first time and do not have a BSV key:

1. Use a BSV wallet application (HandCash, RelayX, Electrum SV) to generate a new wallet
2. Export the WIF private key for the address you want to use as the funding address
3. Set `BSV_FUNDING_KEY` to that WIF string
4. Fund the address (see below)

Alternatively, generate a key programmatically:

```typescript
import { PrivateKey } from "@bsv/sdk";
const key = PrivateKey.fromRandom();
console.log("WIF:", key.toWif());
console.log("Address:", key.toAddress().toString());
```

---

## Sending BSV to the Funding Address

1. Get the address from `GET /api/health` → `wallet.address`
2. Send BSV from any BSV wallet or exchange to that address
3. Wait for 1 confirmation (roughly 10 minutes on BSV mainnet)
4. Trigger replenishment manually or wait for the next scheduled cron (runs every 5 minutes):

```bash
# Trigger replenishment manually (development)
curl http://localhost:3000/api/cron/replenish

# Production — use CRON_SECRET
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://your-app.vercel.app/api/cron/replenish
```

The replenishment cron fetches the wallet's UTXOs from WhatsOnChain, picks the largest one, and splits it into 20 equal outputs (configurable via `UTXO_SPLIT_TARGET`).

---

## Cost Model

| Item | Value |
|------|-------|
| BSV fee rate | 10 satoshis per 1000 bytes |
| Approximate tx size | ~300 bytes |
| Computed fee | `ceil(300 * 10 / 1000)` = 3 satoshis |
| Minimum fee (enforced) | 5 satoshis |
| **Cost per comment** | **~5 satoshis** |

At current prices (BSV ≈ $50 USD as of early 2026):

| Amount | Comments |
|--------|---------|
| $1 USD ≈ 200,000 satoshis | ~40,000 comments |
| $10 USD ≈ 2,000,000 satoshis | ~400,000 comments |

These are approximations. The actual cost per comment depends on the fee market and exact transaction size.

**The change output** means the wallet does not drain linearly. Each comment transaction spends one UTXO but creates one change output. The only net loss is the miner fee. Roughly:

```
Wallet balance after N comments ≈ Initial balance - (N × 5 satoshis)
```

---

## What Happens When the Wallet is Empty

1. The replenishment cron runs and finds no UTXOs on-chain with enough balance to split
2. It returns `ok: false` with a reason like `"Insufficient balance: 0 sats cannot fund 20 outputs"`
3. An alert fires to `ALERT_WEBHOOK_URL` if configured
4. `GET /api/health` returns `status: "critical"`
5. New comment submissions fail with `503 NO_UTXOS`

Existing comments are unaffected — they are already on-chain and in the database.

To recover: send BSV to the funding address, then trigger the replenishment cron.

---

## Alert Thresholds

Two threshold alerts fire automatically:

| Alert | Threshold env var | Default | Fires when |
|-------|-------------------|---------|------------|
| Low UTXO pool | `ALERT_UTXO_MIN_FREE` | `3` | Free UTXO count drops below 3 |
| Low wallet balance | `ALERT_WALLET_MIN_SATS` | `10000` | Wallet balance drops below 10,000 satoshis (~$0.005) |

Alerts go to `ALERT_WEBHOOK_URL` (Slack or Discord incoming webhook). If the URL is not set, alerts are logged to the console only.

**Recommended production threshold:** set `ALERT_WALLET_MIN_SATS` to at least 100,000 satoshis (roughly $0.05) to give yourself comfortable lead time before the wallet runs dry.

To configure:

```
ALERT_UTXO_MIN_FREE=5
ALERT_WALLET_MIN_SATS=100000
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/...
```

---

## Monitoring Checklist

- [ ] `GET /api/health` returns `status: "ok"`
- [ ] `wallet.freeUtxoCount` is above 5 under expected load
- [ ] `ALERT_WEBHOOK_URL` is configured and tested
- [ ] You have confirmed the alert fires by temporarily lowering the threshold
- [ ] You know where your BSV is held and how quickly you can top up
