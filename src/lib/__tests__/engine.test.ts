import { describe, expect, it } from "vitest";
import { buildSeed, DEMO_USERS } from "../seed";
import {
  addCaseUpdate,
  correctOutcome,
  dashboardCounts,
  deleteRecipient,
  recordOutcome,
  registerCase,
  runReminders,
  saveBundle,
  saveLab,
  saveRecipient,
  saveRules,
  sendTest,
  type Ctx,
  type State,
} from "../engine";
import { evaluateCompliance, evaluateTiming, summarizeCompliance, summarizeElements } from "../bundle";
import { buildMessage, isE164, toE164 } from "../notify";

const [qa, er, lab, ip, lead] = DEMO_USERS;
const NOW = new Date("2026-11-08T08:00:00Z").getTime();
const ctx = (user = er, minOffset = 0): Ctx => ({ user, now: new Date(NOW + minOffset * 60000).toISOString() });

const newCase = (s: State, mrn = "TEST-1") =>
  registerCase(s, ctx(), {
    mrn,
    patientName: "Synthetic Test",
    age: 4,
    ageUnit: "years",
    sex: "Male",
    patientCategory: "Pediatric",
    consultant: "Dr. X",
    caseDate: "2026-11-08",
    emergencyDepartmentId: "d-ped-er",
    diagnosisTime: new Date(NOW - 30 * 60000).toISOString(),
    recognitionTime: new Date(NOW - 20 * 60000).toISOString(),
    currentDepartmentId: "d-ped-er",
    physicianName: "Dr. Y",
  });

describe("seed", () => {
  it("builds consistent synthetic data", () => {
    const s = buildSeed(NOW);
    const c = dashboardCounts(s);
    expect(c.total).toBe(15);
    expect(c.discharged + c.dama + c.deaths + c.otherClosed + c.active).toBe(c.total);
    expect(c.deaths).toBe(1);
    expect(c.dama).toBe(1);
    expect(c.otherClosed).toBe(1); // sepsis ruled out is NOT counted as discharged/DAMA/death
  });
});

describe("registration", () => {
  it("saves a case and creates exactly one delivery per configured recipient+channel", () => {
    const s0 = buildSeed(NOW);
    const r = newCase(s0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ev = r.state.events.find((e) => e.caseId === r.value.id && e.eventType === "case_registered")!;
    const ds = r.state.deliveries.filter((d) => d.eventId === ev.id);
    const keys = ds.map((d) => `${d.channel}:${d.address}`);
    expect(new Set(keys).size).toBe(keys.length);
    // Ped ER: Quality Director (WA, all), Ped ER consultant (WA), Quality email, Lab supervisor email = 4
    expect(ds.length).toBe(4);
    expect(r.state.inApp.some((n) => n.eventId === ev.id)).toBe(true);
    // honest status in demo mode
    expect(ds.every((d) => d.status === "not_sent")).toBe(true);
  });

  it("detects duplicate MRN for active case and requires confirmation", () => {
    const s0 = buildSeed(NOW);
    const a = newCase(s0);
    if (!a.ok) throw new Error();
    const b = newCase(a.state);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.error.startsWith("DUPLICATE:")).toBe(true);
  });

  it("rejects future recognition time", () => {
    const s0 = buildSeed(NOW);
    const r = registerCase(s0, ctx(), {
      mrn: "T2", patientName: "X", age: 1, ageUnit: "years", sex: "Female", patientCategory: "", consultant: "", caseDate: "2026-11-08",
      emergencyDepartmentId: "d-ped-er", diagnosisTime: null, recognitionTime: new Date(NOW + 3600000).toISOString(), currentDepartmentId: "d-ped-er", physicianName: "Dr",
    });
    expect(r.ok).toBe(false);
  });

  it("messages contain no MRN or patient name", () => {
    const m = buildMessage({ eventType: "case_registered", caseNo: "SEP-2026-0001", departmentName: "Pediatric ER", caseUrl: "https://x/cases/view?id=1" });
    expect(m.text).toContain("NEW SEPSIS CASE ALERT");
    expect(m.text).toContain("Action Required: Review Sepsis Hour-1 Bundle.");
    expect(m.text).not.toMatch(/MRN|Synthetic/);
  });
});

describe("hour-1 bundle", () => {
  it("timing categories", () => {
    const r = "2026-11-08T08:00:00Z";
    expect(evaluateTiming(r, "2026-11-08T08:59:00Z", "2026-11-09T00:00:00Z").result).toBe("within_60");
    expect(evaluateTiming(r, "2026-11-08T09:01:00Z", "2026-11-09T00:00:00Z").result).toBe("over_60");
    expect(evaluateTiming(r, null).result).toBe("pending");
    expect(evaluateTiming(r, "2026-11-08T07:00:00Z", "2026-11-09T00:00:00Z").result).toBe("requires_review");
  });

  it("never treats NO as not-applicable without documented hypotension", () => {
    const s0 = buildSeed(NOW);
    const a = newCase(s0);
    if (!a.ok) throw new Error();
    const y = { answer: "YES" as const };
    const b = saveBundle(a.state, ctx(er, 1), a.value.id, {
      measures: { lactate: y, blood_cultures: y, antibiotics: y, iv_fluids: y, vasopressors: { answer: "NO" } },
      completionTime: new Date(NOW).toISOString(),
      clinicianAllWithin1h: "YES",
    });
    if (!b.ok) throw new Error(b.error);
    const e = evaluateCompliance(a.value, b.value, ctx(er, 2).now);
    expect(e.status).toBe("requires_review");
    // documented no hypotension -> compliant
    const c = saveBundle(b.state, ctx(er, 2), a.value.id, { hypotensionOccurred: "NO" });
    if (!c.ok) throw new Error(c.error);
    expect(evaluateCompliance(a.value, c.value, ctx(er, 3).now).status).toBe("compliant");
  });

  it("missing documentation is pending, not noncompliant; elapsed time alone is not compliance", () => {
    const s0 = buildSeed(NOW);
    const a = newCase(s0);
    if (!a.ok) throw new Error();
    const b = saveBundle(a.state, ctx(er, 1), a.value.id, { completionTime: new Date(NOW).toISOString(), clinicianAllWithin1h: "YES" });
    if (!b.ok) throw new Error(b.error);
    expect(evaluateCompliance(a.value, b.value, ctx(er, 2).now).status).toBe("pending");
  });

  it("clinician answer conflicting with recorded times requires review", () => {
    const s0 = buildSeed(NOW);
    const a = newCase(s0);
    if (!a.ok) throw new Error();
    const y = { answer: "YES" as const };
    const b = saveBundle(a.state, ctx(er, 60), a.value.id, {
      measures: { lactate: y, blood_cultures: y, antibiotics: y, iv_fluids: y, vasopressors: { answer: "NO" } },
      hypotensionOccurred: "NO",
      completionTime: new Date(NOW + 50 * 60000).toISOString(), // 70 min after recognition
      clinicianAllWithin1h: "YES",
    });
    if (!b.ok) throw new Error(b.error);
    expect(evaluateCompliance(a.value, b.value, ctx(er, 61).now).status).toBe("requires_review");
  });

  it("summary keeps pending separate and uses conditional denominators", () => {
    const s = buildSeed(NOW);
    const evals = s.cases.map((c) => evaluateCompliance(c, s.bundles.find((b) => b.caseId === c.id), new Date(NOW).toISOString()));
    const sum = summarizeCompliance(evals);
    expect(sum.compliant + sum.notCompliant + sum.pending + sum.review).toBe(sum.total);
    const vaso = summarizeElements(evals).find((e) => e.key === "vasopressors")!;
    expect(vaso.denominator).toBe(vaso.yes + vaso.no);
    expect(vaso.notApplicable).toBeGreaterThan(0);
  });
});

describe("lab / inpatient / outcome", () => {
  it("lab result available fires once", () => {
    const s0 = buildSeed(NOW);
    const a = newCase(s0);
    if (!a.ok) throw new Error();
    const req = new Date(NOW - 10 * 60000).toISOString();
    const l1 = saveLab(a.state, ctx(lab, 1), { caseId: a.value.id, testType: "Lactate", status: "pending", requestedAt: req, resultAt: null, notes: "" });
    if (!l1.ok) throw new Error(l1.error);
    expect(l1.value.linkedMeasure).toBe("lactate");
    const l2 = saveLab(l1.state, ctx(lab, 2), { id: l1.value.id, caseId: a.value.id, testType: "Lactate", status: "result_available", requestedAt: req, resultAt: ctx(lab, 2).now, notes: "" });
    if (!l2.ok) throw new Error(l2.error);
    const l3 = saveLab(l2.state, ctx(lab, 3), { id: l1.value.id, caseId: a.value.id, testType: "Lactate", status: "result_available", requestedAt: req, resultAt: ctx(lab, 2).now, notes: "" });
    expect(l3.ok).toBe(false); // unchanged → no duplicate
    expect(l2.state.events.filter((e) => e.eventType === "lab_result_available" && e.caseId === a.value.id).length).toBe(1);
  });

  it("duplicate inpatient updates are rejected; transfers notify", () => {
    const s0 = buildSeed(NOW);
    const a = newCase(s0);
    if (!a.ok) throw new Error();
    const inp = { caseId: a.value.id, departmentId: "d-ped-er", status: "Admitted", updateAt: ctx(ip, 1).now, notes: "x", transferToId: "d-picu" };
    expect(addCaseUpdate(a.state, ctx(ip, 1), inp).ok).toBe(false); // ward staff cannot update an ER case
    const u1 = addCaseUpdate(a.state, ctx(er, 1), inp);
    if (!u1.ok) throw new Error(u1.error);
    expect(u1.state.cases.find((c) => c.id === a.value.id)!.currentDepartmentId).toBe("d-picu");
    expect(u1.state.events.some((e) => e.eventType === "patient_transferred" && e.caseId === a.value.id)).toBe(true);
    expect(addCaseUpdate(u1.state, ctx(er, 2), { ...inp, transferToId: null, departmentId: "d-picu" }).ok).toBe(false); // ER no longer owns it
    const same = { ...inp, departmentId: "d-picu", transferToId: null, status: "Admitted", notes: "x" };
    const u2 = addCaseUpdate(u1.state, ctx(ip, 2), same);
    if (!u2.ok) throw new Error(u2.error);
    expect(addCaseUpdate(u2.state, ctx(ip, 3), same).ok).toBe(false); // unchanged → rejected, no alert
  });

  it("outcomes update counts; correction requires QA + reason", () => {
    const s0 = buildSeed(NOW);
    const before = dashboardCounts(s0);
    const a = newCase(s0);
    if (!a.ok) throw new Error();
    expect(recordOutcome(a.state, ctx(lab, 5), a.value.id, "dama", ctx(ip, 5).now, "").ok).toBe(false);
    const o = recordOutcome(a.state, ctx(er, 5), a.value.id, "dama", ctx(ip, 5).now, "");
    if (!o.ok) throw new Error(o.error);
    expect(dashboardCounts(o.state).dama).toBe(before.dama + 1);
    expect(recordOutcome(o.state, ctx(ip, 6), a.value.id, "death", ctx(ip, 6).now, "").ok).toBe(false);
    expect(correctOutcome(o.state, ctx(ip, 7), a.value.id, { outcome: "death", outcomeAt: ctx(ip, 6).now, reason: "entered wrong outcome" }).ok).toBe(false);
    const c = correctOutcome(o.state, ctx(qa, 7), a.value.id, { outcome: "discharged", outcomeAt: ctx(ip, 6).now, reason: "Wrong outcome selected by ward" });
    if (!c.ok) throw new Error(c.error);
    expect(dashboardCounts(c.state).dama).toBe(before.dama);
    expect(c.state.audit.some((x) => x.action === "outcome.correct")).toBe(true);
  });
});

describe("recipients & rules", () => {
  it("E.164 handling and duplicates", () => {
    expect(toE164("0551234567")).toBe("+966551234567");
    expect(isE164("+966551234567")).toBe(true);
    expect(isE164("0551234567")).toBe(false);
    const s = buildSeed(NOW);
    expect(saveRecipient(s, ctx(qa), { channel: "whatsapp", name: "Dup", address: "0500000001", departmentIds: [], eventTypes: ["case_registered"], active: true }).ok).toBe(false);
    expect(saveRecipient(s, ctx(er), { channel: "email", name: "X", address: "x@example.org", departmentIds: [], eventTypes: ["case_registered"], active: true }).ok).toBe(false);
  });

  it("disabled rules send nothing", () => {
    const s0 = buildSeed(NOW);
    const r = saveRules(s0, ctx(qa), s0.rules.map((x) => (x.eventType === "case_registered" ? { ...x, whatsapp: false, email: false } : x)));
    if (!r.ok) throw new Error();
    const a = newCase(r.state);
    if (!a.ok) throw new Error();
    const ev = a.state.events.find((e) => e.caseId === a.value.id)!;
    expect(a.state.deliveries.filter((d) => d.eventId === ev.id).length).toBe(0);
  });

  it("test messages are marked and deletion keeps history", () => {
    const s0 = buildSeed(NOW);
    const r = s0.recipients[0];
    const t = sendTest(s0, ctx(qa), r.id);
    if (!t.ok) throw new Error();
    expect(t.state.events.find((e) => e.id === t.value.eventId)!.isTest).toBe(true);
    const d = deleteRecipient(t.state, ctx(qa), r.id);
    if (!d.ok) throw new Error();
    expect(d.state.recipients.find((x) => x.id === r.id)!.active).toBe(false);
  });

  it("reminders are idempotent", () => {
    const s0 = buildSeed(NOW);
    const s1 = runReminders(s0, ctx(qa, 0));
    const s2 = runReminders(s1, ctx(qa, 1));
    expect(s2.events.length).toBe(s1.events.length);
    expect(s1.events.some((e) => e.eventType === "bundle_overdue")).toBe(true);
    expect(s1.events.some((e) => e.eventType === "lab_delay")).toBe(true);
    void lead;
  });
});
