import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const DB_PATH = path.join(root, 'flags.db');

export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id   TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('viewer', 'agent', 'lead'))
  );

  CREATE TABLE IF NOT EXISTS flags (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    key                 TEXT NOT NULL UNIQUE,
    name                TEXT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    development_enabled INTEGER NOT NULL DEFAULT 0,
    staging_enabled     INTEGER NOT NULL DEFAULT 0,
    production_enabled  INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS refunds (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    reference    TEXT NOT NULL UNIQUE,
    amount_cents INTEGER NOT NULL,
    status       TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied')) DEFAULT 'pending',
    request_note TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL,
    decided_at   TEXT
  );

  CREATE TABLE IF NOT EXISTS audit_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    at           TEXT NOT NULL,
    actor_id     TEXT NOT NULL REFERENCES users(id),
    subject_type TEXT NOT NULL CHECK (subject_type IN ('flag', 'refund')),
    subject_id   TEXT NOT NULL,
    action       TEXT NOT NULL CHECK (action IN ('create', 'enable', 'disable', 'approve', 'deny')),
    environment  TEXT CHECK (environment IN ('development', 'staging', 'production') OR environment IS NULL),
    reason       TEXT
  );
`;

export function openDb() {
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}
