import fs from 'node:fs';
import { openDb, DB_PATH } from './db.js';

if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
const db = openDb();

const users = [
  ['avery', 'Avery C.', 'reader'],
  ['jordan', 'Jordan L.', 'editor'],
  ['sam', 'Sam P.', 'operator'],
];

// key, name, description, dev, staging, prod
const flags = [
  ['new_checkout', 'New checkout flow', 'Routes checkout through the redesigned one-page flow.', 1, 1, 0],
  ['faster_kyc_banner', 'Faster KYC banner', 'Shows the expedited-verification banner on the KYC page.', 1, 0, 0],
  ['refund_self_serve', 'Refund self-serve', 'Lets support agents issue refunds without an approval ticket.', 1, 1, 1],
  ['dark_mode', 'Dark mode', 'Enables the dark theme across internal tools.', 0, 0, 0],
  ['statement_pdf_v2', 'Statement PDF v2', 'Generates statements with the new PDF renderer.', 1, 1, 0],
  ['wire_limit_hint', 'Wire limit hint', 'Shows the daily wire limit inline on the transfer form.', 1, 0, 0],
  ['beta_search', 'Beta search', 'Swaps transaction search to the beta indexing service.', 1, 1, 1],
  ['maintenance_banner', 'Maintenance banner', 'Displays the scheduled-maintenance banner on all pages.', 0, 0, 0],
];

// Enough history that at least two flags open onto a non-empty timeline.
// key, at (offset in hours before now), actor, action, environment, reason
const audit = [
  ['new_checkout', -72, 'jordan', 'create', null, null],
  ['new_checkout', -70, 'jordan', 'enable', 'development', null],
  ['new_checkout', -48, 'sam', 'enable', 'staging', null],
  ['refund_self_serve', -200, 'jordan', 'create', null, null],
  ['refund_self_serve', -190, 'jordan', 'enable', 'development', null],
  ['refund_self_serve', -170, 'sam', 'enable', 'staging', null],
  ['refund_self_serve', -160, 'sam', 'enable', 'production', 'Support rollout approved by ops review on 9/28.'],
  ['beta_search', -120, 'sam', 'create', null, null],
  ['beta_search', -100, 'jordan', 'enable', 'development', null],
  ['beta_search', -96, 'sam', 'enable', 'staging', null],
  ['beta_search', -24, 'sam', 'enable', 'production', 'Beta cohort validated; enabling for all traffic.'],
  ['statement_pdf_v2', -50, 'jordan', 'create', null, null],
  ['statement_pdf_v2', -30, 'jordan', 'enable', 'development', null],
  ['statement_pdf_v2', -10, 'sam', 'enable', 'staging', null],
];

const insertUser = db.prepare('INSERT INTO users (id, name, role) VALUES (?, ?, ?)');
const insertFlag = db.prepare(`
  INSERT INTO flags (key, name, description, development_enabled, staging_enabled, production_enabled, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const insertAudit = db.prepare(`
  INSERT INTO audit_events (at, actor_id, action, flag_key, environment, reason)
  VALUES (?, ?, ?, ?, ?, ?)
`);

db.exec('BEGIN');
try {
  for (const u of users) insertUser.run(...u);
  const now = Date.now();
  for (const [key, name, description, dev, staging, prod] of flags) {
    const createdAt = new Date(now - 100 * 3600_000).toISOString();
    insertFlag.run(key, name, description, dev, staging, prod, createdAt);
  }
  for (const [key, hoursAgo, actor, action, env, reason] of audit) {
    insertAudit.run(new Date(now + hoursAgo * 3600_000).toISOString(), actor, action, key, env, reason);
  }
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  throw err;
}

console.log(`Seeded ${users.length} users, ${flags.length} flags, ${audit.length} audit events -> ${DB_PATH}`);
