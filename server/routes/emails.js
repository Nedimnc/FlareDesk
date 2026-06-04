const express = require('express');
const { sanitizeEmailInput, sanitizePatchInput } = require('../middleware/sanitize');
const { emailPostLimiter } = require('../middleware/rateLimiter');
const { analyzeEmail } = require('../services/analyzer');
const db = require('../services/database');

const router = express.Router();

router.post('/', emailPostLimiter, async (req, res, next) => {
  try {
    const { sender, subject, body } = req.body || {};
    const sanitized = sanitizeEmailInput({ sender, subject, body });
    if (!sanitized.valid) {
      return res.status(400).json({ error: sanitized.errors.join('; ') });
    }

    const { sender: s, subject: sub, body: storedBody } = sanitized.data;
    const analysisBody = sanitized.analysisBody;

    const analysis = await analyzeEmail({ subject: sub, body: analysisBody });

    const email = db.insertEmail({
      sender: s,
      subject: sub,
      body: storedBody,
      tone_label: analysis.tone_label,
      distress_score: analysis.distress_score,
      priority: analysis.priority,
      summary: analysis.summary,
      escalation_risk: analysis.escalation_risk,
      assigned_to: 'Unassigned',
      status: 'Open',
      received_at: new Date().toISOString(),
      analyzed_at: new Date().toISOString(),
    });

    res.status(201).json(email);
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

router.get('/', (req, res, next) => {
  try {
    const { status, priority, queue, workspace_id, sort, order } = req.query;
    let emails = db.getAllEmails({ status, priority, queue, workspace_id, sort, order });

    const tone = req.query.tone_label || req.query.tone;
    if (tone) {
      emails = emails.filter((e) => e.tone_label === tone);
    }

    res.json(emails);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid email id' });
    }
    const email = db.getEmailById(id);
    if (!email) {
      return res.status(404).json({ error: 'Email not found' });
    }
    res.json(email);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid email id' });
    }

    const existing = db.getEmailById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Email not found' });
    }

    const patch = sanitizePatchInput(req.body || {});
    if (!patch.valid) {
      return res.status(400).json({ error: patch.error });
    }

    const updated = db.updateEmail(id, patch.data, (req.agent && req.agent.name) || 'agent');
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid email id' });
    }

    const deleted = db.deleteEmail(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Email not found' });
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
