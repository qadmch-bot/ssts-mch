-- STAGED SECURITY MIGRATION. Apply only after reviewing department assignments and testing with test accounts.
-- This migration does NOT create passwords or Supabase Auth users.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'ipc';
-- IMPORTANT: PostgreSQL may require the enum addition to commit before running
-- the statements below. Execute the remaining statements in a separate query.

-- Scoped visibility: Quality can view all; Emergency sees its own origin/current cases;
-- Laboratory and IPC see de-identified cases across departments for surveillance.
CREATE OR REPLACE FUNCTION public.can_read_case(p_case uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.has_role('quality_admin','laboratory','ipc','leadership')
 OR EXISTS (
   SELECT 1 FROM public.cases c
   WHERE c.id=p_case
     AND ((public.has_role('emergency') AND (public.in_my_departments(c.emergency_department_id) OR public.in_my_departments(c.current_department_id)))
       OR (public.has_role('inpatient') AND public.in_my_departments(c.current_department_id)))
 );
$$;
DROP POLICY IF EXISTS read_cases ON public.cases;
CREATE POLICY read_cases ON public.cases FOR SELECT TO authenticated USING (public.can_read_case(id));
DROP POLICY IF EXISTS read_identifiers ON public.patient_identifiers;
CREATE POLICY read_identifiers ON public.patient_identifiers FOR SELECT TO authenticated
 USING (public.has_role('quality_admin') OR
  ((public.has_role('emergency','inpatient')) AND public.can_read_case(case_id)));
DROP POLICY IF EXISTS read_bundles ON public.bundle_assessments;
CREATE POLICY read_bundles ON public.bundle_assessments FOR SELECT TO authenticated USING (public.can_read_case(case_id));
DROP POLICY IF EXISTS read_measures ON public.bundle_measures;
CREATE POLICY read_measures ON public.bundle_measures FOR SELECT TO authenticated USING (public.can_read_case(case_id));
DROP POLICY IF EXISTS read_labs ON public.lab_tests;
CREATE POLICY read_labs ON public.lab_tests FOR SELECT TO authenticated USING (public.can_read_case(case_id));
DROP POLICY IF EXISTS read_updates ON public.case_updates;
CREATE POLICY read_updates ON public.case_updates FOR SELECT TO authenticated USING (public.can_read_case(case_id));
DROP POLICY IF EXISTS read_outcomes ON public.final_outcomes;
CREATE POLICY read_outcomes ON public.final_outcomes FOR SELECT TO authenticated USING (public.can_read_case(case_id));
-- Department names and lab test definitions remain readable for form controls.
-- Quality Admin retains complete access to all clinical data and settings.
GRANT EXECUTE ON FUNCTION public.can_read_case(uuid) TO authenticated;
