# Cognition Internal Tools

Prototype internal tools: a **refunds dashboard** (default screen) and a
**feature flag admin** (second nav item). Both share one shell, one actor
header, one SQLite database, and one append-only audit table.

A decision updates status in SQLite. It does not move money.

Both tools use a shared, always-on light theme with Cognition branding.
The local logo is `COGNITION_LOCKUP_HORIZONTAL_WHITE.svg` from the
[official Cognition brand assets](https://cognition.ai/brand) (the white-background variant
ships black artwork), with the background rect removed. The seeded `dark_mode`
flag is demo data, not a theme control.

Contributor: [reedmarques](https://github.com/reedmarques).

## Run it

```bash
npm install
npm run seed
npm run dev
```

Open http://localhost:3000.

## Roles

The header switcher picks who is acting: **Avery Chen** (viewer),
**Jordan Lee** (agent), or **Sam Patel** (lead).

**Caveat:** the switcher sends the acting user as an `X-Actor-Id` request
header. It is a stand-in for Entra group membership — there is no login, no
session, and nothing stops a caller from setting the header themselves. Real
production would sign the UI in with Entra and map groups to these roles.

Inside the flag admin, roles map onto its original set:
viewer → reader, agent → editor, lead → operator.

## Refunds dashboard

- **Viewer** — list, open, read audit.
- **Agent** — approve a pending refund of $500 or less (`amount_cents <=
  50000`); deny any pending refund.
- **Lead** — approve or deny any pending refund. The limit applies to
  approve only.
- Approve and deny both require a reason of at least 15 characters.
- Only `pending` can be decided; a second decision is refused and writes
  nothing.
- A successful decision updates the refund and inserts one audit row in the
  same transaction.
- No create, edit, or delete — the seed is the queue.

## Feature flag admin

- A flag key is set at creation (`[a-z0-9_]{3,40}`, unique) and never edited.
- A new flag is off in every environment.
- Development and staging toggle freely for agents and leads.
- Production is lead-only. **Enabling** requires staging to be on (the
  promotion gate) plus a reason of at least 15 characters. **Disabling**
  requires only the reason.
- Flags are never deleted — turning production off is the kill switch.

## API

The acting user is `X-Actor-Id`. Missing/unknown actor → `401`; role
violation → `403`; rule violation → `422`. All errors are
`{ "error": "<stable string>" }`.

| Method | Path | Who |
|---|---|---|
| GET | `/api/refunds?status=` | any role — rows plus summary (summary always reflects pending, ignoring the filter) |
| GET | `/api/refunds/:reference` | any role — refund + audit, newest first |
| POST | `/api/refunds/:reference/decision` | agent/lead — `{ "action": "approve"\|"deny", "reason": string }` |
| GET | `/api/flags` | any role |
| POST | `/api/flags` | agent, lead |
| GET | `/api/flags/:key` | any role — flag + audit, newest first |
| POST | `/api/flags/:key/environments/:env` | see rules — `{ "enabled": bool, "reason"?: string }` |
| GET | `/api/evaluate?key=&env=` | **unauthenticated** |

`GET /api/evaluate` is intentionally unauthenticated — flag state is not a
secret. It returns the stored boolean only.

## Audit

`audit_events` is append-only; there is no API that updates or deletes it.
One table stores both apps: `subject_type` (`flag` | `refund`) +
`subject_id` (flag key or refund reference). `environment` is empty on
refund rows.

## Out of scope (by design)

- SSO, passwords, sessions, or a real Entra app registration
- Moving money — a decision only updates status
- Create/edit/delete on refunds
- Percentage rollouts, allowlists, cohorts, or multivariate flags
- Scheduled changes, second-person approvals, or a request queue
- SDKs, webhooks, or a public developer portal
- Flag deletion, extra environments, or per-team flag ownership
- KYC, Dataverse, or any customer data
- Deployment to Azure

## Data

SQLite (`flags.db`), created by `npm run seed`. Tables: `users`, `flags`,
`refunds`, `audit_events`. Amounts are integer cents ($500 = 50000).
