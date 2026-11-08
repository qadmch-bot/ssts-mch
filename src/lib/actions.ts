// "Cases requiring action" — derived from stored records, used by dashboard and notifications.
import { evaluateCompliance, minutesSinceRecognition } from "./bundle";
import type { State } from "./engine";
import { humanDuration, nowIso } from "./time";

export type ActionKind = "bundle_open" | "bundle_overdue" | "bundle_review" | "bundle_missing" | "lab_pending" | "lab_overdue" | "update_overdue" | "outcome_pending" | "notify_failed";

export interface ActionItem {
  kind: ActionKind;
  caseId: string | null;
  caseNo: string | null;
  text: string;
  href: string;
  severity: 1 | 2 | 3; // 3 = most urgent
}

export const ACTION_LABELS: Record<ActionKind, string> = {
  bundle_open: "Hour-1 Bundle open",
  bundle_overdue: "Hour-1 Bundle overdue",
  bundle_review: "Bundle requires review",
  bundle_missing: "Missing bundle elements",
  lab_pending: "Pending laboratory result",
  lab_overdue: "Laboratory result overdue",
  update_overdue: "Department update overdue",
  outcome_pending: "Final outcome pending",
  notify_failed: "Notification not delivered",
};

export function actionItems(s: State, now = nowIso()): ActionItem[] {
  const r = s.settings.reminders;
  const out: ActionItem[] = [];
  const t = new Date(now).getTime();
  for (const c of s.cases) {
    if (c.status !== "active") continue;
    const b = s.bundles.find((x) => x.caseId === c.id);
    const ev = evaluateCompliance(c, b, now);
    const m = minutesSinceRecognition(c, now);
    if (!b?.completionTime && m !== null) {
      const overdue = m >= r.bundleOverdueMinutes;
      out.push({
        kind: overdue ? "bundle_overdue" : "bundle_open",
        caseId: c.id,
        caseNo: c.caseNo,
        text: `${humanDuration(m)} since recognition · ${ev.documentedCount}/5 measures documented`,
        href: `/bundle/form?id=${c.id}`,
        severity: overdue ? 3 : m >= r.bundleApproachingMinutes ? 3 : 2,
      });
    } else if (ev.status === "requires_review") {
      out.push({ kind: "bundle_review", caseId: c.id, caseNo: c.caseNo, text: ev.reasons[0] ?? "Review needed", href: `/bundle/form?id=${c.id}`, severity: 2 });
    } else if (ev.status === "pending") {
      out.push({ kind: "bundle_missing", caseId: c.id, caseNo: c.caseNo, text: ev.reasons.join(" · "), href: `/bundle/form?id=${c.id}`, severity: 2 });
    }
    const lastTouch = Math.max(new Date(c.createdAt).getTime(), ...s.updates.filter((u) => u.caseId === c.id).map((u) => new Date(u.createdAt).getTime()));
    const hrs = (t - lastTouch) / 3600000;
    if (hrs >= r.inpatientUpdateOverdueHours)
      out.push({ kind: "update_overdue", caseId: c.id, caseNo: c.caseNo, text: `No department update for ${humanDuration(Math.round(hrs * 60))}`, href: `/inpatient?case=${c.id}`, severity: 2 });
    const days = (t - new Date(c.createdAt).getTime()) / 86400000;
    if (days >= r.outcomePendingDays)
      out.push({ kind: "outcome_pending", caseId: c.id, caseNo: c.caseNo, text: `Active for ${Math.floor(days)} days without a final outcome`, href: `/inpatient?case=${c.id}`, severity: 1 });
  }
  for (const l of s.labs) {
    if (!["requested", "pending"].includes(l.status)) continue;
    const c = s.cases.find((x) => x.id === l.caseId);
    if (!c || c.status !== "active") continue;
    const hrs = l.requestedAt ? (t - new Date(l.requestedAt).getTime()) / 3600000 : 0;
    const overdue = hrs >= r.labOverdueHours;
    out.push({
      kind: overdue ? "lab_overdue" : "lab_pending",
      caseId: c.id,
      caseNo: c.caseNo,
      text: `${l.testType} · requested ${l.requestedAt ? humanDuration(Math.round(hrs * 60)) + " ago" : "—"}`,
      href: `/laboratory?case=${c.id}`,
      severity: overdue ? 3 : 1,
    });
  }
  const failed = s.deliveries.filter((d) => d.status === "failed");
  if (failed.length)
    out.push({ kind: "notify_failed", caseId: null, caseNo: null, text: `${failed.length} notification(s) failed — review and resend`, href: "/notifications?tab=log&status=failed", severity: 2 });
  return out.sort((a, b) => b.severity - a.severity);
}
