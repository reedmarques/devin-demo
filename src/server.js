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

// The acting user is a request header set by the role switcher.
// This is the demo seam — production would resolve the actor from Entra SSO.
function actor(req, res, next) {
  const id = req.get('x-actor-id');
  const user = id && db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(id);
  if (!user) return res.status(401).json({ error: 'Missing or unknown actor.' });
  req.actor = user;
  next();
}

function audit(actorId, action, flagKey, env, reason) {
  db.prepare(
    'INSERT INTO audit_events (at, actor_id, action, flag_key, environment, reason) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(new Date().toISOString(), actorId, action, flagKey, env, reason ?? null);
}

app.get('/api/flags', actor, (req, res) => {
  const flags = db.prepare(
    `SELECT key, name, description, development_enabled, staging_enabled, production_enabled, created_at
     FROM flags ORDER BY key`
  ).all();
  res.json(flags.map(serializeFlag));
});

app.post('/api/flags', actor, (req, res) => {
  if (req.actor.role === 'reader') {
    return res.status(403).json({ error: 'Readers have read-only access.' });
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
    audit(req.actor.id, 'create', key, null, null);
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
     WHERE a.flag_key = ? ORDER BY a.at DESC, a.id DESC`
  ).all(req.params.key);
  res.json({ flag: serializeFlag(flag), audit: events });
});

app.post('/api/flags/:key/environments/:env', actor, (req, res) => {
  const { env } = req.params;
  if (!ENVS.includes(env)) return res.status(422).json({ error: 'Unknown environment.' });
  const flag = db.prepare('SELECT * FROM flags WHERE key = ?').get(req.params.key);
  if (!flag) return res.status(404).json({ error: 'Flag not found.' });

  if (req.actor.role === 'reader') {
    return res.status(403).json({ error: 'Readers have read-only access.' });
  }
  if (env === 'production' && req.actor.role !== 'operator') {
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
    audit(req.actor.id, enabled ? 'enable' : 'disable', flag.key, env, env === 'production' ? reason.trim() : null);
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
app.listen(port, () => console.log(`Feature flag admin on http://localhost:${port}`));

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
