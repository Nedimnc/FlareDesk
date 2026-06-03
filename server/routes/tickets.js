const express = require('express');
const db = require('../services/database');
const { sanitizeResponseInput } = require('../middleware/sanitize');

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

    const author = req.body.author || 'Support Agent';
    const response = db.insertResponse(id, {
      author,
      author_type: parsed.data.is_internal ? 'agent' : 'agent',
      body: parsed.data.body,
      is_internal: parsed.data.is_internal,
      delivery_status: parsed.data.is_internal ? 'logged' : 'sent',
    });

    const updatedTicket = db.getEmailById(id);
    res.status(201).json({ response, ticket: updatedTicket });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
