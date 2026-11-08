"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { BedDouble, Flag, Pencil, Lock, ArrowRightLeft } from "lucide-react";
import { Alert, Badge, Button, Card, Dialog, Empty, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { BundleBadge, CaseLink, LabBadge, OutcomeDialog, StatusBadge } from "@/components/case-bits";
import { useToast } from "@/components/toast";
import { useNow, useStore } from "@/lib/store";
import { addCaseUpdate, canActOnCase, deptName, type UpdateInput } from "@/lib/engine";
import { INPATIENT_STATUSES } from "@/lib/constants";
import { fmtDateTime, fromRiyadhInput, nowIso, timeAgo, toRiyadhInput } from "@/lib/time";
import type { SepsisCase } from "@/lib/types";

function Inner() {
  const sp = useSearchParams();
  const { state, user, can, act } = useStore();
  const toast = useToast();
  const now = useNow();
  const [edit, setEdit] = useState<(UpdateInput & { at: string }) | null>(null);
  const [outcomeCase, setOutcomeCase] = useState<SepsisCase | null>(null);
  const [mine, setMine] = useState(user.role !== "quality_admin" && user.role !== "leadership");
  const outcomeMode = !!sp.get("outcome");

  const open = (c: SepsisCase) => setEdit({ caseId: c.id, departmentId: c.currentDepartmentId, status: "", updateAt: null, at: toRiyadhInput(nowIso()), notes: "", transferToId: null });

  useEffect(() => {
    const id = sp.get("case");
    const c = state.cases.find((x) => x.id === id);
    if (c && c.status === "active" && can("inpatient.edit") && canActOnCase(user, c)) open(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = state.cases
    .filter((c) => c.status === "active")
    .filter((c) => (mine ? canActOnCase(user, c) : true))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  const depts = state.departments.filter((d) => d.active && (d.kind === "inpatient" || d.kind === "emergency"));

  const submit = () => {
    if (!edit) return;
    const r = act((s, ctx) => addCaseUpdate(s, ctx, { ...edit, updateAt: fromRiyadhInput(edit.at) }), (v) => ({ fn: "add_case_update", args: { p: { ...edit, updateAt: fromRiyadhInput(edit.at), id: v.id } } }));
    if (r.ok) {
      toast("success", r.value.transferToId ? "Transfer recorded" : "Update saved", "Notifications queued per configured rules.");
      setEdit(null);
    } else toast(r.error.startsWith("No changes") ? "info" : "error", r.error.startsWith("No changes") ? "Nothing changed" : "Not saved", r.error);
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <PageHeader
        title="Inpatient Updates"
        subtitle="Department follow-up, transfers and final outcomes for active cases"
        icon={<BedDouble />}
        actions={
          user.role !== "leadership" &&
          user.role !== "laboratory" && (
            <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600">
              <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="size-4 accent-navy-900" /> My departments only
            </label>
          )
        }
      />
      {outcomeMode && (
        <Alert tone="blue" icon={<Flag />}>
          Select <b>Outcome</b> on the case to record Discharged, DAMA or Death.
        </Alert>
      )}
      {!can("inpatient.edit") && (
        <Alert tone="blue" icon={<Lock />}>
          Read-only for your role.
        </Alert>
      )}
      <Card>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Case ID</th>
                <th>Current Department</th>
                <th>Case Status</th>
                <th>Hour-1 Bundle</th>
                <th>Laboratory</th>
                <th>Last Update</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {active.map((c) => {
                const allowed = can("inpatient.edit") && canActOnCase(user, c);
                const last = state.updates.filter((u) => u.caseId === c.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
                return (
                  <tr key={c.id}>
                    <td className="whitespace-nowrap">
                      <CaseLink c={c} />
                    </td>
                    <td className="whitespace-nowrap font-medium">{deptName(state, c.currentDepartmentId)}</td>
                    <td>
                      <StatusBadge c={c} />
                    </td>
                    <td>
                      <BundleBadge s={state} c={c} now={now} />
                    </td>
                    <td>
                      <LabBadge s={state} caseId={c.id} />
                    </td>
                    <td className="whitespace-nowrap text-xs text-slate-500">
                      {last ? `${fmtDateTime(last.updateAt)}` : `Registered ${timeAgo(c.createdAt)}`}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      {allowed ? (
                        <>
                          <Button size="sm" variant="outline" className="mr-1" onClick={() => open(c)}>
                            <Pencil /> Update
                          </Button>
                          {can("outcome.record") && (
                            <Button size="sm" onClick={() => setOutcomeCase(c)}>
                              <Flag /> Outcome
                            </Button>
                          )}
                        </>
                      ) : (
                        <Badge tone="gray">
                          <Lock /> {deptName(state, c.currentDepartmentId)}
                        </Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!active.length && <Empty icon={<BedDouble />} title={mine ? "No active cases in your departments" : "No active cases"} />}
        </div>
      </Card>

      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        icon={<BedDouble />}
        title={`Department Update · ${state.cases.find((c) => c.id === edit?.caseId)?.caseNo ?? ""}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setEdit(null)}>
              Cancel
            </Button>
            <Button onClick={submit}>Save Update</Button>
          </>
        }
      >
        {edit && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Current Department" required>
              <Select value={edit.departmentId} onChange={(e) => setEdit({ ...edit, departmentId: e.target.value })}>
                {depts
                  .filter((d) => user.role === "quality_admin" || user.departmentIds.includes(d.id))
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Case Status" required>
              <Select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                <option value="">Select…</option>
                {INPATIENT_STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </Field>
            <Field label="Date & Time (Riyadh)" required>
              <Input type="datetime-local" value={edit.at} max={toRiyadhInput(nowIso())} onChange={(e) => setEdit({ ...edit, at: e.target.value })} />
            </Field>
            <Field label={<span className="inline-flex items-center gap-1.5"><ArrowRightLeft className="size-4" /> Transfer to (optional)</span>}>
              <Select value={edit.transferToId ?? ""} onChange={(e) => setEdit({ ...edit, transferToId: e.target.value || null })}>
                <option value="">No transfer</option>
                {depts
                  .filter((d) => d.id !== edit.departmentId)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Notes" className="sm:col-span-2" hint="Internal follow-up notes. Never included in WhatsApp or email messages.">
              <Textarea value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
            </Field>
            <p className="text-xs text-slate-500 sm:col-span-2">Final outcome (Discharged / DAMA / Death) is recorded with the Outcome button.</p>
          </div>
        )}
      </Dialog>
      {outcomeCase && <OutcomeDialog c={outcomeCase} open onClose={() => setOutcomeCase(null)} />}
    </div>
  );
}

export default function InpatientPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
