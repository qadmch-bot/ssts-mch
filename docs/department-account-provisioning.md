# Department accounts: controlled provisioning (not yet deployed)

## Login

Staff usernames: `OBSER`, `PER`, `LAB`, `IPC`. Quality Admin continues using its existing email. Username-only login maps to internal Supabase Auth emails; it does **not** bypass authentication. Provision **confirmed** Auth users with these exact emails in Supabase Dashboard → Authentication → Users → Add user:

| Username | Internal Auth email | Database role | Department scope |
|---|---|---|---|
| OBSER | obser@ssts-mch.invalid | emergency | Existing OBS emergency department UUID only |
| PER | per@ssts-mch.invalid | emergency | Existing pediatric emergency department UUID only |
| LAB | lab@ssts-mch.invalid | laboratory | Existing laboratory department UUID only |
| IPC | ipc@ssts-mch.invalid | ipc | Read-only surveillance, no patient identifiers |

Use strong, unique passwords and require rotation; **do not** use OBSER123, PER123, LAB123, IPC123 or IPC1123 in production. Avoid sharing credentials in chat or committing them to GitHub. The `.invalid` addresses are synthetic internal identifiers and cannot receive password-reset emails. Administrators must reset passwords in the Supabase Auth dashboard. Validate your Supabase Auth settings permit these identifiers before provisioning. Consider a managed identity provider for production.

## Critical prerequisites before deployment

1. Review the SQL migration `20261115000000_department_scope_ipc.sql` against the **actual** database. The enum addition must be committed separately before the role is used in policy functions.
2. Audit every existing RLS policy and SECURITY DEFINER RPC for bypasses, especially `register_case`, `save_bundle`, `save_lab_test`, `case_updates`, `notification_events`, `audit_logs`, `system_settings` and `profiles`. A restricted menu is **not** access control.
3. Audit all app pages and APIs for role- and department-specific authorization. The current UI still contains cross-department menus and dashboard counts. Do not merge this PR until these are restricted.
4. Create Auth users in the dashboard, note their UUIDs, and assign `profiles` and `profile_departments` using a reviewed transaction. Use exact existing department IDs, not guessed names. Verify separate OBS ER and pediatric ER departments exist.
5. Test with four non-production accounts and Quality Admin: direct URLs, API requests, cross-department case reads, MRN access, lab writes, settings and audit logs. Verify Quality Admin still sees all data.

## Read-only verification query (safe to run)

```sql
SELECT id, name, kind, active FROM public.departments ORDER BY kind, name;
SELECT id, full_name, role, active FROM public.profiles ORDER BY role, full_name;
SELECT profile_id, department_id FROM public.profile_departments ORDER BY profile_id, department_id;
```

**No accounts are created by this PR. Do not run the RLS migration against live patient data until the security review and staging tests are complete.**
