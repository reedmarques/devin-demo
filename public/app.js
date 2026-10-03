const ACTORS = [
  { id: 'avery', name: 'Avery C.', role: 'reader' },
  { id: 'jordan', name: 'Jordan L.', role: 'editor' },
  { id: 'sam', name: 'Sam P.', role: 'operator' },
];

const ENVS = ['development', 'staging', 'production'];

const state = {
  actorId: 'jordan',
  view: 'list',
  flags: [],
  search: '',
  currentKey: null,
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
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

// ---------- list view ----------

async function renderList() {
  state.view = 'list';
  try {
    state.flags = await api('/api/flags');
  } catch (e) {
    app.innerHTML = `<p class="error">${esc(e.message)}</p>`;
    return;
  }
  const canCreate = actor().role !== 'reader';
  app.innerHTML = `
    <div class="toolbar">
      <input type="search" id="search" placeholder="Search by key or name" value="${esc(state.search)}" />
      ${canCreate ? '<button id="new-flag">New flag</button>' : ''}
    </div>
    <table>
      <thead><tr><th>Key</th><th>Name</th><th>Dev</th><th>Staging</th><th>Prod</th></tr></thead>
      <tbody id="flag-rows"></tbody>
    </table>`;
  const rows = document.getElementById('flag-rows');
  for (const f of filteredFlags()) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><code>${esc(f.key)}</code></td>
      <td>${esc(f.name)}</td>
      ${ENVS.map((e) => `<td><span class="state ${f[e] ? 'on' : 'off'}">${f[e] ? 'on' : 'off'}</span></td>`).join('')}`;
    tr.onclick = () => renderDetail(f.key);
    rows.appendChild(tr);
  }
  document.getElementById('search').addEventListener('input', (e) => {
    state.search = e.target.value;
    renderList();
    const el = document.getElementById('search');
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  });
  if (canCreate) document.getElementById('new-flag').onclick = renderCreate;
}

function filteredFlags() {
  const q = state.search.trim().toLowerCase();
  if (!q) return state.flags;
  return state.flags.filter((f) => f.key.includes(q) || f.name.toLowerCase().includes(q));
}

// ---------- create view ----------

function renderCreate() {
  state.view = 'new';
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
  document.getElementById('cancel').onclick = renderList;
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
      renderDetail(flag.key);
    } catch (err) {
      errEl.textContent = err.message;
    }
  };
}

// ---------- detail view ----------

async function renderDetail(key) {
  state.view = 'detail';
  state.currentKey = key;
  let data;
  try {
    data = await api(`/api/flags/${encodeURIComponent(key)}`);
  } catch (e) {
    app.innerHTML = `<p class="error">${esc(e.message)}</p>`;
    return;
  }
  const { flag, audit } = data;
  const role = actor().role;

  const envRows = ENVS.map((env) => {
    const on = flag[env];
    let control, note = '';
    if (role === 'reader') {
      control = switchEl(env, on, true);
      if (env === 'development') note = '<span class="env-note">You have read-only access.</span>';
    } else if (env === 'production' && role === 'editor') {
      control = switchEl(env, on, true);
      note = '<span class="env-note">Production changes require an operator.</span>';
    } else if (env === 'production') {
      control = switchEl(env, on, false);
      control.onclick = () => showReasonBox(env, on);
    } else {
      control = switchEl(env, on, false);
      control.onclick = () => toggleEnv(env, !on);
    }
    return `<div class="env-row" data-env="${env}">
      <span class="env-name">${env}</span>
      ${control.outerHTML}
      ${note}
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
            <span class="action ${ev.action}">${ev.action}d</span>
            ${ev.environment ? `<span class="env-note">${ev.environment}</span>` : ''}
            ${ev.reason ? `<span class="reason">&ldquo;${esc(ev.reason)}&rdquo;</span>` : ''}
          </li>`).join('')}
      </ul>
    </div>`;

  document.getElementById('back').onclick = (e) => { e.preventDefault(); renderList(); };
  // Rebind switches rendered via outerHTML.
  for (const env of ENVS) {
    const row = app.querySelector(`.env-row[data-env="${env}"]`);
    const sw = row.querySelector('.switch');
    if (sw.disabled) continue;
    const on = flag[env];
    if (env === 'production') sw.onclick = () => showReasonBox(env, on);
    else sw.onclick = () => toggleEnv(env, !on);
  }
}

function switchEl(env, on, disabled) {
  const b = document.createElement('button');
  b.className = `switch${on ? ' on' : ''}`;
  b.disabled = disabled;
  b.setAttribute('aria-label', `${env} toggle`);
  b.title = `${env}: ${on ? 'on' : 'off'}`;
  return b;
}

function rowError(env, msg) {
  const row = app.querySelector(`.env-row[data-env="${env}"]`);
  row.querySelector('[data-error]').textContent = msg || '';
}

async function toggleEnv(env, enabled, reason) {
  try {
    await api(`/api/flags/${encodeURIComponent(state.currentKey)}/environments/${env}`, {
      method: 'POST',
      body: JSON.stringify(reason === undefined ? { enabled } : { enabled, reason }),
    });
    renderDetail(state.currentKey);
  } catch (e) {
    rowError(env, e.message);
  }
}

function showReasonBox(env, on) {
  const row = app.querySelector(`.env-row[data-env="${env}"]`);
  const slot = row.querySelector('.reason-slot');
  rowError(env, '');
  slot.innerHTML = `
    <span class="reason-box">
      <input type="text" placeholder="Reason (required, 15+ chars)" />
      <button type="button" data-confirm>${on ? 'Disable' : 'Enable'}</button>
      <button type="button" class="ghost" data-cancel>Cancel</button>
    </span>`;
  const input = slot.querySelector('input');
  input.focus();
  slot.querySelector('[data-cancel]').onclick = () => renderDetail(state.currentKey);
  const submit = () => toggleEnv(env, !on, input.value);
  slot.querySelector('[data-confirm]').onclick = submit;
  input.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
}

// ---------- boot ----------

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
  state.view === 'detail' ? renderDetail(state.currentKey) : renderList();
};
document.getElementById('home').onclick = renderList;

function syncActorBadge() {
  const a = actor();
  actorRole.textContent = a.role;
  actorRole.className = `badge ${a.role}`;
}
syncActorBadge();
renderList();
