"use client";

import Link from "next/link";

import { useMemo, useState } from "react";
import { AlertTriangle, Ambulance, CheckCircle2, Lock, ShieldCheck, Timer } from "lucide-react";
import { Alert, Button, Card, CardHeader, Dialog, Field, Input, PageHeader, Select } from "@/components/ui";
import { useToast } from "@/components/toast";
import { useStore } from "@/lib/store";
import { findDuplicate, registerCase, validateNewCase, type NewCaseInput } from "@/lib/engine";
import { fromRiyadhInput, nowIso, riyadhToday, toRiyadhInput } from "@/lib/time";
import type { AgeUnit, PatientCategory, Sex } from "@/lib/types";

export default function NewCasePage() {
  const { state, can, act, user } = useStore();
  const toast = useToast();
  const erDepts = state.departments.filter((d) => d.kind === "emergency" && d.active);
  const allDepts = state.departments.filter((d) => d.active && (d.kind === "emergency" || d.kind === "inpatient"));
  const defaultEr = erDepts.find((d) => user.departmentIds.includes(d.id))?.id ?? erDepts[0]?.id ?? "";
  const nowLocal = toRiyadhInput(nowIso());

  const [f, setF] = useState({
    mrn: "",
    patientName: "",
    age: "",
    ageUnit: "years" as AgeUnit,
    sex: "" as Sex | "",
    patientCategory: "" as PatientCategory | "",
    consultant: "",
    caseDate: riyadhToday(),
    emergencyDepartmentId: defaultEr,
    diagnosisTime: "",
    recognitionTime: "",
    currentDepartmentId: defaultEr,
    physicianName: "",
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [dup, setDup] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; caseNo: string; deliveries: number } | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const input = useMemo<NewCaseInput>(
    () => ({
      ...f,
      age: f.age === "" ? null : Number(f.age),
      diagnosisTime: fromRiyadhInput(f.diagnosisTime),
      recognitionTime: fromRiyadhInput(f.recognitionTime),
    }),
    [f],
  );

  if (!can("case.create"))
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="New Sepsis Case" icon={<Ambulance />} />
        <Alert tone="amber" icon={<Lock />} title="Not permitted">
          Only Emergency Department users and Quality Admin can register new cases.
        </Alert>
      </div>
    );

  const submit = (confirmDuplicate = false) => {
    const errs = validateNewCase(input, nowIso());
    setErrors(errs);
    if (errs.length) return;
    if (!confirmDuplicate) {
      const d = findDuplicate(state, input.mrn);
      if (d) return setDup(d.caseNo);
    }
    const r = act((s, ctx) => registerCase(s, ctx, { ...input, confirmDuplicate }), (v) => ({ fn: "register_case", args: { p: { ...input, id: v.id }, p_confirm_duplicate: confirmDuplicate } }));
    setDup(null);
    if (!r.ok) {
      setErrors([r.error]);
      toast("error", "Case not saved", r.error);
      return;
    }
    const ev = r.state.events.find((e) => e.caseId === r.value.id && e.eventType === "case_registered");
    const n = r.state.deliveries.filter((d) => d.eventId === ev?.id).length;
    setDone({ id: r.value.id, caseNo: r.value.caseNo, deliveries: n });
    toast("success", `Case ${r.value.caseNo} registered`, `In-app alert created; ${n} external notification(s) queued.`);
  };

  if (done)
    return (
      <div className="mx-auto max-w-2xl">
        <Card className="p-8 text-center">
          <CheckCircle2 className="mx-auto size-14 text-emerald-500" />
          <h1 className="mt-3 text-2xl font-bold text-navy-900">Case Registered</h1>
          <p className="mt-1 text-4xl font-extrabold tracking-tight text-brand-600">{done.caseNo}</p>
          <p className="mx-auto mt-3 max-w-md text-sm text-slate-600">
            Saved with registration time and your user identity. An in-app alert was created and {done.deliveries} WhatsApp/email notification(s) were queued for configured recipients (no
            patient identifiers are included).
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Link href={`/bundle/form?id=${done.id}`}>
              <Button variant="teal" size="lg">
                <Timer /> Document Hour-1 Bundle
              </Button>
            </Link>
            <Link href={`/cases/view?id=${done.id}`}>
              <Button variant="outline" size="lg">
                Open Case
              </Button>
            </Link>
            <Button
              variant="ghost"
              size="lg"
              onClick={() => {
                setDone(null);
                setF((x) => ({ ...x, mrn: "", patientName: "", age: "", sex: "", diagnosisTime: "", recognitionTime: "", consultant: "", physicianName: "", patientCategory: "" }));
              }}
            >
              Register Another
            </Button>
          </div>
        </Card>
      </div>
    );

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="New Sepsis Case" subtitle="Emergency Department registration · Case ID is generated automatically" icon={<Ambulance />} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-5"
      >
        <Card>
          <CardHeader title="Patient" icon={<ShieldCheck />} subtitle="MRN and patient name are restricted and never sent by WhatsApp or email" />
          <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Case ID" className="lg:col-span-1">
              <Input value="Auto-generated" disabled />
            </Field>
            <Field label="Patient MRN" required className="lg:col-span-1">
              <Input value={f.mrn} onChange={(e) => set("mrn", e.target.value)} placeholder="e.g. 1234567" autoComplete="off" />
            </Field>
            <Field label="Patient Name" required className="sm:col-span-2" hint="Restricted access">
              <Input value={f.patientName} onChange={(e) => set("patientName", e.target.value)} autoComplete="off" />
            </Field>
            <Field label="Age" required>
              <div className="flex gap-2">
                <Input type="number" min={0} value={f.age} onChange={(e) => set("age", e.target.value)} className="w-24" />
                <Select value={f.ageUnit} onChange={(e) => set("ageUnit", e.target.value as AgeUnit)}>
                  <option value="days">Days</option>
                  <option value="months">Months</option>
                  <option value="years">Years</option>
                </Select>
              </div>
            </Field>
            <Field label="Sex" required>
              <Select value={f.sex} onChange={(e) => set("sex", e.target.value as Sex)}>
                <option value="">Select…</option>
                <option>Male</option>
                <option>Female</option>
              </Select>
            </Field>
            <Field label="Patient Category">
              <Select value={f.patientCategory} onChange={(e) => set("patientCategory", e.target.value as PatientCategory)}>
                <option value="">Select…</option>
                <option>Neonatal</option>
                <option>Pediatric</option>
                <option>Obstetric</option>
                <option>Adult</option>
              </Select>
            </Field>
            <Field label="Consultant">
              <Input value={f.consultant} onChange={(e) => set("consultant", e.target.value)} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Sepsis Recognition" icon={<Timer />} subtitle="Document the patient arrival time and clinical assessment details" />
          <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Date" required>
              <Input type="date" value={f.caseDate} max={riyadhToday()} onChange={(e) => set("caseDate", e.target.value)} />
            </Field>
            <Field label="Diagnosis Time">
              <Input type="datetime-local" value={f.diagnosisTime} max={nowLocal} onChange={(e) => set("diagnosisTime", e.target.value)} />
            </Field>
            <Field label="Arrival Time" required hint="Patient arrival time; not automatically the clinical sepsis recognition time">
              <Input type="datetime-local" value={f.recognitionTime} max={nowLocal} onChange={(e) => set("recognitionTime", e.target.value)} />
            </Field>
            <Field label="Emergency Department" required>
              <Select value={f.emergencyDepartmentId} onChange={(e) => set("emergencyDepartmentId", e.target.value)}>
                {erDepts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Current Department" required>
              <Select value={f.currentDepartmentId} onChange={(e) => set("currentDepartmentId", e.target.value)}>
                {allDepts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Physician Name" required>
              <Input value={f.physicianName} onChange={(e) => set("physicianName", e.target.value)} />
            </Field>
          </div>
          {f.diagnosisTime && f.recognitionTime && f.diagnosisTime !== f.recognitionTime && (
            <p className="px-5 pb-4 text-xs text-slate-500">Diagnosis Time and Arrival Time are recorded separately. The clinical recognition timestamp requires a separate approved definition.</p>
          )}
        </Card>

        {errors.length > 0 && (
          <Alert tone="red" icon={<AlertTriangle />} title="Please correct the following">
            <ul className="list-disc pl-4">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Alert>
        )}

        <div className="flex flex-wrap items-center justify-end gap-3">
          <p className="mr-auto text-xs text-slate-500">On save: case stored · in-app alert · WhatsApp + email queued to configured recipients.</p>
          <Link href="/">
            <Button variant="outline" size="lg">
              Cancel
            </Button>
          </Link>
          <Button type="submit" size="lg">
            <Ambulance /> Register Case
          </Button>
        </div>
      </form>

      <Dialog
        open={!!dup}
        onClose={() => setDup(null)}
        title="Possible duplicate registration"
        icon={<AlertTriangle />}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setDup(null)}>
              Cancel
            </Button>
            <Link href={`/cases?q=${dup}`}>
              <Button variant="outline">Open {dup}</Button>
            </Link>
            <Button variant="warning" onClick={() => submit(true)}>
              Register anyway
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          An <b>active</b> case (<b>{dup}</b>) already exists for this MRN. Registering again creates a second case and will be recorded in the audit log.
        </p>
      </Dialog>
    </div>
  );
}
