"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Bell, CheckCheck, ListChecks, Send, RefreshCw, ArrowRight, Info } from "lucide-react";
import { Alert, Badge, Button, Card, Empty, PageHeader, Select, Tabs, cn } from "@/components/ui";
import { ChannelIcon, DeliveryStatusBadge } from "@/components/delivery";
import { useToast } from "@/components/toast";
import { useNow, useStore } from "@/lib/store";
import { resendDelivery } from "@/lib/engine";
import { actionItems, ACTION_LABELS } from "@/lib/actions";
import { DELIVERY_STATUS_LABELS, EVENT_LABELS, EVENT_ORDER } from "@/lib/constants";
import { fmtDateTime, timeAgo } from "@/lib/time";

type Tab = "alerts" | "action" | "log";

function Inner() {
  const sp = useSearchParams();
  const { state, user, can, act } = useStore();
  const toast = useToast();
  const now = useNow();
  const [tab, setTab] = useState<Tab>((sp.get("tab") as Tab) || "alerts");
  const [status, setStatus] = useState(sp.get("status") ?? "");
  const [channel, setChannel] = useState("");
  const [event, setEvent] = useState("");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const items = actionItems(state, now);
  const unread = state.inApp.filter((n) => !n.readBy.includes(user.id));

  const markAll = () => {
    act(
      (s) => ({ ok: true, state: { ...s, inApp: s.inApp.map((n) => (n.readBy.includes(user.id) ? n : { ...n, readBy: [...n.readBy, user.id] })) }, value: null }),
      () => ({ fn: "mark_notifications_read", args: { p_ids: unread.map((n) => n.id) } }),
    );
  };
  const markOne = (id: string) =>
    act(
      (s) => ({ ok: true, state: { ...s, inApp: s.inApp.map((n) => (n.id === id && !n.readBy.includes(user.id) ? { ...n, readBy: [...n.readBy, user.id] } : n)) }, value: null }),
      () => ({ fn: "mark_notifications_read", args: { p_ids: [id] } }),
    );

  const eventOf = (id: string) => state.events.find((e) => e.id === id);
  const log = state.deliveries
    .filter((d) => (status ? d.status === status : true))
    .filter((d) => (channel ? d.channel === channel : true))
    .filter((d) => (event ? eventOf(d.eventId)?.eventType === event : true))
    .sort((a, b) => b.queuedAt.localeCompare(a.queuedAt));

  const alerts = (onlyUnread ? unread : state.inApp).slice(0, 200);

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <PageHeader title="Notifications" subtitle="In-app alerts, cases requiring action, and the WhatsApp / email delivery log" icon={<Bell />} />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { value: "alerts", label: "Alerts", icon: <Bell />, count: unread.length },
          { value: "action", label: "Requiring Action", icon: <ListChecks />, count: items.length },
          { value: "log", label: "Delivery Log", icon: <Send />, count: state.deliveries.length },
        ]}
      />

      {tab === "alerts" && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} className="size-4 accent-navy-900" /> Unread only
            </label>
            <Button size="sm" variant="outline" onClick={markAll} disabled={!unread.length}>
              <CheckCheck /> Mark all read
            </Button>
          </div>
          <ul className="divide-y divide-slate-100">
            {alerts.map((n) => {
              const isUnread = !n.readBy.includes(user.id);
              return (
                <li key={n.id} className={cn("flex items-start gap-3 px-5 py-3", isUnread && "bg-brand-50/50")}>
                  <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", isUnread ? "bg-brand-600" : "bg-slate-200")} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-navy-900">{n.title}</p>
                    <p className="text-sm text-slate-600">{n.body}</p>
                    <p className="text-xs text-slate-400">
                      {fmtDateTime(n.createdAt)} · {timeAgo(n.createdAt)}
                    </p>
                  </div>
                  {n.caseId && (
                    <Link href={`/cases/view?id=${n.caseId}`} onClick={() => markOne(n.id)}>
                      <Button size="sm" variant="outline">
                        Open <ArrowRight />
                      </Button>
                    </Link>
                  )}
                </li>
              );
            })}
            {!alerts.length && <Empty icon={<Bell />} title="No alerts" />}
          </ul>
        </Card>
      )}

      {tab === "action" && (
        <Card>
          <ul className="divide-y divide-slate-100">
            {items.map((it, i) => (
              <li key={i}>
                <Link href={it.href} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-slate-50">
                  <span className={cn("size-2.5 shrink-0 rounded-full", it.severity === 3 ? "bg-red-500" : it.severity === 2 ? "bg-amber-500" : "bg-brand-500")} />
                  <span className="w-52 font-semibold text-navy-900">{ACTION_LABELS[it.kind]}</span>
                  {it.caseNo && <Badge tone="blue">{it.caseNo}</Badge>}
                  <span className="min-w-0 flex-1 text-sm text-slate-600">{it.text}</span>
                  <ArrowRight className="size-4 text-slate-400" />
                </Link>
              </li>
            ))}
            {!items.length && <Empty icon={<ListChecks />} title="Nothing requires action" />}
          </ul>
        </Card>
      )}

      {tab === "log" && (
        <>
          {(!state.providersConfigured.whatsapp || !state.providersConfigured.email) && (
            <Alert tone="amber" icon={<Info />} title="Status comes only from real provider responses">
              No provider is configured in this environment, so every external message is logged as <b>Not Sent</b>. “Sent” and “Delivered” appear only after the WhatsApp Business API / email
              provider confirms them.
            </Alert>
          )}
          <Card>
            <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-3">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All statuses</option>
                {Object.entries(DELIVERY_STATUS_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
              <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
                <option value="">All channels</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="email">Email</option>
              </Select>
              <Select value={event} onChange={(e) => setEvent(e.target.value)}>
                <option value="">All events</option>
                {EVENT_ORDER.map((e) => (
                  <option key={e} value={e}>
                    {EVENT_LABELS[e]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Date &amp; Time</th>
                    <th>Case ID</th>
                    <th>Event</th>
                    <th>Recipient</th>
                    <th>Channel</th>
                    <th>Status</th>
                    <th>Sent / Delivered</th>
                    <th>Details</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {log.slice(0, 300).map((d) => {
                    const e = eventOf(d.eventId);
                    return (
                      <tr key={d.id}>
                        <td className="whitespace-nowrap text-slate-600">{fmtDateTime(d.queuedAt)}</td>
                        <td className="whitespace-nowrap font-semibold">{e?.isTest ? <Badge tone="purple">TEST</Badge> : e?.caseNo ?? "—"}</td>
                        <td className="whitespace-nowrap">{e ? (e.isTest ? "Test message" : EVENT_LABELS[e.eventType]) : "—"}</td>
                        <td>
                          <p className="font-medium">{d.recipientName}</p>
                          <p className="font-mono text-xs text-slate-500">{d.address}</p>
                        </td>
                        <td>
                          <span className="inline-flex items-center gap-1.5">
                            <ChannelIcon channel={d.channel} /> {d.channel === "whatsapp" ? "WhatsApp" : "Email"}
                          </span>
                        </td>
                        <td>
                          <DeliveryStatusBadge status={d.status} />
                        </td>
                        <td className="whitespace-nowrap text-xs text-slate-500">
                          {d.sentAt ? fmtDateTime(d.sentAt) : "—"}
                          {d.deliveredAt && <div>✓ {fmtDateTime(d.deliveredAt)}</div>}
                        </td>
                        <td className="max-w-xs text-xs text-slate-500">
                          {d.error ?? (d.providerMessageId ? `ID ${d.providerMessageId}` : "—")}
                          {d.attempts > 1 && <div>Attempts: {d.attempts}</div>}
                        </td>
                        <td className="text-right">
                          {can("notifications.resend") && (d.status === "failed" || d.status === "not_sent") && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                const r = act((s, ctx) => resendDelivery(s, ctx, d.id), () => ({ fn: "resend_delivery", args: { p_id: d.id } }));
                                if (r.ok) toast(r.value.status === "not_sent" ? "warning" : "success", r.value.status === "not_sent" ? "Re-queued — provider still not configured" : "Re-queued for delivery");
                                else toast("error", "Resend failed", r.error);
                              }}
                            >
                              <RefreshCw /> Resend
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!log.length && <Empty icon={<Send />} title="No deliveries match" />}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

export default function NotificationsPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
