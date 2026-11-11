-- Execute in Supabase SQL Editor before deploying the case deletion UI.
-- Only Quality Admin can remove an erroneous/test case. Audit records are immutable.
create or replace function public.delete_erroneous_case(p_case uuid, p_case_no text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_case_no text;
begin
  if not public.has_role('quality_admin') then
    raise exception 'Only Quality Admin can delete a case' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'A deletion reason of at least 10 characters is required';
  end if;
  select case_no into v_case_no from public.cases where id = p_case for update;
  if v_case_no is null then raise exception 'Case not found'; end if;
  if v_case_no is distinct from p_case_no then raise exception 'Case number confirmation does not match'; end if;
  -- Preserve immutable audit and notification delivery records. Case-linked clinical records cascade.
  -- Notifications retain the original case number, but no longer reference a live case.
  perform public.write_audit('case.delete_erroneous', 'case', p_case::text, p_case,
    'Deleted erroneous/test case ' || v_case_no || ': ' || trim(p_reason));
  delete from public.cases where id = p_case;
end $$;
revoke all on function public.delete_erroneous_case(uuid,text,text) from public;
grant execute on function public.delete_erroneous_case(uuid,text,text) to authenticated;
