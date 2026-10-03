#!/usr/bin/env node
/**
 * Linear -> Devin Cloud dispatcher.
 *
 * Polls Linear for issues that newly entered a "started" state (e.g. In Progress)
 * in a configured team, then launches a Devin Cloud session for each one and
 * comments the session URL back on the ticket.
 *
 * Dispatch backends (first match wins):
 *   1. DEVIN_API_KEY set  -> POST https://api.devin.ai/v1/sessions
 *   2. otherwise          -> `devin --cloud -p "<prompt>"` (requires `devin auth login`)
 *
 * Env:
 *   LINEAR_API_KEY   required - Linear personal API key (Settings -> API)
 *   DEVIN_API_KEY    optional - Devin service API key (app.devin.ai settings)
 *   LINEAR_TEAM      optional - team key to watch, default "DEM"
 *   REPO             optional - owner/repo for the prompt, default "reedmarques/devin-demo"
 *   POLL_MS          optional - poll interval, default 15000
 *   ONCE             optional - set to "1" to poll once and exit
 *
 * State: .dispatch-state.json in this directory records dispatched issue ids.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(dir, '.dispatch-state.json');

const LINEAR_API_KEY = process.env.LINEAR_API_KEY;
const DEVIN_API_KEY = process.env.DEVIN_API_KEY;
const TEAM = process.env.LINEAR_TEAM || 'DEM';
const REPO = process.env.REPO || 'reedmarques/devin-demo';
const POLL_MS = Number(process.env.POLL_MS || 15000);
const ONCE = process.env.ONCE === '1';
const DEVIN_CLI =
  process.env.DEVIN_CLI || '/Applications/Devin.app/Contents/Resources/app/extensions/windsurf/devin/bin/devin';

if (!LINEAR_API_KEY) {
  console.error('LINEAR_API_KEY is required (Linear -> Settings -> API -> Personal API keys).');
  process.exit(1);
}

const dispatched = new Set(loadState());

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveState() {
  fs.writeFileSync(STATE_FILE, JSON.stringify([...dispatched], null, 2));
}

async function linear(query, variables = {}) {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: LINEAR_API_KEY },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors) throw new Error(`Linear API: ${JSON.stringify(body.errors)}`);
  return body.data;
}

async function startedIssues() {
  const data = await linear(
    `query($team: String!) {
      issues(filter: { team: { key: { eq: $team } }, state: { type: { eq: "started" } } }) {
        nodes { id identifier title description url }
      }
    }`,
    { team: TEAM }
  );
  return data.issues.nodes;
}

async function comment(issueId, body) {
  await linear(
    `mutation($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) { success }
    }`,
    { issueId, body }
  );
}

function buildPrompt(issue) {
  return [
    `Implement Linear issue ${issue.identifier}: ${issue.title}`,
    '',
    issue.description?.trim() || '(no description)',
    '',
    `Repository: ${REPO}`,
    'Work on a branch, commit your changes, and open a pull request when done.',
    `Reference "${issue.identifier}" in the PR title or body.`,
  ].join('\n');
}

async function dispatchViaApi(prompt) {
  const res = await fetch('https://api.devin.ai/v1/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEVIN_API_KEY}` },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) throw new Error(`Devin API ${res.status}: ${await res.text()}`);
  const body = await res.json();
  const id = body.session_id || body.id;
  return body.url || `https://app.devin.ai/sessions/${id}`;
}

function dispatchViaCli(prompt) {
  return new Promise((resolve, reject) => {
    execFile(DEVIN_CLI, ['--cloud', '-p', prompt], { timeout: 120_000 }, (err, stdout, stderr) => {
      if (err && !stdout) return reject(new Error(`devin --cloud failed: ${stderr || err.message}`));
      const match = (stdout + stderr).match(/https:\/\/app\.devin\.ai\/sessions\/\S+/);
      resolve(match ? match[0] : '(session started; no URL parsed)');
    });
  });
}

async function handleIssue(issue) {
  const prompt = buildPrompt(issue);
  console.log(`[dispatch] ${issue.identifier}: ${issue.title}`);
  let url;
  try {
    url = DEVIN_API_KEY ? await dispatchViaApi(prompt) : await dispatchViaCli(prompt);
  } catch (err) {
    console.error(`[dispatch] ${issue.identifier} failed: ${err.message}`);
    return; // retry next poll
  }
  console.log(`[dispatch] ${issue.identifier} -> ${url}`);
  try {
    await comment(issue.id, `Devin Cloud session started: ${url}`);
  } catch (err) {
    console.error(`[comment] ${issue.identifier}: ${err.message}`);
  }
  dispatched.add(issue.id);
  saveState();
}

async function poll() {
  const issues = await startedIssues();
  for (const issue of issues) {
    if (!dispatched.has(issue.id)) await handleIssue(issue);
  }
}

console.log(
  `Watching team ${TEAM} for issues entering "In Progress" -> dispatching to Devin Cloud` +
    ` (${DEVIN_API_KEY ? 'API' : 'CLI'} backend, repo ${REPO}, every ${POLL_MS}ms)`
);

await poll();
if (!ONCE) setInterval(() => poll().catch((e) => console.error(`[poll] ${e.message}`)), POLL_MS);
