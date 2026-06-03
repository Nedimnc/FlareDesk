# FlareDesk

B2B SaaS support email triage — AI-powered distress scoring and escalation risk detection for customer support teams.

## Quick start

```bash
npm install
cp .env.example .env   # add ANTHROPIC_API_KEY for live Claude analysis
npm run seed
npm start
```

Open **http://localhost:3000** — demo API key: `flaredesk-demo-key-12345` (configured in `.env`).

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start Express server |
| `npm run seed` | Load 12 demo emails (no Claude API calls) |
| `npm test` | Run Jest integration + unit tests |

## API

All `/api/*` routes require `Authorization: Bearer <FLAREDESK_API_KEY>` except `GET /api/config` (demo only).

- `POST /api/emails` — submit email for analysis
- `GET /api/emails` — list queue
- `GET /api/dashboard` — aggregate stats
- `POST /api/webhooks/inbound-email` — Mailgun-shaped inbound email ingest
- `POST /api/emails/:id/responses` — agent reply; sends through Mailgun when configured, otherwise logs locally for demo

## Stack

Node.js, Express, SQLite (`better-sqlite3`), Anthropic Claude, vanilla dashboard UI.

## Production email checklist

No paid email service is required for the local demo. Without Mailgun keys, FlareDesk stores outbound replies with a local message ID so threading and the dashboard can still be tested end-to-end.

What I still need from you before production email goes live:

- [ ] Support domain or subdomain, e.g. `support.yourdomain.com` or `mg.yourdomain.com`.
- [ ] Mailgun account, domain verification, and inbound route pointed at `POST /api/webhooks/inbound-email`.
- [ ] `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_FROM`, and `MAILGUN_WEBHOOK_SIGNING_KEY`.
- [ ] DNS records from Mailgun: MX for inbound, SPF/DKIM for outbound, and DMARC if the domain does not already have it.
- [ ] A strong `WEBHOOK_SECRET` for non-Mailgun webhook callers or extra defense in front of provider signatures.
- [ ] Decision on the cheapest production path: keep local/demo mode for internal testing, then use Mailgun only when real inbound/outbound domain email is needed.
- [ ] Later hardening: SLA timers and CRITICAL alerts, PostgreSQL, teams/workspaces, and Stripe.
