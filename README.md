# FlareDesk

B2B SaaS support command center — AI-powered distress scoring, ticket lifecycle management, email threading, SLA tracking, reply assist, CSAT, and operations reporting for customer support teams.

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
- `GET /api/emails` — list queue with filters for status, priority, tone, queue, and workspace
- `PATCH /api/emails/:id` — update status, assignee, queue, or workspace
- `GET /api/emails/:id/thread` — full conversation, ticket, and activity timeline
- `GET /api/emails/:id/reply-draft` — local AI-style reply draft with macro and knowledge suggestions
- `GET /api/emails/:id/private-messages` — ticket-scoped private member chat
- `POST /api/emails/:id/private-messages` — send a private message to another team member
- `POST /api/emails/:id/private-messages/read` — mark private messages read for the current agent
- `GET /api/emails/:id/action-plan` — recommended ticket playbook/checklist
- `PATCH /api/emails/:id/tasks/:taskId` — complete or reopen an action-plan task
- `GET /api/emails/:id/customer-context` — sender history and risk summary
- `POST /api/emails/:id/csat` — record customer satisfaction rating
- `GET /api/dashboard` — aggregate stats, SLA health, CSAT, queues, and tone breakdown
- `GET /api/reports/overview` — operational reporting summary
- `GET /api/macros` — canned response templates
- `GET /api/queues` — queue metadata and active counts
- `GET /api/team-members` — demo teammate directory for private chat recipients
- `GET /api/workspaces` — demo workspace metadata
- `POST /api/webhooks/inbound-email` — Mailgun-shaped inbound email ingest
- `POST /api/emails/:id/responses` — agent reply; sends through Mailgun when configured, otherwise logs locally for demo

## Built features

- **Ticket lifecycle:** ticket IDs, statuses, assignment, conversation threads, internal notes, and audit events.
- **AI triage:** Claude analysis when `ANTHROPIC_API_KEY` is set; free heuristic fallback when it is not.
- **Email loop:** Mailgun-shaped inbound webhook, Message-ID dedupe, In-Reply-To/References threading, and outbound Mailgun delivery with local demo fallback.
- **Accessible dashboard:** light/dark mode, skip link, landmarks, labeled controls, visible focus states, keyboard-openable ticket rows, search, filters, and a floating detail panel.
- **Private member chat:** ticket-scoped teammate messages with recipients, read tracking, and audit events; these stay separate from customer replies and internal notes.
- **Action plans:** each ticket gets a recommended checklist based on queue, priority, and escalation risk.
- **Customer context:** agents can see sender history, open/critical counts, average distress, and recent prior tickets from the detail panel.
- **SLA timers:** first-response and resolution deadlines based on priority, `on_track` / `due_soon` / `breached` / `met` tracking, and critical alert events.
- **Critical alerts:** CRITICAL tickets route to Escalations and log a senior-agent alert.
- **Reply assist:** macro-powered draft replies and knowledge-base suggestions without paid calls.
- **Macros:** refund review, critical escalation, technical investigation, retention call, and friendly follow-up templates.
- **Queues:** Escalations, Billing, Technical, Success, and General queue routing with queue filters and reassignment.
- **CSAT:** surveys are queued when tickets resolve/close and ratings feed dashboard metrics.
- **Reporting:** queue, priority, SLA, first-response, tone, escalation-risk, and CSAT metrics.
- **Workspace/auth foundation:** bearer auth remains demo-simple, but requests now carry agent and workspace context via environment/header values.

## Private chat vs internal notes

- **Internal notes** are shared ticket annotations for the support team.
- **Private chat** is for direct teammate coordination from the same ticket, e.g. asking a billing lead to review a refund before replying.
- Private chat messages are never sent to customers and do not appear in the customer conversation thread.

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
- [ ] Later hardening: PostgreSQL, full user login/SSO, teams/workspaces, audit exports, retention policy, and Stripe.
