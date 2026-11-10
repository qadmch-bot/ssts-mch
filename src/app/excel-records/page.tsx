"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { IS_DEMO, useStore } from "@/lib/store";

type HistoricalRow = {
  source_row: number;
  facility: string;
  patient_mrn: string;
  admission_date: string | null;
  lactate_1h: boolean | null;
  antibiotic_1h: boolean | null;
  culture_1h: boolean | null;
  bundle_all3: boolean | null;
};

function flag(value: boolean | null) {
  return value === true ? "Yes" : value === false ? "No" : "Not recorded";
}

export default function HistoricalExcelRecordsPage() {
  const { user, ready } = useStore();
  const allowed = ready && user.role === "quality_admin";
  const [rows, setRows] = useState<HistoricalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!ready) return;
    if (!allowed || IS_DEMO) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const sb = supabaseBrowser();
        const { data, error: queryError } = await sb.from("sepsis_excel_import")
          .select("source_row,facility,patient_mrn,admission_date,lactate_1h,antibiotic_1h,culture_1h,bundle_all3")
          .order("source_row", { ascending: true }).limit(1000);
        if (queryError) throw queryError;
        if (!cancelled) setRows((data ?? []) as HistoricalRow[]);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load historical records");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [allowed, ready]);

  if (!ready) return <p className="p-6">Loading…</p>;
  if (!allowed) return <p className="p-6 text-red-700">Access restricted to Quality Admin.</p>;
  if (IS_DEMO) return <p className="p-6">Historical Excel records are available only in the connected production database.</p>;

  return (
    <section className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-navy-900">Excel Sepsis Records</h1>
        <p className="mt-1 text-sm text-slate-600">Historical Excel import — read-only. These records are separate from live Sepsis Cases and do not trigger WhatsApp or email notifications.</p>
      </header>
      {loading ? <p>Loading historical records…</p> : error ? (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
          Unable to load records: {error}. Verify SELECT access / RLS for sepsis_excel_import.
        </div>
      ) : (
        <>
          <p className="font-semibold text-navy-900">Records: {rows.length}</p>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[940px] text-left text-sm">
              <thead className="bg-slate-50 text-slate-700"><tr>
                {["Source Row","Facility","MRN","Admission Date","Lactate 1h","Antibiotic 1h","Culture 1h","All Three"].map(h=><th key={h} className="whitespace-nowrap px-4 py-3">{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(r => <tr key={r.source_row}>
                  <td className="px-4 py-3">{r.source_row}</td>
                  <td className="px-4 py-3">{r.facility}</td>
                  <td className="px-4 py-3 font-mono">{r.patient_mrn}</td>
                  <td className="px-4 py-3">{r.admission_date ?? "Not recorded"}</td>
                  {[r.lactate_1h,r.antibiotic_1h,r.culture_1h,r.bundle_all3].map((v,i)=><td key={i} className="px-4 py-3">{flag(v)}</td>)}
                </tr>)}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">A Yes flag reflects the imported spreadsheet value, not independently verified clinical timing. Repeated MRNs can represent separate admissions.</p>
        </>
      )}
    </section>
  );
}
