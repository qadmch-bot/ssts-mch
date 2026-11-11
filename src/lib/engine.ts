// Pure workflow engine. Every action takes the current state + a context (user, clock)
// and returns a new state. This mirrors the Postgres RPC functions in
// supabase/migrations so the demo and production behave the same way.

import { DEFAULT_LAB_TEST_TYPES, DEFAULT_RULES, EVENT_LABELS, OUTCOME_LABELS, PRIMARY_OUTCOMES } from "./constants";
import { emptyAssessment, evaluateCompliance } from "./bundle";
import { buildMessage, isE164, isEmail, normalizeAddress, planDeliveries, stableHash, toE164 } from "./notify";
import type {
  AgeUnit,
  AppUser,
  AuditEntry,
  BundleAssessment,
  CaseUpdate,
  Channel,
  Department,
  DeliveryAttempt,
  EventType,
  FinalOutcomeType,
  InAppNotification,
  LabStatus,
  LabTest,
  MeasureKey,
  NotificationEvent,
  NotificationRule,
  PatientCategory,
  PatientIdentifiers,
  Recipient,
  SepsisCase,
  Sex,
  SystemSettings,
} from "./types";
import { toRiyadhInput } from "./time";

export interface State {
  version: number;
  departments: Department[];
  users: AppUser[];
  cases: SepsisCase[];
  identifiers: PatientIdentifiers[];
  bundles: BundleAssessment[];
  labs: LabTest[];
  updates: CaseUpdate[];
  recipients: Recipient[];
  rules: NotificationRule[];
  events: NotificationEvent[];
  deliveries: DeliveryAttempt[];
  inApp: InAppNotification[];
  audit: AuditEntry[];
  settings: SystemSettings;
  labTestTypes: string[];
  caseSeq: Record<string, number>;
  /** Whether real providers are configured. In demo mode this is always false. */
  providersConfigured: { whatsapp: boolean; email: boolean };
}

export const STATE_VERSION = 3;

export interface Ctx {
  user: AppUser;
  now: string;
  newId?: () => string;
}

export type Result<T = unknown> = { ok: true; state: State; value: T; warning?: string } | { ok: false; error: string; state: State };

const uid = (ctx: Ctx) => (ctx.newId ? ctx.newId() : crypto.randomUUID());

export function emptyState(): State {
  return {
    version: STATE_VERSION,
    departments: [],
    users: [],
    cases: [],
    identifiers: [],
    bundles: [],
    labs: [],
    updates: [],
    recipients: [],
    rules: DEFAULT_RULES.map((r) => ({ ...r })),
    events: [],
    deliveries: [],
    inApp: [],
    audit: [],
    settings: {
      reminders: {
        bundleApproachingMinutes: 45,
        bundleOverdueMinutes: 60,
        labOverdueHours: 6,
        inpatientUpdateOverdueHours: 24,
        outcomePendingDays: 7,
        approvedByLeadership: false,
      },
      appBaseUrl: "https://ssts.example.org",
      complianceRulesApproved: false,
    },
    labTestTypes: [...DEFAULT_LAB_TEST_TYPES],
    caseSeq: {},
    providersConfigured: { whatsapp: false, email: false },
  };
}

const fail = (state: State, error: string): Result<never> => ({ ok: false, error, state });

function audit(s: State, ctx: Ctx, action: string, entity: string, entityId: string, caseId: string | null, detail: string): State {
  const e: AuditEntry = { id: uid(ctx), at: ctx.now, userId: ctx.user.id, userName: ctx.user.name, action, entity, entityId, caseId, detail };
  return { ...s, audit: [e, ...s.audit] };
}

export function deptName(s: State, id: string | null | undefined) {
  return s.departments.find((d) => d.id === id)?.name ?? "—";
}

// ---------------------------------------------------------------- events

export interface EmitInput {
  eventType: EventType;
  caseId: string | null;
  dedupeKey: string;
  departmentIds?: (string | null)[];
  isTest?: boolean;
}

/** Idempotent: an event with an existing dedupe key is ignored. */
export function emit(s: State, ctx: Ctx, input: EmitInput): { state: State; event: NotificationEvent | null } {
  if (s.events.some((e) => e.dedupeKey === input.dedupeKey)) return { state: s, event: null };
  const rule = s.rules.find((r) => r.eventType === input.eventType);
  const c = input.caseId ? s.cases.find((x) => x.id === input.caseId) : undefined;
  const departmentId = c?.currentDepartmentId ?? null;
  const ev: NotificationEvent = {
    id: uid(ctx),
    eventType: input.eventType,
    caseId: c?.id ?? null,
    caseNo: c?.caseNo ?? null,
    departmentId,
    dedupeKey: input.dedupeKey,
    isTest: !!input.isTest,
    createdAt: ctx.now,
    createdBy: ctx.user.id,
  };
  let next: State = { ...s, events: [ev, ...s.events] };
  if (!rule) return { state: next, event: ev };

  const msg = buildMessage({
    eventType: ev.eventType,
    caseNo: ev.caseNo,
    departmentName: departmentId ? deptName(s, departmentId) : null,
    caseUrl: c ? `${s.settings.appBaseUrl}/cases/view?id=${c.id}` : null,
  });

  if (rule.inApp) {
    const n: InAppNotification = {
      id: uid(ctx),
      eventId: ev.id,
      eventType: ev.eventType,
      caseId: ev.caseId,
      title: EVENT_LABELS[ev.eventType],
      body: `${ev.caseNo ? ev.caseNo + " · " : ""}${departmentId ? deptName(s, departmentId) + " · " : ""}${msg.status}`,
      createdAt: ctx.now,
      readBy: [],
    };
    next = { ...next, inApp: [n, ...next.inApp] };
  }

  const depts = input.departmentIds ?? [departmentId, c?.emergencyDepartmentId ?? null];
  const planned = planDeliveries(ev.eventType, depts, s.rules, s.recipients);
  const deliveries: DeliveryAttempt[] = planned.map((p) => ({
    id: uid(ctx),
    eventId: ev.id,
    recipientId: p.recipient.id,
    recipientName: p.recipient.name,
    address: p.recipient.address,
    channel: p.channel,
    status: "queued",
    queuedAt: ctx.now,
    sentAt: null,
    deliveredAt: null,
    attempts: 0,
    error: null,
    providerMessageId: null,
  }));
  next = { ...next, deliveries: [...deliveries, ...next.deliveries] };
  return { state: dispatchDemo(next), event: ev };
}

/**
 * Demo-mode dispatcher. Without a configured provider nothing is sent, and the log
 * says so honestly. In production the server worker (/api/notifications/dispatch)
 * sends queued deliveries and records real provider responses.
 */
export function dispatchDemo(s: State): State {
  return {
    ...s,
    deliveries: s.deliveries.map((d) => {
      if (d.status !== "queued" && d.status !== "retrying") return d;
      const configured = s.providersConfigured[d.channel];
      if (configured) return d; // left for the real worker
      return {
        ...d,
        status: "not_sent",
        attempts: d.attempts + 1,
        error: `${d.channel === "whatsapp" ? "WhatsApp" : "Email"} provider not configured (demo mode) — message was not sent`,
      };
    }),
  };
}

export function resendDelivery(s: State, ctx: Ctx, deliveryId: string): Result<DeliveryAttempt> {
  const d = s.deliveries.find((x) => x.id === deliveryId);
  if (!d) return fail(s, "Delivery not found");
  if (!["failed", "not_sent"].includes(d.status)) return fail(s, "Only failed or unsent notifications can be resent");
  let next: State = { ...s, deliveries: s.deliveries.map((x) => (x.id === deliveryId ? { ...x, status: "retrying" as const, error: null } : x)) };
  next = audit(next, ctx, "notification.resend", "delivery", deliveryId, null, `Manual resend to ${d.recipientName} via ${d.channel}`);
  next = dispatchDemo(next);
  return { ok: true, state: next, value: next.deliveries.find((x) => x.id === deliveryId)! };
}

// ---------------------------------------------------------------- cases

export interface NewCaseInput {
  mrn: string;
  patientName: string;
  age: number | null;
  ageUnit: AgeUnit;
  sex: Sex | "";
  patientCategory: PatientCategory | "";
  consultant: string;
  caseDate: string;
  emergencyDepartmentId: string;
  diagnosisTime: string | null;
  recognitionTime: string | null;
  currentDepartmentId: string;
  physicianName: string;
  confirmDuplicate?: boolean;
}

export function validateNewCase(input: NewCaseInput, now: string): string[] {
  const errs: string[] = [];
  if (!input.mrn.trim()) errs.push("MRN is required");
  else if (!/^[A-Za-z0-9-]{3,20}$/.test(input.mrn.trim())) errs.push("MRN must be 3–20 letters, digits or dashes");
  if (!input.patientName.trim()) errs.push("Patient name is required");
  if (input.age === null || isNaN(input.age) || input.age < 0) errs.push("Age is required");
  else if (input.ageUnit === "years" && input.age > 120) errs.push("Age is not valid");
  if (!input.sex) errs.push("Sex is required");
  if (!input.caseDate) errs.push("Date is required");
  if (!input.emergencyDepartmentId) errs.push("Emergency Department is required");
  if (!input.currentDepartmentId) errs.push("Current Department is required");
  if (!input.physicianName.trim()) errs.push("Physician Name is required");
  if (!input.recognitionTime) errs.push("Time of Sepsis Recognition is required (starts the Hour-1 timer)");
  if (input.recognitionTime && new Date(input.recognitionTime) > new Date(now)) errs.push("Time of Sepsis Recognition cannot be in the future");
  if (input.diagnosisTime && new Date(input.diagnosisTime) > new Date(now)) errs.push("Diagnosis Time cannot be in the future");
  return errs;
}

export function findDuplicate(s: State, mrn: string) {
  const ids = s.identifiers.filter((i) => i.mrn.trim().toUpperCase() === mrn.trim().toUpperCase()).map((i) => i.caseId);
  return s.cases.find((c) => ids.includes(c.id) && c.status === "active");
}

export function registerCase(s: State, ctx: Ctx, input: NewCaseInput): Result<SepsisCase> {
  const errs = validateNewCase(input, ctx.now);
  if (errs.length) return fail(s, errs.join(". "));
  const dup = findDuplicate(s, input.mrn);
  if (dup && !input.confirmDuplicate) return fail(s, `DUPLICATE:${dup.caseNo}`);

  const year = toRiyadhInput(ctx.now).slice(0, 4);
  const seq = (s.caseSeq[year] ?? 0) + 1;
  const caseNo = `SEP-${year}-${String(seq).padStart(4, "0")}`;
  const c: SepsisCase = {
    id: uid(ctx),
    caseNo,
    age: input.age,
    ageUnit: input.ageUnit,
    sex: input.sex,
    patientCategory: input.patientCategory,
    consultant: input.consultant.trim(),
    caseDate: input.caseDate,
    emergencyDepartmentId: input.emergencyDepartmentId,
    currentDepartmentId: input.currentDepartmentId,
    diagnosisTime: input.diagnosisTime,
    recognitionTime: input.recognitionTime,
    physicianName: input.physicianName.trim(),
    status: "active",
    currentStatus: "In Emergency",
    outcome: null,
    outcomeAt: null,
    createdAt: ctx.now,
    createdBy: ctx.user.id,
    updatedAt: ctx.now,
  };
  const bundle = emptyAssessment(c.id, ctx.user.id);
  bundle.physicianName = c.physicianName;
  let next: State = {
    ...s,
    caseSeq: { ...s.caseSeq, [year]: seq },
    cases: [c, ...s.cases],
    identifiers: [...s.identifiers, { caseId: c.id, mrn: input.mrn.trim(), patientName: input.patientName.trim() }],
    bundles: [...s.bundles, bundle],
  };
  next = audit(next, ctx, "case.register", "case", c.id, c.id, `Registered ${caseNo}${dup ? ` (duplicate MRN confirmed; open case ${dup.caseNo})` : ""}`);
  next = emit(next, ctx, { eventType: "case_registered", caseId: c.id, dedupeKey: `case_registered:${c.id}` }).state;
  return { ok: true, state: next, value: c, warning: dup ? `Registered despite open case ${dup.caseNo} with the same MRN` : undefined };
}

/** Delete an erroneous/test case; retain audit and sent-message history. */
export function deleteErroneousCase(s: State, ctx: Ctx, caseId: string, reason: string): Result<null> {
  if (ctx.user.role !== "quality_admin") return fail(s, "Only Quality Admin can delete a case");
  const c = s.cases.find((x) => x.id === caseId);
  if (!c) return fail(s, "Case not found");
  if (reason.trim().length < 10) return fail(s, "Deletion reason must contain at least 10 characters");
  let next: State = {
    ...s,
    cases: s.cases.filter((x) => x.id !== caseId),
    identifiers: s.identifiers.filter((x) => x.caseId !== caseId),
    bundles: s.bundles.filter((x) => x.caseId !== caseId),
    labs: s.labs.filter((x) => x.caseId !== caseId),
    updates: s.updates.filter((x) => x.caseId !== caseId),
    events: s.events.map((e) => e.caseId === caseId ? { ...e, caseId: null } : e),
    inApp: s.inApp.filter((n) => n.caseId !== caseId),
  };
  next = audit(next, ctx, "case.delete_erroneous", "case", c.id, c.id, `Deleted erroneous/test case ${c.caseNo}: ${reason.trim()}`);
  return { ok: true, state: next, value: null };
}

export function updateCaseTimes(
  s: State,
  ctx: Ctx,
  caseId: string,
  patch: { diagnosisTime?: string | null; recognitionTime?: string | null; reason: string },
): Result<SepsisCase> {
  const c = s.cases.find((x) => x.id === caseId);
  if (!c) return fail(s, "Case not found");
  if (!patch.reason.trim()) return fail(s, "A reason is required to correct clinical times");
  const updated = { ...c, ...("diagnosisTime" in patch ? { diagnosisTime: patch.diagnosisTime ?? null } : {}), ...("recognitionTime" in patch ? { recognitionTime: patch.recognitionTime ?? null } : {}), updatedAt: ctx.now };
  let next: State = { ...s, cases: s.cases.map((x) => (x.id === caseId ? updated : x)) };
  next = audit(next, ctx, "case.correctTimes", "case", caseId, caseId, `Times corrected. Reason: ${patch.reason}`);
  return { ok: true, state: next, value: updated };
}

// ---------------------------------------------------------------- bundle

export type BundlePatch = Partial<Omit<BundleAssessment, "caseId" | "measures" | "updatedAt" | "updatedBy">> & {
  measures?: Partial<Record<MeasureKey, Partial<BundleAssessment["measures"][MeasureKey]>>>;
};

export function saveBundle(s: State, ctx: Ctx, caseId: string, patch: BundlePatch): Result<BundleAssessment> {
  const c = s.cases.find((x) => x.id === caseId);
  if (!c) return fail(s, "Case not found");
  const prev = s.bundles.find((b) => b.caseId === caseId) ?? emptyAssessment(caseId, ctx.user.id);
  const measures = { ...prev.measures };
  for (const [k, v] of Object.entries(patch.measures ?? {})) {
    measures[k as MeasureKey] = { ...measures[k as MeasureKey], ...v };
  }
  const nextB: BundleAssessment = { ...prev, ...patch, measures, caseId, updatedAt: ctx.now, updatedBy: ctx.user.id };

  if (nextB.completionTime && c.recognitionTime && new Date(nextB.completionTime) < new Date(c.recognitionTime))
    return fail(s, "Bundle Completion Time cannot be before the Time of Sepsis Recognition");
  if (nextB.completionTime && new Date(nextB.completionTime) > new Date(ctx.now)) return fail(s, "Bundle Completion Time cannot be in the future");
  if (JSON.stringify({ ...prev, updatedAt: 0, updatedBy: 0 }) === JSON.stringify({ ...nextB, updatedAt: 0, updatedBy: 0 }))
    return fail(s, "No changes to save");

  let next: State = { ...s, bundles: [...s.bundles.filter((b) => b.caseId !== caseId), nextB] };
  next = { ...next, cases: next.cases.map((x) => (x.id === caseId ? { ...x, updatedAt: ctx.now } : x)) };
  next = audit(next, ctx, "bundle.save", "bundle", caseId, caseId, describeBundleChange(prev, nextB));

  if (nextB.completionTime && nextB.completionTime !== prev.completionTime) {
    next = emit(next, ctx, { eventType: "bundle_completed", caseId, dedupeKey: `bundle_completed:${caseId}:${nextB.completionTime}` }).state;
  }
  const ev = evaluateCompliance(c, nextB, ctx.now);
  if (ev.status === "requires_review" && !nextB.reviewOverride) {
    next = emit(next, ctx, { eventType: "bundle_review", caseId, dedupeKey: `bundle_review:${caseId}:${stableHash(ev.reasons.join("|"))}` }).state;
  }
  return { ok: true, state: next, value: nextB };
}

function describeBundleChange(a: BundleAssessment, b: BundleAssessment) {
  const parts: string[] = [];
  for (const k of Object.keys(b.measures) as MeasureKey[]) {
    const x = a.measures[k], y = b.measures[k];
    if (x.answer !== y.answer) parts.push(`${k}: ${x.answer ?? "—"}→${y.answer ?? "—"}`);
    if (x.applicability !== y.applicability) parts.push(`${k} applicability: ${y.applicability}`);
    if (x.informationMissing !== y.informationMissing) parts.push(`${k} info missing: ${y.informationMissing}`);
  }
  if (a.hypotensionOccurred !== b.hypotensionOccurred) parts.push(`hypotension: ${b.hypotensionOccurred ?? "—"}`);
  if (a.completionTime !== b.completionTime) parts.push(`completion time set`);
  if (a.clinicianAllWithin1h !== b.clinicianAllWithin1h) parts.push(`all within 1h: ${b.clinicianAllWithin1h ?? "—"}`);
  if (a.reviewOverride !== b.reviewOverride) parts.push(`review decision: ${b.reviewOverride ?? "cleared"}`);
  return parts.join("; ") || "Bundle details updated";
}

// ---------------------------------------------------------------- laboratory

export interface LabInput {
  id?: string;
  caseId: string;
  testType: string;
  status: LabStatus;
  requestedAt: string | null;
  resultAt: string | null;
  notes: string;
}

export function saveLab(s: State, ctx: Ctx, input: LabInput): Result<LabTest> {
  const c = s.cases.find((x) => x.id === input.caseId);
  if (!c) return fail(s, "Case not found");
  if (!input.testType.trim()) return fail(s, "Test type is required");
  if (input.status === "result_available" && !input.resultAt) return fail(s, "Result Date & Time is required when the result is available");
  if (["requested", "pending", "result_available"].includes(input.status) && !input.requestedAt) return fail(s, "Request Date & Time is required");
  if (input.resultAt && input.requestedAt && new Date(input.resultAt) < new Date(input.requestedAt)) return fail(s, "Result time cannot be before request time");
  if (input.resultAt && new Date(input.resultAt) > new Date(ctx.now)) return fail(s, "Result time cannot be in the future");

  const prev = input.id ? s.labs.find((l) => l.id === input.id) : undefined;
  if (input.id && !prev) return fail(s, "Laboratory test not found");
  const linked: MeasureKey | null = /lactate/i.test(input.testType) ? "lactate" : /blood\s*culture/i.test(input.testType) ? "blood_cultures" : null;
  const lab: LabTest = {
    id: prev?.id ?? uid(ctx),
    caseId: input.caseId,
    testType: input.testType.trim(),
    linkedMeasure: linked,
    status: input.status,
    requestedAt: input.requestedAt,
    resultAt: input.status === "result_available" ? input.resultAt : null,
    notes: input.notes.trim(),
    updatedAt: ctx.now,
    updatedBy: ctx.user.id,
  };
  if (prev && prev.status === lab.status && prev.requestedAt === lab.requestedAt && prev.resultAt === lab.resultAt && prev.notes === lab.notes && prev.testType === lab.testType)
    return fail(s, "No changes to save");

  let next: State = { ...s, labs: prev ? s.labs.map((l) => (l.id === lab.id ? lab : l)) : [...s.labs, lab] };
  next = { ...next, cases: next.cases.map((x) => (x.id === c.id ? { ...x, updatedAt: ctx.now } : x)) };
  next = audit(next, ctx, prev ? "lab.update" : "lab.create", "lab", lab.id, c.id, `${lab.testType}: ${prev?.status ?? "new"} → ${lab.status}`);
  if (lab.status === "result_available") {
    next = emit(next, ctx, { eventType: "lab_result_available", caseId: c.id, dedupeKey: `lab_result:${lab.id}:${lab.resultAt}` }).state;
  }
  return { ok: true, state: next, value: lab };
}

// ---------------------------------------------------------------- inpatient

/** Departments may only modify cases currently located in one of their assigned departments. */
export function canActOnCase(user: AppUser, c: SepsisCase) {
  return user.role === "quality_admin" || user.departmentIds.includes(c.currentDepartmentId);
}

export interface UpdateInput {
  caseId: string;
  departmentId: string;
  status: string;
  updateAt: string | null;
  notes: string;
  transferToId: string | null;
}

export function addCaseUpdate(s: State, ctx: Ctx, input: UpdateInput): Result<CaseUpdate> {
  const c = s.cases.find((x) => x.id === input.caseId);
  if (!c) return fail(s, "Case not found");
  if (c.status === "closed") return fail(s, "Case is closed. A Quality Admin must reopen it before new updates.");
  if (!["quality_admin", "emergency", "inpatient"].includes(ctx.user.role)) return fail(s, "Your role cannot update inpatient status");
  if (!canActOnCase(ctx.user, c)) return fail(s, `Only ${deptName(s, c.currentDepartmentId)} (or Quality Admin) can update this case`);
  if (!input.departmentId) return fail(s, "Current Department is required");
  if (!input.status) return fail(s, "Case Status is required");
  if (!input.updateAt) return fail(s, "Update Date & Time is required");
  if (new Date(input.updateAt) > new Date(ctx.now)) return fail(s, "Update time cannot be in the future");
  if (input.transferToId && input.transferToId === input.departmentId) return fail(s, "Transfer department must differ from the current department");

  const last = s.updates.filter((u) => u.caseId === c.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const same =
    last &&
    last.departmentId === input.departmentId &&
    last.status === input.status &&
    last.notes.trim() === input.notes.trim() &&
    (last.transferToId ?? null) === (input.transferToId ?? null);
  if (same) return fail(s, "No changes since the last update — nothing saved and no alert sent");

  const u: CaseUpdate = {
    id: uid(ctx),
    caseId: c.id,
    departmentId: input.departmentId,
    status: input.status,
    updateAt: input.updateAt,
    notes: input.notes.trim(),
    transferFromId: input.transferToId ? input.departmentId : null,
    transferToId: input.transferToId,
    createdAt: ctx.now,
    createdBy: ctx.user.id,
  };
  const newDept = input.transferToId ?? input.departmentId;
  const transferred = !!input.transferToId || newDept !== c.currentDepartmentId;
  let next: State = {
    ...s,
    updates: [...s.updates, u],
    cases: s.cases.map((x) => (x.id === c.id ? { ...x, currentDepartmentId: newDept, currentStatus: input.status, updatedAt: ctx.now } : x)),
  };
  next = audit(next, ctx, "inpatient.update", "case_update", u.id, c.id, `${deptName(s, input.departmentId)}: ${input.status}${input.transferToId ? ` → transfer to ${deptName(s, input.transferToId)}` : ""}`);
  next = emit(next, ctx, {
    eventType: transferred ? "patient_transferred" : "inpatient_update",
    caseId: c.id,
    dedupeKey: `${transferred ? "transfer" : "update"}:${u.id}`,
    departmentIds: [input.departmentId, newDept, c.emergencyDepartmentId],
  }).state;
  return { ok: true, state: next, value: u };
}

// ---------------------------------------------------------------- outcome

const OUTCOME_EVENT: Record<FinalOutcomeType, EventType> = {
  discharged: "outcome_discharged",
  dama: "outcome_dama",
  death: "outcome_death",
  transferred_facility: "case_closed_other",
  sepsis_ruled_out: "case_closed_other",
  administrative_closure: "case_closed_other",
};

export function recordOutcome(s: State, ctx: Ctx, caseId: string, outcome: FinalOutcomeType, outcomeAt: string | null, notes: string): Result<SepsisCase> {
  const c = s.cases.find((x) => x.id === caseId);
  if (!c) return fail(s, "Case not found");
  if (c.outcome) return fail(s, "A final outcome is already recorded. Use 'Correct Outcome' (Quality Admin).");
  if (!["quality_admin", "emergency", "inpatient"].includes(ctx.user.role)) return fail(s, "Your role cannot record outcomes");
  if (!canActOnCase(ctx.user, c)) return fail(s, `Only ${deptName(s, c.currentDepartmentId)} (or Quality Admin) can record this outcome`);
  if (!outcomeAt) return fail(s, "Outcome Date & Time is required");
  if (new Date(outcomeAt) > new Date(ctx.now)) return fail(s, "Outcome time cannot be in the future");
  if (c.recognitionTime && new Date(outcomeAt) < new Date(c.recognitionTime)) return fail(s, "Outcome time cannot be before sepsis recognition");
  const updated: SepsisCase = { ...c, outcome, outcomeAt, status: "closed", currentStatus: OUTCOME_LABELS[outcome], updatedAt: ctx.now };
  let next: State = { ...s, cases: s.cases.map((x) => (x.id === caseId ? updated : x)) };
  next = audit(next, ctx, "outcome.record", "case", caseId, caseId, `${OUTCOME_LABELS[outcome]} at ${outcomeAt}${notes ? ` — ${notes}` : ""}`);
  next = emit(next, ctx, { eventType: OUTCOME_EVENT[outcome], caseId, dedupeKey: `outcome:${caseId}:${outcome}:${outcomeAt}` }).state;
  return { ok: true, state: next, value: updated };
}

export function correctOutcome(
  s: State,
  ctx: Ctx,
  caseId: string,
  change: { outcome: FinalOutcomeType | null; outcomeAt: string | null; reason: string },
): Result<SepsisCase> {
  const c = s.cases.find((x) => x.id === caseId);
  if (!c) return fail(s, "Case not found");
  if (ctx.user.role !== "quality_admin") return fail(s, "Only Quality Admin can correct or reopen a finalized outcome");
  if (!change.reason.trim() || change.reason.trim().length < 10) return fail(s, "A documented reason (at least 10 characters) is required");
  if (change.outcome && !change.outcomeAt) return fail(s, "Outcome Date & Time is required");
  const reopened = change.outcome === null;
  const updated: SepsisCase = reopened
    ? { ...c, outcome: null, outcomeAt: null, status: "active", currentStatus: "Reopened", updatedAt: ctx.now }
    : { ...c, outcome: change.outcome, outcomeAt: change.outcomeAt, status: "closed", currentStatus: OUTCOME_LABELS[change.outcome!], updatedAt: ctx.now };
  let next: State = { ...s, cases: s.cases.map((x) => (x.id === caseId ? updated : x)) };
  next = audit(
    next,
    ctx,
    reopened ? "case.reopen" : "outcome.correct",
    "case",
    caseId,
    caseId,
    `${c.outcome ? OUTCOME_LABELS[c.outcome] : "none"} → ${reopened ? "reopened" : OUTCOME_LABELS[change.outcome!]}. Reason: ${change.reason}`,
  );
  if (!reopened) next = emit(next, ctx, { eventType: OUTCOME_EVENT[change.outcome!], caseId, dedupeKey: `outcome:${caseId}:${change.outcome}:${change.outcomeAt}` }).state;
  return { ok: true, state: next, value: updated };
}

// ---------------------------------------------------------------- recipients & rules

export interface RecipientInput {
  id?: string;
  channel: Channel;
  name: string;
  address: string;
  departmentIds: string[];
  eventTypes: EventType[];
  active: boolean;
}

export function saveRecipient(s: State, ctx: Ctx, input: RecipientInput): Result<Recipient> {
  if (ctx.user.role !== "quality_admin") return fail(s, "Only Quality Admin can manage recipients");
  const name = input.name.trim();
  if (!name) return fail(s, "Name is required");
  let address = input.address.trim();
  if (input.channel === "whatsapp") {
    address = toE164(address);
    if (!isE164(address)) return fail(s, "WhatsApp number must be in international E.164 format, e.g. +9665XXXXXXXX");
  } else {
    address = address.toLowerCase();
    if (!isEmail(address)) return fail(s, "Enter a valid email address");
  }
  if (!input.eventTypes.length) return fail(s, "Select at least one notification type");
  const dup = s.recipients.find((r) => r.channel === input.channel && r.id !== input.id && normalizeAddress(r.channel, r.address) === normalizeAddress(input.channel, address));
  // A recipient removed from the list may still exist in the database because past
  // notification deliveries must retain their foreign key. Reuse that same ID.
  const latestRecipientAction = dup
    ? [...s.audit].filter((a) => a.entity === "recipient" && a.entityId === dup.id).sort((a, b) => b.at.localeCompare(a.at))[0]?.action
    : undefined;
  const restoreArchived = !input.id && dup && !dup.active && latestRecipientAction === "recipient.deactivate";
  if (dup && !restoreArchived) return fail(s, `This ${input.channel === "whatsapp" ? "number" : "email"} is already registered for ${dup.name}`);
  const prev = restoreArchived ? dup : input.id ? s.recipients.find((r) => r.id === input.id) : undefined;
  const r: Recipient = {
    id: prev?.id ?? uid(ctx),
    channel: input.channel,
    name,
    address,
    departmentIds: input.departmentIds,
    eventTypes: input.eventTypes,
    active: input.active,
    createdAt: prev?.createdAt ?? ctx.now,
    updatedAt: ctx.now,
  };
  let next: State = { ...s, recipients: prev ? s.recipients.map((x) => (x.id === r.id ? r : x)) : [...s.recipients, r] };
  next = audit(next, ctx, restoreArchived ? "recipient.restore" : prev ? "recipient.update" : "recipient.create", "recipient", r.id, null, `${r.channel} recipient ${r.name}${r.active ? "" : " (inactive)"}`);
  return { ok: true, state: next, value: r };
}

export function deleteRecipient(s: State, ctx: Ctx, id: string): Result<null> {
  if (ctx.user.role !== "quality_admin") return fail(s, "Only Quality Admin can manage recipients");
  const r = s.recipients.find((x) => x.id === id);
  if (!r) return fail(s, "Recipient not found");
  // Recipients referenced by the delivery log are kept for traceability and deactivated instead.
  const used = s.deliveries.some((d) => d.recipientId === id);
  let next: State = used
    ? { ...s, recipients: s.recipients.map((x) => (x.id === id ? { ...x, active: false, updatedAt: ctx.now } : x)) }
    : { ...s, recipients: s.recipients.filter((x) => x.id !== id) };
  next = audit(next, ctx, used ? "recipient.deactivate" : "recipient.delete", "recipient", id, null, `${r.channel} recipient ${r.name}`);
  return { ok: true, state: next, value: null, warning: used ? "Recipient has delivery history, so it was deactivated instead of deleted" : undefined };
}

export function saveRules(s: State, ctx: Ctx, rules: NotificationRule[]): Result<NotificationRule[]> {
  if (ctx.user.role !== "quality_admin") return fail(s, "Only Quality Admin can change notification rules");
  let next: State = { ...s, rules };
  next = audit(next, ctx, "rules.update", "rules", "all", null, "Notification rules updated");
  return { ok: true, state: next, value: rules };
}

/** Test messages are clearly marked and never linked to a patient case. */
export function sendTest(s: State, ctx: Ctx, recipientId: string): Result<DeliveryAttempt> {
  const r = s.recipients.find((x) => x.id === recipientId);
  if (!r) return fail(s, "Recipient not found");
  const ev: NotificationEvent = {
    id: uid(ctx),
    eventType: "case_registered",
    caseId: null,
    caseNo: null,
    departmentId: null,
    dedupeKey: `test:${recipientId}:${ctx.now}`,
    isTest: true,
    createdAt: ctx.now,
    createdBy: ctx.user.id,
  };
  const d: DeliveryAttempt = {
    id: uid(ctx),
    eventId: ev.id,
    recipientId: r.id,
    recipientName: r.name,
    address: r.address,
    channel: r.channel,
    status: "queued",
    queuedAt: ctx.now,
    sentAt: null,
    deliveredAt: null,
    attempts: 0,
    error: null,
    providerMessageId: null,
  };
  let next: State = { ...s, events: [ev, ...s.events], deliveries: [d, ...s.deliveries] };
  next = audit(next, ctx, "notification.test", "recipient", r.id, null, `Test ${r.channel} message to ${r.name}`);
  next = dispatchDemo(next);
  return { ok: true, state: next, value: next.deliveries.find((x) => x.id === d.id)! };
}

// ---------------------------------------------------------------- reminders

/** Reminder candidates — used by the demo timer AND the production scheduled job. */
export function reminderEvents(s: State, now: string): EmitInput[] {
  const r = s.settings.reminders;
  const out: EmitInput[] = [];
  const t = new Date(now).getTime();
  for (const c of s.cases) {
    if (c.status !== "active") continue;
    const b = s.bundles.find((x) => x.caseId === c.id);
    if (c.recognitionTime && !b?.completionTime) {
      const mins = (t - new Date(c.recognitionTime).getTime()) / 60000;
      if (mins >= r.bundleOverdueMinutes) out.push({ eventType: "bundle_overdue", caseId: c.id, dedupeKey: `bundle_overdue:${c.id}` });
      else if (mins >= r.bundleApproachingMinutes) out.push({ eventType: "bundle_pending", caseId: c.id, dedupeKey: `bundle_pending:${c.id}` });
    }
    if (b) {
      const ev = evaluateCompliance(c, b, now);
      if (ev.status === "requires_review" && !b.reviewOverride)
        out.push({ eventType: "bundle_review", caseId: c.id, dedupeKey: `bundle_review:${c.id}:${stableHash(ev.reasons.join("|"))}` });
    }
    const lastTouch = Math.max(new Date(c.createdAt).getTime(), ...s.updates.filter((u) => u.caseId === c.id).map((u) => new Date(u.createdAt).getTime()));
    if ((t - lastTouch) / 3600000 >= r.inpatientUpdateOverdueHours) {
      out.push({ eventType: "followup_reminder", caseId: c.id, dedupeKey: `followup:${c.id}:${toRiyadhInput(now).slice(0, 10)}` });
    }
  }
  for (const l of s.labs) {
    if (!["requested", "pending"].includes(l.status) || !l.requestedAt) continue;
    const c = s.cases.find((x) => x.id === l.caseId);
    if (!c || c.status !== "active") continue;
    if ((t - new Date(l.requestedAt).getTime()) / 3600000 >= r.labOverdueHours) out.push({ eventType: "lab_delay", caseId: l.caseId, dedupeKey: `lab_delay:${l.id}` });
  }
  return out;
}

/** Demo-mode equivalent of the scheduled reminder job. Each reminder fires once per dedupe key. */
export function runReminders(s: State, ctx: Ctx): State {
  let next = s;
  for (const e of reminderEvents(s, ctx.now)) next = emit(next, ctx, e).state;
  return next;
}

// ---------------------------------------------------------------- derived

export function labSummary(s: State, caseId: string): { label: string; tone: "green" | "amber" | "gray" | "red" } {
  const labs = s.labs.filter((l) => l.caseId === caseId && l.status !== "cancelled" && l.status !== "not_requested");
  if (!labs.length) return { label: "Not Requested", tone: "gray" };
  const open = labs.filter((l) => l.status !== "result_available");
  if (!open.length) return { label: "Result Available", tone: "green" };
  const overdueH = s.settings.reminders.labOverdueHours;
  const overdue = open.some((l) => l.requestedAt && (Date.now() - new Date(l.requestedAt).getTime()) / 3600000 >= overdueH);
  return overdue ? { label: `Overdue (${open.length})`, tone: "red" } : { label: `Pending (${open.length})`, tone: "amber" };
}

export function dashboardCounts(s: State) {
  return {
    total: s.cases.length,
    active: s.cases.filter((c) => c.status === "active").length,
    pendingLab: new Set(s.labs.filter((l) => l.status === "requested" || l.status === "pending").map((l) => l.caseId)).size,
    discharged: s.cases.filter((c) => c.outcome === "discharged").length,
    dama: s.cases.filter((c) => c.outcome === "dama").length,
    deaths: s.cases.filter((c) => c.outcome === "death").length,
    otherClosed: s.cases.filter((c) => c.outcome && !PRIMARY_OUTCOMES.includes(c.outcome)).length,
  };
}

export function lastUpdateAt(s: State, caseId: string) {
  return s.cases.find((c) => c.id === caseId)?.updatedAt ?? null;
}

// ---------------------------------------------------------------- configuration

export function saveDepartment(s: State, ctx: Ctx, d: { id?: string; name: string; kind: Department["kind"]; active: boolean }): Result<Department> {
  if (ctx.user.role !== "quality_admin") return fail(s, "Only Quality Admin can manage departments");
  const name = d.name.trim();
  if (!name) return fail(s, "Department name is required");
  if (s.departments.some((x) => x.id !== d.id && x.name.toLowerCase() === name.toLowerCase())) return fail(s, "A department with this name already exists");
  const dep: Department = { id: d.id ?? uid(ctx), name, kind: d.kind, active: d.active };
  let next: State = { ...s, departments: d.id ? s.departments.map((x) => (x.id === d.id ? dep : x)) : [...s.departments, dep] };
  next = audit(next, ctx, d.id ? "department.update" : "department.create", "department", dep.id, null, `${dep.name} (${dep.kind})${dep.active ? "" : " inactive"}`);
  return { ok: true, state: next, value: dep };
}

export function saveSettings(s: State, ctx: Ctx, settings: SystemSettings, labTestTypes?: string[]): Result<SystemSettings> {
  if (ctx.user.role !== "quality_admin") return fail(s, "Only Quality Admin can change settings");
  const r = settings.reminders;
  if ([r.bundleApproachingMinutes, r.bundleOverdueMinutes, r.labOverdueHours, r.inpatientUpdateOverdueHours, r.outcomePendingDays].some((v) => !Number.isFinite(v) || v <= 0))
    return fail(s, "All thresholds must be positive numbers");
  if (r.bundleApproachingMinutes >= r.bundleOverdueMinutes) return fail(s, "'Approaching' must be earlier than 'Overdue'");
  if (!/^https:\/\/[^\s]+$/.test(settings.appBaseUrl)) return fail(s, "Application URL must start with https://");
  let next: State = { ...s, settings, labTestTypes: labTestTypes ?? s.labTestTypes };
  next = audit(next, ctx, "settings.update", "settings", "system", null, `Reminders: ${JSON.stringify(r)}; rules approved: ${settings.complianceRulesApproved}`);
  return { ok: true, state: next, value: settings };
}
