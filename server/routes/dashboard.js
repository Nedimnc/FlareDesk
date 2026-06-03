const express = require('express');
const db = require('../services/database');

const router = express.Router();

router.get('/', (req, res, next) => {
  try {
    const stats = db.getDashboardStats();
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
