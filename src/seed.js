import fs from 'node:fs';
import { openDb, DB_PATH } from './db.js';

if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
const db = openDb();

const users = [
  ['avery', 'Avery Chen', 'viewer'],
  ['jordan', 'Jordan Lee', 'agent'],
  ['sam', 'Sam Patel', 'lead'],
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

// reference, amount_cents, status, request_note, created (hours ago), decided (hours ago)
const refunds = [
  ['RFD-1842', 12000, 'pending', 'Card charged twice for the same monthly subscription.', 30, null],
  ['RFD-1843', 48000, 'pending', 'Charge posted after the order was cancelled.', 52, null],
  ['RFD-1844', 50000, 'pending', 'Service credits requested following a reported outage.', 70, null],
  ['RFD-1901', 240000, 'pending', 'Annual contract cancelled inside the cooling-off window.', 12, null],
  ['RFD-1902', 875000, 'pending', 'Corporate card billed after the account was closed.', 6, null],
  ['RFD-1905', 8500, 'pending', 'Subscription renewed after a confirmed cancellation request.', 26, null],
  ['RFD-1911', 165000, 'pending', 'Duplicate wire fee applied across two settlement runs.', 18, null],
  ['RFD-1918', 4500, 'pending', 'Trial period ended but the first billing cycle still posted.', 40, null],
  ['RFD-1926', 62000, 'pending', 'Merchant dispute resolved in favor of the account holder.', 9, null],
  ['RFD-1750', 9500, 'approved', 'Accidental duplicate payment on a single invoice.', 400, 350],
  ['RFD-1755', 120000, 'denied', 'Refund requested outside the published policy window.', 300, 260],
  ['RFD-1760', 31000, 'approved', 'A failed transaction settled a second time.', 220, 200],
];

// subject_id, at (hours ago), actor, subject_type, action, environment, reason
const audit = [
  ['new_checkout', -72, 'jordan', 'flag', 'create', null, null],
  ['new_checkout', -70, 'jordan', 'flag', 'enable', 'development', null],
  ['new_checkout', -48, 'sam', 'flag', 'enable', 'staging', null],
  ['refund_self_serve', -200, 'jordan', 'flag', 'create', null, null],
  ['refund_self_serve', -190, 'jordan', 'flag', 'enable', 'development', null],
  ['refund_self_serve', -170, 'sam', 'flag', 'enable', 'staging', null],
  ['refund_self_serve', -160, 'sam', 'flag', 'enable', 'production', 'Support rollout approved by ops review on 9/28.'],
  ['beta_search', -120, 'sam', 'flag', 'create', null, null],
  ['beta_search', -100, 'jordan', 'flag', 'enable', 'development', null],
  ['beta_search', -96, 'sam', 'flag', 'enable', 'staging', null],
  ['beta_search', -24, 'sam', 'flag', 'enable', 'production', 'Beta cohort validated; enabling for all traffic.'],
  ['statement_pdf_v2', -50, 'jordan', 'flag', 'create', null, null],
  ['statement_pdf_v2', -30, 'jordan', 'flag', 'enable', 'development', null],
  ['statement_pdf_v2', -10, 'sam', 'flag', 'enable', 'staging', null],
  ['RFD-1750', -350, 'jordan', 'refund', 'approve', null, 'Duplicate confirmed against settlement records.'],
  ['RFD-1755', -260, 'sam', 'refund', 'deny', null, 'Request falls outside the published refund window.'],
  ['RFD-1760', -200, 'jordan', 'refund', 'approve', null, 'Duplicate settlement verified in payment logs.'],
];

const insertUser = db.prepare('INSERT INTO users (id, name, role) VALUES (?, ?, ?)');
const insertFlag = db.prepare(`
  INSERT INTO flags (key, name, description, development_enabled, staging_enabled, production_enabled, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const insertRefund = db.prepare(`
  INSERT INTO refunds (reference, amount_cents, status, request_note, created_at, decided_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const insertAudit = db.prepare(`
  INSERT INTO audit_events (at, actor_id, subject_type, subject_id, action, environment, reason)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

db.exec('BEGIN');
try {
  for (const u of users) insertUser.run(...u);
  const now = Date.now();
  for (const [key, name, description, dev, staging, prod] of flags) {
    insertFlag.run(key, name, description, dev, staging, prod, new Date(now - 100 * 3600_000).toISOString());
  }
  for (const [ref, cents, status, note, createdH, decidedH] of refunds) {
    insertRefund.run(
      ref, cents, status, note,
      new Date(now - createdH * 3600_000).toISOString(),
      decidedH == null ? null : new Date(now - decidedH * 3600_000).toISOString()
    );
  }
  for (const [subjectId, hoursAgo, actor, type, action, env, reason] of audit) {
    insertAudit.run(new Date(now + hoursAgo * 3600_000).toISOString(), actor, type, subjectId, action, env, reason);
  }
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  throw err;
}

console.log(`Seeded ${users.length} users, ${flags.length} flags, ${refunds.length} refunds, ${audit.length} audit events -> ${DB_PATH}`);
