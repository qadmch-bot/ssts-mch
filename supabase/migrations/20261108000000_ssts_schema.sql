-- =====================================================================
-- Sepsis Surveillance & Tracking System (SSTS) — database schema
-- Maternity & Children Hospital – Hafar Al Batin · Quality & Patient Safety
--
-- * All timestamps are timestamptz (stored UTC). Display: Asia/Riyadh.
-- * Row Level Security is enabled on every table. Writes go through
--   SECURITY DEFINER functions that check the caller's role/department.
-- * Patient identifiers live in a separate, more restricted table.
-- * audit_logs is append-only (no UPDATE/DELETE, enforced by trigger).
-- * notification_events.dedupe_key and the (event, recipient, channel)
--   unique key make notification creation idempotent.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- types
create type app_role as enum ('quality_admin', 'emergency', 'laboratory', 'inpatient', 'leadership');
create type department_kind as enum ('emergency', 'inpatient', 'laboratory', 'other');
create type yes_no as enum ('YES', 'NO');
create type measure_key as enum ('lactate', 'blood_cultures', 'antibiotics', 'iv_fluids', 'vasopressors');
create type applicability as enum ('applicable', 'not_applicable', 'not_documented');
create type compliance_status as enum ('compliant', 'not_compliant', 'pending', 'requires_review');
create type lab_status as enum ('not_requested', 'requested', 'pending', 'result_available', 'cancelled');
create type final_outcome as enum ('discharged', 'dama', 'death', 'transferred_facility', 'sepsis_ruled_out', 'administrative_closure');
create type channel as enum ('whatsapp', 'email');
create type delivery_status as enum ('queued', 'sent', 'delivered', 'failed', 'retrying', 'not_sent');
create type event_type as enum (
  'case_registered', 'bundle_pending', 'bundle_overdue', 'bundle_completed', 'bundle_review',
  'lab_result_available', 'lab_delay', 'inpatient_update', 'patient_transferred',
  'outcome_discharged', 'outcome_dama', 'outcome_death', 'case_closed_other', 'followup_reminder'
);

-- ---------------------------------------------------------------- core tables
create table departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 2 and 80),
  kind department_kind not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role app_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table profile_departments (
  profile_id uuid not null references profiles (id) on delete cascade,
  department_id uuid not null references departments (id),
  primary key (profile_id, department_id)
);

create table case_sequences (
  year int primary key,
  last_value int not null default 0
);

create table cases (
  id uuid primary key default gen_random_uuid(),
  case_no text not null unique check (case_no ~ '^SEP-\d{4}-\d{4,}$'),
  age numeric check (age >= 0),
  age_unit text not null default 'years' check (age_unit in ('days', 'months', 'years')),
  sex text check (sex in ('Male', 'Female')),
  patient_category text check (patient_category in ('Neonatal', 'Pediatric', 'Obstetric', 'Adult')),
  consultant text not null default '',
  case_date date not null,
  emergency_department_id uuid not null references departments (id),
  current_department_id uuid not null references departments (id),
  diagnosis_time timestamptz,
  recognition_time timestamptz not null,
  physician_name text not null,
  status text not null default 'active' check (status in ('active', 'closed')),
  current_status text not null default 'In Emergency',
  outcome final_outcome,
  outcome_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid not null references profiles (id),
  updated_at timestamptz not null default now(),
  check ((outcome is null) = (outcome_at is null))
);
create index cases_created_at_idx on cases (created_at);
create index cases_current_dept_idx on cases (current_department_id) where status = 'active';

-- Restricted identifiers: MRN + patient name. Never exposed to laboratory/leadership.
create table patient_identifiers (
  case_id uuid primary key references cases (id) on delete cascade,
  mrn text not null check (mrn ~ '^[A-Za-z0-9-]{3,20}$'),
  mrn_hash text not null,
  patient_name text not null
);
create index patient_identifiers_mrn_hash_idx on patient_identifiers (mrn_hash);

create table bundle_assessments (
  case_id uuid primary key references cases (id) on delete cascade,
  hypotension_occurred yes_no,
  completion_time timestamptz,
  clinician_all_within_1h yes_no,
  physician_name text not null default '',
  documented_at timestamptz,
  review_override compliance_status,
  review_note text not null default '',
  reviewed_by uuid references profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles (id)
);

create table bundle_measures (
  case_id uuid not null references bundle_assessments (case_id) on delete cascade,
  measure measure_key not null,
  answer yes_no, -- original clinician answer; NULL = not documented
  applicability applicability not null default 'applicable',
  information_missing boolean not null default false,
  note text not null default '',
  primary key (case_id, measure)
);

create table lab_test_types (
  name text primary key,
  active boolean not null default true
);

create table lab_tests (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases (id) on delete cascade,
  test_type text not null,
  linked_measure measure_key,
  status lab_status not null,
  requested_at timestamptz,
  result_at timestamptz,
  notes text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid not null references profiles (id),
  check (status <> 'result_available' or result_at is not null),
  check (result_at is null or requested_at is null or result_at >= requested_at)
);
create index lab_tests_case_idx on lab_tests (case_id);
create index lab_tests_open_idx on lab_tests (status) where status in ('requested', 'pending');

create table case_updates (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases (id) on delete cascade,
  department_id uuid not null references departments (id),
  status text not null,
  update_at timestamptz not null,
  notes text not null default '',
  transfer_from_id uuid references departments (id),
  transfer_to_id uuid references departments (id),
  created_at timestamptz not null default now(),
  created_by uuid not null references profiles (id)
);
create index case_updates_case_idx on case_updates (case_id, created_at desc);

-- Full outcome history; the current outcome is cached on cases.
create table final_outcomes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases (id) on delete cascade,
  outcome final_outcome, -- NULL row = case reopened
  outcome_at timestamptz,
  notes text not null default '',
  correction_reason text,
  recorded_at timestamptz not null default now(),
  recorded_by uuid not null references profiles (id)
);

-- ---------------------------------------------------------------- notifications
create table notification_recipients (
  id uuid primary key default gen_random_uuid(),
  channel channel not null,
  name text not null,
  address text not null,
  department_ids uuid[] not null default '{}', -- empty = all departments
  event_types event_type[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, address),
  check (
    (channel = 'whatsapp' and address ~ '^\+[1-9][0-9]{7,14}$')
    or (channel = 'email' and address ~* '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' and address = lower(address))
  )
);

create table notification_rules (
  event_type event_type primary key,
  whatsapp boolean not null default true,
  email boolean not null default true,
  in_app boolean not null default true,
  updated_at timestamptz not null default now()
);

create table notification_events (
  id uuid primary key default gen_random_uuid(),
  event_type event_type not null,
  case_id uuid references cases (id) on delete set null,
  case_no text,
  department_id uuid references departments (id),
  dedupe_key text not null unique, -- idempotency
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references profiles (id)
);

create table notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references notification_events (id) on delete cascade,
  recipient_id uuid not null references notification_recipients (id),
  recipient_name text not null,
  address text not null,
  channel channel not null,
  status delivery_status not null default 'queued',
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  error text,
  provider_message_id text unique,
  unique (event_id, recipient_id, channel)
);
create index notification_deliveries_due_idx on notification_deliveries (next_attempt_at) where status in ('queued', 'retrying');

create table in_app_notifications (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique references notification_events (id) on delete cascade,
  event_type event_type not null,
  case_id uuid references cases (id) on delete cascade,
  department_id uuid references departments (id),
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table in_app_reads (
  notification_id uuid not null references in_app_notifications (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, profile_id)
);

create table audit_logs (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid,
  user_name text,
  action text not null,
  entity text not null,
  entity_id text not null,
  case_id uuid,
  detail text not null default ''
);
create index audit_logs_case_idx on audit_logs (case_id, at desc);

create table system_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles (id)
);

-- Append-only audit log
create function forbid_change() returns trigger language plpgsql as $$
begin
  raise exception 'audit_logs is append-only';
end $$;
create trigger audit_logs_immutable before update or delete on audit_logs for each row execute function forbid_change();

-- ---------------------------------------------------------------- helpers
create function current_role_name() returns app_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and active
$$;

create function has_role(variadic roles app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = any (roles) from profiles where id = auth.uid() and active), false)
$$;

create function in_my_departments(dept uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profile_departments where profile_id = auth.uid() and department_id = dept)
$$;

create function can_act_on_case(p_case uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select has_role('quality_admin')
      or exists (select 1 from cases c where c.id = p_case and in_my_departments(c.current_department_id))
$$;

create function mrn_digest(p_mrn text) returns text
language sql immutable set search_path = public, extensions as $$
  select encode(digest(upper(trim(p_mrn)), 'sha256'), 'hex')
$$;

create function write_audit(p_action text, p_entity text, p_entity_id text, p_case uuid, p_detail text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_logs (user_id, user_name, action, entity, entity_id, case_id, detail)
  values (auth.uid(), (select full_name from profiles where id = auth.uid()), p_action, p_entity, p_entity_id, p_case, coalesce(p_detail, ''));
end $$;

create function event_label(e event_type) returns text language sql immutable as $$
  select case e
    when 'case_registered' then 'New Sepsis Case'
    when 'bundle_pending' then 'Hour-1 Bundle Pending'
    when 'bundle_overdue' then 'Hour-1 Bundle Overdue'
    when 'bundle_completed' then 'Hour-1 Bundle Completed'
    when 'bundle_review' then 'Bundle Requires Review'
    when 'lab_result_available' then 'Laboratory Result Available'
    when 'lab_delay' then 'Laboratory Delay Alert'
    when 'inpatient_update' then 'Inpatient Status Updated'
    when 'patient_transferred' then 'Patient Transferred'
    when 'outcome_discharged' then 'Discharged'
    when 'outcome_dama' then 'DAMA'
    when 'outcome_death' then 'Death'
    when 'case_closed_other' then 'Case Closed (Other Outcome)'
    when 'followup_reminder' then 'Pending Follow-up Reminder'
  end
$$;

-- ---------------------------------------------------------------- notification fan-out
-- Idempotent: returns NULL if an event with the same dedupe key already exists.
create function emit_event(p_type event_type, p_case uuid, p_dedupe text, p_dept_ids uuid[] default null, p_is_test boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_event uuid;
  v_rule notification_rules;
  v_case cases;
  v_depts uuid[];
begin
  select * into v_case from cases where id = p_case;
  insert into notification_events (event_type, case_id, case_no, department_id, dedupe_key, is_test, created_by)
  values (p_type, p_case, v_case.case_no, v_case.current_department_id, p_dedupe, p_is_test, auth.uid())
  on conflict (dedupe_key) do nothing
  returning id into v_event;
  if v_event is null then
    return null;
  end if;

  select * into v_rule from notification_rules where event_type = p_type;
  if not found then
    return v_event;
  end if;

  if v_rule.in_app then
    insert into in_app_notifications (event_id, event_type, case_id, department_id, title, body)
    values (v_event, p_type, p_case, v_case.current_department_id, event_label(p_type),
            concat_ws(' · ', v_case.case_no, (select name from departments where id = v_case.current_department_id), event_label(p_type)));
  end if;

  v_depts := coalesce(p_dept_ids, array[v_case.current_department_id, v_case.emergency_department_id]);

  -- one delivery per (event, recipient, channel); addresses are unique per channel
  insert into notification_deliveries (event_id, recipient_id, recipient_name, address, channel)
  select v_event, r.id, r.name, r.address, r.channel
  from notification_recipients r
  where r.active
    and p_type = any (r.event_types)
    and ((r.channel = 'whatsapp' and v_rule.whatsapp) or (r.channel = 'email' and v_rule.email))
    and (cardinality(r.department_ids) = 0 or r.department_ids && v_depts)
  on conflict do nothing;

  return v_event;
end $$;

-- ---------------------------------------------------------------- case registration
create function register_case(p jsonb, p_confirm_duplicate boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := coalesce((p ->> 'id')::uuid, gen_random_uuid());
  v_year int := extract(year from (now() at time zone 'Asia/Riyadh'))::int;
  v_seq int;
  v_case_no text;
  v_dup text;
  v_recog timestamptz := (p ->> 'recognitionTime')::timestamptz;
  v_diag timestamptz := (p ->> 'diagnosisTime')::timestamptz;
  m measure_key;
begin
  if not has_role('quality_admin', 'emergency') then
    raise exception 'Only Emergency Department users and Quality Admin can register cases' using errcode = '42501';
  end if;
  if coalesce(trim(p ->> 'mrn'), '') = '' then raise exception 'MRN is required'; end if;
  if coalesce(trim(p ->> 'patientName'), '') = '' then raise exception 'Patient name is required'; end if;
  if coalesce(trim(p ->> 'physicianName'), '') = '' then raise exception 'Physician Name is required'; end if;
  if v_recog is null then raise exception 'Time of Sepsis Recognition is required'; end if;
  if v_recog > now() + interval '1 minute' then raise exception 'Time of Sepsis Recognition cannot be in the future'; end if;
  if v_diag is not null and v_diag > now() + interval '1 minute' then raise exception 'Diagnosis Time cannot be in the future'; end if;
  if not has_role('quality_admin') and not in_my_departments((p ->> 'emergencyDepartmentId')::uuid) then
    raise exception 'You can only register cases for your own Emergency Department' using errcode = '42501';
  end if;

  select c.case_no into v_dup
  from patient_identifiers i join cases c on c.id = i.case_id
  where i.mrn_hash = mrn_digest(p ->> 'mrn') and c.status = 'active'
  limit 1;
  if v_dup is not null and not p_confirm_duplicate then
    raise exception 'DUPLICATE:%', v_dup;
  end if;

  insert into case_sequences (year, last_value) values (v_year, 1)
  on conflict (year) do update set last_value = case_sequences.last_value + 1
  returning last_value into v_seq;
  v_case_no := format('SEP-%s-%s', v_year, lpad(v_seq::text, 4, '0'));

  insert into cases (id, case_no, age, age_unit, sex, patient_category, consultant, case_date,
                     emergency_department_id, current_department_id, diagnosis_time, recognition_time,
                     physician_name, created_by)
  values (v_id, v_case_no, (p ->> 'age')::numeric, coalesce(p ->> 'ageUnit', 'years'), nullif(p ->> 'sex', ''),
          nullif(p ->> 'patientCategory', ''), coalesce(p ->> 'consultant', ''), (p ->> 'caseDate')::date,
          (p ->> 'emergencyDepartmentId')::uuid, (p ->> 'currentDepartmentId')::uuid, v_diag, v_recog,
          trim(p ->> 'physicianName'), auth.uid());

  insert into patient_identifiers (case_id, mrn, mrn_hash, patient_name)
  values (v_id, trim(p ->> 'mrn'), mrn_digest(p ->> 'mrn'), trim(p ->> 'patientName'));

  insert into bundle_assessments (case_id, physician_name, updated_by) values (v_id, trim(p ->> 'physicianName'), auth.uid());
  foreach m in array enum_range(null::measure_key) loop
    insert into bundle_measures (case_id, measure, applicability)
    values (v_id, m, case when m = 'vasopressors' then 'not_documented'::applicability else 'applicable'::applicability end);
  end loop;

  perform write_audit('case.register', 'case', v_id::text, v_id,
    'Registered ' || v_case_no || case when v_dup is not null then ' (duplicate MRN confirmed; open case ' || v_dup || ')' else '' end);
  perform emit_event('case_registered', v_id, 'case_registered:' || v_id);
  return jsonb_build_object('id', v_id, 'caseNo', v_case_no);
end $$;

-- ---------------------------------------------------------------- Hour-1 bundle
create function save_bundle(p_case uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_case cases;
  v_prev bundle_assessments;
  v_completion timestamptz := (p ->> 'completionTime')::timestamptz;
  k text;
  mv jsonb;
begin
  select * into v_case from cases where id = p_case;
  if not found then raise exception 'Case not found'; end if;
  if not has_role('quality_admin', 'emergency') then raise exception 'Not permitted to document the bundle' using errcode = '42501'; end if;
  if v_case.status = 'closed' and not has_role('quality_admin') then raise exception 'Case is closed'; end if;
  if (p ? 'reviewOverride' or p ? 'reviewNote') and not has_role('quality_admin')
     and ((p ->> 'reviewOverride') is distinct from (select review_override::text from bundle_assessments where case_id = p_case)) then
    raise exception 'Only Quality Admin can record review decisions' using errcode = '42501';
  end if;
  if v_completion is not null and v_completion < v_case.recognition_time then
    raise exception 'Bundle Completion Time cannot be before the Time of Sepsis Recognition';
  end if;
  if v_completion is not null and v_completion > now() + interval '1 minute' then
    raise exception 'Bundle Completion Time cannot be in the future';
  end if;

  select * into v_prev from bundle_assessments where case_id = p_case for update;

  update bundle_assessments set
    hypotension_occurred = (p ->> 'hypotensionOccurred')::yes_no,
    completion_time = v_completion,
    clinician_all_within_1h = (p ->> 'clinicianAllWithin1h')::yes_no,
    physician_name = coalesce(p ->> 'physicianName', ''),
    documented_at = (p ->> 'documentedAt')::timestamptz,
    review_override = (p ->> 'reviewOverride')::compliance_status,
    review_note = coalesce(p ->> 'reviewNote', ''),
    reviewed_by = case when (p ->> 'reviewOverride') is distinct from v_prev.review_override::text then auth.uid() else reviewed_by end,
    updated_at = now(),
    updated_by = auth.uid()
  where case_id = p_case;

  for k, mv in select * from jsonb_each(coalesce(p -> 'measures', '{}'::jsonb)) loop
    update bundle_measures set
      answer = (mv ->> 'answer')::yes_no,
      applicability = coalesce((mv ->> 'applicability')::applicability, applicability),
      information_missing = coalesce((mv ->> 'informationMissing')::boolean, false),
      note = coalesce(mv ->> 'note', '')
    where case_id = p_case and measure = k::measure_key;
  end loop;

  update cases set updated_at = now() where id = p_case;
  perform write_audit('bundle.save', 'bundle', p_case::text, p_case, 'Hour-1 Bundle documentation saved');
  if v_completion is not null and v_completion is distinct from v_prev.completion_time then
    perform emit_event('bundle_completed', p_case, 'bundle_completed:' || p_case || ':' || v_completion);
  end if;
  -- 'bundle_review' events are raised by the reminder job, which evaluates
  -- compliance with the same rules as the application (src/lib/bundle.ts).
end $$;

-- ---------------------------------------------------------------- laboratory
create function save_lab(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := coalesce((p ->> 'id')::uuid, gen_random_uuid());
  v_case uuid := (p ->> 'caseId')::uuid;
  v_status lab_status := (p ->> 'status')::lab_status;
  v_req timestamptz := (p ->> 'requestedAt')::timestamptz;
  v_res timestamptz := case when v_status = 'result_available' then (p ->> 'resultAt')::timestamptz end;
  v_type text := trim(p ->> 'testType');
  v_prev lab_tests;
begin
  if not has_role('quality_admin', 'laboratory') then raise exception 'Only laboratory staff and Quality Admin can update laboratory records' using errcode = '42501'; end if;
  if not exists (select 1 from cases where id = v_case) then raise exception 'Case not found'; end if;
  if v_type = '' then raise exception 'Test type is required'; end if;
  if v_status = 'result_available' and v_res is null then raise exception 'Result Date & Time is required when the result is available'; end if;
  if v_res is not null and v_res > now() + interval '1 minute' then raise exception 'Result time cannot be in the future'; end if;

  select * into v_prev from lab_tests where id = v_id for update;
  if found and v_prev.status = v_status and v_prev.requested_at is not distinct from v_req and v_prev.result_at is not distinct from v_res
     and v_prev.notes = coalesce(p ->> 'notes', '') and v_prev.test_type = v_type then
    raise exception 'No changes to save';
  end if;

  insert into lab_tests (id, case_id, test_type, linked_measure, status, requested_at, result_at, notes, updated_by)
  values (v_id, v_case, v_type,
          case when v_type ~* 'lactate' then 'lactate'::measure_key when v_type ~* 'blood\s*culture' then 'blood_cultures'::measure_key end,
          v_status, v_req, v_res, coalesce(p ->> 'notes', ''), auth.uid())
  on conflict (id) do update set
    test_type = excluded.test_type, linked_measure = excluded.linked_measure, status = excluded.status,
    requested_at = excluded.requested_at, result_at = excluded.result_at, notes = excluded.notes,
    updated_at = now(), updated_by = auth.uid();

  update cases set updated_at = now() where id = v_case;
  perform write_audit(case when v_prev.id is null then 'lab.create' else 'lab.update' end, 'lab', v_id::text, v_case,
                      v_type || ': ' || coalesce(v_prev.status::text, 'new') || ' → ' || v_status);
  if v_status = 'result_available' then
    perform emit_event('lab_result_available', v_case, 'lab_result:' || v_id || ':' || v_res);
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------- inpatient updates
create function add_case_update(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := coalesce((p ->> 'id')::uuid, gen_random_uuid());
  v_case cases;
  v_dept uuid := (p ->> 'departmentId')::uuid;
  v_to uuid := nullif(p ->> 'transferToId', '')::uuid;
  v_at timestamptz := (p ->> 'updateAt')::timestamptz;
  v_last case_updates;
  v_new_dept uuid;
  v_transferred boolean;
begin
  select * into v_case from cases where id = (p ->> 'caseId')::uuid for update;
  if not found then raise exception 'Case not found'; end if;
  if v_case.status = 'closed' then raise exception 'Case is closed. A Quality Admin must reopen it before new updates.'; end if;
  if not has_role('quality_admin', 'emergency', 'inpatient') then raise exception 'Your role cannot update inpatient status' using errcode = '42501'; end if;
  if not can_act_on_case(v_case.id) then raise exception 'Only the current department (or Quality Admin) can update this case' using errcode = '42501'; end if;
  if coalesce(p ->> 'status', '') = '' then raise exception 'Case Status is required'; end if;
  if v_at is null then raise exception 'Update Date & Time is required'; end if;
  if v_at > now() + interval '1 minute' then raise exception 'Update time cannot be in the future'; end if;
  if v_to = v_dept then raise exception 'Transfer department must differ from the current department'; end if;

  select * into v_last from case_updates where case_id = v_case.id order by created_at desc limit 1;
  if found and v_last.department_id = v_dept and v_last.status = p ->> 'status'
     and trim(v_last.notes) = trim(coalesce(p ->> 'notes', '')) and v_last.transfer_to_id is not distinct from v_to then
    raise exception 'No changes since the last update — nothing saved and no alert sent';
  end if;

  insert into case_updates (id, case_id, department_id, status, update_at, notes, transfer_from_id, transfer_to_id, created_by)
  values (v_id, v_case.id, v_dept, p ->> 'status', v_at, trim(coalesce(p ->> 'notes', '')),
          case when v_to is not null then v_dept end, v_to, auth.uid());

  v_new_dept := coalesce(v_to, v_dept);
  v_transferred := v_to is not null or v_new_dept <> v_case.current_department_id;
  update cases set current_department_id = v_new_dept, current_status = p ->> 'status', updated_at = now() where id = v_case.id;

  perform write_audit('inpatient.update', 'case_update', v_id::text, v_case.id, (p ->> 'status') || case when v_to is not null then ' (transfer)' else '' end);
  perform emit_event(case when v_transferred then 'patient_transferred'::event_type else 'inpatient_update'::event_type end,
                     v_case.id, case when v_transferred then 'transfer:' else 'update:' end || v_id,
                     array[v_dept, v_new_dept, v_case.emergency_department_id]);
  return v_id;
end $$;

-- ---------------------------------------------------------------- outcomes
create function outcome_event(o final_outcome) returns event_type language sql immutable as $$
  select case o when 'discharged' then 'outcome_discharged'::event_type
                when 'dama' then 'outcome_dama'::event_type
                when 'death' then 'outcome_death'::event_type
                else 'case_closed_other'::event_type end
$$;

create function record_outcome(p_case uuid, p_outcome final_outcome, p_at timestamptz, p_notes text default '')
returns void language plpgsql security definer set search_path = public as $$
declare v_case cases;
begin
  select * into v_case from cases where id = p_case for update;
  if not found then raise exception 'Case not found'; end if;
  if v_case.outcome is not null then raise exception 'A final outcome is already recorded. Use Correct Outcome (Quality Admin).'; end if;
  if not has_role('quality_admin', 'emergency', 'inpatient') then raise exception 'Your role cannot record outcomes' using errcode = '42501'; end if;
  if not can_act_on_case(p_case) then raise exception 'Only the current department (or Quality Admin) can record this outcome' using errcode = '42501'; end if;
  if p_at is null then raise exception 'Outcome Date & Time is required'; end if;
  if p_at > now() + interval '1 minute' then raise exception 'Outcome time cannot be in the future'; end if;
  if p_at < v_case.recognition_time then raise exception 'Outcome time cannot be before sepsis recognition'; end if;

  insert into final_outcomes (case_id, outcome, outcome_at, notes, recorded_by) values (p_case, p_outcome, p_at, coalesce(p_notes, ''), auth.uid());
  update cases set outcome = p_outcome, outcome_at = p_at, status = 'closed', current_status = initcap(replace(p_outcome::text, '_', ' ')), updated_at = now() where id = p_case;
  perform write_audit('outcome.record', 'case', p_case::text, p_case, p_outcome::text || ' at ' || p_at);
  perform emit_event(outcome_event(p_outcome), p_case, 'outcome:' || p_case || ':' || p_outcome || ':' || p_at);
end $$;

-- p_outcome NULL = reopen
create function correct_outcome(p_case uuid, p_outcome final_outcome, p_at timestamptz, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_case cases;
begin
  if not has_role('quality_admin') then raise exception 'Only Quality Admin can correct or reopen a finalized outcome' using errcode = '42501'; end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then raise exception 'A documented reason (at least 10 characters) is required'; end if;
  select * into v_case from cases where id = p_case for update;
  if not found then raise exception 'Case not found'; end if;
  if p_outcome is not null and p_at is null then raise exception 'Outcome Date & Time is required'; end if;

  insert into final_outcomes (case_id, outcome, outcome_at, correction_reason, recorded_by) values (p_case, p_outcome, p_at, p_reason, auth.uid());
  if p_outcome is null then
    update cases set outcome = null, outcome_at = null, status = 'active', current_status = 'Reopened', updated_at = now() where id = p_case;
  else
    update cases set outcome = p_outcome, outcome_at = p_at, status = 'closed', current_status = initcap(replace(p_outcome::text, '_', ' ')), updated_at = now() where id = p_case;
    perform emit_event(outcome_event(p_outcome), p_case, 'outcome:' || p_case || ':' || p_outcome || ':' || p_at);
  end if;
  perform write_audit(case when p_outcome is null then 'case.reopen' else 'outcome.correct' end, 'case', p_case::text, p_case,
                      coalesce(v_case.outcome::text, 'none') || ' → ' || coalesce(p_outcome::text, 'reopened') || '. Reason: ' || p_reason);
end $$;

create function correct_case_times(p_case uuid, p_diagnosis timestamptz, p_recognition timestamptz, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_role('quality_admin') then raise exception 'Only Quality Admin can correct clinical times' using errcode = '42501'; end if;
  if trim(coalesce(p_reason, '')) = '' then raise exception 'A reason is required to correct clinical times'; end if;
  if p_recognition is null then raise exception 'Time of Sepsis Recognition is required'; end if;
  update cases set diagnosis_time = p_diagnosis, recognition_time = p_recognition, updated_at = now() where id = p_case;
  perform write_audit('case.correctTimes', 'case', p_case::text, p_case, 'Times corrected. Reason: ' || p_reason);
end $$;

-- ---------------------------------------------------------------- configuration (Quality Admin)
create function save_recipient(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := coalesce((p ->> 'id')::uuid, gen_random_uuid());
  v_channel channel := (p ->> 'channel')::channel;
  v_addr text := case when (p ->> 'channel') = 'email' then lower(trim(p ->> 'address')) else regexp_replace(p ->> 'address', '[\s()-]', '', 'g') end;
  v_existed boolean;
begin
  if not has_role('quality_admin') then raise exception 'Only Quality Admin can manage recipients' using errcode = '42501'; end if;
  if exists (select 1 from notification_recipients where channel = v_channel and address = v_addr and id <> v_id) then
    raise exception 'This address is already registered';
  end if;
  if coalesce(jsonb_array_length(p -> 'eventTypes'), 0) = 0 then raise exception 'Select at least one notification type'; end if;
  v_existed := exists (select 1 from notification_recipients where id = v_id);
  insert into notification_recipients (id, channel, name, address, department_ids, event_types, active)
  values (v_id, v_channel, trim(p ->> 'name'), v_addr,
          coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p -> 'departmentIds') x), '{}'),
          (select array_agg(x::event_type) from jsonb_array_elements_text(p -> 'eventTypes') x),
          coalesce((p ->> 'active')::boolean, true))
  on conflict (id) do update set
    name = excluded.name, address = excluded.address, department_ids = excluded.department_ids,
    event_types = excluded.event_types, active = excluded.active, updated_at = now();
  perform write_audit(case when v_existed then 'recipient.update' else 'recipient.create' end, 'recipient', v_id::text, null, v_channel || ' recipient ' || trim(p ->> 'name'));
  return v_id;
end $$;

-- Recipients with delivery history are deactivated, not deleted (traceability).
create function delete_recipient(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('quality_admin') then raise exception 'Only Quality Admin can manage recipients' using errcode = '42501'; end if;
  if exists (select 1 from notification_deliveries where recipient_id = p_id) then
    update notification_recipients set active = false, updated_at = now() where id = p_id;
    perform write_audit('recipient.deactivate', 'recipient', p_id::text, null, 'Deactivated (has delivery history)');
    return 'deactivated';
  end if;
  delete from notification_recipients where id = p_id;
  perform write_audit('recipient.delete', 'recipient', p_id::text, null, 'Deleted');
  return 'deleted';
end $$;

create function save_rules(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if not has_role('quality_admin') then raise exception 'Only Quality Admin can change notification rules' using errcode = '42501'; end if;
  for r in select * from jsonb_array_elements(p) loop
    insert into notification_rules (event_type, whatsapp, email, in_app)
    values ((r ->> 'eventType')::event_type, (r ->> 'whatsapp')::boolean, (r ->> 'email')::boolean, (r ->> 'inApp')::boolean)
    on conflict (event_type) do update set whatsapp = excluded.whatsapp, email = excluded.email, in_app = excluded.in_app, updated_at = now();
  end loop;
  perform write_audit('rules.update', 'rules', 'all', null, 'Notification rules updated');
end $$;

create function save_setting(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('quality_admin') then raise exception 'Only Quality Admin can change settings' using errcode = '42501'; end if;
  insert into system_settings (key, value, updated_by) values (p_key, p_value, auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  perform write_audit('settings.update', 'settings', p_key, null, p_value::text);
end $$;

create function save_department(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce((p ->> 'id')::uuid, gen_random_uuid());
begin
  if not has_role('quality_admin') then raise exception 'Only Quality Admin can manage departments' using errcode = '42501'; end if;
  insert into departments (id, name, kind, active) values (v_id, trim(p ->> 'name'), (p ->> 'kind')::department_kind, coalesce((p ->> 'active')::boolean, true))
  on conflict (id) do update set name = excluded.name, kind = excluded.kind, active = excluded.active;
  perform write_audit('department.save', 'department', v_id::text, null, trim(p ->> 'name'));
  return v_id;
end $$;

create function resend_delivery(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('quality_admin') then raise exception 'Only Quality Admin can resend notifications' using errcode = '42501'; end if;
  update notification_deliveries set status = 'retrying', error = null, next_attempt_at = now(), locked_until = null
  where id = p_id and status in ('failed', 'not_sent');
  if not found then raise exception 'Only failed or unsent notifications can be resent'; end if;
  perform write_audit('notification.resend', 'delivery', p_id::text, null, 'Manual resend');
end $$;

create function send_test_message(p_recipient uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_event uuid; r notification_recipients;
begin
  if not has_role('quality_admin') then raise exception 'Only Quality Admin can send test messages' using errcode = '42501'; end if;
  select * into r from notification_recipients where id = p_recipient;
  if not found then raise exception 'Recipient not found'; end if;
  insert into notification_events (event_type, dedupe_key, is_test, created_by)
  values ('case_registered', 'test:' || p_recipient || ':' || clock_timestamp(), true, auth.uid()) returning id into v_event;
  insert into notification_deliveries (event_id, recipient_id, recipient_name, address, channel) values (v_event, r.id, r.name, r.address, r.channel);
  perform write_audit('notification.test', 'recipient', r.id::text, null, 'Test ' || r.channel || ' message to ' || r.name);
  return v_event;
end $$;

create function mark_notifications_read(p_ids uuid[]) returns void
language sql security definer set search_path = public as $$
  insert into in_app_reads (notification_id, profile_id)
  select unnest(p_ids), auth.uid() where auth.uid() is not null
  on conflict do nothing
$$;

create function save_lab_test_types(p_names text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('quality_admin') then raise exception 'Only Quality Admin can change settings' using errcode = '42501'; end if;
  update lab_test_types set active = (name = any (p_names));
  insert into lab_test_types (name) select trim(n) from unnest(p_names) n where trim(n) <> '' on conflict (name) do update set active = true;
  perform write_audit('settings.labTestTypes', 'settings', 'lab_test_types', null, array_to_string(p_names, ', '));
end $$;

create function log_report_export(p_report text, p_detail text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('quality_admin', 'leadership') then raise exception 'Export not permitted for your role' using errcode = '42501'; end if;
  perform write_audit('report.export', 'report', p_report, null, p_detail);
end $$;

-- ---------------------------------------------------------------- worker functions (service role only)
-- Claim due deliveries with SKIP LOCKED so concurrent workers never send twice.
create function claim_deliveries(p_limit int default 25) returns setof notification_deliveries
language sql security definer set search_path = public as $$
  update notification_deliveries d set locked_until = now() + interval '2 minutes', attempts = d.attempts + 1
  where d.id in (
    select id from notification_deliveries
    where status in ('queued', 'retrying') and next_attempt_at <= now() and (locked_until is null or locked_until < now())
    order by next_attempt_at
    limit p_limit
    for update skip locked
  )
  returning d.*
$$;

-- ---------------------------------------------------------------- Row Level Security
alter table departments enable row level security;
alter table profiles enable row level security;
alter table profile_departments enable row level security;
alter table case_sequences enable row level security;
alter table cases enable row level security;
alter table patient_identifiers enable row level security;
alter table bundle_assessments enable row level security;
alter table bundle_measures enable row level security;
alter table lab_test_types enable row level security;
alter table lab_tests enable row level security;
alter table case_updates enable row level security;
alter table final_outcomes enable row level security;
alter table notification_recipients enable row level security;
alter table notification_rules enable row level security;
alter table notification_events enable row level security;
alter table notification_deliveries enable row level security;
alter table in_app_notifications enable row level security;
alter table in_app_reads enable row level security;
alter table audit_logs enable row level security;
alter table system_settings enable row level security;

-- Reads: any active signed-in staff can read de-identified case data (needed for
-- dashboards and cross-department follow-up). All writes go through the functions above.
create policy read_departments on departments for select to authenticated using (current_role_name() is not null);
create policy read_profiles on profiles for select to authenticated using (id = auth.uid() or has_role('quality_admin'));
create policy read_profile_departments on profile_departments for select to authenticated using (profile_id = auth.uid() or has_role('quality_admin'));
create policy read_cases on cases for select to authenticated using (current_role_name() is not null);
create policy read_identifiers on patient_identifiers for select to authenticated using (has_role('quality_admin', 'emergency', 'inpatient'));
create policy read_bundles on bundle_assessments for select to authenticated using (current_role_name() is not null);
create policy read_measures on bundle_measures for select to authenticated using (current_role_name() is not null);
create policy read_lab_types on lab_test_types for select to authenticated using (current_role_name() is not null);
create policy read_labs on lab_tests for select to authenticated using (current_role_name() is not null);
create policy read_updates on case_updates for select to authenticated using (current_role_name() is not null);
create policy read_outcomes on final_outcomes for select to authenticated using (current_role_name() is not null);
create policy read_rules on notification_rules for select to authenticated using (current_role_name() is not null);
create policy read_recipients on notification_recipients for select to authenticated using (has_role('quality_admin'));
create policy read_events on notification_events for select to authenticated using (current_role_name() is not null);
create policy read_deliveries on notification_deliveries for select to authenticated using (has_role('quality_admin'));
create policy read_in_app on in_app_notifications for select to authenticated using (current_role_name() is not null);
create policy read_in_app_reads on in_app_reads for select to authenticated using (profile_id = auth.uid());
create policy read_audit on audit_logs for select to authenticated using (has_role('quality_admin'));
create policy read_settings on system_settings for select to authenticated using (current_role_name() is not null);

-- No direct INSERT/UPDATE/DELETE policies exist for `authenticated`, so RLS denies
-- direct writes. Revoke anonymous access entirely and limit function execution.
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon, public;
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
grant execute on function register_case(jsonb, boolean), save_bundle(uuid, jsonb), save_lab(jsonb), add_case_update(jsonb),
  record_outcome(uuid, final_outcome, timestamptz, text), correct_outcome(uuid, final_outcome, timestamptz, text),
  correct_case_times(uuid, timestamptz, timestamptz, text), save_recipient(jsonb), delete_recipient(uuid), save_rules(jsonb),
  save_setting(text, jsonb), save_department(jsonb), save_lab_test_types(text[]), log_report_export(text, text), resend_delivery(uuid), send_test_message(uuid), mark_notifications_read(uuid[]),
  current_role_name(), has_role(app_role[]), in_my_departments(uuid), can_act_on_case(uuid)
  to authenticated;
-- emit_event and claim_deliveries are for the server worker (service_role) only.
grant execute on function emit_event(event_type, uuid, text, uuid[], boolean), claim_deliveries(int) to service_role;
-- The server worker uses the service role (Supabase grants this by default; stated explicitly here).
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
