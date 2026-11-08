"use client";
import { CheckCheck, Check, Clock, Mail, MessageCircle, RefreshCw, XCircle, Ban } from "lucide-react";
import { DELIVERY_STATUS_LABELS } from "@/lib/constants";
import type { DeliveryAttempt, DeliveryStatus } from "@/lib/types";
import { Badge, type Tone } from "./ui";

const TONE: Record<DeliveryStatus, Tone> = { queued: "blue", sent: "teal", delivered: "green", failed: "red", retrying: "amber", not_sent: "gray" };
const ICON: Record<DeliveryStatus, React.ReactNode> = {
  queued: <Clock />,
  sent: <Check />,
  delivered: <CheckCheck />,
  failed: <XCircle />,
  retrying: <RefreshCw />,
  not_sent: <Ban />,
};

export function DeliveryStatusBadge({ status }: { status: DeliveryStatus }) {
  return (
    <Badge tone={TONE[status]}>
      {ICON[status]} {status === "not_sent" ? "Not Sent" : DELIVERY_STATUS_LABELS[status]}
    </Badge>
  );
}

export function DeliveryBadge({ d, compact }: { d: DeliveryAttempt; compact?: boolean }) {
  return (
    <Badge tone={TONE[d.status]} title={`${d.recipientName} · ${DELIVERY_STATUS_LABELS[d.status]}${d.error ? ` — ${d.error}` : ""}`}>
      {d.channel === "whatsapp" ? <MessageCircle /> : <Mail />}
      {compact ? d.recipientName.split(" ").slice(0, 2).join(" ") : d.recipientName}
    </Badge>
  );
}

export function ChannelIcon({ channel }: { channel: "whatsapp" | "email" }) {
  return channel === "whatsapp" ? <MessageCircle className="size-4 text-emerald-600" /> : <Mail className="size-4 text-brand-600" />;
}
