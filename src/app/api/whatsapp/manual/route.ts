import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { currentProfile } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function POST(req: Request) {
  const secret = process.env.MANUAL_WHATSAPP_SEND_KEY;
  const profile = await currentProfile().catch(() => null);
  const authorizedRole = profile && ["admin", "quality_admin", "quality", "super_admin"].includes(String(profile.role).toLowerCase());
  const provided = req.headers.get("x-manual-send-key") ?? "";
  if (!authorizedRole && !(secret && secret.length >= 24 && safeEqual(provided, secret))) {
    return NextResponse.json({ error: "غير مصرح بالإرسال. أدخلي رمز الإرسال الصحيح." }, { status: 401 });
  }
  let body: { to?: unknown; message?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 }); }
  const to = String(body.to ?? "").replace(/[^\d]/g, "").replace(/^00/, "");
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!/^\d{8,15}$/.test(to)) return NextResponse.json({ error: "رقم المستلم غير صحيح" }, { status: 400 });
  if (!message || message.length > 1200) return NextResponse.json({ error: "اكتبي رسالة بين 1 و1200 حرف" }, { status: 400 });
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = (process.env.TWILIO_WHATSAPP_FROM ?? "whatsapp:+14155238886").trim();
  if (!sid || !token || !/^whatsapp:\+\d{8,15}$/.test(from)) {
    return NextResponse.json({ error: "إعدادات Twilio غير مكتملة" }, { status: 503 });
  }
  const form = new URLSearchParams({ From: from, To: `whatsapp:+${to}`, Body: message });
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form, cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    const result = await res.json().catch(() => ({})) as { sid?: string; message?: string; status?: string; code?: number };
    if (!res.ok) return NextResponse.json({ error: `Twilio: ${result.message ?? "تعذر الإرسال"}`, code: result.code }, { status: 502 });
    return NextResponse.json({ ok: true, sid: result.sid, status: result.status ?? "queued" });
  } catch { return NextResponse.json({ error: "تعذر الاتصال بخدمة Twilio" }, { status: 502 }); }
}
