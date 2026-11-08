// Notification fan-out and message templates.
// Messages NEVER contain MRN, patient name, DOB, lab values or other clinical details.

import { EVENT_LABELS, HOSPITAL } from "./constants";
import type { Channel, EventType, NotificationRule, Recipient } from "./types";

export interface MessageContext {
  eventType: EventType;
  caseNo: string | null;
  departmentName: string | null;
  caseUrl: string | null; // authenticated link — requires login, carries no token
  isTest?: boolean;
}

const STATUS_LINE: Record<EventType, { title: string; status: string; action?: string }> = {
  case_registered: { title: "NEW SEPSIS CASE ALERT", status: "New Sepsis Case Registered", action: "Review Sepsis Hour-1 Bundle." },
  bundle_pending: { title: "HOUR-1 BUNDLE PENDING", status: "Hour-1 Bundle documentation pending", action: "Complete Hour-1 Bundle documentation." },
  bundle_overdue: { title: "HOUR-1 BUNDLE OVERDUE", status: "Hour-1 Bundle documentation overdue", action: "Complete Hour-1 Bundle documentation." },
  bundle_completed: { title: "HOUR-1 BUNDLE COMPLETED", status: "Bundle completion recorded" },
  bundle_review: { title: "BUNDLE REVIEW REQUIRED", status: "Hour-1 Bundle requires Quality review" },
  lab_result_available: { title: "LABORATORY RESULT AVAILABLE", status: "Laboratory Result Available" },
  lab_delay: { title: "LABORATORY DELAY ALERT", status: "Laboratory result overdue" },
  inpatient_update: { title: "INPATIENT STATUS UPDATE", status: "Inpatient status updated" },
  patient_transferred: { title: "PATIENT TRANSFER", status: "Patient transferred" },
  outcome_discharged: { title: "FINAL OUTCOME RECORDED", status: "Discharged" },
  outcome_dama: { title: "FINAL OUTCOME RECORDED", status: "DAMA (Discharge Against Medical Advice)" },
  outcome_death: { title: "FINAL OUTCOME RECORDED", status: "Death recorded" },
  case_closed_other: { title: "CASE CLOSED", status: "Case closed (other outcome)" },
  followup_reminder: { title: "FOLLOW-UP REMINDER", status: "Case follow-up update pending", action: "Update the case status." },
};

export function buildMessage(ctx: MessageContext) {
  const s = STATUS_LINE[ctx.eventType];
  const lines = [
    ctx.isTest ? `[TEST MESSAGE — NOT A REAL ALERT]` : null,
    s.title,
    "",
    HOSPITAL.hospitalEn,
    "",
    ctx.caseNo ? `Case ID: ${ctx.caseNo}` : null,
    ctx.departmentName ? `Department: ${ctx.departmentName}` : null,
    `Status: ${s.status}`,
    s.action ? `Action Required: ${s.action}` : null,
    "",
    "Please review the case in the secure hospital system.",
    ctx.caseUrl ? ctx.caseUrl : null,
  ].filter((l) => l !== null) as string[];
  const subject = `${ctx.isTest ? "[TEST] " : ""}SSTS – ${EVENT_LABELS[ctx.eventType]}${ctx.caseNo ? ` – ${ctx.caseNo}` : ""}`;
  return { subject, text: lines.join("\n"), title: s.title, status: s.status };
}

/** WhatsApp template parameters (for an approved Meta template with 4 body variables). */
export function whatsappTemplateParams(ctx: MessageContext) {
  const s = STATUS_LINE[ctx.eventType];
  return [s.title, ctx.caseNo ?? "-", ctx.departmentName ?? "-", s.status + (s.action ? ` — ${s.action}` : "")];
}

export interface PlannedDelivery {
  recipient: Recipient;
  channel: Channel;
}

/**
 * Decide who receives an event. One delivery per (recipient, channel) — duplicate
 * recipients with the same address are collapsed so nobody gets the same alert twice.
 */
export function planDeliveries(
  eventType: EventType,
  departmentIds: (string | null)[],
  rules: NotificationRule[],
  recipients: Recipient[],
): PlannedDelivery[] {
  const rule = rules.find((r) => r.eventType === eventType);
  if (!rule) return [];
  const depts = departmentIds.filter(Boolean) as string[];
  const seen = new Set<string>();
  const out: PlannedDelivery[] = [];
  for (const r of recipients) {
    if (!r.active) continue;
    if (r.channel === "whatsapp" && !rule.whatsapp) continue;
    if (r.channel === "email" && !rule.email) continue;
    if (!r.eventTypes.includes(eventType)) continue;
    if (r.departmentIds.length && depts.length && !r.departmentIds.some((d) => depts.includes(d))) continue;
    const key = `${r.channel}:${normalizeAddress(r.channel, r.address)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ recipient: r, channel: r.channel });
  }
  return out;
}

export function normalizeAddress(channel: Channel, address: string) {
  return channel === "email" ? address.trim().toLowerCase() : address.replace(/[\s-()]/g, "");
}

/** E.164: + followed by 8–15 digits, first digit non-zero. */
export function isE164(v: string) {
  return /^\+[1-9]\d{7,14}$/.test(v.replace(/[\s-()]/g, ""));
}

/** Accepts Saudi local formats (05XXXXXXXX / 5XXXXXXXX / 9665…) and returns E.164 when possible. */
export function toE164(v: string) {
  const d = v.replace(/[\s-()]/g, "");
  if (/^05\d{8}$/.test(d)) return `+966${d.slice(1)}`;
  if (/^5\d{8}$/.test(d)) return `+966${d}`;
  if (/^9665\d{8}$/.test(d)) return `+${d}`;
  if (/^00\d+$/.test(d)) return `+${d.slice(2)}`;
  return d;
}

export function isEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

/** Simple stable hash for dedupe keys (not cryptographic). */
export function stableHash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
