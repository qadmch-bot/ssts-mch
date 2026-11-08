import type {
  DeliveryStatus,
  EventType,
  FinalOutcomeType,
  LabStatus,
  MeasureKey,
  NotificationRule,
  Role,
} from "./types";

export const HOSPITAL = {
  clusterEn: "Hafar Al Batin Health Cluster",
  clusterAr: "تجمع حفر الباطن الصحي",
  hospitalEn: "Maternity & Children Hospital",
  hospitalAr: "مستشفى الولادة والأطفال",
  systemName: "Sepsis Surveillance & Tracking System",
  shortName: "SSTS",
  timeZone: "Asia/Riyadh",
};

/** The five measures exactly as worded on the official SEPSIS HOUR-1 BUNDLE form. */
export const BUNDLE_MEASURES: { key: MeasureKey; title: string; question: string; short: string; conditional: boolean }[] = [
  { key: "lactate", title: "Measure Lactate Level", question: "Was lactate level measured?", short: "Lactate", conditional: false },
  {
    key: "blood_cultures",
    title: "Obtain Blood Cultures before Antibiotics",
    question: "Were blood cultures taken before administering antibiotics?",
    short: "Blood Cultures",
    conditional: false,
  },
  {
    key: "antibiotics",
    title: "Administer Broad-Spectrum Antibiotics",
    question: "Were broad-spectrum antibiotics given?",
    short: "Antibiotics",
    conditional: false,
  },
  { key: "iv_fluids", title: "Begin rapid Administration of IV Fluids", question: "Were IV Fluids started rapidly?", short: "IV Fluids", conditional: false },
  {
    key: "vasopressors",
    title: "Apply vasopressors (if Hypotensive during/after Fluids)",
    question: "Were vasopressors administered if hypotension occurred?",
    short: "Vasopressors",
    conditional: true,
  },
];

export const BUNDLE_COMPLETION_QUESTION =
  "All Bundle Followed within 1 Hour – was the entire bundle completed within 1 Hour?";

export const EVENT_LABELS: Record<EventType, string> = {
  case_registered: "New Sepsis Case",
  bundle_pending: "Hour-1 Bundle Pending",
  bundle_overdue: "Hour-1 Bundle Overdue",
  bundle_completed: "Hour-1 Bundle Completed",
  bundle_review: "Bundle Requires Review",
  lab_result_available: "Laboratory Result Available",
  lab_delay: "Laboratory Delay Alert",
  inpatient_update: "Inpatient Status Updated",
  patient_transferred: "Patient Transferred",
  outcome_discharged: "Discharged",
  outcome_dama: "DAMA",
  outcome_death: "Death",
  case_closed_other: "Case Closed (Other Outcome)",
  followup_reminder: "Pending Follow-up Reminder",
};

export const EVENT_ORDER: EventType[] = [
  "case_registered",
  "bundle_pending",
  "bundle_overdue",
  "bundle_completed",
  "bundle_review",
  "lab_result_available",
  "lab_delay",
  "inpatient_update",
  "patient_transferred",
  "outcome_discharged",
  "outcome_dama",
  "outcome_death",
  "case_closed_other",
  "followup_reminder",
];

export const DEFAULT_RULES: NotificationRule[] = EVENT_ORDER.map((eventType) => ({
  eventType,
  whatsapp: !["bundle_review", "case_closed_other"].includes(eventType),
  email: true,
  inApp: true,
}));

export const LAB_STATUS_LABELS: Record<LabStatus, string> = {
  not_requested: "Not Requested",
  requested: "Requested",
  pending: "Pending",
  result_available: "Result Available",
  cancelled: "Cancelled",
};

export const DEFAULT_LAB_TEST_TYPES = ["Lactate", "Blood Culture", "CBC", "CRP", "Procalcitonin", "Blood Gas", "Urine Culture", "CSF Culture"];

export const OUTCOME_LABELS: Record<FinalOutcomeType, string> = {
  discharged: "Discharged",
  dama: "DAMA",
  death: "Death",
  transferred_facility: "Transferred to Another Facility",
  sepsis_ruled_out: "Sepsis Ruled Out",
  administrative_closure: "Other Administrative Closure",
};

export const PRIMARY_OUTCOMES: FinalOutcomeType[] = ["discharged", "dama", "death"];
export const OTHER_OUTCOMES: FinalOutcomeType[] = ["transferred_facility", "sepsis_ruled_out", "administrative_closure"];

export const INPATIENT_STATUSES = [
  "Admitted",
  "Under Treatment",
  "Stable",
  "Improving",
  "Deteriorating",
  "Critical",
  "Transferred (Internal)",
  "Awaiting Discharge",
];

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  queued: "Queued",
  sent: "Sent",
  delivered: "Delivered",
  failed: "Failed",
  retrying: "Retrying",
  not_sent: "Not Sent (provider not configured)",
};

export const ROLE_LABELS: Record<Role, string> = {
  quality_admin: "Quality Admin",
  emergency: "Emergency Department",
  laboratory: "Laboratory",
  inpatient: "Inpatient Department",
  leadership: "Hospital Leadership",
};

export type Permission =
  | "case.create"
  | "case.viewIdentifiers"
  | "bundle.edit"
  | "bundle.review"
  | "lab.edit"
  | "inpatient.edit"
  | "outcome.record"
  | "outcome.correct"
  | "settings.manage"
  | "notifications.resend"
  | "reports.export"
  | "audit.view";

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  quality_admin: [
    "case.create",
    "case.viewIdentifiers",
    "bundle.edit",
    "bundle.review",
    "lab.edit",
    "inpatient.edit",
    "outcome.record",
    "outcome.correct",
    "settings.manage",
    "notifications.resend",
    "reports.export",
    "audit.view",
  ],
  emergency: ["case.create", "case.viewIdentifiers", "bundle.edit", "inpatient.edit", "outcome.record"],
  laboratory: ["lab.edit"],
  inpatient: ["case.viewIdentifiers", "inpatient.edit", "outcome.record"],
  leadership: ["reports.export"],
};

export function can(role: Role, p: Permission) {
  return ROLE_PERMISSIONS[role].includes(p);
}
