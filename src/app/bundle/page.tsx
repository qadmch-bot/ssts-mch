"use client";

import Link from "next/link";
import { useState } from "react";
import { Timer, Clock, ShieldAlert, CheckCircle2, FileWarning } from "lucide-react";
import { Badge, Button, Card, Empty, PageHeader, Tabs, cn } from "@/components/ui";
import { BundleBadge, CaseLink, caseBundle } from "@/components/case-bits";
import { useNow, useStore } from "@/lib/store";
import { deptName } from "@/lib/engine";
import { BUNDLE_MEASURES } from "@/lib/constants";
import { TIMING_LABELS, minutesSinceRecognition } from "@/lib/bundle";
import { fmtDateTime, humanDuration } from "@/lib/time";

type TabKey = "open" | "review" | "pending" | "completed";

export default function BundleListPage() {
  const { state } = useStore();
  const now = useNow(15_000);
  const [tab, setTab] = useState<TabKey>("open");
  const thr = state.settings.reminders;

  const rows = state.cases.map((c) => ({ c, ev: caseBundle(state, c, now), b: state.bundles.find((x) => x.caseId === c.id) }));
  const groups: Record<TabKey, typeof rows> = {
    open: rows.filter((r) => r.c.status === "active" && !r.b?.completionTime),
    review: rows.filter((r) => r.ev.status === "requires_review"),
    pending: rows.filter((r) => r.ev.status === "pending" && r.b?.completionTime),
    completed: rows.filter((r) => r.ev.status === "compliant" || r.ev.status === "not_compliant"),
  };
  const list = groups[tab].sort((a, b) => (a.c.recognitionTime ?? "").localeCompare(b.c.recognitionTime ?? "") * (tab === "open" ? 1 : -1));

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <PageHeader title="Hour-1 Bundle" subtitle="SEPSIS HOUR-1 BUNDLE documentation and timing · timer starts at the documented Time of Sepsis Recognition" icon={<Timer />} />
      <Tabs<TabKey>
        value={tab}
        onChange={setTab}
        items={[
          { value: "open", label: "Open Bundles", icon: <Clock />, count: groups.open.length },
          { value: "review", label: "Requires Review", icon: <ShieldAlert />, count: groups.review.length },
          { value: "pending", label: "Missing Documentation", icon: <FileWarning />, count: groups.pending.length },
          { value: "completed", label: "Completed", icon: <CheckCircle2 />, count: groups.completed.length },
        ]}
      />
      <Card>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Case ID</th>
                <th>Department</th>
                <th>Sepsis Recognition</th>
                <th>{tab === "open" ? "Elapsed" : "Recognition → Completion"}</th>
                <th>Measures</th>
                <th>Clinician: All within 1h</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map(({ c, ev, b }) => {
                const m = minutesSinceRecognition(c, now);
                return (
                  <tr key={c.id}>
                    <td className="whitespace-nowrap">
                      <CaseLink c={c} />
                    </td>
                    <td className="whitespace-nowrap">{deptName(state, c.emergencyDepartmentId)}</td>
                    <td className="whitespace-nowrap text-slate-600">{fmtDateTime(c.recognitionTime)}</td>
                    <td className="whitespace-nowrap">
                      {tab === "open" && m !== null ? (
                        <span className={cn("font-bold", m >= thr.bundleOverdueMinutes ? "text-red-600" : m >= thr.bundleApproachingMinutes ? "text-orange-600" : "text-navy-900")}>{humanDuration(m)}</span>
                      ) : ev.timing.minutes !== null ? (
                        <span>
                          <b>{ev.timing.minutes} min</b> <span className="text-xs text-slate-500">· {TIMING_LABELS[ev.timing.result]}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-slate-500">{TIMING_LABELS[ev.timing.result]}</span>
                      )}
                    </td>
                    <td>
                      <div className="flex gap-1" aria-label={`${ev.documentedCount} of 5 measures documented`}>
                        {ev.measures.map((x) => (
                          <span
                            key={x.key}
                            title={`${BUNDLE_MEASURES.find((q) => q.key === x.key)!.short}: ${x.reason}`}
                            className={cn(
                              "size-3 rounded-full",
                              { done: "bg-emerald-500", not_done: "bg-red-500", not_applicable: "bg-slate-300", missing: "border-2 border-amber-400 bg-white", review: "bg-violet-500" }[x.state],
                            )}
                          />
                        ))}
                      </div>
                    </td>
                    <td>{b?.clinicianAllWithin1h ? <Badge tone={b.clinicianAllWithin1h === "YES" ? "green" : "red"}>{b.clinicianAllWithin1h}</Badge> : <span className="text-xs text-slate-400">Not answered</span>}</td>
                    <td>
                      <BundleBadge s={state} c={c} now={now} />
                    </td>
                    <td className="text-right">
                      <Link href={`/bundle/form?id=${c.id}`}>
                        <Button size="sm" variant={tab === "open" ? "teal" : "outline"}>
                          {tab === "open" ? "Document" : "Open"}
                        </Button>
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!list.length && <Empty icon={<Timer />} title="No bundles in this list" />}
        </div>
        <div className="flex flex-wrap gap-4 border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
          <span className="flex items-center gap-1.5"><span className="size-3 rounded-full bg-emerald-500" />YES</span>
          <span className="flex items-center gap-1.5"><span className="size-3 rounded-full bg-red-500" />NO (applicable)</span>
          <span className="flex items-center gap-1.5"><span className="size-3 rounded-full bg-slate-300" />Not applicable (documented)</span>
          <span className="flex items-center gap-1.5"><span className="size-3 rounded-full border-2 border-amber-400" />Not documented</span>
          <span className="flex items-center gap-1.5"><span className="size-3 rounded-full bg-violet-500" />Requires review</span>
        </div>
      </Card>
    </div>
  );
}
