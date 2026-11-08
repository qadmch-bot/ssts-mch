"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Ambulance, ArrowLeft, BedDouble, Check, ClipboardList, FlaskConical, Flag, History, Pencil, Send, Timer, RotateCcw } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, Dialog, Empty, Field, Input, Select, Textarea, cn } from "@/components/ui";
import { BundleBadge, Identifiers, LabBadge, OutcomeDialog, StatusBadge, caseBundle } from "@/components/case-bits";
import { DeliveryBadge } from "@/components/delivery";
import { useToast } from "@/components/toast";
import { useNow, useStore } from "@/lib/store";
import { correctOutcome, deptName, updateCaseTimes } from "@/lib/engine";
import { BUNDLE_MEASURES, EVENT_LABELS, LAB_STATUS_LABELS, OUTCOME_LABELS } from "@/lib/constants";
import { COMPLIANCE_LABELS, TIMING_LABELS } from "@/lib/bundle";
import { fmtDate, fmtDateTime, fromRiyadhInput, nowIso, toRiyadhInput } from "@/lib/time";
import type { FinalOutcomeType } from "@/lib/types";

function Inner() {
  const id = useSearchParams().get("id");
  const { state, can, act } = useStore();
  const now = useNow();
  const toast = useToast();
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [correctOpen, setCorrectOpen] = useState(false);
  const [timesOpen, setTimesOpen] = useState(false);
  const c = state.cases.find((x) => x.id === id);
  if (!c)
    return (
      <Card className="mx-auto max-w-xl">
        <Empty icon={<ClipboardList />} title="Case not found">
          <Link href="/cases" className="text-brand-600 hover:underline">
            Back to cases
          </Link>
        </Empty>
      </Card>
    );

  const bundle = state.bundles.find((b) => b.caseId === c.id);
  const ev = caseBundle(state, c, now);
  const labs = state.labs.filter((l) => l.caseId === c.id);
  const updates = state.updates.filter((u) => u.caseId === c.id).sort((a, b) => b.updateAt.localeCompare(a.updateAt));
  const events = state.events.filter((e) => e.caseId === c.id);
  const deliveries = state.deliveries.filter((d) => events.some((e) => e.id === d.eventId));
  const audit = state.audit.filter((a) => a.caseId === c.id);

  const steps = [
    { label: "Emergency", sub: fmtDateTime(c.createdAt), done: true, icon: Ambulance },
    { label: "Hour-1 Bundle", sub: COMPLIANCE_LABELS[ev.status], done: !!bundle?.completionTime, icon: Timer },
    { label: "Laboratory", sub: labs.length ? `${labs.filter((l) => l.status === "result_available").length}/${labs.length} results` : "No tests", done: labs.length > 0 && labs.every((l) => ["result_available", "cancelled"].includes(l.status)), icon: FlaskConical },
    { label: "Inpatient", sub: updates.length ? `${updates.length} update(s)` : "No updates", done: updates.length > 0, icon: BedDouble },
    { label: "Final Outcome", sub: c.outcome ? OUTCOME_LABELS[c.outcome] : "Pending", done: !!c.outcome, icon: Flag },
  ];

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/cases" className="rounded-lg p-2 text-slate-500 hover:bg-white" aria-label="Back">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-[28px] font-bold tracking-tight text-navy-900">{c.caseNo}</h1>
        <StatusBadge c={c} />
        <BundleBadge s={state} c={c} now={now} />
        <LabBadge s={state} caseId={c.id} />
        <div className="no-print ml-auto flex flex-wrap gap-2">
          {can("bundle.edit") && (
            <Link href={`/bundle/form?id=${c.id}`}>
              <Button variant="teal">
                <Timer /> Hour-1 Bundle
              </Button>
            </Link>
          )}
          {can("lab.edit") && (
            <Link href={`/laboratory?case=${c.id}&add=1`}>
              <Button variant="outline">
                <FlaskConical /> Lab Test
              </Button>
            </Link>
          )}
          {can("inpatient.edit") && c.status === "active" && (
            <Link href={`/inpatient?case=${c.id}`}>
              <Button variant="outline">
                <BedDouble /> Update
              </Button>
            </Link>
          )}
          {can("outcome.record") && !c.outcome && (
            <Button onClick={() => setOutcomeOpen(true)}>
              <Flag /> Record Outcome
            </Button>
          )}
          {can("outcome.correct") && c.outcome && (
            <Button variant="outline" onClick={() => setCorrectOpen(true)}>
              <Pencil /> Correct / Reopen
            </Button>
          )}
        </div>
      </div>

      {/* Timeline */}
      <Card className="px-4 py-5">
        <ol className="grid grid-cols-5 gap-1">
          {steps.map((s, i) => (
            <li key={s.label} className="relative flex flex-col items-center text-center">
              {i > 0 && <span className={cn("absolute right-1/2 top-5 h-0.5 w-full", steps[i - 1].done ? "bg-teal-500" : "bg-slate-200")} />}
              <div className={cn("relative z-10 grid size-10 place-items-center rounded-full", s.done ? "bg-teal-500 text-white" : "border-2 border-slate-300 bg-white text-slate-400")}>
                {s.done ? <Check className="size-5" /> : <s.icon className="size-5" />}
              </div>
              <p className="mt-2 text-xs font-bold text-navy-900 sm:text-sm">{s.label}</p>
              <p className="hidden text-xs text-slate-500 sm:block">{s.sub}</p>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-center text-xs text-slate-400">Stages reflect what has been recorded; bundle, laboratory and inpatient steps can progress in parallel.</p>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Case Details"
              action={
                can("bundle.review") && (
                  <Button size="sm" variant="ghost" onClick={() => setTimesOpen(true)}>
                    <Pencil /> Correct times
                  </Button>
                )
              }
            />
            <dl className="divide-y divide-slate-100 text-sm">
              {[
                ["MRN / Patient", <Identifiers key="i" caseId={c.id} />],
                ["Age / Sex", `${c.age ?? "—"} ${c.ageUnit} · ${c.sex || "—"}`],
                ["Category", c.patientCategory || "—"],
                ["Consultant", c.consultant || "—"],
                ["Physician", c.physicianName],
                ["Date", fmtDate(c.caseDate + "T12:00:00Z")],
                ["Emergency Dept.", deptName(state, c.emergencyDepartmentId)],
                ["Current Dept.", deptName(state, c.currentDepartmentId)],
                ["Diagnosis Time", fmtDateTime(c.diagnosisTime)],
                ["Sepsis Recognition", fmtDateTime(c.recognitionTime)],
                ["Registered", `${fmtDateTime(c.createdAt)} · ${state.users.find((u) => u.id === c.createdBy)?.name ?? "—"}`],
                ["Final Outcome", c.outcome ? `${OUTCOME_LABELS[c.outcome]} · ${fmtDateTime(c.outcomeAt)}` : "Pending"],
              ].map(([k, v]) => (
                <div key={k as string} className="grid grid-cols-[130px_1fr] gap-2 px-5 py-2.5">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="font-medium text-slate-800">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Notifications for this case" icon={<Send />} />
            <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto text-sm">
              {events.map((e) => (
                <li key={e.id} className="px-5 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-navy-900">{EVENT_LABELS[e.eventType]}</span>
                    <span className="text-xs text-slate-500">{fmtDateTime(e.createdAt)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {deliveries
                      .filter((d) => d.eventId === e.id)
                      .map((d) => (
                        <DeliveryBadge key={d.id} d={d} compact />
                      ))}
                    {!deliveries.some((d) => d.eventId === e.id) && <span className="text-xs text-slate-400">In-app only / no matching recipients</span>}
                  </div>
                </li>
              ))}
              {!events.length && <Empty title="No notifications" />}
            </ul>
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader
              title="Hour-1 Bundle"
              icon={<Timer />}
              subtitle={ev.timing.minutes !== null ? `Recognition → completion: ${ev.timing.minutes} min · ${TIMING_LABELS[ev.timing.result]}` : TIMING_LABELS[ev.timing.result]}
              action={<BundleBadge s={state} c={c} now={now} />}
            />
            <div className="grid gap-2 p-4 sm:grid-cols-5">
              {BUNDLE_MEASURES.map((m) => {
                const st = ev.measures.find((x) => x.key === m.key)!;
                const ans = bundle?.measures[m.key].answer;
                const cls = { done: "border-emerald-200 bg-emerald-50", not_done: "border-red-200 bg-red-50", not_applicable: "border-slate-200 bg-slate-50", missing: "border-amber-200 bg-amber-50", review: "border-violet-200 bg-violet-50" }[st.state];
                return (
                  <div key={m.key} className={cn("rounded-xl border p-3", cls)} title={st.reason}>
                    <p className="text-xs font-semibold text-slate-600">{m.short}</p>
                    <p className="mt-1 text-lg font-extrabold text-navy-900">{ans ?? "—"}</p>
                    <p className="text-[11px] leading-tight text-slate-500">{st.state === "done" ? "Done" : st.state === "not_done" ? "Not done" : st.state === "not_applicable" ? "Not applicable" : st.state === "missing" ? "Not documented" : "Review"}</p>
                  </div>
                );
              })}
            </div>
            {ev.reasons.length > 0 && (
              <ul className="space-y-0.5 px-5 pb-4 text-xs text-slate-600">
                {ev.reasons.map((r) => (
                  <li key={r}>• {r}</li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Laboratory Tests" icon={<FlaskConical />} />
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Test</th>
                    <th>Status</th>
                    <th>Requested</th>
                    <th>Result</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {labs.map((l) => (
                    <tr key={l.id}>
                      <td className="font-semibold">
                        {l.testType} {l.linkedMeasure && <Badge tone="teal">Bundle</Badge>}
                      </td>
                      <td>
                        <Badge tone={l.status === "result_available" ? "green" : l.status === "cancelled" ? "gray" : "amber"}>{LAB_STATUS_LABELS[l.status]}</Badge>
                      </td>
                      <td className="whitespace-nowrap text-slate-600">{fmtDateTime(l.requestedAt)}</td>
                      <td className="whitespace-nowrap text-slate-600">{fmtDateTime(l.resultAt)}</td>
                      <td className="text-slate-600">{l.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!labs.length && <Empty title="No laboratory tests recorded" />}
            </div>
          </Card>

          <Card>
            <CardHeader title="Department Updates" icon={<BedDouble />} />
            <ul className="divide-y divide-slate-100">
              {updates.map((u) => (
                <li key={u.id} className="px-5 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-navy-900">{deptName(state, u.departmentId)}</span>
                    <Badge tone="blue">{u.status}</Badge>
                    {u.transferToId && <Badge tone="purple">Transfer → {deptName(state, u.transferToId)}</Badge>}
                    <span className="ml-auto text-xs text-slate-500">
                      {fmtDateTime(u.updateAt)} · {state.users.find((x) => x.id === u.createdBy)?.name}
                    </span>
                  </div>
                  {u.notes && <p className="mt-1 text-slate-600">{u.notes}</p>}
                </li>
              ))}
              {!updates.length && <Empty title="No department updates yet" />}
            </ul>
          </Card>

          {can("audit.view") && (
            <Card>
              <CardHeader title="Audit Trail" icon={<History />} subtitle="Immutable record of changes to this case" />
              <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto text-sm">
                {audit.map((a) => (
                  <li key={a.id} className="grid gap-1 px-5 py-2.5 sm:grid-cols-[170px_150px_1fr]">
                    <span className="text-xs text-slate-500">{fmtDateTime(a.at)}</span>
                    <span className="font-semibold text-navy-900">{a.userName}</span>
                    <span className="text-slate-600">
                      <code className="mr-1 rounded bg-slate-100 px-1 text-xs">{a.action}</code>
                      {a.detail}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <OutcomeDialog c={c} open={outcomeOpen} onClose={() => setOutcomeOpen(false)} />
      <CorrectOutcomeDialog
        open={correctOpen}
        onClose={() => setCorrectOpen(false)}
        current={c.outcome}
        currentAt={c.outcomeAt}
        onSave={(o, at, reason) => {
          const r = act((s, ctx) => correctOutcome(s, ctx, c.id, { outcome: o, outcomeAt: at, reason }), () => ({ fn: "correct_outcome", args: { p_case: c.id, p_outcome: o, p_at: at, p_reason: reason } }));
          if (r.ok) {
            toast("success", o ? "Outcome corrected" : "Case reopened", "Recorded in the audit trail.");
            setCorrectOpen(false);
          } else toast("error", "Not saved", r.error);
        }}
      />
      <TimesDialog
        open={timesOpen}
        onClose={() => setTimesOpen(false)}
        diagnosis={c.diagnosisTime}
        recognition={c.recognitionTime}
        onSave={(d, r, reason) => {
          const res = act((s, ctx) => updateCaseTimes(s, ctx, c.id, { diagnosisTime: d, recognitionTime: r, reason }), () => ({ fn: "correct_case_times", args: { p_case: c.id, p_diagnosis: d, p_recognition: r, p_reason: reason } }));
          if (res.ok) {
            toast("success", "Clinical times corrected", "Recorded in the audit trail.");
            setTimesOpen(false);
          } else toast("error", "Not saved", res.error);
        }}
      />
      {c.status === "closed" && !can("outcome.correct") && (
        <Alert tone="blue" className="no-print">
          This case is closed. Corrections require Quality Admin.
        </Alert>
      )}
    </div>
  );
}

function CorrectOutcomeDialog({
  open,
  onClose,
  current,
  currentAt,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  current: FinalOutcomeType | null;
  currentAt: string | null;
  onSave: (o: FinalOutcomeType | null, at: string | null, reason: string) => void;
}) {
  const [o, setO] = useState<string>(current ?? "");
  const [at, setAt] = useState(toRiyadhInput(currentAt));
  const [reason, setReason] = useState("");
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Correct Final Outcome"
      icon={<Pencil />}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={o === "" ? "warning" : "primary"} onClick={() => onSave(o === "" ? null : (o as FinalOutcomeType), fromRiyadhInput(at), reason)}>
            {o === "" ? (
              <>
                <RotateCcw /> Reopen Case
              </>
            ) : (
              "Save Correction"
            )}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Alert tone="amber">Quality Admin only. The original value, the new value and your reason are kept in the audit trail.</Alert>
        <Field label="Corrected outcome">
          <Select value={o} onChange={(e) => setO(e.target.value)}>
            <option value="">— Reopen case (remove outcome) —</option>
            {Object.entries(OUTCOME_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        {o !== "" && (
          <Field label="Outcome Date & Time (Riyadh)" required>
            <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
          </Field>
        )}
        <Field label="Reason for correction" required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Minimum 10 characters" />
        </Field>
      </div>
    </Dialog>
  );
}

function TimesDialog({
  open,
  onClose,
  diagnosis,
  recognition,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  diagnosis: string | null;
  recognition: string | null;
  onSave: (d: string | null, r: string | null, reason: string) => void;
}) {
  const [d, setD] = useState(toRiyadhInput(diagnosis));
  const [r, setR] = useState(toRiyadhInput(recognition));
  const [reason, setReason] = useState("");
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Correct clinical times"
      icon={<Pencil />}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(fromRiyadhInput(d), fromRiyadhInput(r), reason)}>Save</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Diagnosis Time">
          <Input type="datetime-local" value={d} max={toRiyadhInput(nowIso())} onChange={(e) => setD(e.target.value)} />
        </Field>
        <Field label="Time of Sepsis Recognition">
          <Input type="datetime-local" value={r} max={toRiyadhInput(nowIso())} onChange={(e) => setR(e.target.value)} />
        </Field>
        <Field label="Reason" required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

export default function CaseViewPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
