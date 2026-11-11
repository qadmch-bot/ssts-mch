// Core domain types for the Sepsis Surveillance & Tracking System (SSTS).
// All timestamps are ISO-8601 strings in UTC. Display uses Asia/Riyadh.

export type Role = "quality_admin" | "emergency" | "laboratory" | "inpatient" | "leadership";

export type DepartmentKind = "emergency" | "inpatient" | "laboratory" | "other";

export interface Department {
  id: string;
  name: string;
  kind: DepartmentKind;
  active: boolean;
}

export interface AppUser {
  id: string;
  name: string;
  role: Role;
  departmentIds: string[];
}

export type Sex = "Male" | "Female";
export type AgeUnit = "days" | "months" | "years";
export type PatientCategory = "Neonatal" | "Pediatric" | "Obstetric" | "Adult";

/** Restricted patient identifiers — stored separately, never sent externally. */
export interface PatientIdentifiers {
  caseId: string;
  mrn: string;
  patientName: string;
}

export type CaseStatus = "active" | "closed";

export type FinalOutcomeType =
  | "discharged"
  | "dama"
  | "death"
  | "transferred_facility"
  | "sepsis_ruled_out"
  | "administrative_closure";

export interface SepsisCase {
  id: string;
  caseNo: string; // SEP-2026-0001
  age: number | null;
  ageUnit: AgeUnit;
  sex: Sex | "";
  patientCategory: PatientCategory | "";
  consultant: string;
  caseDate: string; // YYYY-MM-DD (form "Date")
  emergencyDepartmentId: string;
  currentDepartmentId: string;
  diagnosisTime: string | null; // UTC ISO
  recognitionTime: string | null; // UTC ISO — clinical recognition, never inferred from arrival
  arrivalTime?: string | null; // UTC ISO — patient arrival, distinct from recognition
  physicianName: string;
  status: CaseStatus;
  currentStatus: string; // human status label, e.g. "In Emergency", "Admitted"
  outcome: FinalOutcomeType | null;
  outcomeAt: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

// ---------- Hour-1 Bundle ----------

/** Original clinician answer exactly as on the paper form. null = not yet documented. */
export type YesNo = "YES" | "NO" | null;

export type MeasureKey = "lactate" | "blood_cultures" | "antibiotics" | "iv_fluids" | "vasopressors";

/** Separate, optional electronic documentation — never inferred from a NO answer. */
export type Applicability = "applicable" | "not_applicable" | "not_documented";

export interface BundleMeasure {
  key: MeasureKey;
  answer: YesNo;
  applicability: Applicability;
  informationMissing: boolean;
  note: string;
}

export interface BundleAssessment {
  caseId: string;
  measures: Record<MeasureKey, BundleMeasure>;
  /** For measure 5: did hypotension occur during/after fluids? Separate from the YES/NO answer. */
  hypotensionOccurred: YesNo;
  completionTime: string | null; // Bundle Completion Time (UTC)
  clinicianAllWithin1h: YesNo; // "All Bundle Followed within 1 Hour" original answer
  physicianName: string;
  documentedAt: string | null; // form "Date and Time"
  reviewNote: string;
  reviewedBy: string | null;
  reviewOverride: ComplianceStatus | null; // Quality Admin decision after review
  updatedAt: string;
  updatedBy: string;
}

export type TimingResult = "within_60" | "over_60" | "pending" | "requires_review";
export type ComplianceStatus = "compliant" | "not_compliant" | "pending" | "requires_review";

// ---------- Laboratory ----------

export type LabStatus = "not_requested" | "requested" | "pending" | "result_available" | "cancelled";

export interface LabTest {
  id: string;
  caseId: string;
  testType: string;
  linkedMeasure: MeasureKey | null; // lactate / blood_cultures link to bundle
  status: LabStatus;
  requestedAt: string | null;
  resultAt: string | null;
  notes: string;
  updatedAt: string;
  updatedBy: string;
}

// ---------- Inpatient ----------

export interface CaseUpdate {
  id: string;
  caseId: string;
  departmentId: string;
  status: string;
  updateAt: string;
  notes: string;
  transferFromId: string | null;
  transferToId: string | null;
  createdAt: string;
  createdBy: string;
}

// ---------- Notifications ----------

export type EventType =
  | "case_registered"
  | "bundle_pending"
  | "bundle_overdue"
  | "bundle_completed"
  | "bundle_review"
  | "lab_result_available"
  | "lab_delay"
  | "inpatient_update"
  | "patient_transferred"
  | "outcome_discharged"
  | "outcome_dama"
  | "outcome_death"
  | "case_closed_other"
  | "followup_reminder";

export type Channel = "whatsapp" | "email";

export interface Recipient {
  id: string;
  channel: Channel;
  name: string;
  address: string; // E.164 for WhatsApp, email address for email
  departmentIds: string[]; // empty = all departments
  eventTypes: EventType[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationRule {
  eventType: EventType;
  whatsapp: boolean;
  email: boolean;
  inApp: boolean;
}

export interface NotificationEvent {
  id: string;
  eventType: EventType;
  caseId: string | null;
  caseNo: string | null;
  departmentId: string | null;
  dedupeKey: string; // unique — idempotency
  isTest: boolean;
  createdAt: string;
  createdBy: string;
}

export type DeliveryStatus = "queued" | "sent" | "delivered" | "failed" | "retrying" | "not_sent";

export interface DeliveryAttempt {
  id: string;
  eventId: string;
  recipientId: string;
  recipientName: string;
  address: string;
  channel: Channel;
  status: DeliveryStatus;
  queuedAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  attempts: number;
  error: string | null;
  providerMessageId: string | null;
}

export interface InAppNotification {
  id: string;
  eventId: string;
  eventType: EventType;
  caseId: string | null;
  title: string;
  body: string;
  createdAt: string;
  readBy: string[];
}

export interface AuditEntry {
  id: string;
  at: string;
  userId: string;
  userName: string;
  action: string;
  entity: string;
  entityId: string;
  caseId: string | null;
  detail: string;
}

export interface ReminderSettings {
  bundleApproachingMinutes: number; // warn before 60-min threshold
  bundleOverdueMinutes: number; // documentation overdue after recognition
  labOverdueHours: number;
  inpatientUpdateOverdueHours: number;
  outcomePendingDays: number;
  approvedByLeadership: boolean; // thresholds must be clinically approved
}

export interface SystemSettings {
  reminders: ReminderSettings;
  appBaseUrl: string;
  /** Compliance rule set: must be confirmed by hospital before use in official reports. */
  complianceRulesApproved: boolean;
}
