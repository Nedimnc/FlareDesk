const express = require('express');
const { sanitizeEmailInput } = require('../middleware/sanitize');
const { analyzeEmail } = require('../services/analyzer');
const db = require('../services/database');

const router = express.Router();

// Future: Mailgun / SendGrid / Microsoft Graph will POST here.
// Validates WEBHOOK_SECRET when set; creates ticket + runs AI analysis automatically.
router.post('/inbound-email', async (req, res, next) => {
  try {
    const secret = process.env.WEBHOOK_SECRET;
    if (secret) {
      const provided = req.headers['x-flaredesk-webhook-secret'];
      if (provided !== secret) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    const { sender, subject, body, message_id } = req.body || {};
    const sanitized = sanitizeEmailInput({ sender, subject, body });
    if (!sanitized.valid) {
      return res.status(400).json({ error: sanitized.errors.join('; ') });
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
    });

    if (message_id) {
      db.recordEvent(ticket.id, 'inbound_email', 'mailgun', `Message-ID: ${message_id}`);
    }

    res.status(201).json({ ticket, message: 'Inbound email ingested as ticket' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
