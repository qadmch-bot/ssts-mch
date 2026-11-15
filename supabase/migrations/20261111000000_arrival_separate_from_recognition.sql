-- Apply in Supabase SQL Editor before deploying the updated registration form.
-- Patient arrival and clinical sepsis recognition are distinct timestamps.
alter table public.cases add column if not exists arrival_time timestamptz;
alter table public.cases alter column recognition_time drop not null;
-- Historical recognition values are preserved; arrival is never backfilled from recognition.
create or replace function register_case(p jsonb, p_confirm_duplicate boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := coalesce((p ->> 'id')::uuid, gen_random_uuid());
  v_year int := extract(year from (now() at time zone 'Asia/Riyadh'))::int;
  v_seq int;
  v_case_no text;
  v_dup text;
  v_recog timestamptz := (p ->> 'recognitionTime')::timestamptz;
  v_arrival timestamptz := (p ->> 'arrivalTime')::timestamptz;
  v_diag timestamptz := (p ->> 'diagnosisTime')::timestamptz;
  m measure_key;
begin
  if not has_role('quality_admin', 'emergency') then
    raise exception 'Only Emergency Department users and Quality Admin can register cases' using errcode = '42501';
  end if;
  if coalesce(trim(p ->> 'mrn'), '') = '' then raise exception 'MRN is required'; end if;
  if coalesce(trim(p ->> 'patientName'), '') = '' then raise exception 'Patient name is required'; end if;
  if coalesce(trim(p ->> 'physicianName'), '') = '' then raise exception 'Physician Name is required'; end if;
  if v_arrival is null then raise exception 'Arrival Time is required'; end if;
  if v_arrival > now() + interval '1 minute' then raise exception 'Arrival Time cannot be in the future'; end if;
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
                     emergency_department_id, current_department_id, diagnosis_time, recognition_time, arrival_time,
                     physician_name, created_by)
  values (v_id, v_case_no, (p ->> 'age')::numeric, coalesce(p ->> 'ageUnit', 'years'), nullif(p ->> 'sex', ''),
          nullif(p ->> 'patientCategory', ''), coalesce(p ->> 'consultant', ''), (p ->> 'caseDate')::date,
          (p ->> 'emergencyDepartmentId')::uuid, (p ->> 'currentDepartmentId')::uuid, v_diag, v_recog, v_arrival,
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

