"use client";

import Link from "next/link";
import {
  Ambulance,
  ArrowRight,
  BedDouble,
  Bell,
  CheckCircle2,
  ClipboardCheck,
  DoorOpen,
  FlaskConical,
  Flag,
  HeartPulse,
  Mail,
  MessageCircle,
  Plus,
  Timer,
  Users,
  AlertTriangle,
  Clock,
  Percent,
  ShieldAlert,
  Settings2,
} from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, Empty, Switch, cn } from "@/components/ui";
import { BundleBadge, CaseLink, LabBadge, StatusBadge, caseBundle } from "@/components/case-bits";
import { useStore, useNow } from "@/lib/store";
import { dashboardCounts, deptName, saveRules } from "@/lib/engine";
import { summarizeCompliance } from "@/lib/bundle";
import { actionItems, ACTION_LABELS } from "@/lib/actions";
import { EVENT_LABELS } from "@/lib/constants";
import { timeAgo } from "@/lib/time";
import { useToast } from "@/components/toast";
import type { EventType } from "@/lib/types";

const KPI = [
  { key: "total", label: "Total Sepsis Cases", icon: Users, cls: "bg-brand-50 border-brand-100 text-brand-600", href: "/cases" },
  { key: "active", label: "Active Cases", icon: BedDouble, cls: "bg-sky-50 border-sky-100 text-sky-600", href: "/cases?status=active" },
  { key: "pendingLab", label: "Pending Laboratory Results", icon: FlaskConical, cls: "bg-amber-50 border-amber-100 text-amber-600", href: "/laboratory" },
  { key: "discharged", label: "Discharged", icon: CheckCircle2, cls: "bg-emerald-50 border-emerald-100 text-emerald-600", href: "/cases?outcome=discharged" },
  { key: "dama", label: "DAMA", icon: DoorOpen, cls: "bg-orange-50 border-orange-100 text-orange-600", href: "/cases?outcome=dama" },
  { key: "deaths", label: "Deaths", icon: HeartPulse, cls: "bg-red-50 border-red-100 text-red-600", href: "/cases?outcome=death" },
] as const;

const DASH_RULES: EventType[] = ["case_registered", "bundle_overdue", "lab_result_available", "inpatient_update", "outcome_death"];

export default function Dashboard() {
  const { state, can, act } = useStore();
  const toast = useToast();
  const now = useNow();
  const counts = dashboardCounts(state);
  const evals = state.cases.map((c) => caseBundle(state, c, now));
  const comp = summarizeCompliance(evals);
  const items = actionItems(state, now);
  const recent = [...state.cases].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);
  const wa = state.recipients.filter((r) => r.channel === "whatsapp" && r.active).length;
  const em = state.recipients.filter((r) => r.channel === "email" && r.active).length;
  const notConfigured = !state.providersConfigured.whatsapp || !state.providersConfigured.email;

  const stage = {
    emergency: state.cases.filter((c) => c.status === "active" && ["In Emergency", "Reopened"].includes(c.currentStatus)).length,
    bundle: state.cases.filter((c) => c.status === "active" && !state.bundles.find((b) => b.caseId === c.id)?.completionTime).length,
    lab: counts.pendingLab,
    inpatient: state.cases.filter((c) => c.status === "active" && !["In Emergency", "Reopened"].includes(c.currentStatus)).length,
    outcome: state.cases.filter((c) => c.outcome).length,
  };

  const toggleRule = (et: EventType, on: boolean) => {
    const rules = state.rules.map((r) => (r.eventType === et ? { ...r, whatsapp: on, email: on, inApp: on || r.inApp } : r));
    const r = act((s, ctx) => saveRules(s, ctx, rules), () => ({ fn: "save_rules", args: { p: rules } }));
    if (r.ok) toast("success", `${EVENT_LABELS[et]} alerts ${on ? "enabled" : "disabled"}`);
    else toast("error", "Not allowed", r.error);
  };

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight text-navy-900">Dashboard</h1>
          <p className="text-sm text-slate-500">Sepsis cases, Hour-1 Bundle, laboratory follow-up and outcomes — live from stored records.</p>
        </div>
        {can("case.create") && (
          <Link href="/cases/new" className="no-print">
            <Button size="lg">
              <Plus /> New Sepsis Case
            </Button>
          </Link>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {KPI.map(({ key, label, icon: Icon, cls, href }) => (
          <Link key={key} href={href} className={cn("flex items-center gap-3 rounded-[14px] border p-4 transition hover:-translate-y-0.5 hover:shadow-md", cls)}>
            <Icon className="size-9 shrink-0 stroke-[1.75]" />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold leading-tight text-slate-700">{label}</p>
              <p className="text-3xl font-bold text-navy-900">{counts[key]}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Hour-1 Bundle compliance */}
      <Card>
        <CardHeader
          icon={<Timer />}
          title="Hour-1 Bundle Compliance"
          subtitle={state.settings.complianceRulesApproved ? "Hospital-approved calculation rules" : "Default calculation rules — pending hospital approval"}
          action={
            <Link href="/reports?r=bundle" className="text-sm font-semibold text-brand-600 hover:underline">
              Compliance report →
            </Link>
          }
        />
        <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Total Bundle Assessments", value: comp.total, icon: ClipboardCheck, cls: "text-brand-600" },
            { label: "Completed Within 1 Hour", value: comp.compliant, icon: CheckCircle2, cls: "text-emerald-600" },
            { label: "Not Completed Within 1 Hour", value: comp.notCompliant, icon: AlertTriangle, cls: "text-red-600" },
            { label: "Pending Documentation", value: comp.pending, icon: Clock, cls: "text-amber-600" },
            { label: "Requires Review", value: comp.review, icon: ShieldAlert, cls: "text-violet-600" },
            { label: "Compliance Percentage", value: comp.percentage === null ? "—" : `${comp.percentage}%`, icon: Percent, cls: "text-teal-600" },
          ].map((k) => (
            <div key={k.label} className="flex items-center gap-3 bg-white px-4 py-3.5">
              <k.icon className={cn("size-6 shrink-0", k.cls)} />
              <div>
                <p className="text-xs font-semibold text-slate-500">{k.label}</p>
                <p className="text-xl font-bold text-navy-900">{k.value}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="px-5 py-2 text-xs text-slate-500">
          Compliance % = Within 1 Hour ÷ (Within 1 Hour + Not Within 1 Hour). Pending documentation and cases requiring review are shown separately and never counted as non-compliant.
        </p>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <div className="space-y-5">
            {/* Recent cases */}
            <Card className="min-w-0">
              <CardHeader
                title="Sepsis Cases"
                action={
                  can("case.create") && (
                    <Link href="/cases/new">
                      <Button size="sm">
                        <Plus /> New Sepsis Case (ED)
                      </Button>
                    </Link>
                  )
                }
              />
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Case ID</th>
                      <th>Department</th>
                      <th>Hour-1 Bundle</th>
                      <th>Laboratory</th>
                      <th>Current Status</th>
                      <th>Last Update</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((c) => (
                      <tr key={c.id}>
                        <td className="whitespace-nowrap">
                          <CaseLink c={c} />
                        </td>
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
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!recent.length && <Empty icon={<Users />} title="No cases yet" />}
              </div>
              <div className="border-t border-slate-100 px-5 py-2.5 text-right">
                <Link href="/cases" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline">
                  View All Cases <ArrowRight className="size-4" />
                </Link>
              </div>
            </Card>

            {/* Case flow */}
            <Card className="min-w-0">
              <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 px-5 py-3">
                <p className="text-[15px] font-bold text-navy-900">Case Flow</p>
                <p className="text-xs text-slate-500">Active work per stage · bundle, laboratory and inpatient run in parallel</p>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-3 px-5 py-4">
                {[
                  { label: "Emergency", sub: "In ED", n: stage.emergency, icon: Ambulance, cls: "bg-navy-900" },
                  { label: "Hour-1 Bundle", sub: "Open", n: stage.bundle, icon: Timer, cls: "bg-teal-600" },
                  { label: "Laboratory", sub: "Pending", n: stage.lab, icon: FlaskConical, cls: "bg-emerald-600" },
                  { label: "Inpatient", sub: "Follow-up", n: stage.inpatient, icon: BedDouble, cls: "bg-brand-600" },
                  { label: "Outcome", sub: "Closed", n: stage.outcome, icon: Flag, cls: "bg-slate-400" },
                ].map((st, i) => (
                  <div key={st.label} className="flex items-center gap-2">
                    {i > 0 && <ArrowRight className="size-4 text-slate-300" />}
                    <div className={cn("grid size-10 place-items-center rounded-full text-white shadow-sm", st.cls)}>
                      <st.icon className="size-5" />
                    </div>
                    <div className="leading-tight">
                      <p className="text-[13px] font-bold text-navy-900">{st.label}</p>
                      <p className="text-xs text-slate-500">
                        <b className="text-navy-900">{st.n}</b> {st.sub}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Action panel */}
          <Card className="border-red-100">
            <CardHeader
              icon={<Bell className="!text-red-500" />}
              title={<span className="text-red-600">Cases Requiring Action ({items.length})</span>}
              action={
                <Link href="/notifications?tab=action">
                  <Button size="sm" variant="dangerOutline">
                    View All
                  </Button>
                </Link>
              }
            />
            {notConfigured && (
              <div className="px-5 pt-3">
                <Alert tone="amber" icon={<AlertTriangle />} title="External notifications are not being sent">
                  WhatsApp / email providers are not configured{state.providersConfigured.whatsapp ? " (email)" : ""}. Alerts are logged as “Not Sent”. Configure providers in Settings → Integrations.
                </Alert>
              </div>
            )}
            <ul className="divide-y divide-slate-100">
              {items.slice(0, 7).map((it, i) => (
                <li key={i}>
                  <Link href={it.href} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 sm:px-5">
                    <span className={cn("size-2.5 shrink-0 rounded-full", it.severity === 3 ? "bg-red-500" : it.severity === 2 ? "bg-amber-500" : "bg-brand-500")} />
                    <span className="flex min-w-0 flex-1 flex-col gap-x-3 sm:flex-row sm:items-center">
                      <span className="text-sm font-semibold text-navy-900 sm:w-44 sm:shrink-0">{ACTION_LABELS[it.kind]}</span>
                      {it.caseNo && <span className="shrink-0 text-sm font-bold text-brand-700">{it.caseNo}</span>}
                      <span className="min-w-0 truncate text-sm text-slate-500">{it.text}</span>
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-slate-400" />
                  </Link>
                </li>
              ))}
              {!items.length && <Empty icon={<CheckCircle2 />} title="Nothing requires action right now" />}
            </ul>
          </Card>

          {/* Quick access */}
          <div className="no-print grid grid-cols-2 gap-3 lg:grid-cols-5">
            {[
              { href: "/cases/new", label: "Register New Case", sub: "Emergency", icon: Ambulance, cls: "bg-brand-50 border-brand-100 text-brand-600" },
              { href: "/bundle", label: "Hour-1 Bundle", sub: "Document measures", icon: Timer, cls: "bg-teal-50 border-teal-100 text-teal-600" },
              { href: "/laboratory", label: "Update Lab Result", sub: "Laboratory", icon: FlaskConical, cls: "bg-amber-50 border-amber-100 text-amber-600" },
              { href: "/inpatient", label: "Update Inpatient Case", sub: "Department", icon: BedDouble, cls: "bg-sky-50 border-sky-100 text-sky-600" },
              { href: "/inpatient?outcome=1", label: "Record Outcome", sub: "Discharge / DAMA / Death", icon: Flag, cls: "bg-emerald-50 border-emerald-100 text-emerald-600" },
            ].map((q) => (
              <Link key={q.href} href={q.href} className={cn("flex flex-col items-center gap-1.5 rounded-[14px] border px-3 py-4 text-center transition hover:-translate-y-0.5 hover:shadow-md", q.cls)}>
                <q.icon className="size-8 stroke-[1.75]" />
                <span className="text-sm font-bold text-navy-900">{q.label}</span>
                <span className="text-xs text-slate-500">{q.sub}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-5">
          <Card>
            <CardHeader title="Notification Management" />
            <div className="space-y-2 p-4">
              <Link href="/settings?tab=whatsapp" className="flex items-center gap-3 rounded-xl bg-slate-50 px-3.5 py-3 hover:bg-slate-100">
                <MessageCircle className="size-6 text-emerald-600" />
                <span className="font-semibold text-navy-900">WhatsApp Recipients</span>
                <Badge className="ml-auto">{wa}</Badge>
              </Link>
              <Link href="/settings?tab=email" className="flex items-center gap-3 rounded-xl bg-slate-50 px-3.5 py-3 hover:bg-slate-100">
                <Mail className="size-6 text-brand-600" />
                <span className="font-semibold text-navy-900">Email Recipients</span>
                <Badge className="ml-auto">{em}</Badge>
              </Link>
              <Link href="/settings?tab=whatsapp">
                <Button variant="outline" className="mt-1 w-full border-brand-500 text-brand-700">
                  <Users /> Add / Manage Recipients
                </Button>
              </Link>
            </div>
          </Card>

          <Card>
            <CardHeader
              icon={<Bell />}
              title="Notification Rules"
              action={
                <Link href="/settings?tab=rules" className="text-slate-400 hover:text-brand-600" aria-label="All rules">
                  <Settings2 className="size-4" />
                </Link>
              }
            />
            <ul className="divide-y divide-slate-100">
              {DASH_RULES.map((et) => {
                const r = state.rules.find((x) => x.eventType === et)!;
                const on = r.whatsapp || r.email;
                return (
                  <li key={et} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <span className="text-sm text-slate-700">{EVENT_LABELS[et]}</span>
                    <Switch checked={on} disabled={!can("settings.manage")} onChange={(v) => toggleRule(et, v)} label={EVENT_LABELS[et]} />
                  </li>
                );
              })}
            </ul>
            <div className="grid grid-cols-2 gap-2 border-t border-slate-100 p-4">
              <Link href="/settings?tab=whatsapp">
                <Button variant="outline" size="sm" className="w-full border-emerald-300 text-emerald-700">
                  <MessageCircle /> Test WhatsApp
                </Button>
              </Link>
              <Link href="/settings?tab=email">
                <Button variant="outline" size="sm" className="w-full border-brand-100 text-brand-700">
                  <Mail /> Test Email
                </Button>
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
