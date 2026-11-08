# Sepsis Surveillance & Tracking System (SSTS)

**Hafar Al Batin Health Cluster · Maternity & Children Hospital – Hafar Al Batin · Quality & Patient Safety**

A secure web application to monitor every sepsis case from Emergency registration through the
**SEPSIS HOUR-1 BUNDLE**, laboratory follow-up, inpatient updates and final outcome — with
configurable WhatsApp, email and in-app notifications.

> SSTS is a surveillance and administrative follow-up tool. It does **not** replace the hospital's
> clinical sepsis escalation protocol. Reminder thresholds and compliance rules must be approved by
> hospital leadership and the responsible clinical teams before use.

---

## Status

| Area | State |
|---|---|
| Interface — 9 pages, dashboard, forms, reports | **Built and tested** (browser acceptance tests, desktop + mobile) |
| Workflow engine (registration, Hour-1 Bundle, lab, inpatient, outcomes, notifications fan-out) | **Built and unit-tested** |
| Database schema, Row Level Security, transactional RPC functions | **Built and tested** on embedded PostgreSQL with Supabase auth stubs |
| Supabase connection, Auth, production data loading | **Implemented — not yet connected** to a real Supabase project |
| WhatsApp Business Platform (Cloud API) | **Implemented — not configured or tested** with real credentials |
| Email (SMTP / Microsoft 365 or Resend) | **Implemented — not configured or tested** with real credentials |

**No WhatsApp or email message has been sent by this system yet.** Until providers are configured, every external
notification is logged honestly as **“Not Sent (provider not configured)”**. “Sent” and “Delivered” only appear when the
provider responds.

---

## Run locally (demo mode)

```bash
npm install
npm run dev          # http://localhost:3000
```

With no Supabase variables set, the app runs in **demo mode**: synthetic data, browser storage
(settings and recipients persist across refresh), and a role switcher in the user menu to try
Quality Admin / Emergency / Laboratory / Inpatient / Leadership permissions.

```bash
npm test             # engine + Hour-1 Bundle rule tests
npm run typecheck
npm run build
```

## Main menu

1. **Dashboard** — 6 KPI cards, Hour-1 Bundle compliance strip, case table, case flow, cases requiring action, notification management & rules
2. **New Sepsis Case** — fields from the official form (Diagnosis Time and Time of Sepsis Recognition kept separate), duplicate-MRN check
3. **Sepsis Cases** — filters, case detail with timeline, bundle, labs, updates, notifications and audit trail
4. **Hour-1 Bundle** — live timer from recognition; digitized form with the five original measures (YES/NO)
5. **Laboratory Results** — multiple tests per case, Lactate / Blood Culture linked to the bundle
6. **Inpatient Updates** — department-scoped updates, transfers, outcome buttons (DISCHARGED / DAMA / DEATH + other closures)
7. **Notifications** — alerts, cases requiring action, delivery log with authorized resend
8. **Reports** — case, Hour-1 compliance (by department / month), element compliance, laboratory, department follow-up; Excel, PDF, print
9. **Settings** — WhatsApp recipients, email recipients, notification rules, departments & lab tests, reminders & compliance rules, integrations, audit log

## Hour-1 Bundle rules (default — require hospital approval)

* The clinician's original YES/NO answers are stored exactly as recorded.
* “Clinically not applicable” and “Information missing” are **separate** electronic fields. **NO is never treated as not applicable.**
* Vasopressors are applicable only when *hypotension occurred* is documented YES (separate field).
* Recognition → Completion minutes are calculated and shown as Within 60 / Over 60 / Pending / Requires Review, **separately** from the clinician's “All Bundle Followed within 1 Hour” answer.
* **Within 1 Hour** requires all applicable measures YES, clinician YES, and ≤ 60 min. Elapsed time alone never makes a case compliant.
* Missing documentation → **Pending** (never counted as non-compliant). Contradictions → **Requires Review** for a Quality decision (audited).
* Compliance % = Within ÷ (Within + Not Within). Element denominators exclude documented not-applicable and undocumented cases.
* All registered cases are currently treated as eligible; adjust if the hospital approves exclusions (e.g. *Sepsis Ruled Out*).

Logic: `src/lib/bundle.ts` · tests: `src/lib/__tests__/engine.test.ts`.

## Project layout

```
src/app/                  pages (dashboard, cases, bundle, laboratory, inpatient, notifications, reports, settings, login)
src/app/api/              notification status, dispatch worker, WhatsApp webhook, reminder cron
src/lib/engine.ts         workflow actions (mirrors the SQL functions)
src/lib/bundle.ts         Hour-1 Bundle timing & compliance evaluation
src/lib/notify.ts         routing, idempotency keys, message templates (no patient identifiers)
src/lib/server/           WhatsApp / email providers, dispatcher, job auth
src/lib/backend/          Supabase → app state mapping
supabase/migrations/      schema, RLS, RPC functions
supabase/seed.sql         departments, rules, lab test types, settings (no patients)
docs/                     deployment, WhatsApp setup, security & approval checklist
```

See **docs/DEPLOYMENT.md** to go live and **docs/SECURITY_CHECKLIST.md** for hospital approvals.

The official Hafar Al Batin Health Cluster logo in `public/` was supplied by the hospital; its use is subject to the Cluster's permission.
