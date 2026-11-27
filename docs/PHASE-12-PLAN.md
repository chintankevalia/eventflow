# EventFlow — Phase 12: team feedback, remaining work

Execution plan for the feedback round of October 2026. Items already shipped are listed so they
are not redone. Each remaining step names the files to touch, the approach, and how to prove it
works. Work top to bottom; each phase is independently shippable.

Branch: `phase-12-feedback` (not yet merged to `main`).

---

## Already done (do not redo)

| Feedback item | Commit |
|---|---|
| Login password paste blocked (and drag-drop); email paste still allowed | `2178953` |
| Light theme by default | `2178953` |
| Product version shown (sidebar + sign-in), from `package.json` (now `0.12.0`) | `2178953` |
| "Save & continue" on event sections; prev/next buttons under every tab | `2178953` |
| Owner, manager, partner, tier as dropdowns (new card on Stakeholders tab) | `2178953` |
| Every subtype available under every event type | `2178953` |
| File types limited to: Budget details / cost breakup, Event proposal, Internal costing (server-validated) | `2178953` |
| Widgets drag from the whole title bar | `2178953` |
| Widgets never overlap — neighbours narrow beside, or move down; live while dragging; enforced on save | `4fc7488` |
| Resize widgets from any corner and any edge | `96004a6`, `eba9b7b` |
| Pages feel stuck → top progress bar on every click, fallback skeleton on every route | `570ff3c` |
| Auto refresh (dashboard, Approval Center; 60 s, paused while tab hidden) | `570ff3c` |
| Proper navigation buttons (event tabs) | `2178953` |

**Remaining:** Phase A (approval workflow and finance), Phase B (department-based access),
Phase C (guide page), Phase D (HubSpot). In that order — cheapest and least-blocked first, except
that A comes before B because B's visibility rules depend on the finished workflow.

---

## Ground rules for whoever executes this

- **Ask before serious decisions.** The product owner's standing instruction. The one open question
  is listed under Phase A; everything else here is decided.
- **Never change the brand coral** `#F17463` or `--primary` / `--primary-foreground`. A recorded
  product-owner decision, knowingly below WCAG AA.
- **Ask before installing any package.** Nothing below needs one.
- **The dev database holds real company data** (104 imported Channel events, ₹1.88 Cr). Never
  reset it. Migrations must be additive; read the generated SQL before applying.
- **Verify before claiming done:** `npx tsc --noEmit`, `npm run lint`, `npx vitest run`,
  `npm run test:integration` (separate `_test` database), and a browser check of the actual change.
- **Browser checks without a password:** mint a local session with a throwaway script calling
  `createSession` from `src/server/auth/session-store.ts`, set cookie `ef_session` to the token,
  delete the script afterwards. Never commit it.
- **Scripts importing server modules** throw on `server-only`. Preload a stub:
  `Module._load` returning `{}` for `"server-only"`, via `tsx --require ./stub.cjs`. Delete after.
- **Commits:** message via `git commit -F - <<'MSG' … MSG` (shell heredoc), ending with the
  attribution line the session specifies. Explain *why*, not just what.
- **Shell quoting:** an apostrophe inside `node -e '…'` breaks it. Write multi-line edits to a
  script file instead.
- **Dev server** runs on `0.0.0.0:3000`, shared to the office at `http://10.20.42.3:3000`.
  `/dev/*` answers only to localhost (security fix `312ce5c` — keep it that way).

---

## Phase A — Approval workflow and finance (largest value)

The flow the business wants:

```
Raised by Sales / Marketing / Channel
  → Stage 1  Channel review
  → Stage 2  Event approval        — Akshay and Mitul, both
  → Stage 3  Budget approval       — Amit sir (CEO)
  → Approved → Finance is notified, tracks the event, records invoices and actuals
```

Finance does **not** act at Stage 3; Amit sir alone gives budget approval.

### ❓ Open question — confirm before A1

Who performs Channel review, and does a request *raised by* Channel still go through it?

**Default if no answer:** Stage 1 has mode `ANY` (one reviewer suffices), its approvers are
whoever an administrator assigns in **Settings → Approval workflow** (no code change needed to
change them), and every request goes through it regardless of origin — simplest, and auditable.

### A1. Three stages instead of two

- `scripts/seed-config.ts`, the "Approval workflow" block near the end: today it upserts
  `sequence 1 "Department approval"` and `sequence 2 "Final approval"`. Change to:
  1. `"Channel review"`, mode `ANY`
  2. `"Event approval"`, mode `ALL`
  3. `"Budget approval"`, mode `ALL`
- **Existing databases already have stages 1 and 2 with approvers assigned.** The upsert uses
  `update: {}`, so a re-seed will not rename them. Write the change so that it: renames a stage only
  if it still has its old seeded name (same guard the event-type seed uses — `seededName`), shifts
  existing stage 1 → 2 and stage 2 → 3 **keeping their approvers**, and inserts the new stage 1.
  Do it in a transaction. An in-flight `ApprovalRound` points at `currentStageId`, so stage *ids*
  must be preserved; only `sequence` and `name` change.
- The engine (`src/server/approvals/engine.ts`) already handles N stages in `sequence` order — no
  engine change expected. Confirm by reading how it picks the next stage.
- Assign approvers: Stage 1 per the open question; Stage 2 Akshay + Mitul; Stage 3 Amit sir — in
  Settings → Approval workflow (`src/app/(portal)/settings/workflow/`). Real emails are still owed
  by the product owner; use the seeded test users until then.
- **Prove it:** extend `src/server/approvals/approvals.int.test.ts` with a three-stage round:
  stage 1 ANY clears on one approval, stage 2 ALL needs both, stage 3 approval marks the event
  `APPROVED`. Then click it through in the browser with three users.

### A2. Email every stakeholder after budget approval

- The approved email is sent at the end of the final-stage branch in `engine.ts`
  (`kind: "approval.approved"`), recipients from `notifyTargets()` → `resolveCcList()` in
  `src/server/approvals/notifications.ts`.
- `resolveCcList` today covers requester, owner, earlier approvers, Finance-role users and
  `ccExtra`. **Missing:** the event manager, and every user listed in `EventStakeholder`
  (`userId` not null). Add both, behind a new policy flag `ccStakeholders` (default `true`) in
  `src/server/approvals/settings.ts`, and a checkbox for it wherever the other `cc*` flags are
  edited.
- External stakeholders (`externalName`, no user) have no email — skip them; do not invent one.
- **Prove it:** integration test asserting the approved email's `to + cc` contains manager and
  stakeholder emails, de-duplicated. Check `/dev/outbox` (localhost only) after a real approval.

### A3. Finance queue

- New route `src/app/(portal)/finance/page.tsx`, permission `finance.view` (add to
  `src/lib/permissions.ts`: roles `FINANCE`, `ADMIN`). Add a nav entry in
  `src/components/layout/nav-config.ts`.
- Lists events with `lifecycleStatus` in `APPROVED`, `IN_EXECUTION`, `CLOSED`: code, title,
  department, approved cost, actual cost, invoices received / expected, payment status. Reuse
  `src/components/ui/table.tsx`. Filter tabs: *Awaiting invoice* / *Awaiting payment* / *Paid*.
- Row opens the existing event page. Finance must be able to **read** every tab and **download**
  every file there; confirm `src/app/api/attachments/[id]/route.ts` allows the `FINANCE` role.

### A4. Invoice and actual amount, per cost line

- Model already has what's needed: `CostLineItem.actual`, `invoiceRef`, `invoiceStatus`
  (`NOT_RAISED | RECEIVED | PAID`), `paymentStatus`; `AttachmentKind.INVOICE` exists and was kept
  out of the general Files list on purpose.
- In `src/components/events/cost-lines-panel.tsx`, when the event is `APPROVED` / `IN_EXECUTION` /
  `CLOSED` and the viewer has `finance.view`, each line gets: **Actual amount** input, **Invoice
  ref**, **Upload invoice** (stores an `Attachment` of kind `INVOICE`; add a nullable
  `costLineId` FK on `Attachment` — additive migration — so an invoice belongs to its line), and
  **Mark paid**. Uploading sets `invoiceStatus = RECEIVED`; marking paid sets `PAID`.
- Server action: new `recordInvoiceAction` in `src/app/(portal)/events/actions.ts`, permission
  check for `finance.view`, kind fixed server-side to `INVOICE` (do not trust the form).
- After saving actuals, call the existing roll-up (`recalculateTotals` in
  `src/server/events/service.ts`) so `Event.actualCost` and every dashboard update.
- Audit each change (`writeAudit`, actions `costline.actual_recorded`, `costline.invoice_uploaded`,
  `costline.paid`).
- **Prove it:** integration test — finance user records actual + invoice on an approved event;
  `actualCost` rolls up; a non-finance user is refused. Browser: upload a PDF, see it on the line
  and on the Files tab.

---

## Phase B — Departments decide what people see

What the business asked for: Sales, Marketing, Channel and Finance are **departments**, not separate
user types. A user is created with a department, and the department decides what they can see,
configurable by an administrator. Amit sir and the administrator are the same person — one user
holding `ADMIN` + `EXECUTIVE_APPROVER`; that is configuration, not code.

Keep the two ideas separate, as a professional product does:
- **Role** (existing `User.roles`) decides what you can *do* — raise, approve, administer.
- **Department** (existing `User.department`) decides which *events* you can see.

### B1. Access policy as a setting

- New `src/server/access/policy.ts`, same pattern as `src/server/dashboards/policy.ts`
  (`AppSetting` key `access.policy`, zod schema, `safeParse` with a default, never throws).
- Shape: for each viewer department, the set of event departments it may see, plus `all`.
  Defaults: **Sales → Sales; Marketing → Marketing; Channel → all** (Channel reviews everything);
  **Finance → all**; **Management → all**. Administrators and anyone currently assigned as an
  approver on an event's open round always see that event.
- Admin UI: a card on `src/app/(portal)/settings/config/page.tsx`, a grid of departments × event
  departments, styled like `dashboard-money-panel.tsx`.

### B2. Enforce it everywhere events are read — not just the register

Write one helper, `eventVisibilityWhere(viewer, policy): Prisma.EventWhereInput`, and apply it in:
- `eventListWhere` in `src/server/events/queries.ts` (register + CSV export + global search use it)
- the event detail page (`src/app/(portal)/events/[id]/page.tsx`) — `notFound()` when not visible
- the Approval Center query
- `src/app/api/events/export/route.ts` and `src/app/api/attachments/[id]/route.ts`
- **the dashboard engine** — `compileWidget` in `src/server/dashboards/compile.ts` must AND a
  department predicate into its `WHERE`, passed in like `allowMoney`. Otherwise a Sales user's
  widget would total Marketing's spend. Use the existing filter path so it stays parameterised
  (the ESLint rule on `Prisma.raw` must stay green).
- reports queries in `src/server/reports/queries.ts`.

**Prove it:** an integration test per entry point: a Sales user sees Sales events and not
Marketing ones; Channel sees both; an approver sees the event they must decide even across
departments. This phase is governance-critical — test the refusals, not just the happy path.

### B3. User form

- `src/app/(portal)/settings/users/` — department becomes a required dropdown with a one-line hint
  of what it grants, read from the policy.

---

## Phase C — Guide page

- New `src/app/(portal)/guide/page.tsx`, visible to everyone; a "?" link in
  `src/components/layout/header.tsx`, and a nav entry.
- Short task walkthroughs, each step linking straight to the screen it describes:
  *Raise an event request · Fill in and submit · Channel review / approve from email or portal ·
  Build a dashboard · Finance: record an invoice and actual amount · Admin: users, departments,
  workflow, money visibility.*
- Show only the sections relevant to the viewer's roles (use `can()` from `src/lib/permissions.ts`),
  with an "All topics" toggle.
- Plain server component, existing `Card` / `PageHeader`; no new dependency. Write it after
  Phases A–B so it describes the real flow.

---

## Phase D — HubSpot (blocked on access)

Needs the HubSpot Private App token from the product owner; nothing can be verified without it.
The two-way sync from Phase 8 exists in `src/server/hubspot/`.

- **D1. Partners from HubSpot:** map HubSpot companies → `Organization` including name,
  partner/distributor type and tier (custom company property — get its internal name from the
  owner). Extend the existing field mapping; keep HubSpot ids on `Organization.hubspotId`.
- **D2. Event leads:** HubSpot contacts/deals whose lead source names an event appear on that
  event. Match on a stored HubSpot event identifier, not on event title text. Show on a new
  read-only **HubSpot** tab of the event page: leads, deals, partner company.
- Build behind the existing integration toggle; unit-test the mapping with recorded fixture
  payloads; leave live verification until the token arrives.

---

## Still owed by the product owner

- Answer to the Phase A open question (Channel review).
- Real emails for Akshay, Mitul, Amit sir and the Finance team (approvers and recipients).
- HubSpot Private App token, and the tier property's internal name (Phase D).
- Motadata brand guide (chart palette slots 2–6 are placeholders in `src/styles/tokens.css`).
- M365 SMTP credentials and the hosting target.
