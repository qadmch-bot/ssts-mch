# Security, Privacy & Approval Checklist (before production)

## Approvals (sign and date)
- [ ] Hospital IT — hosting, network, backup/recovery
- [ ] Information / Cyber Security — NCA ECC controls, penetration test or security review
- [ ] Data Protection Officer — Saudi PDPL assessment, data residency, retention period
- [ ] Clinical Governance / Sepsis committee — Hour-1 compliance rules, eligibility, reminder thresholds
- [ ] Quality & Patient Safety — workflows, report definitions
- [ ] Policy approval for WhatsApp as an alert channel; recipient consent
- [ ] Permission to use the official Cluster logo

## Built-in controls
| Control | Implementation |
|---|---|
| Authentication | Supabase Auth; every page requires sign-in (middleware); public sign-up disabled |
| Least privilege | Roles: Quality Admin, Emergency, Laboratory, Inpatient, Leadership (read-only); updates limited to the case's current department |
| Row Level Security | Enabled on all tables; no direct writes — only audited SECURITY DEFINER functions with role checks |
| Patient identifiers | MRN & name in a separate table readable only by Quality Admin, Emergency, Inpatient; masked in UI until revealed; MRN duplicate check uses SHA-256 hash |
| Messaging | WhatsApp/email contain only Case ID, department, event, status and a sign-in link — no identifiers or clinical values |
| Exports | Excel/PDF exclude MRN and names; restricted to Quality Admin & Leadership; each export is audited |
| Audit | Append-only `audit_logs` (trigger blocks UPDATE/DELETE): registrations, bundle saves, lab, updates, outcomes, corrections with reasons, settings, recipients, exports |
| Notification integrity | Unique event keys + unique (event, recipient, channel); SKIP LOCKED worker; retries with backoff; status only from provider responses |
| Secrets | Server-side environment variables only; never stored in the database or browser |
| Transport & headers | HTTPS (HSTS), X-Frame-Options DENY, nosniff, no-referrer, no indexing |
| Time | Stored UTC; displayed Asia/Riyadh |

## Before go-live
- [ ] Replace synthetic data; confirm no demo data in production DB
- [ ] Backups + tested restore; define RPO/RTO
- [ ] Account lifecycle (joiners/leavers) owned by Quality Admin + IT
- [ ] Session timeout / MFA policy configured in Supabase Auth
- [ ] Retention rules for cases, notification logs and audit logs
- [ ] Incident contact for failed notifications
