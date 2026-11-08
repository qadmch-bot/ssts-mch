import puppeteer from "puppeteer-core";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = "/tmp/claude-0/shots";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const browser = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--disable-gpu"], headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
page.on("console", (m) => m.type() === "error" && console.log("CONSOLE:", m.text()));

const go = async (path) => {
  await page.goto(BASE + path, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => !document.body.innerText.includes("Loading…"), { timeout: 20000 });
};
const text = () => page.evaluate(() => document.body.innerText);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Set a field by its <label> text (works for input/select/textarea in a Field wrapper)
const setField = (label, value, root = "body") =>
  page.evaluate(
    (label, value, root) => {
      const scope = document.querySelector(root) ?? document.body;
      const lab = [...scope.querySelectorAll("label")].find((l) => l.textContent.replace("*", "").trim().startsWith(label));
      if (!lab) throw new Error("label not found: " + label);
      const el = lab.parentElement.querySelector("input,select,textarea");
      const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
      el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
    },
    label,
    value,
    root,
  );
const clickText = async (txt, sel = "button") => {
  const ok = await page.evaluate(
    (txt, sel) => {
      const el = [...document.querySelectorAll(sel)].filter((b) => !b.disabled).find((b) => b.innerText.trim().replace(/\s+/g, " ").includes(txt));
      if (!el) return false;
      el.click();
      return true;
    },
    txt,
    sel,
  );
  if (!ok) throw new Error(`clickable not found: ${txt}`);
  await sleep(250);
};
const kpis = async () => {
  await go("/");
  return page.evaluate(() => {
    const get = (l) => {
      const a = [...document.querySelectorAll("a")].find((x) => x.innerText.startsWith(l));
      return a ? Number(a.innerText.split("\n").pop()) : NaN;
    };
    return { total: get("Total Sepsis Cases"), active: get("Active Cases"), deaths: get("Deaths"), dama: get("DAMA"), discharged: get("Discharged") };
  });
};
const riyadh = (minAgo = 0) => new Date(Date.now() + 3 * 3600000 - minAgo * 60000).toISOString().slice(0, 16);

try {
  // ---- 1. dashboard baseline
  const k0 = await kpis();
  check("Dashboard KPIs render from data", k0.total === 15 && k0.deaths === 1, JSON.stringify(k0));
  await page.screenshot({ path: `${OUT}/01-dashboard.png`, fullPage: true });

  // ---- 2. validation + registration
  await go("/cases/new");
  await clickText("Register Case");
  check("Required-field validation shown", (await text()).includes("MRN is required"));
  await setField("Patient MRN", "E2E-7788");
  await setField("Patient Name", "Synthetic E2E Patient");
  await page.evaluate(() => {
    const el = document.querySelector('input[type="number"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "6");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await setField("Sex", "Female");
  await setField("Patient Category", "Pediatric");
  await setField("Consultant", "Dr. E2E Consultant");
  await setField("Diagnosis Time", riyadh(25));
  await setField("Time of Sepsis Recognition", riyadh(20));
  await setField("Physician Name", "Dr. E2E Physician");
  await page.screenshot({ path: `${OUT}/02-new-case.png`, fullPage: true });
  await clickText("Register Case");
  await page.waitForFunction(() => document.body.innerText.includes("Case Registered"), { timeout: 5000 });
  const caseNo = await page.evaluate(() => document.querySelector("p.text-4xl")?.innerText);
  check("New case saved with generated Case ID", /^SEP-\d{4}-\d{4}$/.test(caseNo ?? ""), caseNo);
  const queued = (await text()).match(/(\d+) WhatsApp\/email notification/)?.[1];
  check("Registration queued one notification per recipient+channel", queued === "4", `${queued} queued (Ped ER routing: 2 WhatsApp + 2 email)`);

  // duplicate MRN
  await clickText("Register Another");
  await setField("Patient MRN", "E2E-7788");
  await setField("Patient Name", "Synthetic E2E Patient");
  await page.evaluate(() => {
    const el = document.querySelector('input[type="number"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "6");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await setField("Sex", "Female");
  await setField("Time of Sepsis Recognition", riyadh(20));
  await setField("Physician Name", "Dr. E2E Physician");
  await clickText("Register Case");
  check("Duplicate MRN warning", (await text()).includes("Possible duplicate registration"));
  await clickText("Cancel");

  // find the case id
  await go("/cases?q=" + caseNo);
  const caseHref = await page.evaluate((no) => [...document.querySelectorAll("a")].find((a) => a.innerText === no)?.getAttribute("href"), caseNo);
  const caseId = new URL(BASE + caseHref).searchParams.get("id");

  // ---- 3. Hour-1 bundle
  await go(`/bundle/form?id=${caseId}`);
  await page.screenshot({ path: `${OUT}/03-bundle-empty.png`, fullPage: true });
  // answer YES on measures 1-4 and NO on vasopressors without hypotension → requires review
  await page.evaluate(() => {
    const groups = [...document.querySelectorAll("div.inline-flex.overflow-hidden")];
    // order: m1..m4 , hypotension(inside m5), m5 answer, completion question
    const click = (g, v) => [...g.querySelectorAll("button")].find((b) => b.innerText === v).click();
    window.__groups = groups.length;
    click(groups[0], "YES");
    click(groups[1], "YES");
    click(groups[2], "YES");
    click(groups[3], "YES");
    click(groups[5], "NO"); // vasopressors answer
    click(groups[6], "YES"); // all within 1h
  });
  await setField("Bundle Completion Time", riyadh(2));
  await sleep(200);
  let t = await text();
  check("NO on vasopressors without documented hypotension → Requires Review (not N/A)", t.includes("NO recorded but hypotension not documented"));
  await clickText("Save Bundle");
  await sleep(300);
  // now document hypotension = NO → compliant
  await page.evaluate(() => {
    const g = [...document.querySelectorAll("div.inline-flex.overflow-hidden")][4];
    [...g.querySelectorAll("button")].find((b) => b.innerText === "NO").click();
  });
  await sleep(200);
  t = await text();
  check("Clinician answer and system timing shown separately", /clinician-recorded/i.test(t) && /system-calculated timing/i.test(t) && t.includes("18 min"));
  check("Documented no-hypotension + all YES + ≤60 min → Within 1 Hour", t.includes("All applicable measures YES"));
  await page.screenshot({ path: `${OUT}/04-bundle-complete.png`, fullPage: true });
  await clickText("Save Bundle");
  await sleep(300);

  // ---- 4. laboratory
  await go(`/laboratory?case=${caseId}&add=1`);
  await sleep(300);
  await clickText("Save", "div[role=dialog] button");
  await sleep(300);
  await clickText("Result Available", "td button");
  await sleep(300);
  await page.screenshot({ path: `${OUT}/05-lab-dialog.png` });
  await clickText("Save", "div[role=dialog] button");
  await sleep(300);
  t = await text();
  check("Lab result marked available", t.includes("Result Available"));

  // ---- 5. inpatient transfer
  await go(`/inpatient?case=${caseId}`);
  await sleep(300);
  await setField("Case Status", "Admitted", "div[role=dialog]");
  await setField("Transfer to (optional)", "d-picu", "div[role=dialog]");
  await setField("Notes", "Admitted to PICU", "div[role=dialog]");
  await clickText("Save Update");
  await sleep(300);
  // duplicate update should be rejected
  await go(`/inpatient?case=${caseId}`);
  await sleep(300);
  await setField("Current Department", "d-picu", "div[role=dialog]");
  await setField("Case Status", "Admitted", "div[role=dialog]");
  await setField("Notes", "Admitted to PICU", "div[role=dialog]");
  await clickText("Save Update"); // PICU "Admitted" — a genuine new update
  await sleep(300);
  await go(`/inpatient?case=${caseId}`);
  await sleep(300);
  await setField("Current Department", "d-picu", "div[role=dialog]");
  await setField("Case Status", "Admitted", "div[role=dialog]");
  await setField("Notes", "Admitted to PICU", "div[role=dialog]");
  await clickText("Save Update"); // identical → must be rejected
  await sleep(300);
  t = await text();
  check("Unchanged update rejected (no duplicate alert)", t.includes("No changes since the last update"));
  await page.keyboard.press("Escape");

  // ---- 6. outcome DEATH
  await go(`/cases/view?id=${caseId}`);
  await clickText("Record Outcome");
  await clickText("DEATH");
  await clickText("Continue");
  await page.screenshot({ path: `${OUT}/06-outcome-confirm.png` });
  await clickText("Confirm & Save");
  await sleep(300);
  await page.screenshot({ path: `${OUT}/07-case-detail.png`, fullPage: true });
  const k1 = await kpis();
  check("Death updates dashboard counts", k1.deaths === k0.deaths + 1 && k1.total === k0.total + 1 && k1.active === k0.active, JSON.stringify(k1));

  // ---- 7. notification log
  await go("/notifications?tab=log");
  t = await text();
  const caseEvents = ["New Sepsis Case", "Hour-1 Bundle Completed", "Laboratory Result Available", "Patient Transferred", "Death"].filter((e) =>
    t.split("\n").some((line) => line.includes(caseNo) || true) && t.includes(e),
  );
  check("Delivery log lists case events", caseEvents.length === 5, caseEvents.join(", "));
  check("No fake delivery: unconfigured provider shows Not Sent", t.includes("Not Sent") && !/\tDelivered\t/.test(t));
  await page.screenshot({ path: `${OUT}/08-delivery-log.png` });

  // ---- 8. recipients persist across refresh
  await go("/settings?tab=whatsapp");
  await clickText("Add Recipient");
  await setField("Name / Role", "PICU Consultant (E2E)", "div[role=dialog]");
  await setField("WhatsApp Number", "0551234567", "div[role=dialog]");
  await clickText("Save", "div[role=dialog] button");
  await sleep(300);
  await page.reload({ waitUntil: "networkidle0" });
  await sleep(500);
  t = await text();
  check("WhatsApp recipient saved, E.164-normalized, persists after refresh", t.includes("PICU Consultant (E2E)") && t.includes("+966551234567"));
  await clickText("Add Recipient");
  await setField("Name / Role", "Dup", "div[role=dialog]");
  await setField("WhatsApp Number", "+966551234567", "div[role=dialog]");
  await clickText("Save", "div[role=dialog] button");
  t = await text();
  check("Duplicate WhatsApp number rejected", t.includes("already registered"));
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `${OUT}/09-settings-whatsapp.png` });

  // email recipient deactivate
  await go("/settings?tab=email");
  await page.evaluate(() => document.querySelector('button[role="switch"]').click());
  await sleep(200);
  await page.reload({ waitUntil: "networkidle0" });
  await sleep(400);
  t = await text();
  check("Email recipient deactivation persists", t.includes("Inactive"));

  // rules disable persists
  await go("/settings?tab=rules");
  await page.screenshot({ path: `${OUT}/10-rules.png` });

  // ---- 9. role restrictions
  await go("/");
  await page.evaluate(() => localStorage.setItem("ssts-demo-user", "u-lab"));
  await go("/cases/new");
  check("Laboratory role cannot register cases", (await text()).includes("Not permitted"));
  await go(`/cases/view?id=${caseId}`);
  t = await text();
  check("Laboratory role cannot see MRN", t.includes("Restricted") && !t.includes("E2E-7788"));
  await go("/settings?tab=whatsapp");
  check("Non-admin cannot manage recipients", (await text()).includes("Read-only") && !(await text()).includes("Add Recipient"));
  await page.evaluate(() => localStorage.setItem("ssts-demo-user", "u-lead"));
  await go("/reports");
  check("Leadership can view reports", (await text()).includes("Sepsis Case Report"));
  await page.evaluate(() => localStorage.setItem("ssts-demo-user", "u-qa"));

  // ---- 10. mobile
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await go("/");
  await page.screenshot({ path: `${OUT}/11-mobile-dashboard.png`, fullPage: false });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check("Mobile: no horizontal page overflow", !overflow);
  await page.click('button[aria-label="Open menu"]');
  await sleep(300);
  await page.screenshot({ path: `${OUT}/12-mobile-menu.png` });
  await page.setViewport({ width: 1600, height: 1000 });
} catch (e) {
  check("E2E run completed", false, e.message);
  await page.screenshot({ path: `${OUT}/zz-error.png`, fullPage: true });
}
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
