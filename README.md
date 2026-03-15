# Nothing App

An on-chain comment box. Every comment is permanently stored on BSV mainnet via `OP_RETURN`. The app pays all transaction fees — users post for free.

**We're building this to save human lives.** Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for how to help.

**Stack:** Next.js 14 · Drizzle ORM · Supabase (Postgres) · Upstash Redis · @bsv/sdk · TAAL ARC

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 18+ | |
| npm | 9+ | |
| Supabase account | — | Free tier works |
| Upstash account | — | Free tier works — needed for rate limiting |
| BSV wallet | — | WIF-format private key with funded mainnet address |

---

## Local Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd nothing-app
npm install
```

### 2. Create your environment file

```bash
cp .env.example .env.local
```

Then fill in every variable. See [Environment Variables](#environment-variables) below.

### 3. Run the database migration

Open your Supabase project's SQL editor and run the migration file:

```
src/db/migrate.sql
```

This creates the four tables: `comments`, `utxo_pool`, `wallet_state`, `txid_blocklist`.

Alternatively, use Drizzle:

```bash
npm run db:generate
npm run db:migrate
```

### 4. Seed the wallet

The app needs pre-split UTXOs in `utxo_pool` before any comment can be posted. The replenishment cron handles this automatically, but for local dev you can trigger it manually:

```bash
# Confirm your funding address first
curl http://localhost:3000/api/health

# Then send some BSV to the address shown in wallet.address
# After funding, trigger replenishment (no auth needed in dev)
curl http://localhost:3000/api/cron/replenish
```

### 5. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 6. Verify everything works

```bash
# Health check — should show status: "ok"
curl http://localhost:3000/api/health | jq

# Post a test comment
curl -X POST http://localhost:3000/api/comments \
  -H "Content-Type: application/json" \
  -d '{"commentText": "hello blockchain", "displayName": "Dev"}'

# Read it back
curl http://localhost:3000/api/comments | jq
```

---

## Environment Variables

Create `.env.local` at the project root. All variables without a default are **required**.

### Database

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Supabase Postgres connection string. Found in your Supabase project under Settings → Database → Connection string (URI mode). |

```
DATABASE_URL=postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres
```

### BSV Wallet

| Variable | Required | Description |
|----------|----------|-------------|
| `BSV_FUNDING_KEY` | Yes | WIF-encoded private key for the funding wallet. This key signs every transaction. Keep it secret. See [Wallet Top-Up Guide](docs/wallet-topup.md) for how to generate one. |

```
BSV_FUNDING_KEY=5KYourWifKeyHere...
```

### Upstash Redis (Rate Limiting)

| Variable | Required | Description |
|----------|----------|-------------|
| `UPSTASH_REDIS_REST_URL` | Yes* | REST URL from your Upstash Redis database. |
| `UPSTASH_REDIS_REST_TOKEN` | Yes* | REST token from your Upstash Redis database. |

*If omitted, rate limiting is disabled. Comments can still be posted but with no per-IP limits.

```
UPSTASH_REDIS_REST_URL=https://your-db.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token
```

### Rate Limit Tuning (optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_MAX` | `5` | Max POST requests per IP per minute. |
| `RATE_LIMIT_WINDOW` | `60` | Window size in seconds for the per-minute limit. |
| `RATE_LIMIT_HOURLY_MAX` | `50` | Max POST requests per IP per hour. |

### Content Moderation

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Recommended | If set, every comment is scanned by OpenAI's Moderation API before broadcast. If omitted, a keyword filter runs instead. Strongly recommended for production. |

```
OPENAI_API_KEY=sk-...
```

### Admin

| Variable | Required | Description |
|----------|----------|-------------|
| `ADMIN_API_KEY` | Yes for prod | Protects `/api/admin/*` routes. Use a long random string. |

```
ADMIN_API_KEY=change-me-to-a-long-random-secret
```

### Cron Jobs

| Variable | Required | Description |
|----------|----------|-------------|
| `CRON_SECRET` | Yes for prod | Vercel sets this automatically when it invokes scheduled cron jobs. Set it here if triggering crons manually. If unset, cron routes allow requests only in `NODE_ENV=development`. |

### Monitoring Alerts

| Variable | Default | Description |
|----------|---------|-------------|
| `ALERT_WEBHOOK_URL` | — | Slack or Discord webhook URL. Receives low-balance and pool-exhaustion alerts. |
| `ALERT_UTXO_MIN_FREE` | `3` | Alert threshold: fires when free UTXO count drops below this. |
| `ALERT_WALLET_MIN_SATS` | `10000` | Alert threshold: fires when wallet balance drops below this many satoshis. |
| `ADMIN_ALERT_WEBHOOK_URL` | — | Separate webhook for CSAM alerts — should go to a monitored channel. |

### JungleBus Reconciliation (optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `JUNGLEBUS_SUBSCRIPTION_ID` | — | Your JungleBus subscription ID. Required for the reconciliation cron. See [Architecture](docs/architecture.md). |
| `JUNGLEBUS_URL` | `https://junglebus.gorillapool.io` | JungleBus base URL. |
| `JUNGLEBUS_API_KEY` | — | API key for authenticated JungleBus access. |

### NCMEC Reporting (required before production)

| Variable | Description |
|----------|-------------|
| `NCMEC_ESP_ID` | Your NCMEC Electronic Service Provider ID. Register at [missingkids.org](https://www.missingkids.org/gethelpnow/cybertipline). |
| `NCMEC_API_TOKEN` | NCMEC API token received upon ESP registration. |

### Comment Limits (optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_MAX_COMMENT_LENGTH` | `512` | Maximum comment character count. Enforced server-side and exposed to the client. |

---

## npm Scripts

| Script | What it does |
|--------|-------------|
| `npm run dev` | Start the Next.js dev server on port 3000 |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run test` | Run the Vitest test suite |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:coverage` | Coverage report |
| `npm run db:generate` | Generate Drizzle migration files from schema |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Open Drizzle Studio (database browser) |

---

## Project Structure

```
nothing-app/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── comments/          # GET + POST /api/comments
│   │   │   │   └── [txid]/        # GET /api/comments/:txid
│   │   │   ├── health/            # GET /api/health
│   │   │   ├── admin/
│   │   │   │   ├── blocklist/     # Blocklist management
│   │   │   │   └── reconcile/     # Manual JungleBus reconcile
│   │   │   └── cron/
│   │   │       ├── replenish/     # UTXO pool replenishment
│   │   │       ├── clear-locks/   # Stale lock recovery
│   │   │       └── reconcile/     # Scheduled reconciliation
│   │   ├── page.tsx               # Main feed page
│   │   └── layout.tsx
│   ├── components/                # React UI components
│   ├── db/
│   │   ├── schema.ts              # Drizzle table definitions
│   │   ├── index.ts               # DB connection
│   │   ├── queries.ts             # Shared query helpers
│   │   └── migrate.sql            # Reference SQL migration
│   ├── services/
│   │   ├── comment-write.service.ts  # Orchestrates the full post flow
│   │   ├── utxo-pool.service.ts      # UTXO checkout/release/stats
│   │   ├── wallet.service.ts         # Key management, tx building
│   │   ├── broadcast.service.ts      # TAAL ARC broadcast
│   │   ├── moderation.service.ts     # OpenAI + keyword moderation
│   │   ├── ncmec.service.ts          # CSAM reporting pipeline
│   │   └── junglebus.service.ts      # On-chain reconciliation
│   └── lib/
│       ├── constants.ts           # All tuneable parameters
│       ├── validators.ts          # Zod schemas
│       ├── op-return.ts           # OP_RETURN encode/decode
│       ├── alerts.ts              # Slack/Discord webhook alerts
│       └── date-utils.ts
├── docs/
│   ├── api.md                     # Full API reference
│   ├── architecture.md            # System design and data flows
│   ├── wallet-topup.md            # Funding the wallet
│   ├── utxo-pool.md               # UTXO pool management
│   └── moderation-policy.md       # Content moderation policy
├── drizzle.config.ts
├── package.json
└── tsconfig.json
```

---

## Docs

- [API Reference](docs/api.md)
- [Architecture Overview](docs/architecture.md)
- [Wallet Top-Up Guide](docs/wallet-topup.md)
- [UTXO Pool Management](docs/utxo-pool.md)
- [Content Moderation Policy](docs/moderation-policy.md)
