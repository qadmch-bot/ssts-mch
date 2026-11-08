"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { FlaskConical, Plus, Pencil, Lock, CheckCircle2 } from "lucide-react";
import { Alert, Badge, Button, Card, Dialog, Empty, Field, Input, PageHeader, Select, Tabs, Textarea } from "@/components/ui";
import { CaseLink } from "@/components/case-bits";
import { useToast } from "@/components/toast";
import { useNow, useStore } from "@/lib/store";
import { deptName, saveLab, type LabInput } from "@/lib/engine";
import { LAB_STATUS_LABELS } from "@/lib/constants";
import { fmtDateTime, fromRiyadhInput, humanDuration, minutesBetween, nowIso, toRiyadhInput } from "@/lib/time";
import type { LabStatus, LabTest } from "@/lib/types";

type Tab = "open" | "overdue" | "available" | "all";

function Inner() {
  const sp = useSearchParams();
  const { state, can, act } = useStore();
  const toast = useToast();
  const now = useNow();
  const caseFilter = sp.get("case");
  const [tab, setTab] = useState<Tab>(caseFilter ? "all" : "open");
  const [edit, setEdit] = useState<LabInput | null>(null);
  const overdueH = state.settings.reminders.labOverdueHours;

  useEffect(() => {
    if (sp.get("add") && caseFilter && can("lab.edit")) setEdit(blank(caseFilter));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isOverdue = (l: LabTest) => ["requested", "pending"].includes(l.status) && !!l.requestedAt && minutesBetween(l.requestedAt, now) >= overdueH * 60;
  const all = state.labs.filter((l) => (caseFilter ? l.caseId === caseFilter : true));
  const groups: Record<Tab, LabTest[]> = {
    open: all.filter((l) => ["requested", "pending"].includes(l.status)),
    overdue: all.filter(isOverdue),
    available: all.filter((l) => l.status === "result_available"),
    all,
  };
  const rows = [...groups[tab]].sort((a, b) => (b.requestedAt ?? "").localeCompare(a.requestedAt ?? ""));

  const submit = () => {
    if (!edit) return;
    const r = act((s, ctx) => saveLab(s, ctx, edit), (v) => ({ fn: "save_lab", args: { p: { ...edit, id: v.id } } }));
    if (r.ok) {
      toast("success", "Laboratory record saved", r.value.status === "result_available" ? "Result marked available — WhatsApp, email and in-app alerts queued." : undefined);
      setEdit(null);
    } else toast("error", "Not saved", r.error);
  };

  const caseOf = (id: string) => state.cases.find((c) => c.id === id)!;
  const activeCases = state.cases.filter((c) => c.status === "active");

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <PageHeader
        title="Laboratory Results"
        subtitle={caseFilter ? `Filtered to ${caseOf(caseFilter)?.caseNo}` : "Track requests and result availability · actual values stay in the laboratory system"}
        icon={<FlaskConical />}
        actions={
          can("lab.edit") && (
            <Button onClick={() => setEdit(blank(caseFilter ?? activeCases[0]?.id ?? ""))}>
              <Plus /> Add Test Request
            </Button>
          )
        }
      />
      {!can("lab.edit") && (
        <Alert tone="blue" icon={<Lock />}>
          Read-only. Laboratory staff and Quality Admin can update results.
        </Alert>
      )}
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { value: "open", label: "Pending", count: groups.open.length },
          { value: "overdue", label: `Overdue (>${overdueH}h)`, count: groups.overdue.length },
          { value: "available", label: "Result Available", count: groups.available.length },
          { value: "all", label: "All", count: groups.all.length },
        ]}
      />
      <Card>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Case ID</th>
                <th>Department</th>
                <th>Test Type</th>
                <th>Request Date &amp; Time</th>
                <th>Result Status</th>
                <th>Result Date &amp; Time</th>
                <th>Result Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => {
                const c = caseOf(l.caseId);
                return (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap">
                      <CaseLink c={c} />
                    </td>
                    <td className="whitespace-nowrap">{deptName(state, c.currentDepartmentId)}</td>
                    <td className="whitespace-nowrap font-semibold">
                      {l.testType} {l.linkedMeasure && <Badge tone="teal">Bundle</Badge>}
                    </td>
                    <td className="whitespace-nowrap text-slate-600">
                      {fmtDateTime(l.requestedAt)}
                      {isOverdue(l) && <div className="text-xs font-semibold text-red-600">{humanDuration(minutesBetween(l.requestedAt!, now))} waiting</div>}
                    </td>
                    <td>
                      <Badge tone={l.status === "result_available" ? "green" : l.status === "cancelled" || l.status === "not_requested" ? "gray" : isOverdue(l) ? "red" : "amber"}>{LAB_STATUS_LABELS[l.status]}</Badge>
                    </td>
                    <td className="whitespace-nowrap text-slate-600">{fmtDateTime(l.resultAt)}</td>
                    <td className="max-w-xs truncate text-slate-600">{l.notes || "—"}</td>
                    <td className="whitespace-nowrap text-right">
                      {can("lab.edit") && l.status !== "result_available" && l.status !== "cancelled" && (
                        <Button
                          size="sm"
                          variant="success"
                          className="mr-1"
                          onClick={() => setEdit({ id: l.id, caseId: l.caseId, testType: l.testType, status: "result_available", requestedAt: l.requestedAt, resultAt: nowIso(), notes: l.notes })}
                        >
                          <CheckCircle2 /> Result Available
                        </Button>
                      )}
                      {can("lab.edit") && (
                        <Button size="sm" variant="outline" onClick={() => setEdit({ id: l.id, caseId: l.caseId, testType: l.testType, status: l.status, requestedAt: l.requestedAt, resultAt: l.resultAt, notes: l.notes })}>
                          <Pencil />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!rows.length && <Empty icon={<FlaskConical />} title="No laboratory records in this list" />}
        </div>
      </Card>

      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? "Update Laboratory Test" : "Add Laboratory Test Request"}
        icon={<FlaskConical />}
        footer={
          <>
            <Button variant="outline" onClick={() => setEdit(null)}>
              Cancel
            </Button>
            <Button onClick={submit}>Save</Button>
          </>
        }
      >
        {edit && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Case ID" required>
              <Select value={edit.caseId} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, caseId: e.target.value })}>
                {(edit.id ? state.cases : activeCases).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.caseNo} · {deptName(state, c.currentDepartmentId)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Test Type" required>
              <Select value={edit.testType} onChange={(e) => setEdit({ ...edit, testType: e.target.value })}>
                {state.labTestTypes.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            </Field>
            <Field label="Result Status" required>
              <Select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value as LabStatus, resultAt: e.target.value === "result_available" ? edit.resultAt ?? nowIso() : null })}>
                {Object.entries(LAB_STATUS_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Request Date & Time">
              <Input type="datetime-local" value={toRiyadhInput(edit.requestedAt)} max={toRiyadhInput(nowIso())} onChange={(e) => setEdit({ ...edit, requestedAt: fromRiyadhInput(e.target.value) })} />
            </Field>
            {edit.status === "result_available" && (
              <Field label="Result Date & Time" required>
                <Input type="datetime-local" value={toRiyadhInput(edit.resultAt)} max={toRiyadhInput(nowIso())} onChange={(e) => setEdit({ ...edit, resultAt: fromRiyadhInput(e.target.value) })} />
              </Field>
            )}
            <Field label="Result Notes" className="sm:col-span-2" hint="Do not enter result values — they are not shared through this system's notifications.">
              <Textarea value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
            </Field>
          </div>
        )}
      </Dialog>
    </div>
  );
}

function blank(caseId: string): LabInput {
  return { caseId, testType: "Lactate", status: "requested", requestedAt: nowIso(), resultAt: null, notes: "" };
}

export default function LaboratoryPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
