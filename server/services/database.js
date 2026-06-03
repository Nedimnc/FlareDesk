const Database = require('better-sqlite3');
const path = require('path');

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
    );

    CREATE TABLE IF NOT EXISTS ticket_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email_id INTEGER NOT NULL,
      author TEXT NOT NULL,
      author_type TEXT NOT NULL DEFAULT 'agent',
      body TEXT NOT NULL,
      is_internal INTEGER NOT NULL DEFAULT 0,
      delivery_status TEXT DEFAULT 'sent',
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

    CREATE INDEX IF NOT EXISTS idx_responses_email ON ticket_responses(email_id);
    CREATE INDEX IF NOT EXISTS idx_events_email ON ticket_events(email_id);
  `);
}

function migrateSchema(database) {
  const cols = new Set(
    database.prepare('PRAGMA table_info(emails)').all().map((c) => c.name)
  );
  const migrations = [
    ['ticket_number', 'TEXT'],
    ['channel', "TEXT DEFAULT 'manual'"],
    ['closed_at', 'DATETIME'],
    ['last_response_at', 'DATETIME'],
    ['response_count', 'INTEGER DEFAULT 0'],
  ];
  for (const [name, def] of migrations) {
    if (!cols.has(name)) {
      database.exec(`ALTER TABLE emails ADD COLUMN ${name} ${def}`);
    }
  }
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
  const stmt = getDb().prepare(`
    INSERT INTO emails (
      sender, subject, body, tone_label, distress_score, priority,
      summary, escalation_risk, assigned_to, status, channel,
      received_at, analyzed_at
    ) VALUES (
      @sender, @subject, @body, @tone_label, @distress_score, @priority,
      @summary, @escalation_risk, @assigned_to, @status, @channel,
      @received_at, @analyzed_at
    )
  `);
  const result = stmt.run({
    channel: 'manual',
    ...row,
  });
  const id = result.lastInsertRowid;
  const ticketNumber = generateTicketNumber(id);
  getDb()
    .prepare('UPDATE emails SET ticket_number = ? WHERE id = ?')
    .run(ticketNumber, id);
  recordEvent(id, 'ticket_created', 'system', `Inbound via ${row.channel || 'manual'}`);
  recordEvent(id, 'analysis_complete', 'ai', row.summary || 'Tone analysis completed');
  return getEmailById(id);
}

function getEmailById(id) {
  return getDb().prepare('SELECT * FROM emails WHERE id = ?').get(id);
}

function getAllEmails(filters = {}) {
  const { status, priority, sort = 'distress_score', order = 'desc' } = filters;
  const allowedSort = ['distress_score', 'received_at', 'priority', 'id', 'last_response_at'];
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

function insertResponse(emailId, { author, author_type, body, is_internal, delivery_status }) {
  const ticket = getEmailById(emailId);
  if (!ticket) return null;

  const result = getDb()
    .prepare(
      `INSERT INTO ticket_responses (email_id, author, author_type, body, is_internal, delivery_status)
       VALUES (@email_id, @author, @author_type, @body, @is_internal, @delivery_status)`
    )
    .run({
      email_id: emailId,
      author,
      author_type: author_type || 'agent',
      body,
      is_internal: is_internal ? 1 : 0,
      delivery_status: delivery_status || 'sent',
    });

  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE emails SET response_count = response_count + 1, last_response_at = @now
       WHERE id = @id`
    )
    .run({ now, id: emailId });

  const label = is_internal ? 'internal_note' : 'agent_reply';
  recordEvent(
    emailId,
    label,
    author,
    is_internal ? 'Internal note added' : 'Reply sent to customer'
  );

  if (!is_internal && ticket.status === 'Open') {
    getDb().prepare("UPDATE emails SET status = 'In Progress' WHERE id = ?").run(emailId);
    recordEvent(emailId, 'status_changed', author, 'Open → In Progress (first reply)');
  }

  return getDb()
    .prepare('SELECT * FROM ticket_responses WHERE id = ?')
    .get(result.lastInsertRowid);
}

function updateEmail(id, fields, actor = 'agent') {
  const existing = getEmailById(id);
  if (!existing) return null;

  const allowed = ['status', 'assigned_to'];
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

  return getEmailById(id);
}

function deleteEmail(id) {
  const conn = getDb();
  conn.prepare('DELETE FROM ticket_responses WHERE email_id = ?').run(id);
  conn.prepare('DELETE FROM ticket_events WHERE email_id = ?').run(id);
  const result = conn.prepare('DELETE FROM emails WHERE id = ?').run(id);
  return result.changes > 0;
}

function getDashboardStats() {
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

  return {
    total,
    open,
    critical,
    closed,
    awaiting_response: awaiting,
    total_responses: totalResponses,
    avg_distress_score,
    top_escalation_risks,
    tone_breakdown,
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
  getAllEmails,
  updateEmail,
  deleteEmail,
  getDashboardStats,
  getTicketThread,
  insertResponse,
  getResponses,
  getEvents,
  recordEvent,
  generateTicketNumber,
  closeDb,
  DB_PATH,
};
