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

## Stack

Node.js, Express, SQLite (`better-sqlite3`), Anthropic Claude, vanilla dashboard UI.
