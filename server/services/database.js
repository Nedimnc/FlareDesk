const Database = require('better-sqlite3');
const path = require('path');
const {
  calculateSlaDeadlines,
  classifyQueue,
  computeSlaStatus,
  suggestedAssignee,
} = require('./supportOps');

const DB_PATH = process.env.FLAREDESK_DB_PATH || path.join(__dirname, '../../flaredesk.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initSchema(db);
    migrateSchema(db);
  }
  return db;
}

function initSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_number TEXT UNIQUE,
      sender TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      message_id TEXT,
      in_reply_to TEXT,
      email_references TEXT,
      tone_label TEXT,
      distress_score INTEGER,
      priority TEXT,
      summary TEXT,
      escalation_risk TEXT,
      assigned_to TEXT DEFAULT 'Unassigned',
      status TEXT DEFAULT 'Open',
      channel TEXT DEFAULT 'manual',
      received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      analyzed_at DATETIME,
      closed_at DATETIME,
      last_response_at DATETIME,
      response_count INTEGER DEFAULT 0
      ,workspace_id TEXT DEFAULT 'demo'
      ,queue TEXT DEFAULT 'General'
      ,first_response_due_at DATETIME
      ,resolution_due_at DATETIME
      ,first_response_at DATETIME
      ,resolved_at DATETIME
      ,sla_status TEXT DEFAULT 'on_track'
      ,critical_alert_sent_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS ticket_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email_id INTEGER NOT NULL,
      author TEXT NOT NULL,
      author_type TEXT NOT NULL DEFAULT 'agent',
      body TEXT NOT NULL,
      is_internal INTEGER NOT NULL DEFAULT 0,
      delivery_status TEXT DEFAULT 'sent',
      provider_message_id TEXT,
      in_reply_to TEXT,
      email_references TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (email_id) REFERENCES emails(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ticket_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      actor TEXT,
      detail TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (email_id) REFERENCES emails(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'Demo',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS csat_surveys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email_id INTEGER NOT NULL,
      rating INTEGER,
      comment TEXT,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      responded_at DATETIME,
      FOREIGN KEY (email_id) REFERENCES emails(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_responses_email ON ticket_responses(email_id);
    CREATE INDEX IF NOT EXISTS idx_events_email ON ticket_events(email_id);
    CREATE INDEX IF NOT EXISTS idx_emails_message_id ON emails(message_id);
    CREATE INDEX IF NOT EXISTS idx_responses_provider_message_id ON ticket_responses(provider_message_id);
    CREATE INDEX IF NOT EXISTS idx_csat_email ON csat_surveys(email_id);
  `);
  database
    .prepare(
      "INSERT OR IGNORE INTO workspaces (id, name, plan) VALUES ('demo', 'Demo Workspace', 'Demo')"
    )
    .run();
}

function migrateSchema(database) {
  const emailCols = new Set(
    database.prepare('PRAGMA table_info(emails)').all().map((c) => c.name)
  );
  const emailMigrations = [
    ['ticket_number', 'TEXT'],
    ['channel', "TEXT DEFAULT 'manual'"],
    ['closed_at', 'DATETIME'],
    ['last_response_at', 'DATETIME'],
    ['response_count', 'INTEGER DEFAULT 0'],
    ['message_id', 'TEXT'],
    ['in_reply_to', 'TEXT'],
    ['email_references', 'TEXT'],
    ['workspace_id', "TEXT DEFAULT 'demo'"],
    ['queue', "TEXT DEFAULT 'General'"],
    ['first_response_due_at', 'DATETIME'],
    ['resolution_due_at', 'DATETIME'],
    ['first_response_at', 'DATETIME'],
    ['resolved_at', 'DATETIME'],
    ['sla_status', "TEXT DEFAULT 'on_track'"],
    ['critical_alert_sent_at', 'DATETIME'],
  ];
  for (const [name, def] of emailMigrations) {
    if (!emailCols.has(name)) {
      database.exec(`ALTER TABLE emails ADD COLUMN ${name} ${def}`);
    }
  }

  const responseCols = new Set(
    database.prepare('PRAGMA table_info(ticket_responses)').all().map((c) => c.name)
  );
  const responseMigrations = [
    ['provider_message_id', 'TEXT'],
    ['in_reply_to', 'TEXT'],
    ['email_references', 'TEXT'],
  ];
  for (const [name, def] of responseMigrations) {
    if (!responseCols.has(name)) {
      database.exec(`ALTER TABLE ticket_responses ADD COLUMN ${name} ${def}`);
    }
  }

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_emails_message_id ON emails(message_id);
    CREATE INDEX IF NOT EXISTS idx_emails_workspace_queue ON emails(workspace_id, queue);
    CREATE INDEX IF NOT EXISTS idx_emails_sla_status ON emails(sla_status);
    CREATE INDEX IF NOT EXISTS idx_responses_provider_message_id ON ticket_responses(provider_message_id);
    CREATE INDEX IF NOT EXISTS idx_csat_email ON csat_surveys(email_id);
  `);

  database
    .prepare(
      "INSERT OR IGNORE INTO workspaces (id, name, plan) VALUES ('demo', 'Demo Workspace', 'Demo')"
    )
    .run();
}

function generateTicketNumber(id) {
  const year = new Date().getFullYear();
  return `FD-${year}-${String(id).padStart(4, '0')}`;
}

function recordEvent(emailId, eventType, actor, detail) {
  getDb()
    .prepare(
      'INSERT INTO ticket_events (email_id, event_type, actor, detail) VALUES (?, ?, ?, ?)'
    )
    .run(emailId, eventType, actor || 'system', detail || null);
}

function clearEmails() {
  const conn = getDb();
  conn.prepare('DELETE FROM ticket_responses').run();
  conn.prepare('DELETE FROM ticket_events').run();
  conn.prepare('DELETE FROM emails').run();
}

function insertEmail(row) {
  const receivedAt = row.received_at || new Date().toISOString();
  const queue = row.queue || classifyQueue(row);
  const sla = calculateSlaDeadlines(row.priority, receivedAt);
  const requestedAssignee =
    row.assigned_to && row.assigned_to !== 'Unassigned' ? row.assigned_to : null;
  const assignee =
    requestedAssignee || (row.priority === 'CRITICAL' ? suggestedAssignee(queue, row.priority) : 'Unassigned');
  const stmt = getDb().prepare(`
    INSERT INTO emails (
      sender, subject, body, tone_label, distress_score, priority,
      summary, escalation_risk, assigned_to, status, channel,
      received_at, analyzed_at, message_id, in_reply_to, email_references,
      workspace_id, queue, first_response_due_at, resolution_due_at, sla_status,
      critical_alert_sent_at
    ) VALUES (
      @sender, @subject, @body, @tone_label, @distress_score, @priority,
      @summary, @escalation_risk, @assigned_to, @status, @channel,
      @received_at, @analyzed_at, @message_id, @in_reply_to, @email_references,
      @workspace_id, @queue, @first_response_due_at, @resolution_due_at, @sla_status,
      @critical_alert_sent_at
    )
  `);
  const result = stmt.run({
    channel: 'manual',
    assigned_to: assignee,
    status: 'Open',
    received_at: receivedAt,
    analyzed_at: new Date().toISOString(),
    message_id: null,
    in_reply_to: null,
    email_references: null,
    workspace_id: 'demo',
    queue,
    first_response_due_at: sla.first_response_due_at,
    resolution_due_at: sla.resolution_due_at,
    sla_status: 'on_track',
    critical_alert_sent_at: row.priority === 'CRITICAL' ? new Date().toISOString() : null,
    ...row,
    assigned_to: assignee,
    received_at: receivedAt,
    queue,
    first_response_due_at: row.first_response_due_at || sla.first_response_due_at,
    resolution_due_at: row.resolution_due_at || sla.resolution_due_at,
    sla_status: row.sla_status || 'on_track',
    critical_alert_sent_at:
      row.critical_alert_sent_at || (row.priority === 'CRITICAL' ? new Date().toISOString() : null),
  });
  const id = result.lastInsertRowid;
  const ticketNumber = generateTicketNumber(id);
  getDb()
    .prepare('UPDATE emails SET ticket_number = ? WHERE id = ?')
    .run(ticketNumber, id);
  recordEvent(id, 'ticket_created', 'system', `Inbound via ${row.channel || 'manual'}`);
  recordEvent(id, 'analysis_complete', 'ai', row.summary || 'Tone analysis completed');
  recordEvent(id, 'sla_started', 'system', `First response due ${sla.first_response_due_at}`);
  if (row.priority === 'CRITICAL') {
    recordEvent(id, 'critical_alert', 'system', `Alert routed to ${assignee}`);
  }
  return getEmailById(id);
}

function getEmailById(id) {
  return getDb().prepare('SELECT * FROM emails WHERE id = ?').get(id);
}

function updateTicketSlaStatus(id) {
  const ticket = getEmailById(id);
  if (!ticket) return null;
  const status = computeSlaStatus(ticket);
  if (status !== ticket.sla_status) {
    getDb().prepare('UPDATE emails SET sla_status = ? WHERE id = ?').run(status, id);
    recordEvent(id, 'sla_status_changed', 'system', `${ticket.sla_status || 'unknown'} → ${status}`);
  }
  return status;
}

function refreshSlaStatuses() {
  const activeTickets = getDb()
    .prepare("SELECT id FROM emails WHERE status NOT IN ('Resolved', 'Closed')")
    .all();
  for (const ticket of activeTickets) {
    updateTicketSlaStatus(ticket.id);
  }
}

function getEmailByMessageId(messageId) {
  if (!messageId) return null;
  return getDb().prepare('SELECT * FROM emails WHERE message_id = ?').get(messageId);
}

function getResponseByProviderMessageId(messageId) {
  if (!messageId) return null;
  return getDb()
    .prepare('SELECT * FROM ticket_responses WHERE provider_message_id = ?')
    .get(messageId);
}

function getTicketByResponseMessageId(messageId) {
  if (!messageId) return null;
  return getDb()
    .prepare(
      `SELECT e.* FROM emails e
       JOIN ticket_responses r ON r.email_id = e.id
       WHERE r.provider_message_id = ?
       LIMIT 1`
    )
    .get(messageId);
}

function findTicketByMessageHeaders({ in_reply_to, email_references }) {
  const candidates = [in_reply_to];
  if (email_references) {
    candidates.push(...email_references.split(/\s+/));
  }

  for (const raw of candidates) {
    const messageId = raw && raw.trim();
    if (!messageId) continue;

    const ticket = getEmailByMessageId(messageId) || getTicketByResponseMessageId(messageId);
    if (ticket) return ticket;
  }

  return null;
}

function getAllEmails(filters = {}) {
  refreshSlaStatuses();
  const { status, priority, queue, workspace_id, sort = 'distress_score', order = 'desc' } = filters;
  const allowedSort = [
    'distress_score',
    'received_at',
    'priority',
    'id',
    'last_response_at',
    'first_response_due_at',
    'resolution_due_at',
  ];
  const sortCol = allowedSort.includes(sort) ? sort : 'distress_score';
  const sortOrder = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  let sql = 'SELECT * FROM emails WHERE 1=1';
  const params = [];

  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  if (priority) {
    sql += ' AND priority = ?';
    params.push(priority);
  }
  if (queue) {
    sql += ' AND queue = ?';
    params.push(queue);
  }
  if (workspace_id) {
    sql += ' AND workspace_id = ?';
    params.push(workspace_id);
  }

  sql += ` ORDER BY ${sortCol} ${sortOrder}`;

  return getDb().prepare(sql).all(...params);
}

function getResponses(emailId) {
  return getDb()
    .prepare(
      'SELECT * FROM ticket_responses WHERE email_id = ? ORDER BY created_at ASC'
    )
    .all(emailId);
}

function getEvents(emailId) {
  return getDb()
    .prepare('SELECT * FROM ticket_events WHERE email_id = ? ORDER BY created_at ASC')
    .all(emailId);
}

function getTicketThread(id) {
  const ticket = getEmailById(id);
  if (!ticket) return null;
  return {
    ticket,
    responses: getResponses(id),
    events: getEvents(id),
  };
}

function responseEventDetail({ author_type, is_internal, delivery_status }) {
  if (is_internal) return 'Internal note added';
  if (author_type === 'customer') return 'Customer reply received';
  if (delivery_status === 'failed') return 'Reply failed to send';
  if (delivery_status === 'logged') return 'Reply logged locally (email delivery not configured)';
  return 'Reply sent to customer';
}

function insertResponse(emailId, {
  author,
  author_type,
  body,
  is_internal,
  delivery_status,
  provider_message_id,
  in_reply_to,
  email_references,
}) {
  const ticket = getEmailById(emailId);
  if (!ticket) return null;

  const result = getDb()
    .prepare(
      `INSERT INTO ticket_responses (
        email_id, author, author_type, body, is_internal, delivery_status,
        provider_message_id, in_reply_to, email_references
      )
       VALUES (
        @email_id, @author, @author_type, @body, @is_internal, @delivery_status,
        @provider_message_id, @in_reply_to, @email_references
      )`
    )
    .run({
      email_id: emailId,
      author,
      author_type: author_type || 'agent',
      body,
      is_internal: is_internal ? 1 : 0,
      delivery_status: delivery_status || 'sent',
      provider_message_id: provider_message_id || null,
      in_reply_to: in_reply_to || null,
      email_references: email_references || null,
    });

  const now = new Date().toISOString();
  const responseAuthorType = author_type || 'agent';
  const shouldSetFirstResponse =
    !is_internal && responseAuthorType === 'agent' && !ticket.first_response_at;
  getDb()
    .prepare(
      `UPDATE emails SET
        response_count = response_count + 1,
        last_response_at = @now,
        first_response_at = CASE
          WHEN @set_first_response = 1 THEN @now
          ELSE first_response_at
        END
       WHERE id = @id`
    )
    .run({ now, id: emailId, set_first_response: shouldSetFirstResponse ? 1 : 0 });

  const label = is_internal
    ? 'internal_note'
    : responseAuthorType === 'customer'
      ? 'customer_reply'
      : 'agent_reply';
  recordEvent(
    emailId,
    label,
    author,
    responseEventDetail({
      author_type: responseAuthorType,
      is_internal,
      delivery_status: delivery_status || 'sent',
    })
  );

  if (!is_internal && responseAuthorType === 'agent' && ticket.status === 'Open') {
    getDb().prepare("UPDATE emails SET status = 'In Progress' WHERE id = ?").run(emailId);
    recordEvent(emailId, 'status_changed', author, 'Open → In Progress (first reply)');
  }
  updateTicketSlaStatus(emailId);

  return getDb()
    .prepare('SELECT * FROM ticket_responses WHERE id = ?')
    .get(result.lastInsertRowid);
}

function updateEmail(id, fields, actor = 'agent') {
  const existing = getEmailById(id);
  if (!existing) return null;

  const allowed = ['status', 'assigned_to', 'queue', 'workspace_id'];
  const updates = [];
  const params = { id };

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      updates.push(`${key} = @${key}`);
      params[key] = fields[key];
    }
  }

  if (fields.status === 'Closed' || fields.status === 'Resolved') {
    updates.push('closed_at = @closed_at');
    updates.push('resolved_at = @closed_at');
    params.closed_at = new Date().toISOString();
  }

  if (updates.length === 0) {
    return existing;
  }

  const sql = `UPDATE emails SET ${updates.join(', ')} WHERE id = @id`;
  getDb().prepare(sql).run(params);

  if (fields.status && fields.status !== existing.status) {
    recordEvent(id, 'status_changed', actor, `${existing.status} → ${fields.status}`);
  }
  if (fields.assigned_to && fields.assigned_to !== existing.assigned_to) {
    recordEvent(id, 'assigned', actor, `Assigned to ${fields.assigned_to}`);
  }
  if (fields.queue && fields.queue !== existing.queue) {
    recordEvent(id, 'queue_changed', actor, `${existing.queue || 'General'} → ${fields.queue}`);
  }
  if (fields.status && ['Resolved', 'Closed'].includes(fields.status)) {
    ensureCsatSurvey(id);
  }
  updateTicketSlaStatus(id);

  return getEmailById(id);
}

function deleteEmail(id) {
  const conn = getDb();
  conn.prepare('DELETE FROM csat_surveys WHERE email_id = ?').run(id);
  conn.prepare('DELETE FROM ticket_responses WHERE email_id = ?').run(id);
  conn.prepare('DELETE FROM ticket_events WHERE email_id = ?').run(id);
  const result = conn.prepare('DELETE FROM emails WHERE id = ?').run(id);
  return result.changes > 0;
}

function getWorkspaces() {
  return getDb().prepare('SELECT * FROM workspaces ORDER BY created_at ASC').all();
}

function getQueues() {
  refreshSlaStatuses();
  const rows = getDb()
    .prepare(
      `SELECT queue, COUNT(*) as open_count
       FROM emails
       WHERE status NOT IN ('Resolved', 'Closed')
       GROUP BY queue`
    )
    .all();
  const counts = Object.fromEntries(rows.map((row) => [row.queue, row.open_count]));
  const { QUEUES } = require('./supportOps');
  return QUEUES.map((queue) => ({
    ...queue,
    open_count: counts[queue.id] || 0,
  }));
}

function ensureCsatSurvey(emailId) {
  const existing = getDb()
    .prepare('SELECT * FROM csat_surveys WHERE email_id = ?')
    .get(emailId);
  if (existing) return existing;

  const result = getDb()
    .prepare('INSERT INTO csat_surveys (email_id, sent_at) VALUES (?, ?)')
    .run(emailId, new Date().toISOString());
  recordEvent(emailId, 'csat_sent', 'system', 'CSAT survey queued for resolved ticket');
  return getDb().prepare('SELECT * FROM csat_surveys WHERE id = ?').get(result.lastInsertRowid);
}

function submitCsat(emailId, { rating, comment }) {
  const ticket = getEmailById(emailId);
  if (!ticket) return null;
  ensureCsatSurvey(emailId);
  getDb()
    .prepare(
      `UPDATE csat_surveys
       SET rating = @rating, comment = @comment, responded_at = @responded_at
       WHERE email_id = @email_id`
    )
    .run({
      email_id: emailId,
      rating,
      comment: comment || null,
      responded_at: new Date().toISOString(),
    });
  recordEvent(emailId, 'csat_received', 'customer', `Rating: ${rating}/5`);
  return getDb().prepare('SELECT * FROM csat_surveys WHERE email_id = ?').get(emailId);
}

function getCsat(emailId) {
  return getDb().prepare('SELECT * FROM csat_surveys WHERE email_id = ?').get(emailId) || null;
}

function getDashboardStats() {
  refreshSlaStatuses();
  const dbConn = getDb();
  const total = dbConn.prepare('SELECT COUNT(*) as count FROM emails').get().count;
  const open = dbConn
    .prepare("SELECT COUNT(*) as count FROM emails WHERE status IN ('Open', 'In Progress', 'Waiting on Customer')")
    .get().count;
  const critical = dbConn
    .prepare("SELECT COUNT(*) as count FROM emails WHERE priority = 'CRITICAL' AND status != 'Closed'")
    .get().count;
  const closed = dbConn.prepare("SELECT COUNT(*) as count FROM emails WHERE status = 'Closed'").get().count;
  const awaiting = dbConn
    .prepare(
      "SELECT COUNT(*) as count FROM emails WHERE status IN ('Open', 'In Progress') AND (response_count IS NULL OR response_count = 0)"
    )
    .get().count;

  const avgRow = dbConn
    .prepare('SELECT AVG(distress_score) as avg_score FROM emails WHERE distress_score IS NOT NULL')
    .get();
  const avg_distress_score =
    avgRow.avg_score != null ? Math.round(avgRow.avg_score * 10) / 10 : 0;

  const escalationRows = dbConn
    .prepare(
      'SELECT escalation_risk, COUNT(*) as count FROM emails WHERE escalation_risk IS NOT NULL GROUP BY escalation_risk'
    )
    .all();
  const top_escalation_risks = {};
  for (const row of escalationRows) {
    top_escalation_risks[row.escalation_risk] = row.count;
  }

  const toneRows = dbConn
    .prepare(
      'SELECT tone_label, COUNT(*) as count FROM emails WHERE tone_label IS NOT NULL GROUP BY tone_label'
    )
    .all();
  const tone_breakdown = {};
  for (const row of toneRows) {
    tone_breakdown[row.tone_label] = row.count;
  }

  const totalResponses = dbConn
    .prepare('SELECT COUNT(*) as count FROM ticket_responses')
    .get().count;
  const slaBreached = dbConn
    .prepare(
      "SELECT COUNT(*) as count FROM emails WHERE sla_status = 'breached' AND status NOT IN ('Resolved', 'Closed')"
    )
    .get().count;
  const slaDueSoon = dbConn
    .prepare(
      "SELECT COUNT(*) as count FROM emails WHERE sla_status = 'due_soon' AND status NOT IN ('Resolved', 'Closed')"
    )
    .get().count;
  const criticalAlerts = dbConn
    .prepare('SELECT COUNT(*) as count FROM emails WHERE critical_alert_sent_at IS NOT NULL')
    .get().count;
  const csatRow = dbConn
    .prepare('SELECT AVG(rating) as avg_rating, COUNT(rating) as responses FROM csat_surveys WHERE rating IS NOT NULL')
    .get();
  const queueRows = dbConn
    .prepare(
      "SELECT queue, COUNT(*) as count FROM emails WHERE status NOT IN ('Resolved', 'Closed') GROUP BY queue"
    )
    .all();
  const queue_breakdown = {};
  for (const row of queueRows) {
    queue_breakdown[row.queue || 'General'] = row.count;
  }

  return {
    total,
    open,
    critical,
    closed,
    awaiting_response: awaiting,
    total_responses: totalResponses,
    sla_breached: slaBreached,
    sla_due_soon: slaDueSoon,
    critical_alerts: criticalAlerts,
    avg_csat: csatRow.avg_rating != null ? Math.round(csatRow.avg_rating * 10) / 10 : null,
    csat_responses: csatRow.responses || 0,
    queue_breakdown,
    avg_distress_score,
    top_escalation_risks,
    tone_breakdown,
  };
}

function getReportOverview() {
  refreshSlaStatuses();
  const dbConn = getDb();
  const byPriority = dbConn
    .prepare('SELECT priority, COUNT(*) as count FROM emails GROUP BY priority')
    .all();
  const byQueue = dbConn
    .prepare('SELECT queue, COUNT(*) as count FROM emails GROUP BY queue')
    .all();
  const bySla = dbConn
    .prepare('SELECT sla_status, COUNT(*) as count FROM emails GROUP BY sla_status')
    .all();
  const responseRows = dbConn
    .prepare(
      `SELECT received_at, first_response_at
       FROM emails
       WHERE first_response_at IS NOT NULL`
    )
    .all();
  const avgFirstResponseMinutes = responseRows.length
    ? Math.round(
        responseRows.reduce((sum, row) => {
          return sum + (new Date(row.first_response_at) - new Date(row.received_at)) / 60000;
        }, 0) / responseRows.length
      )
    : null;

  return {
    priority_breakdown: Object.fromEntries(byPriority.map((row) => [row.priority, row.count])),
    queue_breakdown: Object.fromEntries(byQueue.map((row) => [row.queue || 'General', row.count])),
    sla_breakdown: Object.fromEntries(bySla.map((row) => [row.sla_status || 'on_track', row.count])),
    avg_first_response_minutes: avgFirstResponseMinutes,
    dashboard: getDashboardStats(),
  };
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  getDb,
  clearEmails,
  insertEmail,
  getEmailById,
  getEmailByMessageId,
  getResponseByProviderMessageId,
  findTicketByMessageHeaders,
  updateTicketSlaStatus,
  refreshSlaStatuses,
  getAllEmails,
  updateEmail,
  deleteEmail,
  getDashboardStats,
  getReportOverview,
  getWorkspaces,
  getQueues,
  ensureCsatSurvey,
  submitCsat,
  getCsat,
  getTicketThread,
  insertResponse,
  getResponses,
  getEvents,
  recordEvent,
  generateTicketNumber,
  closeDb,
  DB_PATH,
};
