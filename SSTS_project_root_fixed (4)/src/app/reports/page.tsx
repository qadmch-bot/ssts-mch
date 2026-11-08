"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { BarChart3, FileSpreadsheet, FileText, Printer, Lock } from "lucide-react";
import { Alert, Button, Card, CardHeader, Empty, Field, Input, PageHeader, Tabs, cn } from "@/components/ui";
import { useToast } from "@/components/toast";
import { useStore } from "@/lib/store";
import { buildReport, exportExcel, exportPdf, REPORTS, type ReportKey } from "@/lib/reports";
import { nowIso, riyadhToday, toRiyadhInput } from "@/lib/time";
import type { State } from "@/lib/engine";

type Preset = "daily" | "weekly" | "monthly" | "all" | "custom";

function range(p: Preset): [string, string] {
  const today = riyadhToday();
  const back = (d: number) => toRiyadhInput(new Date(Date.now() - d * 86400000).toISOString()).slice(0, 10);
  if (p === "daily") return [today, today];
  if (p === "weekly") return [back(6), today];
  if (p === "monthly") return [today.slice(0, 8) + "01", today];
  return ["", today];
}

function Inner() {
  const sp = useSearchParams();
  const { state, can, act } = useStore();
  const toast = useToast();
  const [key, setKey] = useState<ReportKey>((sp.get("r") as ReportKey) || "cases");
  const [preset, setPreset] = useState<Preset>("monthly");
  const [[from, to], setRange] = useState<[string, string]>(range("monthly"));
  const now = useMemo(() => nowIso(), [key, from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  const report = useMemo(() => buildReport(state, key, from, to, now), [state, key, from, to, now]);
  const allowed = can("reports.export");

  const logExport = (fmt: string) =>
    act(
      (s: State, ctx) => ({
        ok: true,
        value: null,
        state: { ...s, audit: [{ id: crypto.randomUUID(), at: ctx.now, userId: ctx.user.id, userName: ctx.user.name, action: "report.export", entity: "report", entityId: key, caseId: null, detail: `${report.title} (${fmt}) ${report.period}` }, ...s.audit] },
      }),
      () => ({ fn: "log_report_export", args: { p_report: key, p_detail: `${report.title} (${fmt}) ${report.period}` } }),
    );

  const doExport = async (fmt: "xlsx" | "pdf" | "print") => {
    if (!allowed) return toast("error", "Export not permitted for your role");
    logExport(fmt);
    try {
      if (fmt === "print") return window.print();
      if (fmt === "xlsx") await exportExcel(report);
      else {
        const logo = await toDataUrl("/cluster-mark.png").catch(() => undefined);
        await exportPdf(report, logo);
      }
      toast("success", `${fmt === "xlsx" ? "Excel" : "PDF"} exported`, "No patient identifiers are included.");
    } catch (e) {
      toast("error", "Export failed", (e as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <PageHeader
        title="Reports"
        subtitle="Calculated from stored records at the time of viewing · exports exclude MRN and patient names"
        icon={<BarChart3 />}
        actions={
          allowed ? (
            <>
              <Button variant="outline" onClick={() => doExport("xlsx")}>
                <FileSpreadsheet className="text-emerald-600" /> Excel
              </Button>
              <Button variant="outline" onClick={() => doExport("pdf")}>
                <FileText className="text-red-600" /> PDF
              </Button>
              <Button variant="outline" onClick={() => doExport("print")}>
                <Printer /> Print
              </Button>
            </>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-sm text-slate-500">
              <Lock className="size-4" /> Export restricted
            </span>
          )
        }
      />
      <Tabs<ReportKey> value={key} onChange={setKey} items={REPORTS.map((r) => ({ value: r.key, label: r.label }))} />
      <Card className="no-print p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex overflow-hidden rounded-lg border border-slate-300">
            {(["daily", "weekly", "monthly", "all"] as Preset[]).map((p) => (
              <button
                key={p}
                onClick={() => {
                  setPreset(p);
                  setRange(range(p));
                }}
                className={cn("px-3.5 py-2 text-sm font-semibold capitalize", preset === p ? "bg-navy-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50")}
              >
                {p === "all" ? "All time" : p}
              </button>
            ))}
          </div>
          <Field label="From">
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setPreset("custom");
                setRange([e.target.value, to]);
              }}
            />
          </Field>
          <Field label="To">
            <Input
              type="date"
              value={to}
              onChange={(e) => {
                setPreset("custom");
                setRange([from, e.target.value]);
              }}
            />
          </Field>
          <p className="ml-auto text-xs text-slate-500">Cases are included by registration date (Riyadh). Each case is counted once.</p>
        </div>
      </Card>

      <div className="hidden print:block">
        <h1 className="text-xl font-bold">{report.title}</h1>
        <p className="text-sm">
          Maternity &amp; Children Hospital – Hafar Al Batin · Period {report.period} · Generated {report.generatedAt}
        </p>
      </div>

      {key === "bundle" && !state.settings.complianceRulesApproved && <Alert tone="amber">Compliance figures use the default calculation rules, which are pending hospital approval.</Alert>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {report.summary.map((x) => (
          <Card key={x.label} className="px-4 py-3">
            <p className="text-xs font-semibold text-slate-500">{x.label}</p>
            <p className="text-2xl font-bold text-navy-900">{x.value}</p>
          </Card>
        ))}
      </div>

      {report.sections.map((sec) => (
        <Card key={sec.title}>
          <CardHeader title={sec.title} subtitle={`${sec.rows.length} row(s)`} />
          {sec.title.includes("by Month") && sec.rows.length > 0 && <MonthBars rows={sec.rows} />}
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  {sec.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sec.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((v, j) => (
                      <td key={j} className={cn(j === 0 && "font-semibold text-navy-900", "whitespace-nowrap")}>
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {!sec.rows.length && <Empty title="No records in this period" />}
          </div>
          {sec.note && <p className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500">{sec.note}</p>}
        </Card>
      ))}
    </div>
  );
}

function MonthBars({ rows }: { rows: (string | number)[][] }) {
  return (
    <div className="flex items-end gap-4 overflow-x-auto px-5 pt-4">
      {rows.map((r) => {
        const v = typeof r[6] === "string" && r[6].endsWith("%") ? parseFloat(r[6]) : null;
        return (
          <div key={String(r[0])} className="flex w-16 shrink-0 flex-col items-center gap-1">
            <span className="text-xs font-bold text-navy-900">{v === null ? "—" : `${v}%`}</span>
            <div className="flex h-24 w-8 items-end rounded bg-slate-100">
              <div className="w-full rounded bg-teal-500" style={{ height: `${v ?? 0}%` }} />
            </div>
            <span className="text-[11px] text-slate-500">{r[0]}</span>
          </div>
        );
      })}
    </div>
  );
}

async function toDataUrl(src: string) {
  const blob = await (await fetch(src)).blob();
  return await new Promise<string>((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });
}

export default function ReportsPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
