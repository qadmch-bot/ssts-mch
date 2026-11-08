"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ClipboardList, Plus, Search } from "lucide-react";
import { Button, Card, Empty, Input, PageHeader, Select } from "@/components/ui";
import { BundleBadge, CaseLink, LabBadge, StatusBadge } from "@/components/case-bits";
import { useNow, useStore } from "@/lib/store";
import { deptName } from "@/lib/engine";
import { OUTCOME_LABELS } from "@/lib/constants";
import { fmtDateTime, timeAgo } from "@/lib/time";

function CasesInner() {
  const sp = useSearchParams();
  const { state, can } = useStore();
  const now = useNow();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [status, setStatus] = useState(sp.get("status") ?? (sp.get("outcome") ? "closed" : "all"));
  const [outcome, setOutcome] = useState(sp.get("outcome") ?? "");
  const [dept, setDept] = useState("");

  const rows = state.cases
    .filter((c) => (status === "all" ? true : c.status === status))
    .filter((c) => (outcome ? c.outcome === outcome : true))
    .filter((c) => (dept ? c.currentDepartmentId === dept || c.emergencyDepartmentId === dept : true))
    .filter((c) => (q ? c.caseNo.toLowerCase().includes(q.toLowerCase().trim()) : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Sepsis Cases"
        subtitle={`${rows.length} of ${state.cases.length} cases`}
        icon={<ClipboardList />}
        actions={
          can("case.create") && (
            <Link href="/cases/new">
              <Button>
                <Plus /> New Sepsis Case
              </Button>
            </Link>
          )
        }
      />
      <Card>
        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 size-4 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Case ID…" className="pl-9" />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="closed">Closed</option>
          </Select>
          <Select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">Any outcome</option>
            {Object.entries(OUTCOME_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Select value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">All departments</option>
            {state.departments
              .filter((d) => d.kind === "emergency" || d.kind === "inpatient")
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </Select>
        </div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Case ID</th>
                <th>Registration Date</th>
                <th>Department</th>
                <th>Hour-1 Bundle</th>
                <th>Laboratory</th>
                <th>Current Status</th>
                <th>Last Update</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="whitespace-nowrap">
                    <CaseLink c={c} />
                  </td>
                  <td className="whitespace-nowrap text-slate-600">{fmtDateTime(c.createdAt)}</td>
                  <td className="whitespace-nowrap">{deptName(state, c.currentDepartmentId)}</td>
                  <td>
                    <BundleBadge s={state} c={c} now={now} />
                  </td>
                  <td>
                    <LabBadge s={state} caseId={c.id} />
                  </td>
                  <td>
                    <StatusBadge c={c} />
                  </td>
                  <td className="whitespace-nowrap text-xs text-slate-500">{timeAgo(c.updatedAt)}</td>
                  <td className="text-right">
                    <Link href={`/cases/view?id=${c.id}`}>
                      <Button size="sm" variant="outline">
                        Open
                      </Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <Empty icon={<ClipboardList />} title="No cases match these filters" />}
        </div>
      </Card>
    </div>
  );
}

export default function CasesPage() {
  return (
    <Suspense>
      <CasesInner />
    </Suspense>
  );
}
