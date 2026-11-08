import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildMessage, whatsappTemplateParams } from "@/lib/notify";
import type { EventType } from "@/lib/types";
import { MAX_ATTEMPTS, RETRY_MINUTES, sendEmail, sendWhatsApp } from "./providers";

interface ClaimedDelivery {
  id: string;
  event_id: string;
  channel: "whatsapp" | "email";
  address: string;
  attempts: number;
}

/**
 * Sends due deliveries. Rows are claimed with FOR UPDATE SKIP LOCKED (claim_deliveries),
 * so concurrent workers never send the same message twice. WhatsApp and email are sent
 * independently — one channel failing never blocks the other.
 */
export async function dispatchDue(admin: SupabaseClient, limit = 25) {
  const { data, error } = await admin.rpc("claim_deliveries", { p_limit: limit });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ClaimedDelivery[];
  if (!rows.length) return { processed: 0, sent: 0, failed: 0, retrying: 0, notSent: 0 };

  const eventIds = [...new Set(rows.map((r) => r.event_id))];
  const { data: events } = await admin
    .from("notification_events")
    .select("id, event_type, case_id, case_no, is_test, department_id, departments(name)")
    .in("id", eventIds);
  const { data: setting } = await admin.from("system_settings").select("value").eq("key", "appBaseUrl").maybeSingle();
  const baseUrl = (setting?.value as string) ?? process.env.APP_BASE_URL ?? "";
  const byId = new Map((events ?? []).map((e) => [e.id, e]));

  const stats = { processed: rows.length, sent: 0, failed: 0, retrying: 0, notSent: 0 };
  await Promise.all(
    rows.map(async (d) => {
      const e = byId.get(d.event_id);
      if (!e) return;
      const ctx = {
        eventType: e.event_type as EventType,
        caseNo: e.case_no,
        departmentName: (e.departments as unknown as { name: string } | null)?.name ?? null,
        caseUrl: e.case_id && baseUrl ? `${baseUrl}/cases/view?id=${e.case_id}` : null,
        isTest: e.is_test,
      };
      const msg = buildMessage(ctx);
      const out = { to: d.address, subject: msg.subject, text: msg.text, templateParams: whatsappTemplateParams(ctx), isTest: e.is_test };
      const r = d.channel === "whatsapp" ? await sendWhatsApp(out) : await sendEmail(out);
      let patch: Record<string, unknown>;
      if (r.ok) {
        stats.sent++;
        patch = { status: "sent", sent_at: new Date().toISOString(), provider_message_id: r.providerMessageId ?? null, error: null, locked_until: null };
      } else if (/not configured/i.test(r.error ?? "")) {
        stats.notSent++;
        patch = { status: "not_sent", error: r.error, locked_until: null };
      } else if (r.retryable && d.attempts < MAX_ATTEMPTS) {
        stats.retrying++;
        const wait = RETRY_MINUTES[Math.min(d.attempts - 1, RETRY_MINUTES.length - 1)];
        patch = { status: "retrying", error: r.error, next_attempt_at: new Date(Date.now() + wait * 60000).toISOString(), locked_until: null };
      } else {
        stats.failed++;
        patch = { status: "failed", error: r.error, locked_until: null };
      }
      await admin.from("notification_deliveries").update(patch).eq("id", d.id);
    }),
  );
  return stats;
}
