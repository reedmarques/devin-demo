const ACTORS = [
  { id: 'avery', name: 'Avery Chen', role: 'viewer' },
  { id: 'jordan', name: 'Jordan Lee', role: 'agent' },
  { id: 'sam', name: 'Sam Patel', role: 'lead' },
];

// Refund roles map onto the flag admin's role set.
const FLAG_ROLE = { viewer: 'reader', agent: 'editor', lead: 'operator' };

const ENVS = ['development', 'staging', 'production'];
const REFUND_STATUSES = ['all', 'pending', 'approved', 'denied'];
const ACTION_LABEL = {
  create: 'created', enable: 'enabled', disable: 'disabled',
  approve: 'approved', deny: 'denied',
};

const state = {
  actorId: 'jordan',
  app: 'refunds',
  refunds: { view: 'list', status: 'pending', current: null },
  flags: { view: 'list', search: '', currentKey: null },
};

const app = document.getElementById('app');
const actorSelect = document.getElementById('actor');
const actorRole = document.getElementById('actor-role');

function actor() {
  return ACTORS.find((a) => a.id === state.actorId);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'X-Actor-Id': state.actorId, 'Content-Type': 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function fmtMoney(cents) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function statusBadge(status) {
  return `<span class="status status-${status}">${status}</span>`;
}

function render() {
  document.querySelectorAll('.nav-item').forEach((b) =>
    b.classList.toggle('active', b.dataset.app === state.app));
  if (state.app === 'refunds') {
    state.refunds.view === 'detail' ? renderRefundDetail(state.refunds.current) : renderRefundsList();
  } else {
    if (state.flags.view === 'detail') renderFlagDetail(state.flags.currentKey);
    else if (state.flags.view === 'new') renderFlagCreate();
    else renderFlagList();
  }
}

// ============ refunds ============

async function renderRefundsList() {
  state.refunds.view = 'list';
  let data;
  try {
    data = await api(`/api/refunds?status=${state.refunds.status}`);
  } catch (e) {
    app.innerHTML = `<p class="error">${esc(e.message)}</p>`;
    return;
  }
  const { summary, refunds } = data;
  app.innerHTML = `
    <div class="stat-strip">
      <div class="stat"><span class="stat-value">${summary.pending_count}</span><span class="stat-label">Pending</span></div>
      <div class="stat"><span class="stat-value">${fmtMoney(summary.pending_cents)}</span><span class="stat-label">Pending dollars</span></div>
      <div class="stat"><span class="stat-value">${summary.lead_only_count}</span><span class="stat-label">Over $500 (lead only)</span></div>
    </div>
    <div class="toolbar">
      <div class="filter-group">
        ${REFUND_STATUSES.map((s) =>
          `<button class="filter ${state.refunds.status === s ? 'active' : ''}" data-status="${s}">${s}</button>`).join('')}
      </div>
    </div>
    <table>
      <thead><tr><th>Reference</th><th>Amount</th><th>Status</th><th>Created</th></tr></thead>
      <tbody id="refund-rows"></tbody>
    </table>`;
  const rows = document.getElementById('refund-rows');
  if (refunds.length === 0) {
    rows.innerHTML = '<tr><td colspan="4" class="muted">No refunds.</td></tr>';
  }
  for (const r of refunds) {
    const tr = document.createElement('tr');
    const leadOnly = r.status === 'pending' && r.amount_cents > 50000;
    tr.innerHTML = `
      <td><code>${esc(r.reference)}</code>${leadOnly ? ' <span class="lead-badge">Lead approval</span>' : ''}</td>
      <td>${fmtMoney(r.amount_cents)}</td>
      <td>${statusBadge(r.status)}</td>
      <td class="muted">${fmtTime(r.created_at)}</td>`;
    tr.onclick = () => renderRefundDetail(r.reference);
    rows.appendChild(tr);
  }
  document.querySelectorAll('.filter').forEach((b) => {
    b.onclick = () => { state.refunds.status = b.dataset.status; renderRefundsList(); };
  });
}

async function renderRefundDetail(reference) {
  state.refunds.view = 'detail';
  state.refunds.current = reference;
  let data;
  try {
    data = await api(`/api/refunds/${encodeURIComponent(reference)}`);
  } catch (e) {
    app.innerHTML = `<p class="error">${esc(e.message)}</p>`;
    return;
  }
  const { refund, audit } = data;
  const role = actor().role;
  const pending = refund.status === 'pending';
  const overLimit = refund.amount_cents > 50000;

  let approveDisabled, denyDisabled, note;
  if (role === 'viewer') {
    approveDisabled = denyDisabled = true;
    note = 'You have view-only access.';
  } else if (!pending) {
    approveDisabled = denyDisabled = true;
    note = 'This refund is already decided.';
  } else if (role === 'agent' && overLimit) {
    approveDisabled = true;
    denyDisabled = false;
    note = 'A lead has to approve refunds over $500.';
  } else {
    approveDisabled = denyDisabled = false;
    note = '';
  }

  app.innerHTML = `
    <p><a href="#" id="back" class="muted">&larr; All refunds</a></p>
    <div class="card">
      <div class="detail-head">
        <h2 style="margin:0"><code>${esc(refund.reference)}</code></h2>
        <span class="amount">${fmtMoney(refund.amount_cents)}</span>
        ${statusBadge(refund.status)}
      </div>
      <p>${esc(refund.request_note)}</p>
      <p class="muted">Requested ${fmtTime(refund.created_at)}${refund.decided_at ? ` &middot; decided ${fmtTime(refund.decided_at)}` : ''}</p>
      <div class="decision-bar">
        <button id="approve" class="success" ${approveDisabled ? 'disabled' : ''}>Approve</button>
        <button id="deny" class="danger" ${denyDisabled ? 'disabled' : ''}>Deny</button>
        <span class="env-note">${esc(note)}</span>
      </div>
      <div class="reason-holder"></div>
      <p class="error" id="decision-error"></p>
    </div>
    <div class="audit">
      <h2>Audit</h2>
      <ul>
        ${audit.map((ev) => `
          <li>
            <span class="time">${fmtTime(ev.at)}</span>
            <span>${esc(ev.actor_name)}</span>
            <span class="action ${ev.action}">${ACTION_LABEL[ev.action] || ev.action}</span>
            ${ev.reason ? `<span class="reason">&ldquo;${esc(ev.reason)}&rdquo;</span>` : ''}
          </li>`).join('')}
      </ul>
    </div>`;

  document.getElementById('back').onclick = (e) => { e.preventDefault(); renderRefundsList(); };
  if (!approveDisabled) document.getElementById('approve').onclick = () => showDecisionReason('approve');
  if (!denyDisabled) document.getElementById('deny').onclick = () => showDecisionReason('deny');
}

function showDecisionReason(decision) {
  const holder = app.querySelector('.reason-holder');
  holder.innerHTML = `
    <span class="reason-box">
      <input type="text" placeholder="Reason (required, 15+ chars)" />
      <button type="button" data-confirm>${decision === 'approve' ? 'Approve' : 'Deny'}</button>
      <button type="button" class="ghost" data-cancel>Cancel</button>
    </span>`;
  const input = holder.querySelector('input');
  input.focus();
  holder.querySelector('[data-cancel]').onclick = () => { holder.innerHTML = ''; };
  const submit = async () => {
    const errEl = document.getElementById('decision-error');
    errEl.textContent = '';
    try {
      await api(`/api/refunds/${encodeURIComponent(state.refunds.current)}/decision`, {
        method: 'POST',
        body: JSON.stringify({ action: decision, reason: input.value }),
      });
      renderRefundDetail(state.refunds.current);
    } catch (e) {
      errEl.textContent = e.message;
    }
  };
  holder.querySelector('[data-confirm]').onclick = submit;
  input.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
}

// ============ flag admin ============

function flagRole() {
  return FLAG_ROLE[actor().role];
}

async function renderFlagList() {
  state.flags.view = 'list';
  let flags;
  try {
    flags = await api('/api/flags');
  } catch (e) {
    app.innerHTML = `<p class="error">${esc(e.message)}</p>`;
    return;
  }
  state.flags.data = flags;
  const canCreate = flagRole() !== 'reader';
  app.innerHTML = `
    <div class="toolbar">
      <input type="search" id="search" placeholder="Search by key or name" value="${esc(state.flags.search)}" />
      ${canCreate ? '<button id="new-flag">New flag</button>' : ''}
    </div>
    <table>
      <thead><tr><th>Key</th><th>Name</th><th>Dev</th><th>Staging</th><th>Prod</th></tr></thead>
      <tbody id="flag-rows"></tbody>
    </table>`;
  renderFlagRows();
  document.getElementById('search').addEventListener('input', (e) => {
    state.flags.search = e.target.value;
    renderFlagRows();
  });
  if (canCreate) document.getElementById('new-flag').onclick = renderFlagCreate;
}

function renderFlagRows() {
  const rows = document.getElementById('flag-rows');
  const q = state.flags.search.trim().toLowerCase();
  const list = q
    ? state.flags.data.filter((f) => f.key.includes(q) || f.name.toLowerCase().includes(q))
    : state.flags.data;
  rows.innerHTML = '';
  for (const f of list) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><code>${esc(f.key)}</code></td>
      <td>${esc(f.name)}</td>
      ${ENVS.map((e) => `<td><span class="state ${f[e] ? 'on' : 'off'}">${f[e] ? 'on' : 'off'}</span></td>`).join('')}`;
    tr.onclick = () => renderFlagDetail(f.key);
    rows.appendChild(tr);
  }
}

function renderFlagCreate() {
  state.flags.view = 'new';
  app.innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">New flag</h2>
      <form class="field-group" id="create-form">
        <label for="key">Key</label>
        <input id="key" required placeholder="lowercase letters, numbers, underscores" />
        <label for="name">Name</label>
        <input id="name" required />
        <label for="description">Description</label>
        <textarea id="description" rows="3"></textarea>
        <div class="actions">
          <button type="submit">Create</button>
          <button type="button" class="ghost" id="cancel">Cancel</button>
        </div>
        <p class="error" id="form-error"></p>
      </form>
    </div>`;
  document.getElementById('cancel').onclick = renderFlagList;
  document.getElementById('create-form').onsubmit = async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('form-error');
    errEl.textContent = '';
    try {
      const flag = await api('/api/flags', {
        method: 'POST',
        body: JSON.stringify({
          key: document.getElementById('key').value.trim(),
          name: document.getElementById('name').value.trim(),
          description: document.getElementById('description').value,
        }),
      });
      renderFlagDetail(flag.key);
    } catch (err) {
      errEl.textContent = err.message;
    }
  };
}

async function renderFlagDetail(key) {
  state.flags.view = 'detail';
  state.flags.currentKey = key;
  let data;
  try {
    data = await api(`/api/flags/${encodeURIComponent(key)}`);
  } catch (e) {
    app.innerHTML = `<p class="error">${esc(e.message)}</p>`;
    return;
  }
  const { flag, audit } = data;
  const role = flagRole();

  const envRows = ENVS.map((env) => {
    const on = flag[env];
    let disabled = false, note = '', needsReason = false;
    if (role === 'reader') {
      disabled = true;
      if (env === 'development') note = 'You have read-only access.';
    } else if (env === 'production' && role === 'editor') {
      disabled = true;
      note = 'Production changes require an operator.';
    } else if (env === 'production') {
      needsReason = true;
    }
    return `<div class="env-row" data-env="${env}">
      <span class="env-name">${env}</span>
      <button class="switch${on ? ' on' : ''}" ${disabled ? 'disabled' : ''}
        data-need-reason="${needsReason ? '1' : '0'}" title="${env}: ${on ? 'on' : 'off'}"></button>
      ${note ? `<span class="env-note">${note}</span>` : ''}
      <span class="reason-slot"></span>
      <span class="error" data-error></span>
    </div>`;
  }).join('');

  app.innerHTML = `
    <p><a href="#" id="back" class="muted">&larr; All flags</a></p>
    <div class="card">
      <h2 style="margin:0 0 4px">${esc(flag.name)}</h2>
      <p class="muted" style="margin-top:0"><code>${esc(flag.key)}</code></p>
      ${flag.description ? `<p>${esc(flag.description)}</p>` : ''}
      ${envRows}
    </div>
    <div class="audit">
      <h2>Audit</h2>
      <ul>
        ${audit.map((ev) => `
          <li>
            <span class="time">${fmtTime(ev.at)}</span>
            <span>${esc(ev.actor_name)}</span>
            <span class="action ${ev.action}">${ACTION_LABEL[ev.action] || ev.action}</span>
            ${ev.environment ? `<span class="env-note">${ev.environment}</span>` : ''}
            ${ev.reason ? `<span class="reason">&ldquo;${esc(ev.reason)}&rdquo;</span>` : ''}
          </li>`).join('')}
      </ul>
    </div>`;

  document.getElementById('back').onclick = (e) => { e.preventDefault(); renderFlagList(); };
  for (const env of ENVS) {
    const row = app.querySelector(`.env-row[data-env="${env}"]`);
    const sw = row.querySelector('.switch');
    if (sw.disabled) continue;
    const on = flag[env];
    sw.onclick = sw.dataset.needReason === '1'
      ? () => showFlagReasonBox(env, on)
      : () => toggleFlagEnv(env, !on);
  }
}

async function toggleFlagEnv(env, enabled, reason) {
  try {
    await api(`/api/flags/${encodeURIComponent(state.flags.currentKey)}/environments/${env}`, {
      method: 'POST',
      body: JSON.stringify(reason === undefined ? { enabled } : { enabled, reason }),
    });
    renderFlagDetail(state.flags.currentKey);
  } catch (e) {
    const row = app.querySelector(`.env-row[data-env="${env}"]`);
    row.querySelector('[data-error]').textContent = e.message;
  }
}

function showFlagReasonBox(env, on) {
  const row = app.querySelector(`.env-row[data-env="${env}"]`);
  const slot = row.querySelector('.reason-slot');
  row.querySelector('[data-error]').textContent = '';
  slot.innerHTML = `
    <span class="reason-box">
      <input type="text" placeholder="Reason (required, 15+ chars)" />
      <button type="button" data-confirm>${on ? 'Disable' : 'Enable'}</button>
      <button type="button" class="ghost" data-cancel>Cancel</button>
    </span>`;
  const input = slot.querySelector('input');
  input.focus();
  slot.querySelector('[data-cancel]').onclick = () => renderFlagDetail(state.flags.currentKey);
  const submit = () => toggleFlagEnv(env, !on, input.value);
  slot.querySelector('[data-confirm]').onclick = submit;
  input.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
}

// ============ boot ============

for (const a of ACTORS) {
  const opt = document.createElement('option');
  opt.value = a.id;
  opt.textContent = `${a.name} — ${a.role}`;
  actorSelect.appendChild(opt);
}
actorSelect.value = state.actorId;
actorSelect.onchange = () => {
  state.actorId = actorSelect.value;
  syncActorBadge();
  render();
};

document.querySelectorAll('.nav-item').forEach((b) => {
  b.onclick = () => { state.app = b.dataset.app; render(); };
});

function syncActorBadge() {
  const a = actor();
  actorRole.textContent = a.role;
  actorRole.className = `badge ${a.role}`;
}
syncActorBadge();
render();
