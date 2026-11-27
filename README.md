# EventFlow · Motadata

Motadata's internal portal for event requests and approvals:
**Draft → Sales review → Scheduling → Pending approval → Approved → In execution → Closed** (or Dropped).

**Stack:** Next.js 15 (App Router, TypeScript), Tailwind CSS 4, PostgreSQL 16 + Prisma 6, Zod, Vitest.

## How the app works

| Step | Who | What happens |
| --- | --- | --- |
| 1. Draft | Requester (Marketing, Channel …) | Raises an event: type, subtype, title, department. |
| 2. Sales review | Sales department | Answers 11 business-case questions and scores 5 factors (out of 25). **Go** unlocks planning; **No-go** drops the event with a reason. This step is required for every new event. |
| 3. Scheduling | Requester / owner / manager | Fills in details, budget (cost lines), tasks, speakers and files. |
| 4. Approval | Approvers, then the executive approver | Stage 1 (parallel), then stage 2. Decisions can be made in the portal or from the email. |
| 5. Execution and closure | Owner / manager, Finance | Records actuals, invoices, payments and post-event results. |

**Roles:** Requester, Event owner, Event manager, Approver, Executive approver, Finance, Reporting, Admin.
Users in the **Sales** department only review (Go / No-go), view events and use dashboards. They
can't create or edit events, whatever roles are ticked. Admins can do everything.

Other modules: custom **dashboards** (free-form canvas, money visibility set per role), Event
Register, Budget & Reports, Templates, Settings (users, workflow, form fields, lists), an Excel
import, and a HubSpot sync (needs a HubSpot service key).

## Run locally (no Docker needed)

Requires **Node 20.18+**.

```bash
npm install
cp .env.example .env          # set a DB password in DATABASE_URL and TEST_DATABASE_URL,
                              # and a DEV_SEED_PASSWORD (12+ chars)
npm run db:start              # terminal 1: local PostgreSQL 16 on port 5433 (data in .data/pg)
```

In a second terminal, the first time only:

```bash
npm run db:deploy             # create the tables
npm run config:seed           # event types, subtypes, regions, lists, form rules, approval workflow
npm run config:seed-dashboards  # the stock dashboards
npm run db:seed-dev           # test users (one per role), password = DEV_SEED_PASSWORD
```

Then start the app at http://localhost:3000:

```bash
npm run dev
```

**Test logins** (`@eventflow.test`; the emails can't reach a real inbox):

| Email | Department | Use it for |
| --- | --- | --- |
| admin@ | Management | Everything, including Settings |
| sales.requester@ | Sales | Sales review only |
| marketing.manager@ | Marketing | Raising and running events |
| channel.requester@ | Channel | Raising events |
| akshay@, mitul@ | Management | Stage-1 approvals |
| amit@ | Management | Final approval |
| finance@ | Finance | Budget, actuals, invoices |

In development, emails aren't sent. They're saved to `.data/outbox` and can be read at
http://localhost:3000/dev/outbox.

## Environment (`.env`)

See `.env.example`. Never commit `.env`.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection (local: port 5433) |
| `APP_URL` | Base URL used in email links |
| `STORAGE_DIR` | Where uploaded files are kept (default `./storage`) |
| `MAIL_TRANSPORT` | `outbox` (dev) or `smtp` (Office 365 relay, with `SMTP_*`) |
| `HUBSPOT_ENCRYPT_KEY` | 32+ characters; encrypts the HubSpot key at rest |
| `DEV_SEED_PASSWORD` | Development only: password for the seeded test users |
| `TEST_DATABASE_URL` | Integration-test database; its name must end in `_test` |

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` · `npm run typecheck` · `npm test` | Quality checks |
| `npm run test:integration` | Integration tests against the `_test` database |
| `npm run db:start` | Local embedded PostgreSQL 16 |
| `npm run db:migrate` | Create and apply a new migration (after a schema change) |
| `npm run db:deploy` | Apply migrations (fresh setup and production) |
| `npm run db:studio` | Browse the database in Prisma Studio |
| `npm run config:seed` | Default event types, lists, field rules, workflow |
| `npm run config:seed-dashboards` | Stock dashboards |
| `npm run db:seed-dev` | Test users (local database only) |
| `npm run user:create-admin` | Create the first real admin (production) |
| `npm run import:channel-sheet -- "<file.xlsx>"` | Import the channel marketing sheet (dry run; add `--commit`) |
| `npm run approvals:remind` | Approval reminder / escalation job (run hourly in production) |
| `npm run icons:generate` | Rebuild favicons from `brand/*.svg` |

## Run with Docker

```bash
echo POSTGRES_PASSWORD=choose-a-strong-password > .env.docker
docker compose --env-file .env.docker up -d --build
```

The app runs on http://localhost:3000, and the Mailpit inbox for captured emails is on http://localhost:8025.

## Deploying to a server

See [DEPLOYMENT.md](DEPLOYMENT.md). In short: copy the code (not `.env`), then run `db:deploy` and
`next build`. Copy `public`, `.next/static` and `.env` into `.next/standalone`, then restart the service.

## Project layout

```
src/app/(portal)/   dashboard, events, sales-review, approvals, reports, templates, settings
src/app/(auth)/     login, forgot password, invite and reset links
src/app/api/        health, attachments, events, reports, import, HubSpot, search
src/components/     ui/ (design system), layout/ (shell), events/, dashboards/
src/lib/            shared, pure code: permissions, form schema, Sales-review questions, formatting
src/server/         server-only domain services: events, approvals, access policy, dashboards, mail, HubSpot
prisma/             schema and migrations
scripts/            dev database, seeds, imports, reminder job
tests/              integration-test helpers
```

## Branding

- `brand/` holds the logo and favicon SVGs (light, dark, auto) plus the original PNGs.
- `src/styles/tokens.css` holds **all** colours and theme values. Change styling there only.
- Accent coral `#F17463`, ink black/white, font Inter. Primary buttons are coral with white text (product-owner decision).

## Uploads

Attachments are stored under `storage/` (or `STORAGE_DIR`). Only PDF, Office, CSV and image files up to
25 MB are accepted. Files are served to signed-in users only, through `/api/attachments/[id]`.

## Health check

`GET /api/health` returns `{"status":"ok","database":"ok"}` when the app can reach PostgreSQL.
