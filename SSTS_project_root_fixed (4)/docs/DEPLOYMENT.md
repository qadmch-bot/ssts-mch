# Deployment Guide

> Do not use real patient data or activate external messaging until hospital IT, Information
> Security, Clinical Governance and the Data Protection Officer have approved (see SECURITY_CHECKLIST.md).

## 1. Hosting & data residency decision (first)

Patient identifiers (MRN, name) and clinical timing are personal health data under the Saudi PDPL and
NCA controls. **Confirm with hospital IT / cybersecurity where data may be hosted before creating any
cloud project.** Options:

* **Supabase Cloud + Vercel** — fastest; confirm whether an available region is acceptable to the hospital.
* **Self-hosted** — Supabase (Docker) and the Next.js app (`npm run build && npm start`, or Docker) on
  hospital-approved infrastructure inside the Kingdom. The code needs no changes; only the URLs differ.

## 2. Database (Supabase)

1. Create the project. Enable **Point-in-Time Recovery / daily backups**.
2. SQL editor → run `supabase/migrations/20261108000000_ssts_schema.sql`, then `supabase/seed.sql`.
   (Or `supabase db push` with the Supabase CLI.)
3. Authentication → Providers: keep **Email** enabled, **disable public sign-ups**. Enable MFA if available.
   Create users from the dashboard (invite), then assign roles:

```sql
insert into profiles (id, full_name, role) values ('<auth user uuid>', 'Quality Team', 'quality_admin');
-- department-scoped users (emergency / inpatient) also need departments:
insert into profile_departments (profile_id, department_id)
select '<auth user uuid>', id from departments where name in ('Pediatric ER');
```

Roles: `quality_admin`, `emergency`, `laboratory`, `inpatient`, `leadership` (read-only).

## 3. Application (Vercel or self-hosted)

1. Import the repository; framework Next.js.
2. Set the environment variables from `.env.example` (service role key, CRON_SECRET, provider secrets are **server-side only**).
3. Deploy. Open `/login`, sign in as the Quality Admin.
4. Settings → Reminders & Compliance → set **Application URL** to the HTTPS address.

### Scheduler

`vercel.json` runs `/api/cron/reminders` every minute (Hour-1 pending/overdue, bundle review, lab delay,
follow-up reminders, then sends queued messages). Per-minute crons require a Vercel plan that supports
them. Alternatives: Supabase `pg_cron` + `pg_net`, or any scheduler calling:

```
GET https://<app>/api/cron/reminders         Authorization: Bearer <CRON_SECRET>
GET https://<app>/api/notifications/dispatch Authorization: Bearer <CRON_SECRET>
```

Messages are also dispatched immediately after each user action.

## 4. WhatsApp — see docs/WHATSAPP.md

## 5. Email

* **Microsoft 365 / Exchange (SMTP):** `EMAIL_PROVIDER=smtp`, `SMTP_HOST=smtp.office365.com`, port 587, a licensed
  service mailbox with SMTP AUTH enabled by IT, `EMAIL_FROM` = that mailbox.
* **Resend:** `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, verified sending domain.

Email status becomes **Sent** when the mail server accepts the message. SMTP does not report inbox delivery, so
email rows do not move to “Delivered”.

## 6. Go-live verification (record results)

| Step | Expected |
|---|---|
| Settings → Integrations → Test Connection | both providers “Configured” |
| Send test message to one WhatsApp and one email recipient | log shows **TEST**, then Sent → Delivered (WhatsApp) / Sent (email); the message is received |
| Register a synthetic case in a test department | exactly one delivery per routed recipient and channel |
| Mark a lab result available / transfer / record outcome | one alert each; repeating an unchanged update creates none |
| Disable a rule and repeat | no message sent |
| Use a wrong number | log shows Failed with the provider's error; Resend works |
| Sign in as Laboratory / Leadership | MRN hidden; cannot register, edit recipients or settings |
| Restore test from backup | data recovered |
