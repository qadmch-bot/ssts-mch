// Hour-1 Bundle evaluation.
//
// IMPORTANT: The rules below are the DEFAULT electronic interpretation and must be
// approved by the hospital (Quality & Patient Safety + responsible clinical teams)
// before results are used as official compliance indicators. Key principles:
//  - The clinician's original YES/NO answers are stored and displayed unchanged.
//  - A "NO" answer is never silently treated as "Not Applicable".
//  - Missing documentation is reported as "Pending", never as non-compliance.
//  - Elapsed time alone never makes a bundle "compliant".
//  - Contradictions are routed to "Requires Review" for a human decision.

import { BUNDLE_MEASURES } from "./constants";
import type { BundleAssessment, BundleMeasure, ComplianceStatus, MeasureKey, SepsisCase, TimingResult, YesNo } from "./types";
import { minutesBetween, nowIso } from "./time";

export const MAX_PLAUSIBLE_MINUTES = 24 * 60;

export function emptyMeasure(key: MeasureKey): BundleMeasure {
  return { key, answer: null, applicability: key === "vasopressors" ? "not_documented" : "applicable", informationMissing: false, note: "" };
}

export function emptyAssessment(caseId: string, user = ""): BundleAssessment {
  const measures = Object.fromEntries(BUNDLE_MEASURES.map((m) => [m.key, emptyMeasure(m.key)])) as Record<MeasureKey, BundleMeasure>;
  return {
    caseId,
    measures,
    hypotensionOccurred: null,
    completionTime: null,
    clinicianAllWithin1h: null,
    physicianName: "",
    documentedAt: null,
    reviewNote: "",
    reviewedBy: null,
    reviewOverride: null,
    updatedAt: nowIso(),
    updatedBy: user,
  };
}

export interface TimingEvaluation {
  result: TimingResult;
  minutes: number | null;
  reason: string;
}

export function evaluateTiming(recognitionTime: string | null, completionTime: string | null, now = nowIso()): TimingEvaluation {
  if (!recognitionTime) return { result: "pending", minutes: null, reason: "Time of Sepsis Recognition not documented" };
  if (new Date(recognitionTime) > new Date(now)) return { result: "requires_review", minutes: null, reason: "Recognition time is in the future" };
  if (!completionTime) return { result: "pending", minutes: null, reason: "Bundle Completion Time not documented" };
  const minutes = minutesBetween(recognitionTime, completionTime);
  if (minutes < 0) return { result: "requires_review", minutes, reason: "Completion time is before recognition time" };
  if (minutes > MAX_PLAUSIBLE_MINUTES) return { result: "requires_review", minutes, reason: "Elapsed time over 24 hours — please verify times" };
  return minutes <= 60
    ? { result: "within_60", minutes, reason: "Completed within 60 minutes of recognition" }
    : { result: "over_60", minutes, reason: "Completed more than 60 minutes after recognition" };
}

export type MeasureState = "done" | "not_done" | "not_applicable" | "missing" | "review";

export interface MeasureEvaluation {
  key: MeasureKey;
  state: MeasureState;
  reason: string;
}

export function evaluateMeasure(a: BundleAssessment, key: MeasureKey): MeasureEvaluation {
  const m = a.measures[key];
  if (m.informationMissing) return { key, state: "missing", reason: "Marked as information missing" };

  if (key === "vasopressors") {
    // Applicability comes only from the separately documented hypotension field.
    const hypo: YesNo = a.hypotensionOccurred;
    if (m.answer === null) {
      if (hypo === "NO") return { key, state: "not_applicable", reason: "No hypotension documented — vasopressors not indicated" };
      return { key, state: "missing", reason: "Vasopressor answer not documented" };
    }
    if (m.answer === "YES") {
      if (hypo === "NO") return { key, state: "review", reason: "Vasopressors YES but hypotension documented as NO" };
      return { key, state: "done", reason: "Vasopressors administered" };
    }
    // answer NO
    if (hypo === "YES") return { key, state: "not_done", reason: "Hypotension occurred and vasopressors NOT administered" };
    if (hypo === "NO") return { key, state: "not_applicable", reason: "NO recorded; hypotension documented as NO" };
    return { key, state: "review", reason: "NO recorded but hypotension not documented — cannot tell if indicated" };
  }

  if (m.applicability === "not_applicable") {
    if (!m.note.trim()) return { key, state: "review", reason: "Marked not applicable without a documented reason" };
    if (m.answer === "YES") return { key, state: "review", reason: "Marked not applicable but answered YES" };
    return { key, state: "not_applicable", reason: `Not applicable: ${m.note}` };
  }
  if (m.answer === null) return { key, state: "missing", reason: "Not documented" };
  return m.answer === "YES" ? { key, state: "done", reason: "Documented YES" } : { key, state: "not_done", reason: "Documented NO" };
}

export interface ComplianceEvaluation {
  status: ComplianceStatus;
  reasons: string[];
  timing: TimingEvaluation;
  measures: MeasureEvaluation[];
  documentedCount: number;
}

export function evaluateCompliance(c: Pick<SepsisCase, "recognitionTime">, a: BundleAssessment | undefined, now = nowIso()): ComplianceEvaluation {
  const assessment = a ?? emptyAssessment("");
  const timing = evaluateTiming(c.recognitionTime, assessment.completionTime, now);
  const measures = BUNDLE_MEASURES.map((m) => evaluateMeasure(assessment, m.key));
  const documentedCount = measures.filter((m) => m.state !== "missing").length;
  const reasons: string[] = [];

  if (assessment.reviewOverride) {
    return { status: assessment.reviewOverride, reasons: [`Quality review decision: ${assessment.reviewNote || "recorded"}`], timing, measures, documentedCount };
  }

  const missing = measures.filter((m) => m.state === "missing");
  const review = measures.filter((m) => m.state === "review");
  if (review.length) reasons.push(...review.map((r) => `${label(r.key)}: ${r.reason}`));
  if (timing.result === "requires_review") reasons.push(timing.reason);

  const clinician = assessment.clinicianAllWithin1h;
  if (clinician === "YES" && timing.result === "over_60") reasons.push("Clinician recorded YES (within 1 hour) but recorded times show over 60 minutes");
  const allApplicableDone = measures.every((m) => m.state === "done" || m.state === "not_applicable");
  if (clinician === "NO" && timing.result === "within_60" && allApplicableDone)
    reasons.push("Clinician recorded NO but all measures and recorded times indicate completion within 60 minutes");
  if (clinician === "YES" && measures.some((m) => m.state === "not_done"))
    reasons.push("Clinician recorded YES but at least one applicable measure is recorded as NO");

  if (reasons.length) return { status: "requires_review", reasons, timing, measures, documentedCount };

  if (missing.length || timing.result === "pending" || clinician === null) {
    if (missing.length) reasons.push(`Missing: ${missing.map((m) => label(m.key)).join(", ")}`);
    if (timing.result === "pending") reasons.push(timing.reason);
    if (clinician === null) reasons.push("'All Bundle Followed within 1 Hour' not answered");
    return { status: "pending", reasons, timing, measures, documentedCount };
  }

  if (allApplicableDone && clinician === "YES" && timing.result === "within_60") {
    return { status: "compliant", reasons: ["All applicable measures YES, completed within 60 minutes"], timing, measures, documentedCount };
  }

  const notDone = measures.filter((m) => m.state === "not_done").map((m) => label(m.key));
  if (notDone.length) reasons.push(`Not done: ${notDone.join(", ")}`);
  if (timing.result === "over_60") reasons.push(timing.reason);
  if (clinician === "NO") reasons.push("Clinician recorded NO for completion within 1 hour");
  return { status: "not_compliant", reasons, timing, measures, documentedCount };
}

function label(k: MeasureKey) {
  return BUNDLE_MEASURES.find((m) => m.key === k)!.short;
}

export const COMPLIANCE_LABELS: Record<ComplianceStatus, string> = {
  compliant: "Within 1 Hour",
  not_compliant: "Not Within 1 Hour",
  pending: "Pending Documentation",
  requires_review: "Requires Review",
};

export const TIMING_LABELS: Record<TimingResult, string> = {
  within_60: "Within 60 Minutes",
  over_60: "Over 60 Minutes",
  pending: "Pending Documentation",
  requires_review: "Requires Review",
};

/** Live minutes since recognition for open (not yet completed) bundles. */
export function minutesSinceRecognition(c: Pick<SepsisCase, "recognitionTime">, now = nowIso()) {
  return c.recognitionTime ? minutesBetween(c.recognitionTime, now) : null;
}

export interface ComplianceSummary {
  total: number;
  compliant: number;
  notCompliant: number;
  pending: number;
  review: number;
  percentage: number | null; // compliant / (compliant + notCompliant)
}

export function summarizeCompliance(evals: ComplianceEvaluation[]): ComplianceSummary {
  const s = { total: evals.length, compliant: 0, notCompliant: 0, pending: 0, review: 0 };
  for (const e of evals) {
    if (e.status === "compliant") s.compliant++;
    else if (e.status === "not_compliant") s.notCompliant++;
    else if (e.status === "pending") s.pending++;
    else s.review++;
  }
  const denom = s.compliant + s.notCompliant;
  return { ...s, percentage: denom ? Math.round((s.compliant / denom) * 1000) / 10 : null };
}

export interface ElementSummary {
  key: MeasureKey;
  yes: number;
  no: number;
  notApplicable: number;
  missing: number;
  review: number;
  denominator: number; // documented & applicable
  percentage: number | null;
}

export function summarizeElements(evals: ComplianceEvaluation[]): ElementSummary[] {
  return BUNDLE_MEASURES.map(({ key }) => {
    const s = { key, yes: 0, no: 0, notApplicable: 0, missing: 0, review: 0 };
    for (const e of evals) {
      const m = e.measures.find((x) => x.key === key)!;
      if (m.state === "done") s.yes++;
      else if (m.state === "not_done") s.no++;
      else if (m.state === "not_applicable") s.notApplicable++;
      else if (m.state === "missing") s.missing++;
      else s.review++;
    }
    const denominator = s.yes + s.no;
    return { ...s, denominator, percentage: denominator ? Math.round((s.yes / denominator) * 1000) / 10 : null };
  });
}
