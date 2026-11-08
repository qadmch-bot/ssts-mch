// SYNTHETIC demo data only — no real patients. Names/MRNs are fabricated placeholders.
import { EVENT_ORDER } from "./constants";
import {
  addCaseUpdate,
  emptyState,
  recordOutcome,
  registerCase,
  saveBundle,
  saveLab,
  saveRecipient,
  type Ctx,
  type State,
} from "./engine";
import type { AppUser, Department, EventType } from "./types";
import { toRiyadhInput } from "./time";

export const DEPARTMENTS: Department[] = [
  { id: "d-ped-er", name: "Pediatric ER", kind: "emergency", active: true },
  { id: "d-ob-er", name: "Obstetric ER", kind: "emergency", active: true },
  { id: "d-nicu", name: "NICU", kind: "inpatient", active: true },
  { id: "d-picu", name: "PICU", kind: "inpatient", active: true },
  { id: "d-ped-ward", name: "Pediatric Medical Ward", kind: "inpatient", active: true },
  { id: "d-ped-imc", name: "Pediatric Intermediate Care", kind: "inpatient", active: true },
  { id: "d-ob-1", name: "Obstetric Ward 1", kind: "inpatient", active: true },
  { id: "d-ob-2", name: "Obstetric Ward 2", kind: "inpatient", active: true },
  { id: "d-lab", name: "Laboratory", kind: "laboratory", active: true },
  { id: "d-quality", name: "Quality & Patient Safety", kind: "other", active: true },
];

export const DEMO_USERS: AppUser[] = [
  { id: "u-qa", name: "Quality Team", role: "quality_admin", departmentIds: ["d-quality"] },
  { id: "u-er", name: "ER Charge Nurse", role: "emergency", departmentIds: ["d-ped-er", "d-ob-er"] },
  { id: "u-lab", name: "Lab Technologist", role: "laboratory", departmentIds: ["d-lab"] },
  { id: "u-ip", name: "Ward Head Nurse", role: "inpatient", departmentIds: ["d-nicu", "d-picu", "d-ped-ward", "d-ped-imc", "d-ob-1", "d-ob-2"] },
  { id: "u-lead", name: "Medical Director", role: "leadership", departmentIds: [] },
];

const ALL = EVENT_ORDER;
const CORE: EventType[] = ["case_registered", "bundle_overdue", "bundle_completed", "lab_result_available", "outcome_death", "outcome_dama"];

function ago(min: number, base: number) {
  return new Date(base - min * 60000).toISOString();
}

export function buildSeed(baseNow = Date.now()): State {
  let s: State = { ...emptyState(), departments: DEPARTMENTS, users: DEMO_USERS };
  const [qa, er, lab, ip] = DEMO_USERS;
  const at = (user: AppUser, minAgo: number): Ctx => ({ user, now: ago(minAgo, baseNow) });
  const must = <T,>(r: { ok: boolean; state: State; value?: T; error?: string }) => {
    if (!r.ok) throw new Error(`seed failed: ${r.error}`);
    s = r.state;
    return r.value as T;
  };

  // Recipients (synthetic numbers in the reserved +966 5000000xx range; example.org emails)
  const rcp = [
    { channel: "whatsapp" as const, name: "Quality Director", address: "+966500000001", departmentIds: [], eventTypes: ALL },
    { channel: "whatsapp" as const, name: "Pediatric ER Consultant on Call", address: "+966500000002", departmentIds: ["d-ped-er"], eventTypes: CORE },
    { channel: "whatsapp" as const, name: "Obstetric ER Head Nurse", address: "+966500000003", departmentIds: ["d-ob-er", "d-ob-1", "d-ob-2"], eventTypes: CORE },
    { channel: "whatsapp" as const, name: "NICU Head Nurse", address: "+966500000004", departmentIds: ["d-nicu"], eventTypes: ALL },
    { channel: "email" as const, name: "Quality & Patient Safety", address: "quality@example.org", departmentIds: [], eventTypes: ALL },
    { channel: "email" as const, name: "Medical Director", address: "medical.director@example.org", departmentIds: [], eventTypes: ["outcome_death", "outcome_dama", "bundle_overdue", "bundle_review"] as EventType[] },
    { channel: "email" as const, name: "Laboratory Supervisor", address: "lab.supervisor@example.org", departmentIds: [], eventTypes: ["lab_delay", "case_registered"] as EventType[] },
  ];
  for (const r of rcp) must(saveRecipient(s, at(qa, 60 * 24 * 10), { ...r, active: true }));

  type Plan = {
    min: number; // minutes ago the case was registered
    dept: string;
    cur: string;
    cat: "Neonatal" | "Pediatric" | "Obstetric";
    age: [number, "days" | "months" | "years"];
    sex: "Male" | "Female";
    bundle?: "complete_ok" | "complete_late" | "partial" | "review" | "none" | "complete_no_hypo";
    labs?: ("avail" | "pending" | "requested_old")[];
    ward?: string;
    outcome?: "discharged" | "dama" | "death" | "sepsis_ruled_out";
  };
  const plans: Plan[] = [
    { min: 60 * 24 * 26, dept: "d-ped-er", cur: "d-ped-er", cat: "Pediatric", age: [4, "years"], sex: "Male", bundle: "complete_ok", labs: ["avail", "avail"], ward: "d-ped-ward", outcome: "discharged" },
    { min: 60 * 24 * 24, dept: "d-ob-er", cur: "d-ob-er", cat: "Obstetric", age: [29, "years"], sex: "Female", bundle: "complete_ok", labs: ["avail"], ward: "d-ob-1", outcome: "discharged" },
    { min: 60 * 24 * 21, dept: "d-ped-er", cur: "d-ped-er", cat: "Neonatal", age: [9, "days"], sex: "Female", bundle: "complete_late", labs: ["avail", "avail"], ward: "d-nicu", outcome: "death" },
    { min: 60 * 24 * 18, dept: "d-ped-er", cur: "d-ped-er", cat: "Pediatric", age: [7, "months"], sex: "Male", bundle: "complete_no_hypo", labs: ["avail"], ward: "d-picu", outcome: "discharged" },
    { min: 60 * 24 * 15, dept: "d-ob-er", cur: "d-ob-er", cat: "Obstetric", age: [34, "years"], sex: "Female", bundle: "complete_ok", labs: ["avail"], ward: "d-ob-2", outcome: "dama" },
    { min: 60 * 24 * 12, dept: "d-ped-er", cur: "d-ped-er", cat: "Pediatric", age: [2, "years"], sex: "Female", bundle: "review", labs: ["avail"], ward: "d-ped-imc", outcome: "sepsis_ruled_out" },
    { min: 60 * 24 * 9, dept: "d-ped-er", cur: "d-ped-er", cat: "Pediatric", age: [11, "years"], sex: "Male", bundle: "complete_ok", labs: ["avail", "avail"], ward: "d-ped-ward", outcome: "discharged" },
    { min: 60 * 24 * 6, dept: "d-ob-er", cur: "d-ob-er", cat: "Obstetric", age: [24, "years"], sex: "Female", bundle: "complete_late", labs: ["avail"], ward: "d-ob-1" },
    { min: 60 * 24 * 3, dept: "d-ped-er", cur: "d-ped-er", cat: "Neonatal", age: [3, "days"], sex: "Male", bundle: "complete_ok", labs: ["avail", "requested_old"], ward: "d-nicu" },
    { min: 60 * 30, dept: "d-ped-er", cur: "d-ped-er", cat: "Pediatric", age: [5, "years"], sex: "Female", bundle: "partial", labs: ["avail", "pending"], ward: "d-ped-ward" },
    { min: 60 * 14, dept: "d-ob-er", cur: "d-ob-er", cat: "Obstetric", age: [31, "years"], sex: "Female", bundle: "complete_ok", labs: ["pending"] },
    { min: 140, dept: "d-ped-er", cur: "d-ped-er", cat: "Pediatric", age: [18, "months"], sex: "Male", bundle: "complete_ok", labs: ["avail"] },
    { min: 95, dept: "d-ob-er", cur: "d-ob-er", cat: "Obstetric", age: [27, "years"], sex: "Female", bundle: "partial", labs: ["pending", "pending"] },
    { min: 50, dept: "d-ped-er", cur: "d-ped-er", cat: "Pediatric", age: [3, "years"], sex: "Male", bundle: "none", labs: ["pending"] },
    { min: 12, dept: "d-ped-er", cur: "d-ped-er", cat: "Neonatal", age: [20, "days"], sex: "Female", bundle: "none" },
  ];

  const consultants = ["Dr. A. Consultant", "Dr. B. Consultant", "Dr. C. Consultant"];
  const physicians = ["Dr. Resident One", "Dr. Resident Two", "Dr. Resident Three"];
  plans.forEach((p, i) => {
    const regMin = p.min;
    const recog = ago(regMin + 8, baseNow);
    const diag = ago(regMin + 20, baseNow);
    const c = must(
      registerCase(s, at(er, regMin), {
        mrn: `DEMO-${String(100200 + i * 37)}`,
        patientName: `Synthetic Patient ${String.fromCharCode(65 + i)}`,
        age: p.age[0],
        ageUnit: p.age[1],
        sex: p.sex,
        patientCategory: p.cat,
        consultant: consultants[i % 3],
        caseDate: toRiyadhInput(recog).slice(0, 10),
        emergencyDepartmentId: p.dept,
        diagnosisTime: diag,
        recognitionTime: recog,
        currentDepartmentId: p.cur,
        physicianName: physicians[i % 3],
      }),
    ) as { id: string };
    const yes = { answer: "YES" as const };
    const doc = (minAfterRecog: number) => ago(regMin + 8 - minAfterRecog, baseNow);
    const bmin = (m: number) => Math.max(1, regMin + 8 - m);
    if (p.bundle === "complete_ok" || p.bundle === "complete_late" || p.bundle === "complete_no_hypo") {
      const late = p.bundle === "complete_late";
      const done = late ? 85 : 48;
      must(
        saveBundle(s, at(er, bmin(done)), c.id, {
          measures: {
            lactate: yes,
            blood_cultures: yes,
            antibiotics: yes,
            iv_fluids: yes,
            vasopressors: p.bundle === "complete_no_hypo" ? { answer: "NO" } : i % 3 === 0 ? yes : { answer: "NO" },
          },
          hypotensionOccurred: p.bundle === "complete_no_hypo" ? "NO" : i % 3 === 0 ? "YES" : "NO",
          completionTime: doc(done),
          clinicianAllWithin1h: late ? "NO" : "YES",
          physicianName: physicians[i % 3],
          documentedAt: doc(done),
        }),
      );
    } else if (p.bundle === "partial") {
      must(
        saveBundle(s, at(er, bmin(25)), c.id, {
          measures: { lactate: yes, blood_cultures: yes, antibiotics: yes },
          physicianName: physicians[i % 3],
        }),
      );
    } else if (p.bundle === "review") {
      must(
        saveBundle(s, at(er, bmin(55)), c.id, {
          measures: { lactate: yes, blood_cultures: yes, antibiotics: yes, iv_fluids: yes, vasopressors: { answer: "NO" } },
          completionTime: doc(55),
          clinicianAllWithin1h: "YES",
          physicianName: physicians[i % 3],
          documentedAt: doc(55),
        }),
      );
    }
    (p.labs ?? []).forEach((l, j) => {
      const type = j === 0 ? "Lactate" : "Blood Culture";
      const req = ago(regMin - 5, baseNow);
      const old = l === "requested_old";
      must(
        saveLab(s, at(lab, Math.max(1, regMin - (l === "avail" ? (j === 0 ? 45 : 60 * 36) : 6))), {
          caseId: c.id,
          testType: type,
          status: l === "avail" ? "result_available" : old ? "requested" : "pending",
          requestedAt: req,
          resultAt: l === "avail" ? ago(Math.max(1, regMin - (j === 0 ? 45 : 60 * 36)), baseNow) : null,
          notes: l === "avail" ? "Result reported to treating team" : "",
        }),
      );
    });
    if (p.ward) {
      must(
        addCaseUpdate(s, at(er, regMin - 180), {
          caseId: c.id,
          departmentId: p.cur,
          status: "Admitted",
          updateAt: ago(regMin - 180, baseNow),
          notes: "Admitted from ER",
          transferToId: p.ward,
        }),
      );
      if (regMin > 60 * 24 * 2)
        must(
          addCaseUpdate(s, at(ip, regMin - 60 * 24), {
            caseId: c.id,
            departmentId: p.ward,
            status: "Improving",
            updateAt: ago(regMin - 60 * 24, baseNow),
            notes: "Clinically improving",
            transferToId: null,
          }),
        );
    }
    if (p.outcome) {
      const om = regMin - 60 * 24 * 4;
      must(recordOutcome(s, at(ip, om), c.id, p.outcome, ago(om, baseNow), ""));
    }
  });
  // Older alerts are treated as already read so the bell reflects recent activity only.
  const cutoff = baseNow - 6 * 3600000;
  s = { ...s, inApp: s.inApp.map((n) => (new Date(n.createdAt).getTime() < cutoff ? { ...n, readBy: DEMO_USERS.map((u) => u.id) } : n)) };
  return s;
}
