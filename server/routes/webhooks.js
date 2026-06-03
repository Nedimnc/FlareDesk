const express = require('express');
const { sanitizeEmailInput } = require('../middleware/sanitize');
const { analyzeEmail } = require('../services/analyzer');
const { parseInboundPayload, verifyInboundRequest } = require('../services/emailProvider');
const db = require('../services/database');

const router = express.Router();

// Mailgun can post form-encoded payloads here; the dashboard demo posts JSON.
// WEBHOOK_SECRET and MAILGUN_WEBHOOK_SIGNING_KEY are optional in local dev but should be set in production.
router.post('/inbound-email', async (req, res, next) => {
  try {
    if (!verifyInboundRequest(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const inbound = parseInboundPayload(req.body || {});
    const sanitized = sanitizeEmailInput(inbound);
    if (!sanitized.valid) {
      return res.status(400).json({ error: sanitized.errors.join('; ') });
    }

    if (inbound.message_id) {
      const existingTicket = db.getEmailByMessageId(inbound.message_id);
      const existingResponse = db.getResponseByProviderMessageId(inbound.message_id);
      if (existingTicket || existingResponse) {
        return res.status(200).json({
          duplicate: true,
          ticket: existingTicket || db.getEmailById(existingResponse.email_id),
          message: 'Inbound email already ingested',
        });
      }
    }

    const threadTicket = db.findTicketByMessageHeaders({
      in_reply_to: inbound.in_reply_to,
      email_references: inbound.email_references,
    });

    if (threadTicket) {
      const response = db.insertResponse(threadTicket.id, {
        author: sanitized.data.sender,
        author_type: 'customer',
        body: sanitized.data.body,
        is_internal: false,
        delivery_status: 'received',
        provider_message_id: inbound.message_id,
        in_reply_to: inbound.in_reply_to,
        email_references: inbound.email_references,
      });
      const ticket = db.getEmailById(threadTicket.id);
      return res.status(200).json({
        ticket,
        response,
        message: 'Inbound customer reply appended to existing ticket',
      });
    }

    const analysis = await analyzeEmail({
      subject: sanitized.data.subject,
      body: sanitized.analysisBody,
    });

    const ticket = db.insertEmail({
      sender: sanitized.data.sender,
      subject: sanitized.data.subject,
      body: sanitized.data.body,
      tone_label: analysis.tone_label,
      distress_score: analysis.distress_score,
      priority: analysis.priority,
      summary: analysis.summary,
      escalation_risk: analysis.escalation_risk,
      channel: 'email',
      status: 'Open',
      received_at: new Date().toISOString(),
      analyzed_at: new Date().toISOString(),
      message_id: inbound.message_id,
      in_reply_to: inbound.in_reply_to,
      email_references: inbound.email_references,
    });

    if (inbound.message_id) {
      db.recordEvent(ticket.id, 'inbound_email', inbound.provider, `Message-ID: ${inbound.message_id}`);
    }

    res.status(201).json({ ticket, message: 'Inbound email ingested as ticket' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
