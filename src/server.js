import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const db = openDb();
const app = express();
app.use(express.json());

const ENVS = ['development', 'staging', 'production'];
const KEY_RE = /^[a-z0-9_]{3,40}$/;
const AGENT_APPROVE_LIMIT_CENTS = 50000;

// Refund roles map onto the flag admin's role set.
const FLAG_ROLE = { viewer: 'reader', agent: 'editor', lead: 'operator' };

// The acting user is a request header set by the role switcher.
// This is the demo seam — production would resolve the actor from Entra SSO.
function actor(req, res, next) {
  const id = req.get('x-actor-id');
  const user = id && db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(id);
  if (!user) return res.status(401).json({ error: 'Missing or unknown actor.' });
  req.actor = user;
  next();
}

function audit(actorId, subjectType, subjectId, action, env, reason) {
  db.prepare(
    `INSERT INTO audit_events (at, actor_id, subject_type, subject_id, action, environment, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(new Date().toISOString(), actorId, subjectType, subjectId, action, env, reason ?? null);
}

// ---------- refunds ----------

app.get('/api/refunds', actor, (req, res) => {
  const status = req.query.status ?? 'pending';
  const summary = db.prepare(
    `SELECT COUNT(*) AS pending_count,
            COALESCE(SUM(amount_cents), 0) AS pending_cents,
            COALESCE(SUM(amount_cents > ?), 0) AS lead_only_count
     FROM refunds WHERE status = 'pending'`
  ).get(AGENT_APPROVE_LIMIT_CENTS);

  let rows;
  if (status === 'all') {
    rows = db.prepare('SELECT * FROM refunds ORDER BY created_at ASC').all();
  } else if (['pending', 'approved', 'denied'].includes(status)) {
    rows = db.prepare('SELECT * FROM refunds WHERE status = ? ORDER BY created_at ASC').all(status);
  } else {
    return res.status(422).json({ error: 'Unknown status filter.' });
  }
  res.json({ summary, refunds: rows.map(serializeRefund) });
});

app.get('/api/refunds/:reference', actor, (req, res) => {
  const refund = db.prepare('SELECT * FROM refunds WHERE reference = ?').get(req.params.reference);
  if (!refund) return res.status(404).json({ error: 'Refund not found.' });
  const events = db.prepare(
    `SELECT a.id, a.at, a.action, a.reason, u.name AS actor_name
     FROM audit_events a JOIN users u ON u.id = a.actor_id
     WHERE a.subject_type = 'refund' AND a.subject_id = ?
     ORDER BY a.at DESC, a.id DESC`
  ).all(refund.reference);
  res.json({ refund: serializeRefund(refund), audit: events });
});

app.post('/api/refunds/:reference/decision', actor, (req, res) => {
  const refund = db.prepare('SELECT * FROM refunds WHERE reference = ?').get(req.params.reference);
  if (!refund) return res.status(404).json({ error: 'Refund not found.' });
  if (req.actor.role === 'viewer') {
    return res.status(403).json({ error: 'You have view-only access.' });
  }
  const { action, reason } = req.body ?? {};
  if (action !== 'approve' && action !== 'deny') {
    return res.status(422).json({ error: 'action must be approve or deny.' });
  }
  if (refund.status !== 'pending') {
    return res.status(422).json({ error: 'This refund is already decided.' });
  }
  if (action === 'approve' && req.actor.role === 'agent' && refund.amount_cents > AGENT_APPROVE_LIMIT_CENTS) {
    return res.status(403).json({ error: 'A lead has to approve refunds over $500.' });
  }
  if (typeof reason !== 'string' || reason.trim().length < 15) {
    return res.status(422).json({ error: 'Enter a reason of at least 15 characters.' });
  }

  const decidedAt = new Date().toISOString();
  const status = action === 'approve' ? 'approved' : 'denied';
  db.exec('BEGIN');
  try {
    const updated = db.prepare(
      `UPDATE refunds SET status = ?, decided_at = ? WHERE reference = ? AND status = 'pending'`
    ).run(status, decidedAt, refund.reference);
    if (updated.changes === 0) {
      db.exec('ROLLBACK');
      return res.status(422).json({ error: 'This refund is already decided.' });
    }
    audit(req.actor.id, 'refund', refund.reference, action, null, reason.trim());
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.json(serializeRefund(db.prepare('SELECT * FROM refunds WHERE reference = ?').get(refund.reference)));
});

// ---------- flags ----------

app.get('/api/flags', actor, (req, res) => {
  const flags = db.prepare(
    `SELECT key, name, description, development_enabled, staging_enabled, production_enabled, created_at
     FROM flags ORDER BY key`
  ).all();
  res.json(flags.map(serializeFlag));
});

app.post('/api/flags', actor, (req, res) => {
  if (FLAG_ROLE[req.actor.role] === 'reader') {
    return res.status(403).json({ error: 'Viewers have read-only access.' });
  }
  const { key, name, description } = req.body ?? {};
  if (typeof key !== 'string' || !KEY_RE.test(key)) {
    return res.status(422).json({ error: 'Key must be 3-40 characters of lowercase letters, numbers, and underscores.' });
  }
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(422).json({ error: 'Name is required.' });
  }
  if (db.prepare('SELECT 1 FROM flags WHERE key = ?').get(key)) {
    return res.status(422).json({ error: 'That key already exists.' });
  }
  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO flags (key, name, description, development_enabled, staging_enabled, production_enabled, created_at)
       VALUES (?, ?, ?, 0, 0, 0, ?)`
    ).run(key, name.trim(), typeof description === 'string' ? description : '', new Date().toISOString());
    audit(req.actor.id, 'flag', key, 'create', null, null);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.status(201).json(serializeFlag(db.prepare('SELECT * FROM flags WHERE key = ?').get(key)));
});

app.get('/api/flags/:key', actor, (req, res) => {
  const flag = db.prepare('SELECT * FROM flags WHERE key = ?').get(req.params.key);
  if (!flag) return res.status(404).json({ error: 'Flag not found.' });
  const events = db.prepare(
    `SELECT a.id, a.at, a.action, a.environment, a.reason, u.name AS actor_name
     FROM audit_events a JOIN users u ON u.id = a.actor_id
     WHERE a.subject_type = 'flag' AND a.subject_id = ?
     ORDER BY a.at DESC, a.id DESC`
  ).all(req.params.key);
  res.json({ flag: serializeFlag(flag), audit: events });
});

app.post('/api/flags/:key/environments/:env', actor, (req, res) => {
  const { env } = req.params;
  if (!ENVS.includes(env)) return res.status(422).json({ error: 'Unknown environment.' });
  const flag = db.prepare('SELECT * FROM flags WHERE key = ?').get(req.params.key);
  if (!flag) return res.status(404).json({ error: 'Flag not found.' });

  const role = FLAG_ROLE[req.actor.role];
  if (role === 'reader') {
    return res.status(403).json({ error: 'Viewers have read-only access.' });
  }
  if (env === 'production' && role !== 'operator') {
    return res.status(403).json({ error: 'Production changes require an operator.' });
  }

  const { enabled, reason } = req.body ?? {};
  if (typeof enabled !== 'boolean') {
    return res.status(422).json({ error: 'enabled must be a boolean.' });
  }

  if (env === 'production') {
    if (enabled && !flag.staging_enabled) {
      return res.status(422).json({ error: 'Turn staging on before production.' });
    }
    if (typeof reason !== 'string' || reason.trim().length < 15) {
      return res.status(422).json({ error: 'Enter a reason of at least 15 characters.' });
    }
  }

  const column = `${env}_enabled`;
  if (Boolean(flag[column]) === enabled) {
    return res.json(serializeFlag(flag));
  }

  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE flags SET ${column} = ? WHERE key = ?`).run(enabled ? 1 : 0, flag.key);
    audit(req.actor.id, 'flag', flag.key, enabled ? 'enable' : 'disable', env, env === 'production' ? reason.trim() : null);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.json(serializeFlag(db.prepare('SELECT * FROM flags WHERE key = ?').get(flag.key)));
});

// Unauthenticated on purpose: flag state is not a secret.
app.get('/api/evaluate', (req, res) => {
  const { key, env } = req.query;
  if (!ENVS.includes(env)) return res.status(404).json({ error: 'Not found.' });
  const flag = db.prepare('SELECT * FROM flags WHERE key = ?').get(key);
  if (!flag) return res.status(404).json({ error: 'Not found.' });
  res.json({ key: flag.key, env, enabled: Boolean(flag[`${env}_enabled`]) });
});

app.use(express.static(path.join(root, 'public')));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`FinTechCompany internal tools on http://localhost:${port}`));

function serializeRefund(r) {
  return {
    reference: r.reference,
    amount_cents: r.amount_cents,
    status: r.status,
    request_note: r.request_note,
    created_at: r.created_at,
    decided_at: r.decided_at,
  };
}

function serializeFlag(f) {
  return {
    key: f.key,
    name: f.name,
    description: f.description,
    development: Boolean(f.development_enabled),
    staging: Boolean(f.staging_enabled),
    production: Boolean(f.production_enabled),
    createdAt: f.created_at,
  };
}
