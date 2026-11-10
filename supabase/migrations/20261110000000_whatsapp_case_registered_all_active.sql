-- All active WhatsApp recipients receive new Sepsis case alerts, regardless of department
-- or event subscription. Other events retain existing routing preferences.
-- This migration is idempotent and preserves existing cases and recipients.
create or replace function emit_event(p_type event_type, p_case uuid, p_dedupe text, p_dept_ids uuid[] default null, p_is_test boolean default false)
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
    and (p_type = any (r.event_types) or (p_type = 'case_registered' and r.channel = 'whatsapp'))
    and ((r.channel = 'whatsapp' and v_rule.whatsapp) or (r.channel = 'email' and v_rule.email))
    and ( (p_type = 'case_registered' and r.channel = 'whatsapp')
          or cardinality(r.department_ids) = 0
          or r.department_ids && v_depts )
  on conflict do nothing;

  return v_event;
end $$;
