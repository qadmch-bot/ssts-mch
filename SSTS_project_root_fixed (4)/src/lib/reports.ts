// Report builder — every figure is computed from stored records at request time.
// Exports never include MRN or patient name.
import { evaluateCompliance, summarizeCompliance, summarizeElements, COMPLIANCE_LABELS, TIMING_LABELS } from "./bundle";
import { BUNDLE_MEASURES, LAB_STATUS_LABELS, OUTCOME_LABELS } from "./constants";
import { deptName, type State } from "./engine";
import { fmtDateTime, minutesBetween, toRiyadhInput } from "./time";
import type { SepsisCase } from "./types";

export type ReportKey = "cases" | "bundle" | "elements" | "lab" | "department";

export const REPORTS: { key: ReportKey; label: string }[] = [
  { key: "cases", label: "Sepsis Case Report" },
  { key: "bundle", label: "Hour-1 Bundle Compliance" },
  { key: "elements", label: "Bundle Element Compliance" },
  { key: "lab", label: "Laboratory Report" },
  { key: "department", label: "Department Follow-up" },
];

export interface Section {
  title: string;
  columns: string[];
  rows: (string | number)[][];
  note?: string;
}

export interface ReportData {
  title: string;
  period: string;
  generatedAt: string;
  summary: { label: string; value: string | number }[];
  sections: Section[];
}

export function inPeriod(c: SepsisCase, from: string, to: string) {
  // Registration date (Riyadh calendar day) within [from, to]
  const d = toRiyadhInput(c.createdAt).slice(0, 10);
  return (!from || d >= from) && (!to || d <= to);
}

const pct = (v: number | null) => (v === null ? "—" : `${v}%`);

export function buildReport(s: State, key: ReportKey, from: string, to: string, now: string): ReportData {
  const cases = s.cases.filter((c) => inPeriod(c, from, to)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const ids = new Set(cases.map((c) => c.id));
  const evals = cases.map((c) => ({ c, e: evaluateCompliance(c, s.bundles.find((b) => b.caseId === c.id), now) }));
  const period = `${from || "start"} to ${to || "today"}`;
  const base = { period, generatedAt: fmtDateTime(now) };
  const dept = (c: SepsisCase) => deptName(s, c.emergencyDepartmentId);

  if (key === "cases") {
    const n = (f: (c: SepsisCase) => boolean) => cases.filter(f).length;
    const byDept = groupBy(cases, (c) => deptName(s, c.currentDepartmentId));
    return {
      ...base,
      title: "Sepsis Case Report",
      summary: [
        { label: "Total Cases", value: cases.length },
        { label: "Active Cases", value: n((c) => c.status === "active") },
        { label: "Discharged", value: n((c) => c.outcome === "discharged") },
        { label: "DAMA", value: n((c) => c.outcome === "dama") },
        { label: "Deaths", value: n((c) => c.outcome === "death") },
        { label: "Other closures", value: n((c) => !!c.outcome && !["discharged", "dama", "death"].includes(c.outcome)) },
      ],
      sections: [
        {
          title: "Cases by Current Department",
          columns: ["Department", "Total", "Active", "Discharged", "DAMA", "Death", "Other closure"],
          rows: Object.entries(byDept).map(([d, cs]) => [
            d,
            cs.length,
            cs.filter((c) => c.status === "active").length,
            cs.filter((c) => c.outcome === "discharged").length,
            cs.filter((c) => c.outcome === "dama").length,
            cs.filter((c) => c.outcome === "death").length,
            cs.filter((c) => c.outcome && !["discharged", "dama", "death"].includes(c.outcome)).length,
          ]),
        },
        {
          title: "Case List",
          columns: ["Case ID", "Registered", "Emergency Dept.", "Current Dept.", "Category", "Status", "Outcome", "Outcome Time"],
          rows: cases.map((c) => [
            c.caseNo,
            fmtDateTime(c.createdAt),
            dept(c),
            deptName(s, c.currentDepartmentId),
            c.patientCategory || "—",
            c.status === "active" ? "Active" : "Closed",
            c.outcome ? OUTCOME_LABELS[c.outcome] : "—",
            fmtDateTime(c.outcomeAt),
          ]),
        },
      ],
    };
  }

  if (key === "bundle") {
    const sum = summarizeCompliance(evals.map((x) => x.e));
    const byDept = groupBy(evals, (x) => dept(x.c));
    const byMonth = groupBy(evals, (x) => toRiyadhInput(x.c.recognitionTime ?? x.c.createdAt).slice(0, 7));
    const row = (k: string, xs: typeof evals) => {
      const m = summarizeCompliance(xs.map((x) => x.e));
      return [k, m.total, m.compliant, m.notCompliant, m.pending, m.review, pct(m.percentage)];
    };
    const cols = ["Group", "Total", "Within 1 Hour", "Not Within 1 Hour", "Pending Documentation", "Requires Review", "Compliance %"];
    return {
      ...base,
      title: "Hour-1 Bundle Compliance Report",
      summary: [
        { label: "Total Eligible Cases", value: sum.total },
        { label: "Completed Within 1 Hour", value: sum.compliant },
        { label: "Not Completed Within 1 Hour", value: sum.notCompliant },
        { label: "Pending Documentation", value: sum.pending },
        { label: "Requires Review", value: sum.review },
        { label: "Compliance Percentage", value: pct(sum.percentage) },
      ],
      sections: [
        { title: "Compliance by Department", columns: cols.map((c, i) => (i === 0 ? "Department" : c)), rows: Object.entries(byDept).map(([k, v]) => row(k, v)) },
        { title: "Compliance by Month", columns: cols.map((c, i) => (i === 0 ? "Month" : c)), rows: Object.entries(byMonth).sort().map(([k, v]) => row(k, v)) },
        {
          title: "Case Detail",
          columns: ["Case ID", "Department", "Recognition", "Completion", "Minutes", "Timing (system)", "Clinician: within 1h", "Status", "Reason"],
          rows: evals.map(({ c, e }) => {
            const b = s.bundles.find((x) => x.caseId === c.id);
            return [c.caseNo, dept(c), fmtDateTime(c.recognitionTime), fmtDateTime(b?.completionTime), e.timing.minutes ?? "—", TIMING_LABELS[e.timing.result], b?.clinicianAllWithin1h ?? "—", COMPLIANCE_LABELS[e.status], e.reasons[0] ?? ""];
          }),
        },
      ],
    };
  }

  if (key === "elements") {
    const el = summarizeElements(evals.map((x) => x.e));
    return {
      ...base,
      title: "Bundle Element Compliance",
      summary: el.map((x) => ({ label: BUNDLE_MEASURES.find((m) => m.key === x.key)!.short, value: pct(x.percentage) })),
      sections: [
        {
          title: "Element Compliance",
          columns: ["Measure", "YES", "NO", "Denominator (applicable & documented)", "Compliance %", "Not applicable (documented)", "Not documented", "Requires review"],
          rows: el.map((x) => [BUNDLE_MEASURES.find((m) => m.key === x.key)!.title, x.yes, x.no, x.denominator, pct(x.percentage), x.notApplicable, x.missing, x.review]),
          note: "Vasopressors are applicable only when hypotension is documented as YES. Not-documented and review cases are excluded from denominators and shown separately.",
        },
      ],
    };
  }

  if (key === "lab") {
    const labs = s.labs.filter((l) => ids.has(l.caseId));
    const overdueH = s.settings.reminders.labOverdueHours;
    const overdue = labs.filter((l) => ["requested", "pending"].includes(l.status) && l.requestedAt && minutesBetween(l.requestedAt, now) >= overdueH * 60);
    const tat = labs.filter((l) => l.resultAt && l.requestedAt).map((l) => minutesBetween(l.requestedAt!, l.resultAt!));
    const median = tat.length ? tat.sort((a, b) => a - b)[Math.floor(tat.length / 2)] : null;
    return {
      ...base,
      title: "Laboratory Report",
      summary: [
        { label: "Total Tests", value: labs.length },
        { label: "Pending Results", value: labs.filter((l) => ["requested", "pending"].includes(l.status)).length },
        { label: "Available Results", value: labs.filter((l) => l.status === "result_available").length },
        { label: `Overdue (>${overdueH}h)`, value: overdue.length },
        { label: "Median turnaround", value: median === null ? "—" : `${median} min` },
      ],
      sections: [
        {
          title: "Tests",
          columns: ["Case ID", "Test", "Status", "Requested", "Result", "Turnaround (min)", "Overdue"],
          rows: labs.map((l) => [
            s.cases.find((c) => c.id === l.caseId)!.caseNo,
            l.testType,
            LAB_STATUS_LABELS[l.status],
            fmtDateTime(l.requestedAt),
            fmtDateTime(l.resultAt),
            l.resultAt && l.requestedAt ? minutesBetween(l.requestedAt, l.resultAt) : "—",
            overdue.includes(l) ? "Yes" : "",
          ]),
        },
      ],
    };
  }

  // department follow-up
  const updH = s.settings.reminders.inpatientUpdateOverdueHours;
  const byDept = groupBy(cases, (c) => deptName(s, c.currentDepartmentId));
  const lastTouch = (c: SepsisCase) => Math.max(new Date(c.createdAt).getTime(), ...s.updates.filter((u) => u.caseId === c.id).map((u) => new Date(u.createdAt).getTime()));
  const pending = (c: SepsisCase) => c.status === "active" && (new Date(now).getTime() - lastTouch(c)) / 3600000 >= updH;
  return {
    ...base,
    title: "Department Follow-up Report",
    summary: [
      { label: "Active Cases", value: cases.filter((c) => c.status === "active").length },
      { label: `Pending Updates (>${updH}h)`, value: cases.filter(pending).length },
      { label: "Final Outcomes", value: cases.filter((c) => c.outcome).length },
      { label: "Updates Recorded", value: s.updates.filter((u) => ids.has(u.caseId)).length },
    ],
    sections: [
      {
        title: "By Current Department",
        columns: ["Department", "Active", "Pending Updates", "Final Outcomes", "Updates Recorded"],
        rows: Object.entries(byDept).map(([d, cs]) => [d, cs.filter((c) => c.status === "active").length, cs.filter(pending).length, cs.filter((c) => c.outcome).length, s.updates.filter((u) => cs.some((c) => c.id === u.caseId)).length]),
      },
      {
        title: "Overdue Updates",
        columns: ["Case ID", "Department", "Last Update", "Current Status"],
        rows: cases.filter(pending).map((c) => [c.caseNo, deptName(s, c.currentDepartmentId), fmtDateTime(new Date(lastTouch(c)).toISOString()), c.currentStatus]),
      },
    ],
  };
}

function groupBy<T>(xs: T[], f: (x: T) => string) {
  const out: Record<string, T[]> = {};
  for (const x of xs) (out[f(x)] ??= []).push(x);
  return out;
}

export async function exportExcel(r: ReportData) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "SSTS – Maternity & Children Hospital";
  const ws = wb.addWorksheet("Summary");
  ws.addRow([r.title]).font = { bold: true, size: 14 };
  ws.addRow([`Maternity & Children Hospital – Hafar Al Batin · Period: ${r.period} · Generated: ${r.generatedAt}`]);
  ws.addRow([]);
  r.summary.forEach((x) => ws.addRow([x.label, x.value]));
  ws.getColumn(1).width = 38;
  ws.getColumn(2).width = 16;
  r.sections.forEach((sec, i) => {
    const sh = wb.addWorksheet(sec.title.slice(0, 28) || `Sheet${i + 2}`);
    const h = sh.addRow(sec.columns);
    h.font = { bold: true, color: { argb: "FFFFFFFF" } };
    h.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B2A55" } }));
    sec.rows.forEach((row) => sh.addRow(row));
    sec.columns.forEach((_, j) => (sh.getColumn(j + 1).width = Math.min(40, Math.max(12, sec.columns[j].length + 4))));
    if (sec.note) {
      sh.addRow([]);
      sh.addRow([sec.note]);
    }
  });
  const buf = await wb.xlsx.writeBuffer();
  download(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${slug(r.title)}_${r.period.replace(/\s/g, "")}.xlsx`);
}

export async function exportPdf(r: ReportData, logoDataUrl?: string) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  if (logoDataUrl) doc.addImage(logoDataUrl, "PNG", 40, 26, 40, 38);
  doc.setFont("helvetica", "bold").setFontSize(15).setTextColor(11, 42, 85).text(r.title, 90, 42);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(90).text(`Hafar Al Batin Health Cluster · Maternity & Children Hospital · Quality & Patient Safety`, 90, 56);
  doc.text(`Period: ${r.period}   ·   Generated: ${r.generatedAt}`, 90, 68);
  autoTable(doc, {
    startY: 84,
    head: [r.summary.map((x) => x.label)],
    body: [r.summary.map((x) => String(x.value))],
    theme: "grid",
    headStyles: { fillColor: [20, 179, 155], fontSize: 8 },
    bodyStyles: { fontStyle: "bold", fontSize: 11, halign: "center" },
  });
  for (const sec of r.sections) {
    const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 22;
    doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(11, 42, 85).text(sec.title, 40, y);
    autoTable(doc, {
      startY: y + 6,
      head: [sec.columns],
      body: sec.rows.map((r) => r.map(String)),
      theme: "striped",
      headStyles: { fillColor: [11, 42, 85], fontSize: 8 },
      styles: { fontSize: 7.5, cellPadding: 3 },
    });
    if (sec.note) {
      const y2 = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;
      doc.setFont("helvetica", "italic").setFontSize(8).setTextColor(100).text(sec.note, 40, y2, { maxWidth: 760 });
    }
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(130);
    doc.text(`Confidential – internal quality report. Contains no patient identifiers. Page ${i} of ${pages}`, 40, doc.internal.pageSize.getHeight() - 18);
  }
  doc.save(`${slug(r.title)}_${r.period.replace(/\s/g, "")}.pdf`);
}

function slug(s: string) {
  return s.replace(/[^A-Za-z0-9]+/g, "_").replace(/_+$/, "");
}

function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
