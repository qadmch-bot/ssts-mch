"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, Calculator, CheckCircle2, ClipboardPen, FlaskConical, Info, Lock, Save, ShieldCheck, Timer } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, Field, Input, Select, Textarea, YesNoToggle, cn } from "@/components/ui";
import { BundleBadge, Identifiers } from "@/components/case-bits";
import { useToast } from "@/components/toast";
import { useNow, useStore } from "@/lib/store";
import { deptName, saveBundle } from "@/lib/engine";
import { BUNDLE_COMPLETION_QUESTION, BUNDLE_MEASURES, LAB_STATUS_LABELS } from "@/lib/constants";
import { COMPLIANCE_LABELS, TIMING_LABELS, emptyAssessment, evaluateCompliance, minutesSinceRecognition } from "@/lib/bundle";
import { fmtDateTime, fromRiyadhInput, humanDuration, nowIso, toRiyadhInput } from "@/lib/time";
import type { BundleAssessment, ComplianceStatus, MeasureKey, YesNo } from "@/lib/types";

function Inner() {
  const id = useSearchParams().get("id");
  const { state, can, act } = useStore();
  const toast = useToast();
  const now = useNow(10_000);
  const c = state.cases.find((x) => x.id === id);
  const stored = state.bundles.find((b) => b.caseId === id);
  const [draft, setDraft] = useState<BundleAssessment | null>(null);

  useEffect(() => {
    if (c) setDraft(stored ? structuredClone(stored) : emptyAssessment(c.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, stored?.updatedAt]);

  if (!c)
    return (
      <Alert tone="amber" title="Case not found">
        <Link href="/bundle" className="underline">
          Back to Hour-1 Bundle
        </Link>
      </Alert>
    );
  if (!draft) return null;

  const editable = can("bundle.edit") && (c.status === "active" || can("bundle.review"));
  const ev = evaluateCompliance(c, draft, now);
  const elapsed = minutesSinceRecognition(c, now);
  const thr = state.settings.reminders;
  const labs = state.labs.filter((l) => l.caseId === c.id && l.linkedMeasure);
  const dirty = JSON.stringify(draft) !== JSON.stringify(stored ?? emptyAssessment(c.id));

  const setM = (k: MeasureKey, patch: Partial<BundleAssessment["measures"][MeasureKey]>) =>
    setDraft((d) => (d ? { ...d, measures: { ...d.measures, [k]: { ...d.measures[k], ...patch } } } : d));
  const set = <K extends keyof BundleAssessment>(k: K, v: BundleAssessment[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  const save = () => {
    const { caseId: _c, updatedAt: _u, updatedBy: _b, ...patch } = draft;
    void _c;
    void _u;
    void _b;
    const r = act((s, ctx) => saveBundle(s, ctx, c.id, patch), () => ({ fn: "save_bundle", args: { p_case: c.id, p: patch } }));
    if (r.ok) {
      const after = evaluateCompliance(c, r.value, nowIso());
      toast("success", "Hour-1 Bundle saved", `${c.caseNo} · ${COMPLIANCE_LABELS[after.status]}${draft.completionTime && draft.completionTime !== stored?.completionTime ? " · completion notification queued" : ""}`);
    } else toast(r.error === "No changes to save" ? "info" : "error", r.error === "No changes to save" ? "No changes to save" : "Not saved", r.error === "No changes to save" ? undefined : r.error);
  };

  const timerOpen = !draft.completionTime && c.status === "active" && elapsed !== null;
  const timerCls = elapsed === null ? "" : elapsed >= thr.bundleOverdueMinutes ? "from-red-600 to-red-500" : elapsed >= thr.bundleApproachingMinutes ? "from-orange-500 to-amber-500" : "from-teal-600 to-teal-500";

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-24">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/bundle" className="rounded-lg p-2 text-slate-500 hover:bg-white" aria-label="Back">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-navy-900 sm:text-[28px]">Sepsis Hour-1 Bundle</h1>
          <p className="text-sm text-slate-500">
            <Link href={`/cases/view?id=${c.id}`} className="font-bold text-brand-600 hover:underline">
              {c.caseNo}
            </Link>{" "}
            · {deptName(state, c.emergencyDepartmentId)} · {c.age} {c.ageUnit} · {c.sex} · Consultant: {c.consultant || "—"}
          </p>
        </div>
        <div className="ml-auto">
          <BundleBadge s={state} c={c} now={now} />
        </div>
      </div>

      {/* Timer & timing */}
      <div className="grid gap-4 md:grid-cols-[1.1fr_1fr]">
        <div className={cn("rounded-[14px] bg-gradient-to-br p-5 text-white shadow", timerOpen ? timerCls : "from-navy-900 to-navy-800")}>
          <div className="flex items-center gap-2 text-sm font-semibold text-white/80">
            <Timer className="size-4" /> {timerOpen ? "Time since Sepsis Recognition" : "Recognition → Bundle Completion"}
          </div>
          <p className="mt-1 text-4xl font-extrabold tracking-tight">
            {timerOpen ? humanDuration(elapsed!) : ev.timing.minutes !== null ? `${ev.timing.minutes} min` : "—"}
          </p>
          <p className="mt-1 text-sm text-white/85">
            {timerOpen
              ? elapsed! >= thr.bundleOverdueMinutes
                ? "Bundle documentation overdue — complete and record the completion time."
                : `${Math.max(0, 60 - elapsed!)} min remaining to the 1-hour mark`
              : TIMING_LABELS[ev.timing.result] + (ev.timing.result === "requires_review" ? ` — ${ev.timing.reason}` : "")}
          </p>
        </div>
        <Card className="grid grid-cols-2 gap-3 p-4 text-sm">
          <div>
            <p className="text-xs font-semibold text-slate-500">Diagnosis Time</p>
            <p className="font-semibold text-navy-900">{fmtDateTime(c.diagnosisTime)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500">Recorded Recognition Time</p>
            <p className="font-semibold text-navy-900">{fmtDateTime(c.recognitionTime)}</p>
          </div>
          <div className="col-span-2">
            <p className="text-xs font-semibold text-slate-500">Patient (restricted)</p>
            <Identifiers caseId={c.id} />
          </div>
          <p className="col-span-2 text-xs text-slate-400">Times are corrected from the case page by Quality Admin, with a documented reason.</p>
        </Card>
      </div>

      {/* Progress */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          {BUNDLE_MEASURES.map((m, i) => {
            const st = ev.measures[i].state;
            return (
              <div key={m.key} className="flex items-center gap-2">
                {i > 0 && <span className="text-slate-300">•</span>}
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold",
                    { done: "border-emerald-200 bg-emerald-50 text-emerald-700", not_done: "border-red-200 bg-red-50 text-red-700", not_applicable: "border-slate-200 bg-slate-50 text-slate-500", missing: "border-amber-200 bg-white text-amber-700", review: "border-violet-200 bg-violet-50 text-violet-700" }[st],
                  )}
                >
                  {st === "done" && <CheckCircle2 className="size-3.5" />}
                  {m.key === "vasopressors" ? "Vasopressors (if indicated)" : m.short === "Lactate" ? "Measure Lactate" : m.short}
                </span>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-slate-500">Measures may be performed at the same time — this list is not a required sequence.</p>
      </Card>

      {!editable && (
        <Alert tone="blue" icon={<Lock />}>
          {c.status === "closed" ? "Case closed — read-only." : "Read-only for your role. Emergency Department and Quality Admin can document the bundle."}
        </Alert>
      )}

      {/* Measures */}
      <Card>
        <CardHeader icon={<ClipboardPen />} title="Bundle Measures" subtitle="Original form answers (YES / NO) · electronic documentation kept separately" />
        <div className="divide-y divide-slate-100">
          {BUNDLE_MEASURES.map((m, i) => {
            const mm = draft.measures[m.key];
            const st = ev.measures[i];
            const linked = labs.filter((l) => l.linkedMeasure === m.key);
            return (
              <div key={m.key} className="grid gap-3 px-5 py-4 md:grid-cols-[1fr_auto]">
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wide text-teal-700">
                    Measure {i + 1} · {m.title}
                  </p>
                  <p className="mt-0.5 font-semibold text-navy-900">{m.question}</p>
                  {m.key === "vasopressors" && (
                    <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 px-3 py-2">
                      <span className="text-sm text-slate-700">Did hypotension occur during/after fluids?</span>
                      <YesNoToggle value={draft.hypotensionOccurred} onChange={(v) => set("hypotensionOccurred", v)} disabled={!editable} />
                      <span className="text-xs text-slate-500">Separate field — determines whether vasopressors were indicated.</span>
                    </div>
                  )}
                  {linked.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {linked.map((l) => (
                        <Badge key={l.id} tone={l.status === "result_available" ? "green" : "amber"}>
                          <FlaskConical /> {l.testType}: {LAB_STATUS_LABELS[l.status]}
                        </Badge>
                      ))}
                      <span className="text-xs text-slate-500">Lab status is informational — a pending result does not mean the sample was not taken.</span>
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                    {m.key !== "vasopressors" && (
                      <label className="flex items-center gap-1.5 text-slate-600">
                        <input
                          type="checkbox"
                          disabled={!editable}
                          checked={mm.applicability === "not_applicable"}
                          onChange={(e) => setM(m.key, { applicability: e.target.checked ? "not_applicable" : "applicable" })}
                          className="size-4 accent-navy-900"
                        />
                        Clinically not applicable
                      </label>
                    )}
                    <label className="flex items-center gap-1.5 text-slate-600">
                      <input type="checkbox" disabled={!editable} checked={mm.informationMissing} onChange={(e) => setM(m.key, { informationMissing: e.target.checked })} className="size-4 accent-navy-900" />
                      Information missing
                    </label>
                    {(mm.applicability === "not_applicable" || mm.informationMissing || mm.note) && (
                      <Input
                        value={mm.note}
                        disabled={!editable}
                        onChange={(e) => setM(m.key, { note: e.target.value })}
                        placeholder={mm.applicability === "not_applicable" ? "Reason (required)" : "Note"}
                        className="h-8 max-w-sm"
                      />
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-start gap-1.5 md:items-end">
                  <YesNoToggle value={mm.answer} onChange={(v: YesNo) => setM(m.key, { answer: v })} disabled={!editable} />
                  <span className={cn("text-xs", st.state === "review" ? "font-semibold text-violet-700" : "text-slate-500")}>{st.reason}</span>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Completion */}
      <Card>
        <CardHeader icon={<CheckCircle2 />} title="Bundle Completion" />
        <div className="grid gap-4 p-5 sm:grid-cols-3">
          <Field label="Bundle Completion Time" hint="Recorded date and time">
            <Input
              type="datetime-local"
              disabled={!editable}
              value={toRiyadhInput(draft.completionTime)}
              max={toRiyadhInput(nowIso())}
              min={toRiyadhInput(c.recognitionTime)}
              onChange={(e) => set("completionTime", fromRiyadhInput(e.target.value))}
            />
          </Field>
          <Field label="Physician Name">
            <Input disabled={!editable} value={draft.physicianName} onChange={(e) => set("physicianName", e.target.value)} />
          </Field>
          <Field label="Date and Time" hint="When the form was completed">
            <Input type="datetime-local" disabled={!editable} value={toRiyadhInput(draft.documentedAt)} max={toRiyadhInput(nowIso())} onChange={(e) => set("documentedAt", fromRiyadhInput(e.target.value))} />
          </Field>
          <div className="sm:col-span-3">
            <p className="mb-2 font-semibold text-navy-900">{BUNDLE_COMPLETION_QUESTION}</p>
            <YesNoToggle value={draft.clinicianAllWithin1h} onChange={(v) => set("clinicianAllWithin1h", v)} disabled={!editable} />
          </div>
        </div>
      </Card>

      {/* Calculation */}
      <Card>
        <CardHeader icon={<Calculator />} title="Electronic Monitoring Result" subtitle={state.settings.complianceRulesApproved ? "Hospital-approved rules" : "Default rules — pending hospital approval"} />
        <div className="grid gap-4 p-5 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Clinician-recorded</p>
            <p className="mt-1 text-sm text-slate-600">All bundle within 1 hour</p>
            <p className="text-2xl font-extrabold text-navy-900">{draft.clinicianAllWithin1h ?? "Not answered"}</p>
          </div>
          <div className="rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">System-calculated timing</p>
            <p className="mt-1 text-sm text-slate-600">Recognition → completion</p>
            <p className="text-2xl font-extrabold text-navy-900">{ev.timing.minutes !== null ? `${ev.timing.minutes} min` : "—"}</p>
            <p className="text-sm font-semibold text-slate-600">{TIMING_LABELS[ev.timing.result]}</p>
          </div>
          <div className="rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Compliance status</p>
            <p className={cn("mt-1 text-xl font-extrabold", { compliant: "text-emerald-600", not_compliant: "text-red-600", pending: "text-amber-600", requires_review: "text-violet-600" }[ev.status])}>{COMPLIANCE_LABELS[ev.status]}</p>
            <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
              {ev.reasons.map((r) => (
                <li key={r}>• {r}</li>
              ))}
            </ul>
          </div>
        </div>
        <p className="flex gap-2 px-5 pb-4 text-xs text-slate-500">
          <Info className="size-4 shrink-0" /> The clinician&apos;s answer and the calculated timing are kept separately. Elapsed time alone never marks a bundle compliant; contradictions are sent to Quality
          review.
        </p>
      </Card>

      {can("bundle.review") && (
        <Card>
          <CardHeader icon={<ShieldCheck />} title="Quality Review" subtitle="Quality Admin decision after reviewing the record (audited)" />
          <div className="grid gap-4 p-5 sm:grid-cols-[260px_1fr]">
            <Field label="Review decision">
              <Select value={draft.reviewOverride ?? ""} onChange={(e) => set("reviewOverride", (e.target.value || null) as ComplianceStatus | null)}>
                <option value="">No decision — use calculation</option>
                <option value="compliant">Confirm: Within 1 Hour</option>
                <option value="not_compliant">Confirm: Not Within 1 Hour</option>
                <option value="pending">Return: Pending Documentation</option>
              </Select>
            </Field>
            <Field label="Review note">
              <Textarea value={draft.reviewNote} onChange={(e) => set("reviewNote", e.target.value)} placeholder="Why this decision was made" />
            </Field>
          </div>
        </Card>
      )}

      {editable && (
        <div className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:left-[240px]">
          <div className="mx-auto flex max-w-5xl items-center justify-end gap-3">
            {dirty ? (
              <span className="mr-auto flex items-center gap-1.5 text-sm font-semibold text-amber-600">
                <AlertTriangle className="size-4" /> Unsaved changes
              </span>
            ) : (
              <span className="mr-auto text-sm text-slate-500">Last saved {stored ? fmtDateTime(stored.updatedAt) : "—"}</span>
            )}
            <Button size="lg" disabled={!dirty} onClick={save}>
              <Save /> Save Bundle
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BundleFormPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
