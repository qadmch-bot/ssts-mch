"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  Bell,
  Building2,
  History,
  Lock,
  Mail,
  MessageCircle,
  Pencil,
  Plug,
  Plus,
  Send,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Trash2,
  Wifi,
  X,
  Save,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, Dialog, Empty, Field, Input, PageHeader, Select, Switch, Tabs, cn } from "@/components/ui";
import { ChannelIcon, DeliveryStatusBadge } from "@/components/delivery";
import { useToast } from "@/components/toast";
import { IS_DEMO, useStore } from "@/lib/store";
import { deleteRecipient, saveDepartment, saveRecipient, saveRules, saveSettings, sendTest, type RecipientInput } from "@/lib/engine";
import { EVENT_LABELS, EVENT_ORDER } from "@/lib/constants";
import { fmtDateTime } from "@/lib/time";
import type { Channel, Department, NotificationRule, SystemSettings } from "@/lib/types";

type Tab = "whatsapp" | "email" | "rules" | "departments" | "reminders" | "integrations" | "audit";

function Inner() {
  const sp = useSearchParams();
  const { can } = useStore();
  const [tab, setTab] = useState<Tab>((sp.get("tab") as Tab) || "whatsapp");
  const admin = can("settings.manage");
  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <PageHeader title="Settings" subtitle="Notification Management, departments, reminders and integrations" icon={<SettingsIcon />} />
      {!admin && (
        <Alert tone="blue" icon={<Lock />}>
          Read-only. Only Quality &amp; Patient Safety Admin can change settings and recipients.
        </Alert>
      )}
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { value: "whatsapp", label: "WhatsApp Recipients", icon: <MessageCircle /> },
          { value: "email", label: "Email Recipients", icon: <Mail /> },
          { value: "rules", label: "Notification Rules", icon: <Bell /> },
          { value: "departments", label: "Departments & Tests", icon: <Building2 /> },
          { value: "reminders", label: "Reminders & Compliance", icon: <SlidersHorizontal /> },
          { value: "integrations", label: "Integrations", icon: <Plug /> },
          { value: "audit", label: "Audit Log", icon: <History /> },
        ]}
      />
      {tab === "whatsapp" && <Recipients channel="whatsapp" />}
      {tab === "email" && <Recipients channel="email" />}
      {tab === "rules" && <Rules />}
      {tab === "departments" && <Departments />}
      {tab === "reminders" && <Reminders />}
      {tab === "integrations" && <Integrations />}
      {tab === "audit" && <AuditLog />}
    </div>
  );
}

// ------------------------------------------------------------------ recipients

function Recipients({ channel }: { channel: Channel }) {
  const { state, can, act } = useStore();
  const toast = useToast();
  const admin = can("settings.manage");
  const [edit, setEdit] = useState<RecipientInput | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const [del, setDel] = useState<string | null>(null);
  const list = state.recipients.filter((r) => r.channel === channel).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  const wa = channel === "whatsapp";
  const depts = state.departments.filter((d) => d.active);
  const dn = (ids: string[]) => (ids.length ? ids.map((i) => state.departments.find((d) => d.id === i)?.name ?? "?").join(", ") : "All departments");

  const save = () => {
    if (!edit) return;
    const r = act((s, ctx) => saveRecipient(s, ctx, edit), (v) => ({ fn: "save_recipient", args: { p: { ...edit, id: v.id, address: v.address } } }));
    if (r.ok) {
      toast("success", edit.id ? "Recipient updated" : "Recipient added", "Saved permanently.");
      setEdit(null);
    } else toast("error", "Not saved", r.error);
  };
  const toggle = (id: string, active: boolean) => {
    const r0 = state.recipients.find((x) => x.id === id)!;
    const r = act((s, ctx) => saveRecipient(s, ctx, { ...r0, active }), () => ({ fn: "save_recipient", args: { p: { ...r0, active } } }));
    if (r.ok) toast("success", `${r0.name} ${active ? "enabled" : "disabled"}`);
    else toast("error", "Not saved", r.error);
  };
  const test = (id: string) => {
    const r = act((s, ctx) => sendTest(s, ctx, id), () => ({ fn: "send_test_message", args: { p_recipient: id } }));
    if (!r.ok) return toast("error", "Test failed", r.error);
    if (r.value.status === "not_sent") toast("warning", "Test message not sent", r.value.error ?? undefined);
    else toast("success", "Test message queued", "Status will update from the provider response.");
  };

  return (
    <Card>
      <CardHeader
        icon={wa ? <MessageCircle className="!text-emerald-600" /> : <Mail />}
        title={wa ? "WhatsApp Recipients" : "Email Recipients"}
        subtitle={wa ? "International E.164 format, e.g. +9665XXXXXXXX. Saudi local numbers (05…) are converted automatically." : "Use organizational email addresses."}
        action={
          admin && (
            <Button onClick={() => setEdit({ channel, name: "", address: wa ? "+966" : "", departmentIds: [], eventTypes: [...EVENT_ORDER], active: true })}>
              <Plus /> Add Recipient
            </Button>
          )
        }
      />
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>Name</th>
              <th>Department</th>
              <th>{wa ? "WhatsApp Number" : "Email"}</th>
              <th>Notification Types</th>
              <th>Status</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className={cn(!r.active && "opacity-60")}>
                <td className="font-semibold text-navy-900">{r.name}</td>
                <td className="max-w-[220px] text-slate-600">{dn(r.departmentIds)}</td>
                <td className="whitespace-nowrap font-mono text-sm">{r.address}</td>
                <td className="max-w-[280px]">
                  {r.eventTypes.length === EVENT_ORDER.length ? (
                    <Badge tone="teal">All events</Badge>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {r.eventTypes.slice(0, 3).map((e) => (
                        <Badge key={e}>{EVENT_LABELS[e]}</Badge>
                      ))}
                      {r.eventTypes.length > 3 && <Badge>+{r.eventTypes.length - 3}</Badge>}
                    </div>
                  )}
                </td>
                <td>
                  <div className="flex items-center gap-2">
                    <Switch checked={r.active} disabled={!admin} onChange={(v) => toggle(r.id, v)} label={`${r.name} active`} />
                    <span className="text-xs font-semibold text-slate-500">{r.active ? "Active" : "Inactive"}</span>
                  </div>
                </td>
                <td className="whitespace-nowrap text-right">
                  {admin && (
                    <>
                      <Button size="icon" variant="ghost" title="Send test message" onClick={() => test(r.id)} disabled={!r.active}>
                        <Send />
                      </Button>
                      <Button size="icon" variant="ghost" title="Delivery history" onClick={() => setHistory(r.id)}>
                        <History />
                      </Button>
                      <Button size="icon" variant="ghost" title="Edit" onClick={() => setEdit({ ...r })}>
                        <Pencil />
                      </Button>
                      <Button size="icon" variant="ghost" title="Delete" className="text-red-600 hover:bg-red-50" onClick={() => setDel(r.id)}>
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <Empty icon={wa ? <MessageCircle /> : <Mail />} title="No recipients yet" />}
      </div>

      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        size="lg"
        icon={wa ? <MessageCircle /> : <Mail />}
        title={edit?.id ? "Edit Recipient" : `Add ${wa ? "WhatsApp" : "Email"} Recipient`}
        footer={
          <>
            <Button variant="outline" onClick={() => setEdit(null)}>
              Cancel
            </Button>
            <Button onClick={save}>
              <Save /> Save
            </Button>
          </>
        }
      >
        {edit && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name / Role" required>
                <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. NICU Head Nurse" />
              </Field>
              <Field label={wa ? "WhatsApp Number" : "Email Address"} required hint={wa ? "E.164, e.g. +966512345678" : undefined}>
                <Input value={edit.address} type={wa ? "tel" : "email"} onChange={(e) => setEdit({ ...edit, address: e.target.value })} className="font-mono" />
              </Field>
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-700">Departments</p>
                <span className="text-xs text-slate-500">None selected = all departments</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {depts.map((d) => {
                  const on = edit.departmentIds.includes(d.id);
                  return (
                    <button
                      key={d.id}
                      onClick={() => setEdit({ ...edit, departmentIds: on ? edit.departmentIds.filter((x) => x !== d.id) : [...edit.departmentIds, d.id] })}
                      className={cn("rounded-lg border px-3 py-1.5 text-sm font-medium", on ? "border-navy-900 bg-navy-900 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50")}
                    >
                      {d.name}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-700">
                  Notification Types <span className="text-red-500">*</span>
                </p>
                <div className="flex gap-2 text-xs">
                  <button className="font-semibold text-brand-600" onClick={() => setEdit({ ...edit, eventTypes: [...EVENT_ORDER] })}>
                    Select all
                  </button>
                  <button className="font-semibold text-slate-500" onClick={() => setEdit({ ...edit, eventTypes: [] })}>
                    Clear
                  </button>
                </div>
              </div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {EVENT_ORDER.map((e) => (
                  <label key={e} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
                    <input
                      type="checkbox"
                      className="size-4 accent-navy-900"
                      checked={edit.eventTypes.includes(e)}
                      onChange={(x) => setEdit({ ...edit, eventTypes: x.target.checked ? [...edit.eventTypes, e] : edit.eventTypes.filter((y) => y !== e) })}
                    />
                    {EVENT_LABELS[e]}
                  </label>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-3">
              <Switch checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Active" />
              <span className="text-sm font-semibold text-slate-700">Notifications enabled for this recipient</span>
            </label>
          </div>
        )}
      </Dialog>

      <Dialog open={!!history} onClose={() => setHistory(null)} title="Delivery History" icon={<History />} size="lg">
        <HistoryList recipientId={history} />
      </Dialog>

      <Dialog
        open={!!del}
        onClose={() => setDel(null)}
        title="Remove recipient?"
        size="sm"
        icon={<Trash2 />}
        footer={
          <>
            <Button variant="outline" onClick={() => setDel(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const r = act((s, ctx) => deleteRecipient(s, ctx, del!), () => ({ fn: "delete_recipient", args: { p_id: del } }));
                if (r.ok) toast("success", r.warning ? "Recipient deactivated" : "Recipient deleted", r.warning);
                else toast("error", "Not removed", r.error);
                setDel(null);
              }}
            >
              Remove
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">Recipients with delivery history are deactivated (kept for the audit trail) instead of being permanently deleted.</p>
      </Dialog>
    </Card>
  );
}

function HistoryList({ recipientId }: { recipientId: string | null }) {
  const { state } = useStore();
  const list = state.deliveries.filter((d) => d.recipientId === recipientId).slice(0, 100);
  if (!list.length) return <Empty title="No deliveries yet" />;
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th>Date &amp; Time</th>
          <th>Case</th>
          <th>Event</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {list.map((d) => {
          const e = state.events.find((x) => x.id === d.eventId);
          return (
            <tr key={d.id}>
              <td className="whitespace-nowrap text-slate-600">{fmtDateTime(d.queuedAt)}</td>
              <td>{e?.isTest ? <Badge tone="purple">TEST</Badge> : e?.caseNo}</td>
              <td>{e?.isTest ? "Test message" : e && EVENT_LABELS[e.eventType]}</td>
              <td>
                <DeliveryStatusBadge status={d.status} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ------------------------------------------------------------------ rules

function Rules() {
  const { state, can, act } = useStore();
  const toast = useToast();
  const admin = can("settings.manage");
  const [rules, setRules] = useState<NotificationRule[]>(state.rules);
  useEffect(() => setRules(state.rules), [state.rules]);
  const dirty = JSON.stringify(rules) !== JSON.stringify(state.rules);
  const set = (i: number, k: "whatsapp" | "email" | "inApp", v: boolean) => setRules((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const count = (e: NotificationRule["eventType"], ch: Channel) => state.recipients.filter((r) => r.active && r.channel === ch && r.eventTypes.includes(e)).length;
  return (
    <Card>
      <CardHeader
        icon={<Bell />}
        title="Notification Rules"
        subtitle="Turn each channel on or off per event. Recipients choose events in their own settings; departments route alerts."
        action={
          admin && (
            <Button
              disabled={!dirty}
              onClick={() => {
                const r = act((s, ctx) => saveRules(s, ctx, rules), () => ({ fn: "save_rules", args: { p: rules } }));
                if (r.ok) toast("success", "Notification rules saved");
                else toast("error", "Not saved", r.error);
              }}
            >
              <Save /> Save Rules
            </Button>
          )
        }
      />
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>Event</th>
              <th className="text-center">WhatsApp</th>
              <th className="text-center">Email</th>
              <th className="text-center">In-App</th>
              <th>Recipients</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r, i) => (
              <tr key={r.eventType}>
                <td className="font-semibold text-navy-900">{EVENT_LABELS[r.eventType]}</td>
                {(["whatsapp", "email", "inApp"] as const).map((k) => (
                  <td key={k} className="text-center">
                    <div className="inline-flex">
                      <Switch checked={r[k]} disabled={!admin} onChange={(v) => set(i, k, v)} label={`${EVENT_LABELS[r.eventType]} ${k}`} />
                    </div>
                  </td>
                ))}
                <td className="whitespace-nowrap text-xs text-slate-600">
                  <span className="mr-3 inline-flex items-center gap-1">
                    <ChannelIcon channel="whatsapp" /> {count(r.eventType, "whatsapp")}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <ChannelIcon channel="email" /> {count(r.eventType, "email")}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
        Every event has a unique identifier; each recipient receives at most one message per event and channel. Disabled channels send nothing. WhatsApp and email are processed independently —
        failure of one does not block the other.
      </p>
    </Card>
  );
}

// ------------------------------------------------------------------ departments

function Departments() {
  const { state, can, act } = useStore();
  const toast = useToast();
  const admin = can("settings.manage");
  const [edit, setEdit] = useState<{ id?: string; name: string; kind: Department["kind"]; active: boolean } | null>(null);
  const [test, setTest] = useState("");
  const saveTypes = (types: string[]) => {
    const r = act((s, ctx) => saveSettings(s, ctx, s.settings, types), () => ({ fn: "save_lab_test_types", args: { p_names: types } }));
    if (!r.ok) toast("error", "Not saved", r.error);
  };
  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardHeader
          icon={<Building2 />}
          title="Departments"
          action={
            admin && (
              <Button size="sm" onClick={() => setEdit({ name: "", kind: "inpatient", active: true })}>
                <Plus /> Add Department
              </Button>
            )
          }
        />
        <table className="tbl">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {state.departments.map((d) => (
              <tr key={d.id} className={cn(!d.active && "opacity-60")}>
                <td className="font-semibold">{d.name}</td>
                <td className="capitalize text-slate-600">{d.kind}</td>
                <td>{d.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
                <td className="text-right">
                  {admin && (
                    <Button size="icon" variant="ghost" onClick={() => setEdit({ ...d })}>
                      <Pencil />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card>
        <CardHeader title="Laboratory Test Types" subtitle="Tests containing “Lactate” or “Blood Culture” link to the Hour-1 Bundle" />
        <div className="flex flex-wrap gap-2 p-4">
          {state.labTestTypes.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-sm">
              {t}
              {admin && (
                <button onClick={() => saveTypes(state.labTestTypes.filter((x) => x !== t))} className="text-slate-400 hover:text-red-600" aria-label={`Remove ${t}`}>
                  <X className="size-3.5" />
                </button>
              )}
            </span>
          ))}
        </div>
        {admin && (
          <form
            className="flex gap-2 border-t border-slate-100 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              const v = test.trim();
              if (!v || state.labTestTypes.some((x) => x.toLowerCase() === v.toLowerCase())) return;
              saveTypes([...state.labTestTypes, v]);
              setTest("");
            }}
          >
            <Input value={test} onChange={(e) => setTest(e.target.value)} placeholder="Add test type" />
            <Button type="submit" variant="outline">
              <Plus /> Add
            </Button>
          </form>
        )}
      </Card>
      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        size="sm"
        title={edit?.id ? "Edit Department" : "Add Department"}
        footer={
          <>
            <Button variant="outline" onClick={() => setEdit(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const r = act((s, ctx) => saveDepartment(s, ctx, edit!), (v) => ({ fn: "save_department", args: { p: { ...edit, id: v.id } } }));
                if (r.ok) {
                  toast("success", "Department saved");
                  setEdit(null);
                } else toast("error", "Not saved", r.error);
              }}
            >
              Save
            </Button>
          </>
        }
      >
        {edit && (
          <div className="space-y-4">
            <Field label="Name" required>
              <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <Field label="Type">
              <Select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as Department["kind"] })}>
                <option value="emergency">Emergency</option>
                <option value="inpatient">Inpatient</option>
                <option value="laboratory">Laboratory</option>
                <option value="other">Other</option>
              </Select>
            </Field>
            <label className="flex items-center gap-3">
              <Switch checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} />
              <span className="text-sm font-semibold">Active</span>
            </label>
          </div>
        )}
      </Dialog>
    </div>
  );
}

// ------------------------------------------------------------------ reminders

function Reminders() {
  const { state, can, act } = useStore();
  const toast = useToast();
  const admin = can("settings.manage");
  const [s, setS] = useState<SystemSettings>(state.settings);
  const r = s.reminders;
  const setR = (k: keyof SystemSettings["reminders"], v: number | boolean) => setS({ ...s, reminders: { ...r, [k]: v } });
  const num = (k: keyof SystemSettings["reminders"], label: string, unit: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <Input type="number" min={1} disabled={!admin} value={r[k] as number} onChange={(e) => setR(k, Number(e.target.value))} className="w-28" />
        <span className="text-sm text-slate-500">{unit}</span>
      </div>
    </Field>
  );
  return (
    <div className="space-y-5">
      <Alert tone="amber" icon={<AlertTriangle />} title="Clinical thresholds require approval">
        Reminder thresholds and compliance rules must be approved by hospital leadership and the responsible clinical teams. This system supports surveillance and administrative follow-up and does
        not replace the hospital&apos;s clinical sepsis escalation protocol.
      </Alert>
      <Card>
        <CardHeader icon={<SlidersHorizontal />} title="Reminders & Escalation" />
        <div className="grid gap-5 p-5 sm:grid-cols-2 lg:grid-cols-3">
          {num("bundleApproachingMinutes", "Hour-1: approaching threshold alert", "minutes after recognition")}
          {num("bundleOverdueMinutes", "Hour-1: documentation overdue", "minutes after recognition")}
          {num("labOverdueHours", "Laboratory result overdue", "hours after request")}
          {num("inpatientUpdateOverdueHours", "Department update overdue", "hours without update")}
          {num("outcomePendingDays", "Final outcome pending", "days after registration")}
          <Field label="Application URL (used in secure case links)" hint="Links require sign-in; no patient data in the link.">
            <Input disabled={!admin} value={s.appBaseUrl} onChange={(e) => setS({ ...s, appBaseUrl: e.target.value })} />
          </Field>
        </div>
        <div className="space-y-3 border-t border-slate-100 p-5">
          <label className="flex items-start gap-3">
            <Switch checked={r.approvedByLeadership} disabled={!admin} onChange={(v) => setR("approvedByLeadership", v)} />
            <span className="text-sm text-slate-700">
              <b>Thresholds approved</b> by hospital leadership and clinical teams
            </span>
          </label>
          <label className="flex items-start gap-3">
            <Switch checked={s.complianceRulesApproved} disabled={!admin} onChange={(v) => setS({ ...s, complianceRulesApproved: v })} />
            <span className="text-sm text-slate-700">
              <b>Hour-1 compliance calculation rules approved</b> (shown on dashboard and reports)
            </span>
          </label>
        </div>
        {admin && (
          <div className="flex justify-end border-t border-slate-100 p-4">
            <Button
              onClick={() => {
                const res = act(
                  (st, ctx) => saveSettings(st, ctx, s),
                  (v) => [
                    { fn: "save_setting", args: { p_key: "reminders", p_value: v.reminders } },
                    { fn: "save_setting", args: { p_key: "appBaseUrl", p_value: v.appBaseUrl } },
                    { fn: "save_setting", args: { p_key: "complianceRulesApproved", p_value: v.complianceRulesApproved } },
                  ],
                );
                if (res.ok) toast("success", "Settings saved");
                else toast("error", "Not saved", res.error);
              }}
            >
              <Save /> Save Settings
            </Button>
          </div>
        )}
      </Card>
      <Card>
        <CardHeader title="Default Hour-1 compliance rules (for hospital review)" />
        <ol className="list-decimal space-y-1.5 px-10 py-4 text-sm text-slate-700">
          <li>
            <b>Within 1 Hour</b>: every applicable measure answered YES, clinician answered YES to “All Bundle Followed within 1 Hour”, and recorded Recognition → Completion time ≤ 60 minutes.
          </li>
          <li>
            <b>Not Within 1 Hour</b>: documentation complete and consistent, but an applicable measure is NO, the time exceeds 60 minutes, or the clinician answered NO.
          </li>
          <li>
            <b>Pending Documentation</b>: any measure, the completion time, or the clinician answer is missing. Never counted as non-compliant.
          </li>
          <li>
            <b>Requires Review</b>: contradictions — e.g. clinician YES but recorded time over 60 minutes; vasopressors NO with hypotension not documented; “not applicable” without a reason; times out
            of order.
          </li>
          <li>
            Vasopressors are applicable only when hypotension is documented as YES. NO is never silently treated as not applicable. Element denominators exclude documented not-applicable cases.
          </li>
          <li>Compliance % = Within 1 Hour ÷ (Within 1 Hour + Not Within 1 Hour). Quality Admin review decisions are audited.</li>
        </ol>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ integrations

function Integrations() {
  const { state } = useStore();
  const toast = useToast();
  const [status, setStatus] = useState<null | { whatsapp: { configured: boolean; detail: string }; email: { configured: boolean; detail: string } }>(null);
  const [checking, setChecking] = useState(false);
  const check = async () => {
    setChecking(true);
    try {
      const r = await fetch("/api/notifications/status", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setStatus(await r.json());
    } catch (e) {
      toast("warning", "Server check unavailable", `Could not reach the notification server (${(e as Error).message}).`);
      setStatus({ whatsapp: { configured: false, detail: "Server not reachable" }, email: { configured: false, detail: "Server not reachable" } });
    } finally {
      setChecking(false);
    }
  };
  const row = (name: string, icon: React.ReactNode, st?: { configured: boolean; detail: string }) => (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-4">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-navy-900">{name}</p>
        <p className="text-sm text-slate-500">{st ? st.detail : "Not checked"}</p>
      </div>
      {st ? st.configured ? <Badge tone="green"><CheckCircle2 /> Configured</Badge> : <Badge tone="red">Not configured</Badge> : <Badge>Unknown</Badge>}
    </div>
  );
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          icon={<Plug />}
          title="Notification Providers"
          subtitle="Test Connection checks server-side configuration only. Messages are reported Delivered only when the provider confirms."
          action={
            <Button variant="outline" onClick={check} disabled={checking}>
              <Wifi /> {checking ? "Checking…" : "Test Connection"}
            </Button>
          }
        />
        <div className="grid gap-3 p-5 md:grid-cols-2">
          {row("WhatsApp Business Platform (Cloud API)", <MessageCircle className="size-8 text-emerald-600" />, status?.whatsapp)}
          {row("Email (SMTP / Microsoft 365 or Resend)", <Mail className="size-8 text-brand-600" />, status?.email)}
        </div>
      </Card>
      <Card>
        <CardHeader title="Environment" />
        <div className="space-y-2 p-5 text-sm text-slate-700">
          <p>
            Mode: <b>{IS_DEMO ? "Demo (browser storage, synthetic data)" : "Production (Supabase)"}</b>
          </p>
          <p>
            Display time zone: <b>Asia/Riyadh (AST, UTC+03:00)</b> · Storage: <b>UTC</b>
          </p>
          <p>
            WhatsApp provider in this environment: <b>{state.providersConfigured.whatsapp ? "configured" : "not configured"}</b> · Email: <b>{state.providersConfigured.email ? "configured" : "not configured"}</b>
          </p>
          <p className="text-slate-500">
            Provider credentials are server-side environment variables only (see <code>.env.example</code> and <code>docs/DEPLOYMENT.md</code>). They are never stored in the browser or the database.
          </p>
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ audit

function AuditLog() {
  const { state, can } = useStore();
  const [q, setQ] = useState("");
  if (!can("audit.view"))
    return (
      <Alert tone="blue" icon={<Lock />}>
        Audit log is available to Quality Admin.
      </Alert>
    );
  const list = state.audit.filter((a) => (q ? `${a.action} ${a.detail} ${a.userName}`.toLowerCase().includes(q.toLowerCase()) : true)).slice(0, 300);
  return (
    <Card>
      <CardHeader icon={<History />} title="Audit Log" subtitle="Append-only record of registrations, updates, outcomes, corrections and configuration changes" action={<Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" className="w-56" />} />
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>Date &amp; Time</th>
              <th>User</th>
              <th>Action</th>
              <th>Case</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id}>
                <td className="whitespace-nowrap text-slate-600">{fmtDateTime(a.at)}</td>
                <td className="whitespace-nowrap font-semibold">{a.userName}</td>
                <td>
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{a.action}</code>
                </td>
                <td className="whitespace-nowrap">{state.cases.find((c) => c.id === a.caseId)?.caseNo ?? "—"}</td>
                <td className="text-slate-600">{a.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
