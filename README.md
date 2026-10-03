# Feature Flag Admin

A prototype internal tool for managing feature flags across three environments
(development, staging, production) with role-based authorization and an
append-only audit trail.

## Run it

```bash
npm install
npm run seed
npm run dev
```

Open http://localhost:3000.

## Roles

The header switcher picks who is acting: **Avery C.** (reader),
**Jordan L.** (editor), or **Sam P.** (operator).

**Caveat:** the switcher sends the acting user as an `X-Actor-Id` request
header. It is a stand-in for Entra group membership — there is no login, no
session, and nothing stops a caller from setting the header themselves. Real
production would sign the UI in with Entra and map groups to these roles.

- **Reader** — list flags, open a flag, read its audit. No writes.
- **Editor** — create flags; toggle development and staging.
- **Operator** — everything an editor can do, plus toggle production.

## Product rules

- A flag key is set at creation (`[a-z0-9_]{3,40}`, unique) and never edited.
- A new flag is off in every environment.
- Development and staging toggle freely for editors and operators.
- Production is operator-only. **Enabling** requires staging to be on (the
  promotion gate) plus a reason of at least 15 characters. **Disabling**
  requires only the reason.
- Flags are never deleted — turning production off is the kill switch.
- Every successful change is one transaction: flag update + exactly one
  `audit_events` row. A failed rule writes nothing. `audit_events` is
  append-only; there is no API that updates or deletes it.

## API

The acting user is `X-Actor-Id`. Missing/unknown actor → `401`; role violation
→ `403`; rule violation → `422`. All errors are `{ "error": "<stable string>" }`.

| Method | Path | Who |
|---|---|---|
| GET | `/api/flags` | any role |
| POST | `/api/flags` | editor, operator |
| GET | `/api/flags/:key` | any role — flag + audit, newest first |
| POST | `/api/flags/:key/environments/:env` | see rules — body `{ "enabled": bool, "reason"?: string }` |
| GET | `/api/evaluate?key=&env=` | **unauthenticated** |

`GET /api/evaluate` is intentionally unauthenticated — flag state is not a
secret. It returns the stored boolean only: no percentage rollouts, user
targeting, or segments.

## Out of scope (by design)

- SSO, passwords, sessions, or a real Entra app registration
- Percentage rollouts, allowlists, cohorts, or multivariate flags
- Scheduled changes, second-person approvals, or a request queue
- SDKs, webhooks, or a public developer portal
- Flag deletion, extra environments, or per-team flag ownership
- KYC, refunds, Dataverse, or any customer data
- Deployment to Azure

## Data

SQLite (`flags.db`), created by `npm run seed`. Tables: `users`, `flags`,
`audit_events`.
