# FlareDesk Architecture & Roadmap

## Vision

FlareDesk is a **ticket-centric support command center**: every inbound message becomes a ticket with AI distress scoring, a full conversation thread, agent replies, internal notes, and an auditable activity log. The goal is top-tier support ops — not just ranking emails, but **owning the full lifecycle** from intake through resolution.

---

## How business email connects (future)

Today you can simulate intake via the dashboard or `POST /api/emails`. Production email ingestion uses a **webhook-first** design already stubbed at:

```
POST /api/webhooks/inbound-email
Header: x-flaredesk-webhook-secret: <WEBHOOK_SECRET>
Body: { "sender", "subject", "body", "message_id" }
```

### Recommended providers

| Provider | How it works | Best for |
|----------|--------------|----------|
| **Mailgun** | Inbound routes → HTTP POST to FlareDesk | Custom domains, high volume |
| **SendGrid Inbound Parse** | MX → webhook | Teams already on SendGrid |
| **Microsoft Graph** | Subscription on `me/messages` | Microsoft 365 / Outlook shops |
| **Gmail API** | Push notifications + `history.list` | Google Workspace |
| **Zapier / Make** | Email trigger → webhook | Fast MVP without MX changes |

### End-to-end flow (target state)

```
Customer sends email → Provider receives → Webhook POST → FlareDesk
  → Sanitize + dedupe (Message-ID) → Claude analysis → Ticket created
  → CRITICAL? → Slack/PagerDuty alert to senior agent
Agent replies in FlareDesk UI → Outbound API (Mailgun/SendGrid) → Customer inbox
  → Reply stored on ticket thread → Status → Waiting on Customer
Customer replies → Same thread (In-Reply-To / References headers)
Ticket Resolved → Closed → SLA metrics finalized
```

### What you’ll need to add for real email

1. **MX / domain verification** — point `support@yourcompany.com` to Mailgun/SendGrid
2. **Outbound sending** — SPF, DKIM, DMARC; send agent replies from the same domain
3. **Threading** — store `Message-ID`, `In-Reply-To`, `References` on tickets/responses
4. **Dedup** — ignore duplicate webhook deliveries
5. **OAuth mailboxes** (optional) — Graph/Gmail for bi-directional sync without forwarding

---

## Current data model

### `emails` (tickets)

Each row is one support ticket (originally one inbound email).

| Field | Purpose |
|-------|---------|
| `ticket_number` | Human ID, e.g. `FD-2026-0007` |
| `channel` | `manual`, `email`, `webhook` |
| `distress_score` / `priority` | AI triage |
| `status` | Open → In Progress → Waiting on Customer → Resolved → Closed |
| `response_count` / `last_response_at` | Reply tracking |
| `closed_at` | Resolution timestamp |

### `ticket_responses`

| Field | Purpose |
|-------|---------|
| `author_type` | `agent`, `customer`, `system` |
| `is_internal` | `1` = internal note (not sent to customer) |
| `delivery_status` | `sent`, `logged`, `draft`, `failed` |

### `ticket_events`

Audit trail: `ticket_created`, `analysis_complete`, `agent_reply`, `internal_note`, `status_changed`, `assigned`, `inbound_email`.

---

## Top-tier support system checklist

What FlareDesk has now vs. what enterprise tools (Zendesk, Intercom, Front) add:

| Capability | FlareDesk today | Next phase |
|------------|-----------------|------------|
| AI distress scoring | ✅ | Fine-tuned models per industry |
| Ticket IDs + lifecycle | ✅ | Custom statuses per team |
| Conversation thread | ✅ | Email threading headers |
| Agent replies + internal notes | ✅ | Rich text + templates |
| Activity audit log | ✅ | Export for compliance |
| Auto email ingest | 🔌 Webhook stub | Mailgun + outbound send |
| SLA timers | — | First response / resolution deadlines |
| CSAT surveys | — | Post-resolution email |
| Team queues / round-robin | — | Multi-agent assignment rules |
| Macros / canned responses | — | One-click reply snippets |
| Knowledge base suggestions | — | RAG over help docs |
| Multi-tenant workspaces | — | Per-customer billing (Stripe) |
| Real-time collab | — | “Agent X is viewing” |
| Reporting | Basic dashboard | Funnel, agent performance, tone trends |

---

## API surface (tickets)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/emails/:id/thread` | Ticket + responses + events |
| `POST` | `/api/emails/:id/responses` | Agent reply or internal note |
| `GET` | `/api/emails/:id/events` | Activity timeline |
| `POST` | `/api/webhooks/inbound-email` | Future email ingest (secret optional) |

All `/api/emails/*` (except webhook) require `Authorization: Bearer <FLAREDESK_API_KEY>`.

---

## Security notes for production email

- Rotate `WEBHOOK_SECRET` and verify on every inbound POST
- Never expose `/api/config` in production
- Sign outbound mail; rate-limit webhooks separately from UI API
- PII retention policy + GDPR delete endpoint (TODO in `server/index.js`)

---

## Suggested build order (post-MVP)

1. Mailgun inbound + outbound (single domain)
2. Message-ID threading for reply continuity
3. SLA fields + breach alerts on CRITICAL tickets
4. PostgreSQL + workspace/team model
5. Stripe ($99/mo) + seat limits
6. CSAT + analytics warehouse
