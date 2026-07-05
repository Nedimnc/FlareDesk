const express = require('express');
const db = require('../services/database');
const { MACROS, TEAM_MEMBERS, buildReplyDraft } = require('../services/supportOps');

const router = express.Router();

router.get('/macros', (req, res) => {
  res.json(MACROS);
});

router.get('/queues', (req, res, next) => {
  try {
    res.json(db.getQueues());
  } catch (err) {
    next(err);
  }
});

router.get('/workspaces', (req, res, next) => {
  try {
    res.json(db.getWorkspaces());
  } catch (err) {
    next(err);
  }
});

router.get('/team-members', (req, res) => {
  res.json(TEAM_MEMBERS);
});

router.get('/reports/overview', (req, res, next) => {
  try {
    res.json(db.getReportOverview());
  } catch (err) {
    next(err);
  }
});

router.get('/emails/:id/reply-draft', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid ticket id' });
    }

    const thread = db.getTicketThread(id);
    if (!thread) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    res.json(buildReplyDraft(thread.ticket, thread.responses, req.query.macro_id));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
