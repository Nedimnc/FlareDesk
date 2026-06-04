require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const auth = require('./middleware/auth');
const { apiLimiter } = require('./middleware/rateLimiter');
const emailsRouter = require('./routes/emails');
const dashboardRouter = require('./routes/dashboard');
const ticketsRouter = require('./routes/tickets');
const webhooksRouter = require('./routes/webhooks');
const supportRouter = require('./routes/support');
const db = require('./services/database');
const { isEmailDeliveryConfigured } = require('./services/emailDelivery');

// TODO: Replace /api/config open endpoint with proper session auth (OAuth or JWT)
// Webhook ingest: POST /api/webhooks/inbound-email (see ARCHITECTURE.md)
// TODO: Add team/workspace model for multi-tenant SaaS
// TODO: Add Stripe billing integration ($99/month per workspace)
// TODO: Add email notification to senior agents when CRITICAL email arrives
// TODO: Replace SQLite with PostgreSQL for production scale
// TODO: Add GDPR email data deletion endpoint
// TODO: Set up proper logging (e.g. Pino or Winston) instead of console.log
// TODO: Add CORS whitelist for production domain

const app = express();
const PORT = process.env.PORT || 3000;

db.getDb();

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
      },
    },
  })
);

// Production: replace with your deployed frontend origin(s)
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const allowed =
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
      if (allowed) return callback(null, true);
      callback(new Error('Not allowed by CORS'));
    },
  })
);

app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(express.static(path.join(__dirname, '../public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Demo-only: exposes API key to the browser dashboard. Remove in production.
app.get('/api/config', (req, res) => {
  res.json({
    apiKey: process.env.FLAREDESK_API_KEY,
    emailDeliveryMode: isEmailDeliveryConfigured() ? 'mailgun' : 'local',
    workspaceId: process.env.FLAREDESK_WORKSPACE_ID || 'demo',
    agentName: process.env.FLAREDESK_AGENT_NAME || 'Support Agent',
  });
});

app.use('/api', apiLimiter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api', auth, supportRouter);
app.use('/api/emails', auth, emailsRouter);
app.use('/api/emails', auth, ticketsRouter);
app.use('/api/dashboard', auth, dashboardRouter);

app.use((err, req, res, next) => {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}]`, err.message || err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`FlareDesk running at http://localhost:${PORT}`);
  });
}

module.exports = app;
