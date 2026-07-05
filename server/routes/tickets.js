const express = require('express');
const validator = require('validator');
const db = require('../services/database');
const { sanitizeResponseInput } = require('../middleware/sanitize');
const { stripHtml } = require('../middleware/sanitize');
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

router.get('/:id/private-messages', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid ticket id' });
    }

    const ticket = db.getEmailById(id);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const recipient = (req.agent && req.agent.name) || 'Support Agent';
    res.json({
      messages: db.getPrivateMessages(id),
      unread_count: db.getPrivateUnreadCount(id, recipient),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/action-plan', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid ticket id' });
    }

    const ticket = db.getEmailById(id);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    res.json({ tasks: db.getTicketTasks(id) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/customer-context', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid ticket id' });
    }

    const context = db.getCustomerContext(id);
    if (!context) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    res.json(context);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/tasks/:taskId', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const taskId = Number(req.params.taskId);
    if (!Number.isInteger(id) || id < 1 || !Number.isInteger(taskId) || taskId < 1) {
      return res.status(400).json({ error: 'Invalid task id' });
    }

    const task = db.updateTicketTask(id, taskId, {
      is_completed: Boolean(req.body.is_completed),
      actor: (req.agent && req.agent.name) || 'agent',
    });
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(task);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/private-messages', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid ticket id' });
    }

    const body = typeof req.body.body === 'string' ? stripHtml(req.body.body).trim() : '';
    const recipient = typeof req.body.recipient === 'string' ? stripHtml(req.body.recipient).trim() : '';
    if (!body) {
      return res.status(400).json({ error: 'Private message body is required' });
    }
    if (body.length > 5000) {
      return res.status(400).json({ error: 'Private message body must be at most 5000 characters' });
    }
    if (!recipient || recipient.length > 255) {
      return res.status(400).json({ error: 'Private message recipient is required' });
    }

    const rawSender = req.body.sender || (req.agent && req.agent.name) || 'Support Agent';
    const sender = stripHtml(String(rawSender)).trim().slice(0, 255) || 'Support Agent';
    const message = db.insertPrivateMessage(id, {
      sender: validator.escape(sender),
      recipient: validator.escape(recipient),
      body: validator.escape(body),
    });
    if (!message) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    res.status(201).json(message);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/private-messages/read', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid ticket id' });
    }

    const recipient = req.body.recipient || (req.agent && req.agent.name) || 'Support Agent';
    const result = db.markPrivateMessagesRead(id, recipient);
    if (!result) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    res.json(result);
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
