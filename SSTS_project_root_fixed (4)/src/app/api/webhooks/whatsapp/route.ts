import { NextResponse } from "next/server";
import { verifyWhatsAppSignature } from "@/lib/server/providers";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Meta webhook verification handshake
export async function GET(req: Request) {
  const u = new URL(req.url);
  const token = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (token && u.searchParams.get("hub.mode") === "subscribe" && u.searchParams.get("hub.verify_token") === token) {
    return new Response(u.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

const RANK: Record<string, number> = { queued: 0, retrying: 0, not_sent: 0, sent: 1, delivered: 2, failed: 3 };

// Delivery status updates: sent → delivered → read, or failed. Only provider-confirmed statuses are stored.
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyWhatsAppSignature(raw, req.headers.get("x-hub-signature-256"))) return new Response("Invalid signature", { status: 401 });
  const body = JSON.parse(raw) as {
    entry?: { changes?: { value?: { statuses?: { id: string; status: string; timestamp: string; errors?: { code: number; title: string; message?: string }[] }[] } }[] }[];
  };
  const admin = supabaseAdmin();
  const statuses = body.entry?.flatMap((e) => e.changes?.flatMap((c) => c.value?.statuses ?? []) ?? []) ?? [];
  for (const s of statuses) {
    const { data: d } = await admin.from("notification_deliveries").select("id, status").eq("provider_message_id", s.id).maybeSingle();
    if (!d) continue;
    const at = new Date(Number(s.timestamp) * 1000).toISOString();
    if (s.status === "failed") {
      const err = s.errors?.map((x) => `${x.code} ${x.title}${x.message ? ": " + x.message : ""}`).join("; ") ?? "Failed";
      await admin.from("notification_deliveries").update({ status: "failed", error: `WhatsApp: ${err}` }).eq("id", d.id);
    } else if ((s.status === "delivered" || s.status === "read") && RANK[d.status] < 2) {
      await admin.from("notification_deliveries").update({ status: "delivered", delivered_at: at }).eq("id", d.id);
    } else if (s.status === "sent" && RANK[d.status] < 1) {
      await admin.from("notification_deliveries").update({ status: "sent", sent_at: at }).eq("id", d.id);
    }
  }
  return NextResponse.json({ ok: true });
}
