// Loads the application state from Supabase (RLS applies to the caller) and maps
// snake_case rows to the camelCase domain types used throughout the UI.
import type { SupabaseClient } from "@supabase/supabase-js";
import { emptyState, STATE_VERSION, type State } from "@/lib/engine";
import { emptyMeasure } from "@/lib/bundle";
import type { BundleAssessment, MeasureKey, SystemSettings } from "@/lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export async function loadState(sb: SupabaseClient, opts: { auditLimit?: number; deliveryLimit?: number } = {}): Promise<State> {
  const q = async (p: PromiseLike<{ data: Row[] | null; error: { message: string } | null }>) => {
    const { data, error } = await p;
    if (error) throw new Error(error.message);
    return data ?? [];
  };
  const [departments, profiles, profDepts, cases, identifiers, bundles, measures, labs, updates, recipients, rules, events, deliveries, inApp, reads, audit, settings, labTypes] =
    await Promise.all([
      q(sb.from("departments").select("*").order("name")),
      q(sb.from("profiles").select("*")),
      q(sb.from("profile_departments").select("*")),
      q(sb.from("cases").select("*").order("created_at", { ascending: false })),
      q(sb.from("patient_identifiers").select("case_id, mrn, patient_name")),
      q(sb.from("bundle_assessments").select("*")),
      q(sb.from("bundle_measures").select("*")),
      q(sb.from("lab_tests").select("*")),
      q(sb.from("case_updates").select("*")),
      q(sb.from("notification_recipients").select("*")),
      q(sb.from("notification_rules").select("*")),
      q(sb.from("notification_events").select("*").order("created_at", { ascending: false }).limit(2000)),
      q(sb.from("notification_deliveries").select("*").order("queued_at", { ascending: false }).limit(opts.deliveryLimit ?? 2000)),
      q(sb.from("in_app_notifications").select("*").order("created_at", { ascending: false }).limit(500)),
      q(sb.from("in_app_reads").select("*")),
      q(sb.from("audit_logs").select("*").order("at", { ascending: false }).limit(opts.auditLimit ?? 1000)),
      q(sb.from("system_settings").select("*")),
      q(sb.from("lab_test_types").select("*").eq("active", true).order("name")),
    ]);

  const base = emptyState();
  const setting = (k: string) => settings.find((s) => s.key === k)?.value;
  const sys: SystemSettings = {
    reminders: { ...base.settings.reminders, ...(setting("reminders") ?? {}) },
    appBaseUrl: setting("appBaseUrl") ?? base.settings.appBaseUrl,
    complianceRulesApproved: !!setting("complianceRulesApproved"),
  };

  return {
    ...base,
    version: STATE_VERSION,
    departments: departments.map((d) => ({ id: d.id, name: d.name, kind: d.kind, active: d.active })),
    users: profiles.map((p) => ({ id: p.id, name: p.full_name, role: p.role, departmentIds: profDepts.filter((x) => x.profile_id === p.id).map((x) => x.department_id) })),
    cases: cases.map((c) => ({
      id: c.id,
      caseNo: c.case_no,
      age: c.age === null ? null : Number(c.age),
      ageUnit: c.age_unit,
      sex: c.sex ?? "",
      patientCategory: c.patient_category ?? "",
      consultant: c.consultant,
      caseDate: c.case_date,
      emergencyDepartmentId: c.emergency_department_id,
      currentDepartmentId: c.current_department_id,
      diagnosisTime: c.diagnosis_time,
      recognitionTime: c.recognition_time,
      arrivalTime: c.arrival_time ?? null,
      physicianName: c.physician_name,
      status: c.status,
      currentStatus: c.current_status,
      outcome: c.outcome,
      outcomeAt: c.outcome_at,
      createdAt: c.created_at,
      createdBy: c.created_by,
      updatedAt: c.updated_at,
    })),
    identifiers: identifiers.map((i) => ({ caseId: i.case_id, mrn: i.mrn, patientName: i.patient_name })),
    bundles: bundles.map((b): BundleAssessment => {
      const ms = Object.fromEntries(
        (["lactate", "blood_cultures", "antibiotics", "iv_fluids", "vasopressors"] as MeasureKey[]).map((k) => {
          const m = measures.find((x) => x.case_id === b.case_id && x.measure === k);
          return [k, m ? { key: k, answer: m.answer, applicability: m.applicability, informationMissing: m.information_missing, note: m.note } : emptyMeasure(k)];
        }),
      ) as BundleAssessment["measures"];
      return {
        caseId: b.case_id,
        measures: ms,
        hypotensionOccurred: b.hypotension_occurred,
        completionTime: b.completion_time,
        clinicianAllWithin1h: b.clinician_all_within_1h,
        physicianName: b.physician_name,
        documentedAt: b.documented_at,
        reviewNote: b.review_note,
        reviewedBy: b.reviewed_by,
        reviewOverride: b.review_override,
        updatedAt: b.updated_at,
        updatedBy: b.updated_by,
      };
    }),
    labs: labs.map((l) => ({
      id: l.id,
      caseId: l.case_id,
      testType: l.test_type,
      linkedMeasure: l.linked_measure,
      status: l.status,
      requestedAt: l.requested_at,
      resultAt: l.result_at,
      notes: l.notes,
      updatedAt: l.updated_at,
      updatedBy: l.updated_by,
    })),
    updates: updates.map((u) => ({
      id: u.id,
      caseId: u.case_id,
      departmentId: u.department_id,
      status: u.status,
      updateAt: u.update_at,
      notes: u.notes,
      transferFromId: u.transfer_from_id,
      transferToId: u.transfer_to_id,
      createdAt: u.created_at,
      createdBy: u.created_by,
    })),
    recipients: recipients.map((r) => ({
      id: r.id,
      channel: r.channel,
      name: r.name,
      address: r.address,
      departmentIds: r.department_ids ?? [],
      eventTypes: r.event_types ?? [],
      active: r.active,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    rules: rules.length ? base.rules.map((d) => {
      const r = rules.find((x) => x.event_type === d.eventType);
      return r ? { eventType: d.eventType, whatsapp: r.whatsapp, email: r.email, inApp: r.in_app } : d;
    }) : base.rules,
    events: events.map((e) => ({
      id: e.id,
      eventType: e.event_type,
      caseId: e.case_id,
      caseNo: e.case_no,
      departmentId: e.department_id,
      dedupeKey: e.dedupe_key,
      isTest: e.is_test,
      createdAt: e.created_at,
      createdBy: e.created_by,
    })),
    deliveries: deliveries.map((d) => ({
      id: d.id,
      eventId: d.event_id,
      recipientId: d.recipient_id,
      recipientName: d.recipient_name,
      address: d.address,
      channel: d.channel,
      status: d.status,
      queuedAt: d.queued_at,
      sentAt: d.sent_at,
      deliveredAt: d.delivered_at,
      attempts: d.attempts,
      error: d.error,
      providerMessageId: d.provider_message_id,
    })),
    inApp: inApp.map((n) => ({
      id: n.id,
      eventId: n.event_id,
      eventType: n.event_type,
      caseId: n.case_id,
      title: n.title,
      body: n.body,
      createdAt: n.created_at,
      readBy: reads.filter((r) => r.notification_id === n.id).map((r) => r.profile_id),
    })),
    audit: audit.map((a) => ({
      id: String(a.id),
      at: a.at,
      userId: a.user_id ?? "",
      userName: a.user_name ?? "system",
      action: a.action,
      entity: a.entity,
      entityId: a.entity_id,
      caseId: a.case_id,
      detail: a.detail,
    })),
    settings: sys,
    labTestTypes: labTypes.length ? labTypes.map((t) => t.name) : base.labTestTypes,
  };
}
