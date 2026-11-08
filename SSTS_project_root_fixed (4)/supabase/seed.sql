-- Reference data only (no patients). Run after the migration.
insert into departments (name, kind) values
  ('Pediatric ER', 'emergency'), ('Obstetric ER', 'emergency'),
  ('NICU', 'inpatient'), ('PICU', 'inpatient'), ('Pediatric Medical Ward', 'inpatient'),
  ('Pediatric Intermediate Care', 'inpatient'), ('Obstetric Ward 1', 'inpatient'), ('Obstetric Ward 2', 'inpatient'),
  ('Laboratory', 'laboratory'), ('Quality & Patient Safety', 'other')
on conflict (name) do nothing;

insert into notification_rules (event_type, whatsapp, email, in_app)
select e, e not in ('bundle_review', 'case_closed_other'), true, true from unnest(enum_range(null::event_type)) e
on conflict (event_type) do nothing;

insert into lab_test_types (name) values
  ('Lactate'), ('Blood Culture'), ('CBC'), ('CRP'), ('Procalcitonin'), ('Blood Gas'), ('Urine Culture'), ('CSF Culture')
on conflict do nothing;

insert into system_settings (key, value) values
  ('reminders', '{"bundleApproachingMinutes":45,"bundleOverdueMinutes":60,"labOverdueHours":6,"inpatientUpdateOverdueHours":24,"outcomePendingDays":7,"approvedByLeadership":false}'),
  ('appBaseUrl', '"https://ssts.example.org"'),
  ('complianceRulesApproved', 'false')
on conflict (key) do nothing;

-- First Quality Admin: create the user in Supabase Auth (dashboard → Authentication),
-- then run (replace the UUID and name):
-- insert into profiles (id, full_name, role) values ('00000000-0000-0000-0000-000000000000', 'Quality Team', 'quality_admin');
