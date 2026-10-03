import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const DB_PATH = path.join(root, 'flags.db');

export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id   TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('reader', 'editor', 'operator'))
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

  CREATE TABLE IF NOT EXISTS audit_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    at          TEXT NOT NULL,
    actor_id    TEXT NOT NULL REFERENCES users(id),
    action      TEXT NOT NULL CHECK (action IN ('create', 'enable', 'disable')),
    flag_key    TEXT NOT NULL REFERENCES flags(key),
    environment TEXT CHECK (environment IN ('development', 'staging', 'production') OR environment IS NULL),
    reason      TEXT
  );
`;

export function openDb() {
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}
