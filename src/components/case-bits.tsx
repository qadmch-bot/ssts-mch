"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, BedDouble, CheckCircle2, Clock, DoorOpen, Flag, HeartPulse, Lock, Activity, Eye, EyeOff } from "lucide-react";
import { COMPLIANCE_LABELS, evaluateCompliance, minutesSinceRecognition, type ComplianceEvaluation } from "@/lib/bundle";
import { OTHER_OUTCOMES, OUTCOME_LABELS, PRIMARY_OUTCOMES } from "@/lib/constants";
import { labSummary, recordOutcome, type State } from "@/lib/engine";
import { useStore } from "@/lib/store";
import { fromRiyadhInput, humanDuration, nowIso, toRiyadhInput } from "@/lib/time";
import type { FinalOutcomeType, SepsisCase } from "@/lib/types";
import { Alert, Badge, Button, Dialog, Field, Input, Textarea, cn, type Tone } from "./ui";
import { useToast } from "./toast";

export function caseBundle(s: State, c: SepsisCase, now = nowIso()): ComplianceEvaluation {
  return evaluateCompliance(c, s.bundles.find((b) => b.caseId === c.id), now);
}

export function BundleBadge({ s, c, now }: { s: State; c: SepsisCase; now?: string }) {
  const ev = caseBundle(s, c, now);
  const b = s.bundles.find((x) => x.caseId === c.id);
  if (ev.status === "pending" && !b?.completionTime && c.status === "active") {
    const m = minutesSinceRecognition(c, now);
    const thr = s.settings.reminders;
    if (m !== null) {
      const tone: Tone = m >= thr.bundleOverdueMinutes ? "red" : m >= thr.bundleApproachingMinutes ? "orange" : "amber";
      return (
        <Badge tone={tone}>
          <Clock /> {m >= thr.bundleOverdueMinutes ? "Overdue" : "Open"} · {humanDuration(m)}
        </Badge>
      );
    }
  }
  const tone: Record<string, Tone> = { compliant: "green", not_compliant: "red", pending: "amber", requires_review: "purple" };
  const Icon = ev.status === "compliant" ? CheckCircle2 : ev.status === "requires_review" ? AlertTriangle : ev.status === "not_compliant" ? AlertTriangle : Clock;
  return (
    <Badge tone={tone[ev.status]}>
      <Icon /> {COMPLIANCE_LABELS[ev.status]}
    </Badge>
  );
}

export function LabBadge({ s, caseId }: { s: State; caseId: string }) {
  const l = labSummary(s, caseId);
  return <Badge tone={l.tone}>{l.label}</Badge>;
}

export function StatusBadge({ c }: { c: SepsisCase }) {
  if (c.outcome) {
    const map: Record<FinalOutcomeType, { tone: Tone; icon: React.ReactNode }> = {
      discharged: { tone: "green", icon: <CheckCircle2 /> },
      dama: { tone: "orange", icon: <DoorOpen /> },
      death: { tone: "red", icon: <HeartPulse /> },
      transferred_facility: { tone: "gray", icon: <Flag /> },
      sepsis_ruled_out: { tone: "gray", icon: <Flag /> },
      administrative_closure: { tone: "gray", icon: <Flag /> },
    };
    return (
      <Badge tone={map[c.outcome].tone}>
        {map[c.outcome].icon} {OUTCOME_LABELS[c.outcome]}
      </Badge>
    );
  }
  const inpatient = !["In Emergency", "Reopened"].includes(c.currentStatus);
  return (
    <Badge tone="blue">
      {inpatient ? <BedDouble /> : <Activity />} {c.currentStatus}
    </Badge>
  );
}

/** Restricted identifiers (MRN / patient name) — masked unless the role is permitted. */
export function Identifiers({ caseId, compact }: { caseId: string; compact?: boolean }) {
  const { state, can } = useStore();
  const [show, setShow] = useState(false);
  const id = state.identifiers.find((i) => i.caseId === caseId);
  if (!can("case.viewIdentifiers") || !id)
    return (
      <span className="inline-flex items-center gap-1 text-xs text-slate-400">
        <Lock className="size-3.5" /> Restricted
      </span>
    );
  const mask = (v: string) => (v.length <= 3 ? "***" : "•".repeat(Math.min(6, v.length - 3)) + v.slice(-3));
  return (
    <span className={cn("inline-flex items-center gap-2", compact ? "text-xs" : "text-sm")}>
      <span className="font-mono">{show ? id.mrn : mask(id.mrn)}</span>
      {!compact && <span className="text-slate-600">{show ? id.patientName : "Name hidden"}</span>}
      <button onClick={() => setShow((x) => !x)} className="text-slate-400 hover:text-brand-600" aria-label={show ? "Hide identifiers" : "Show identifiers"}>
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </span>
  );
}

export function OutcomeDialog({ c, open, onClose, initial }: { c: SepsisCase; open: boolean; onClose: () => void; initial?: FinalOutcomeType }) {
  const { act } = useStore();
  const toast = useToast();
  const [outcome, setOutcome] = useState<FinalOutcomeType | null>(initial ?? null);
  const [at, setAt] = useState(toRiyadhInput(nowIso()));
  const [notes, setNotes] = useState("");
  const [confirm, setConfirm] = useState(false);
  const close = () => {
    setConfirm(false);
    onClose();
  };
  const save = () => {
    if (!outcome) return;
    const r = act((s, ctx) => recordOutcome(s, ctx, c.id, outcome, fromRiyadhInput(at), notes), () => ({ fn: "record_outcome", args: { p_case: c.id, p_outcome: outcome, p_at: fromRiyadhInput(at), p_notes: notes } }));
    if (r.ok) {
      toast("success", `Final outcome recorded: ${OUTCOME_LABELS[outcome]}`, `${c.caseNo} closed. Notifications queued per rules.`);
      close();
    } else {
      toast("error", "Could not record outcome", r.error);
      setConfirm(false);
    }
  };
  const btn: Record<string, string> = {
    discharged: "border-emerald-300 bg-emerald-50 text-emerald-700 data-[on=true]:bg-emerald-600 data-[on=true]:text-white",
    dama: "border-orange-300 bg-orange-50 text-orange-700 data-[on=true]:bg-orange-500 data-[on=true]:text-white",
    death: "border-red-300 bg-red-50 text-red-700 data-[on=true]:bg-red-600 data-[on=true]:text-white",
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      icon={<Flag />}
      title={`Record Final Outcome · ${c.caseNo}`}
      footer={
        confirm ? (
          <>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Back
            </Button>
            <Button variant={outcome === "death" ? "danger" : "primary"} onClick={save}>
              Confirm &amp; Save
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button disabled={!outcome || !at} onClick={() => setConfirm(true)}>
              Continue
            </Button>
          </>
        )
      }
    >
      {confirm && outcome ? (
        <Alert tone={outcome === "death" ? "red" : "amber"} icon={<AlertTriangle />} title="Please confirm the final outcome">
          <p>
            Case <b>{c.caseNo}</b> will be recorded as <b>{OUTCOME_LABELS[outcome]}</b> at <b>{at.replace("T", " ")}</b> (Riyadh time) and closed. WhatsApp, email and in-app notifications will be
            queued for configured recipients. Corrections afterwards require Quality Admin and a documented reason.
          </p>
        </Alert>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {PRIMARY_OUTCOMES.map((o) => (
              <button key={o} data-on={outcome === o} onClick={() => setOutcome(o)} className={cn("rounded-xl border-2 px-2 py-4 text-sm font-extrabold tracking-wide transition", btn[o])}>
                {OUTCOME_LABELS[o].toUpperCase()}
              </button>
            ))}
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Other closures (not counted as Discharged / DAMA / Death)</p>
            <div className="flex flex-wrap gap-2">
              {OTHER_OUTCOMES.map((o) => (
                <button
                  key={o}
                  onClick={() => setOutcome(o)}
                  className={cn("rounded-lg border px-3 py-2 text-sm font-semibold", outcome === o ? "border-navy-900 bg-navy-900 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50")}
                >
                  {OUTCOME_LABELS[o]}
                </button>
              ))}
            </div>
          </div>
          <Field label="Outcome Date & Time (Riyadh)" required>
            <Input type="datetime-local" value={at} max={toRiyadhInput(nowIso())} onChange={(e) => setAt(e.target.value)} />
          </Field>
          <Field label="Notes (optional, internal only)">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Do not enter details that are not needed for follow-up" />
          </Field>
        </div>
      )}
    </Dialog>
  );
}

export function CaseLink({ c }: { c: SepsisCase }) {
  return (
    <Link href={`/cases/view?id=${c.id}`} className="font-bold text-navy-900 hover:text-brand-600 hover:underline">
      {c.caseNo}
    </Link>
  );
}
