import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "node:fs";

const db = new PGlite({ extensions: { pgcrypto } });
const res = [];
const check = (n, ok, d = "") => (res.push(ok), console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`));
const q = (s, p) => db.query(s, p);
const expectErr = async (name, fn, re) => {
  try {
    await fn();
    check(name, false, "no error");
  } catch (e) {
    check(name, re.test(e.message), e.message);
  }
};

// --- Supabase stubs
await db.exec(`
  create schema auth; create schema extensions;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema auth to authenticated, service_role; grant execute on function auth.uid() to authenticated, service_role;
`);
await db.exec(fs.readFileSync("/home/claude/ssts/supabase/migrations/20261108000000_ssts_schema.sql", "utf8"));
await db.exec(fs.readFileSync("/home/claude/ssts/supabase/seed.sql", "utf8"));
check("Migration + seed apply cleanly", true);

const dept = async (n) => (await q("select id from departments where name=$1", [n])).rows[0].id;
const PER = await dept("Pediatric ER"), PICU = await dept("PICU");
const users = { qa: "11111111-1111-1111-1111-111111111111", er: "22222222-2222-2222-2222-222222222222", lab: "33333333-3333-3333-3333-333333333333", ip: "44444444-4444-4444-4444-444444444444", lead: "55555555-5555-5555-5555-555555555555" };
for (const [k, id] of Object.entries(users)) {
  await q("insert into auth.users values ($1)", [id]);
  await q("insert into profiles (id, full_name, role) values ($1,$2,$3)", [id, k, { qa: "quality_admin", er: "emergency", lab: "laboratory", ip: "inpatient", lead: "leadership" }[k]]);
}
await q("insert into profile_departments values ($1,$2)", [users.er, PER]);
await q("insert into profile_departments values ($1,$2)", [users.ip, PICU]);

const as = async (who) => {
  await db.exec(`reset role; select set_config('test.uid', '${users[who] ?? ""}', false); set role authenticated;`);
};
const asService = () => db.exec(`reset role; select set_config('test.uid','',false); set role service_role;`);

// recipients (QA)
await as("qa");
await q(`select save_recipient($1)`, [{ channel: "whatsapp", name: "Quality Director", address: "+966 50 000 0001", departmentIds: [], eventTypes: ["case_registered", "lab_result_available", "outcome_death", "patient_transferred", "bundle_completed"], active: true }]);
await q(`select save_recipient($1)`, [{ channel: "email", name: "Quality", address: "Quality@Example.org", departmentIds: [PER], eventTypes: ["case_registered", "outcome_death"], active: true }]);
await q(`select save_recipient($1)`, [{ channel: "email", name: "PICU only", address: "picu@example.org", departmentIds: [PICU], eventTypes: ["case_registered"], active: true }]);
await expectErr("Duplicate recipient address rejected", () => q(`select save_recipient($1)`, [{ channel: "whatsapp", name: "Dup", address: "+966500000001", eventTypes: ["case_registered"] }]), /already registered/);
await expectErr("Invalid WhatsApp number rejected (E.164 check)", () => q(`select save_recipient($1)`, [{ channel: "whatsapp", name: "Bad", address: "0500", eventTypes: ["case_registered"] }]), /check constraint/);
await as("er");
await expectErr("Non-admin cannot manage recipients", () => q(`select save_recipient($1)`, [{ channel: "email", name: "x", address: "x@example.org", eventTypes: ["case_registered"] }]), /Only Quality Admin/);

// registration
const now = Date.now();
const iso = (m) => new Date(now - m * 60000).toISOString();
const reg = (extra = {}) => q(`select register_case($1, $2) r`, [{ mrn: "MRN-1001", patientName: "Synthetic", age: 4, ageUnit: "years", sex: "Male", caseDate: iso(0).slice(0, 10), emergencyDepartmentId: PER, currentDepartmentId: PER, recognitionTime: iso(30), diagnosisTime: iso(40), physicianName: "Dr X", ...extra }, false]);
const r1 = (await reg()).rows[0].r;
check("ER registers case with generated Case ID", /^SEP-\d{4}-0001$/.test(r1.caseNo), r1.caseNo);
const caseId = r1.id;
await expectErr("Duplicate active MRN detected", () => reg(), /DUPLICATE:SEP-/);
await as("lab");
await expectErr("Laboratory role cannot register", () => reg({ mrn: "MRN-2" }), /Only Emergency/);

await asService();
let ev = (await q(`select e.id, e.event_type, (select count(*) from notification_deliveries d where d.event_id=e.id)::int n, (select count(*) from in_app_notifications i where i.event_id=e.id)::int ia from notification_events e where case_id=$1`, [caseId])).rows;
check("Registration → exactly one event, one in-app, routed deliveries", ev.length === 1 && ev[0].n === 2 && ev[0].ia === 1, JSON.stringify(ev)); // WA all-depts + email PER; PICU-only email excluded
await q("select emit_event('case_registered', $1::uuid, 'case_registered:' || $1::text)", [caseId]);
check("Re-emitting same event is a no-op (idempotent)", (await q("select count(*)::int c from notification_events where case_id=$1", [caseId])).rows[0].c === 1);

// RLS: identifiers & direct writes
await as("lab");
check("RLS: laboratory cannot read MRN/name", (await q("select * from patient_identifiers")).rows.length === 0);
check("RLS: laboratory can read de-identified case", (await q("select case_no from cases")).rows.length === 1);
await expectErr("RLS: direct table write denied", () => q("update cases set status='closed'"), /permission denied|policy/);
await as("lead");
check("RLS: leadership cannot read recipients or delivery log", (await q("select * from notification_recipients")).rows.length === 0 && (await q("select * from notification_deliveries")).rows.length === 0);
await as("er");
check("RLS: ER can read identifiers", (await q("select mrn from patient_identifiers")).rows[0]?.mrn === "MRN-1001");
await db.exec("reset role; select set_config('test.uid','',false); set role anon;");
await expectErr("Anonymous has no access", () => q("select * from cases"), /permission denied/);

// bundle
await as("er");
await q(`select save_bundle($1, $2)`, [caseId, { measures: { lactate: { answer: "YES" }, vasopressors: { answer: "NO" } }, hypotensionOccurred: "NO", completionTime: iso(2), clinicianAllWithin1h: "YES", physicianName: "Dr X" }]);
const bm = (await q("select measure, answer from bundle_measures where case_id=$1 order by measure", [caseId])).rows;
check("Bundle saves original YES/NO answers; undocumented stay NULL", bm.find((m) => m.measure === "lactate").answer === "YES" && bm.find((m) => m.measure === "antibiotics").answer === null);
await expectErr("Completion before recognition rejected", () => q(`select save_bundle($1, $2)`, [caseId, { completionTime: iso(120) }]), /before the Time of Sepsis Recognition/);
await expectErr("ER cannot set a Quality review decision", () => q(`select save_bundle($1, $2)`, [caseId, { reviewOverride: "compliant", completionTime: iso(2) }]), /Only Quality Admin/);

// lab
await as("lab");
const labId = (await q(`select save_lab($1) id`, [{ caseId, testType: "Lactate", status: "pending", requestedAt: iso(20), notes: "" }])).rows[0].id;
await q(`select save_lab($1)`, [{ id: labId, caseId, testType: "Lactate", status: "result_available", requestedAt: iso(20), resultAt: iso(1), notes: "" }]);
await expectErr("Unchanged lab update rejected", () => q(`select save_lab($1)`, [{ id: labId, caseId, testType: "Lactate", status: "result_available", requestedAt: iso(20), resultAt: iso(1), notes: "" }]), /No changes/);
check("Lab linked to bundle measure", (await q("select linked_measure from lab_tests where id=$1", [labId])).rows[0].linked_measure === "lactate");

// inpatient
await as("ip");
await expectErr("Ward cannot update a case still in ER", () => q(`select add_case_update($1)`, [{ caseId, departmentId: PICU, status: "Admitted", updateAt: iso(0) }]), /current department/);
await as("er");
await q(`select add_case_update($1)`, [{ caseId, departmentId: PER, status: "Admitted", updateAt: iso(0), notes: "to PICU", transferToId: PICU }]);
await as("ip");
const upd = { caseId, departmentId: PICU, status: "Under Treatment", updateAt: iso(0), notes: "" };
await q(`select add_case_update($1)`, [upd]);
await expectErr("Unchanged inpatient update rejected (no duplicate alert)", () => q(`select add_case_update($1)`, [upd]), /No changes/);

// outcome
await q(`select record_outcome($1, 'death', $2, '')`, [caseId, iso(0)]);
await expectErr("Second outcome blocked", () => q(`select record_outcome($1, 'dama', $2, '')`, [caseId, iso(0)]), /already recorded/);
await expectErr("Correction requires Quality Admin", () => q(`select correct_outcome($1, 'dama', $2, 'wrong button pressed')`, [caseId, iso(0)]), /Only Quality Admin/);
await as("qa");
await expectErr("Correction requires a reason", () => q(`select correct_outcome($1, 'dama', $2, 'short')`, [caseId, iso(0)]), /reason/);
await q(`select correct_outcome($1, 'discharged', $2, 'Ward selected the wrong outcome')`, [caseId, iso(0)]);
const c = (await q("select outcome, status from cases where id=$1", [caseId])).rows[0];
check("Corrected outcome stored; history kept", c.outcome === "discharged" && (await q("select count(*)::int n from final_outcomes where case_id=$1", [caseId])).rows[0].n === 2);

// events overview
await asService();
const types = (await q("select event_type from notification_events where case_id=$1 order by created_at", [caseId])).rows.map((r) => r.event_type);
check("Event chain recorded", ["case_registered", "bundle_completed", "lab_result_available", "patient_transferred", "inpatient_update", "outcome_death", "outcome_discharged"].every((t) => types.includes(t)), types.join(","));

// disabled rule sends nothing
await as("qa");
await q(`select save_rules($1)`, [[{ eventType: "case_registered", whatsapp: false, email: false, inApp: true }]]);
await as("er");
const r2 = (await reg({ mrn: "MRN-2002" })).rows[0].r;
await asService();
check("Disabled rule → no external deliveries", (await q("select count(*)::int n from notification_deliveries d join notification_events e on e.id=d.event_id where e.case_id=$1", [r2.id])).rows[0].n === 0);

// worker claim is exclusive
const a = (await q("select * from claim_deliveries(100)")).rows.length;
const b = (await q("select * from claim_deliveries(100)")).rows.length;
check("Worker claim is exclusive (no double send)", a > 0 && b === 0, `${a} then ${b}`);

// audit immutability
await expectErr("Audit log is append-only", () => q("delete from audit_logs"), /append-only/);
check("Audit entries written", (await q("select count(*)::int n from audit_logs")).rows[0].n >= 10);

// recipient deletion with history → deactivated
await as("qa");
const rid = (await q("select id from notification_recipients where name='Quality Director'")).rows[0].id;
check("Recipient with history is deactivated, not deleted", (await q("select delete_recipient($1) r", [rid])).rows[0].r === "deactivated");

console.log(`\n${res.filter(Boolean).length}/${res.length} passed`);
process.exit(res.every(Boolean) ? 0 : 1);
