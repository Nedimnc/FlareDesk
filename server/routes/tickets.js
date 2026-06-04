const express = require('express');
const db = require('../services/database');
const { sanitizeResponseInput } = require('../middleware/sanitize');
const { sendTicketReply } = require('../services/emailDelivery');

const router = express.Router({ mergeParams: true });

router.get('/:id/thread', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid ticket id' });
    }
    const thread = db.getTicketThread(id);
    if (!thread) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    res.json(thread);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/events', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const events = db.getEvents(id);
    res.json(events);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/responses', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid ticket id' });
    }

    const ticket = db.getEmailById(id);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    if (ticket.status === 'Closed') {
      return res.status(400).json({ error: 'Cannot reply to a closed ticket' });
    }

    const parsed = sanitizeResponseInput(req.body || {});
    if (!parsed.valid) {
      return res.status(400).json({ error: parsed.error });
    }

    const author = req.body.author || (req.agent && req.agent.name) || 'Support Agent';
    const delivery = parsed.data.is_internal
      ? { status: 'logged', provider: 'internal', detail: 'Internal note stored.' }
      : await sendTicketReply({ ticket, body: parsed.data.body, author });

    const response = db.insertResponse(id, {
      author,
      author_type: parsed.data.is_internal ? 'agent' : 'agent',
      body: parsed.data.body,
      is_internal: parsed.data.is_internal,
      delivery_status: delivery.status,
      provider_message_id: delivery.messageId,
      in_reply_to: ticket.message_id,
      email_references: ticket.email_references,
    });

    const updatedTicket = db.getEmailById(id);
    if (delivery.status === 'failed') {
      return res.status(502).json({
        error: 'Reply saved, but outbound email delivery failed',
        response,
        ticket: updatedTicket,
        delivery,
      });
    }

    res.status(201).json({ response, ticket: updatedTicket, delivery });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/csat', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid ticket id' });
    }

    const rating = Number(req.body && req.body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'CSAT rating must be an integer from 1 to 5' });
    }

    const comment =
      typeof req.body.comment === 'string' ? req.body.comment.trim().slice(0, 1000) : null;
    const survey = db.submitCsat(id, { rating, comment });
    if (!survey) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    res.status(201).json(survey);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
