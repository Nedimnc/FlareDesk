const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.FLAREDESK_DB_PATH || path.join(__dirname, '../../flaredesk.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initSchema(db);
  }
  return db;
}

function initSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      analyzed_at DATETIME
    );
  `);
}

function clearEmails() {
  getDb().prepare('DELETE FROM emails').run();
}

function insertEmail(row) {
  const stmt = getDb().prepare(`
    INSERT INTO emails (
      sender, subject, body, tone_label, distress_score, priority,
      summary, escalation_risk, assigned_to, status, received_at, analyzed_at
    ) VALUES (
      @sender, @subject, @body, @tone_label, @distress_score, @priority,
      @summary, @escalation_risk, @assigned_to, @status, @received_at, @analyzed_at
    )
  `);
  const result = stmt.run(row);
  return getEmailById(result.lastInsertRowid);
}

function getEmailById(id) {
  return getDb().prepare('SELECT * FROM emails WHERE id = ?').get(id);
}

function getAllEmails(filters = {}) {
  const { status, priority, sort = 'distress_score', order = 'desc' } = filters;
  const allowedSort = ['distress_score', 'received_at', 'priority', 'id'];
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

function updateEmail(id, fields) {
  const allowed = ['status', 'assigned_to'];
  const updates = [];
  const params = {};

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      updates.push(`${key} = @${key}`);
      params[key] = fields[key];
    }
  }

  if (updates.length === 0) {
    return getEmailById(id);
  }

  params.id = id;
  const sql = `UPDATE emails SET ${updates.join(', ')} WHERE id = @id`;
  getDb().prepare(sql).run(params);
  return getEmailById(id);
}

function deleteEmail(id) {
  const result = getDb().prepare('DELETE FROM emails WHERE id = ?').run(id);
  return result.changes > 0;
}

function getDashboardStats() {
  const dbConn = getDb();
  const total = dbConn.prepare('SELECT COUNT(*) as count FROM emails').get().count;
  const open = dbConn.prepare("SELECT COUNT(*) as count FROM emails WHERE status = 'Open'").get().count;
  const critical = dbConn
    .prepare("SELECT COUNT(*) as count FROM emails WHERE priority = 'CRITICAL'")
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

  return {
    total,
    open,
    critical,
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
  closeDb,
  DB_PATH,
};
