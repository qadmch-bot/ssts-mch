
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { currentProfile } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);

  return (
    x.length === y.length &&
    timingSafeEqual(x, y)
  );
}

function credentials() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = (process.env.TWILIO_WHATSAPP_FROM ?? "").trim();
  return { sid, token, from };
}

async function allowed(req: Request) {
  const secret = (process.env.MANUAL_WHATSAPP_SEND_KEY ?? "").trim();
  const profile = await currentProfile().catch(() => null);
  const role = profile && ["admin", "quality_admin", "quality", "super_admin"].includes(String(profile.role).toLowerCase());
  const provided = (req.headers.get("x-manual-send-key") ?? "").trim();
  return Boolean(role || (secret.length >= 24 && provided && safeEqual(provided, secret)));
}

export async function GET(req: Request) {
  if (!(await allowed(req))) return NextResponse.json({ error: "غير مصرح بالاستعلام" }, { status: 401 });
  const messageSid = new URL(req.url).searchParams.get("sid") ?? "";
  if (!/^SM[a-f0-9]{32}$/i.test(messageSid)) return NextResponse.json({ error: "معرّف الرسالة غير صحيح" }, { status: 400 });
  const { sid, token } = credentials();
  if (!sid || !token) return NextResponse.json({ error: "إعدادات Twilio غير مكتملة" }, { status: 503 });
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages/${messageSid}.json`, {
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` }, cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    const data = await res.json() as { status?: string; error_code?: number | null; error_message?: string | null; message?: string };
    if (!res.ok) return NextResponse.json({ error: data.message ?? "تعذر الاستعلام" }, { status: 502 });
    return NextResponse.json({ status: data.status, errorCode: data.error_code, errorMessage: data.error_message });
  } catch { return NextResponse.json({ error: "تعذر الاستعلام من Twilio" }, { status: 502 }); }
}

export async function POST(req: Request) {
  try {
    if (!(await allowed(req))) {
      return NextResponse.json({ error: "غير مصرح بالإرسال. تأكدي من رمز الإرسال أو صلاحية الحساب." }, { status: 401 });
    }

    // 2. Read message
    let body: {
      to?: unknown;
      message?: unknown;
    };

    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "طلب غير صالح" },
        { status: 400 }
      );
    }

    let to = String(body.to ?? "")
      .replace(/[^\d]/g, "")
      .replace(/^00/, "");

    // Accept Saudi numbers starting with 05
    if (/^05\d{8}$/.test(to)) {
      to = "966" + to.slice(1);
    }

    const message =
      typeof body.message === "string"
        ? body.message.trim()
        : "";

    if (!/^\d{8,15}$/.test(to)) {
      return NextResponse.json(
        { error: "رقم المستلم غير صحيح" },
        { status: 400 }
      );
    }

    if (!message || message.length > 1200) {
      return NextResponse.json(
        {
          error: "اكتبي رسالة بين 1 و1200 حرف",
        },
        { status: 400 }
      );
    }

    // 3. Twilio credentials
    const { sid, token, from } = credentials();

    if (
      !sid ||
      !token ||
      !/^whatsapp:\+\d{8,15}$/.test(from)
    ) {
      return NextResponse.json(
        {
          error:
            "إعدادات Twilio غير مكتملة. تحققي من TWILIO_ACCOUNT_SID وTWILIO_AUTH_TOKEN وTWILIO_WHATSAPP_FROM في Vercel.",
        },
        { status: 503 }
      );
    }

    // 4. Send message
    const form = new URLSearchParams({
      From: from,
      To: `whatsapp:+${to}`,
      Body: message,
    });

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization:
            `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
          "Content-Type":
            "application/x-www-form-urlencoded",
        },
        body: form,
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      }
    );

    const result = (await res.json().catch(() => ({}))) as {
      sid?: string;
      message?: string;
      status?: string;
      code?: number;
    };

    if (!res.ok) {
      return NextResponse.json(
        {
          error:
            `Twilio: ${result.message ?? "تعذر الإرسال"}`,
          code: result.code,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      sid: result.sid,
      status: result.status ?? "queued",
      message:
        "تم قبول الرسالة من Twilio، ويجري إرسالها.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error &&
          error.name === "TimeoutError"
            ? "انتهت مهلة الاتصال بخدمة Twilio"
            : "تعذر الاتصال بخدمة Twilio",
      },
      { status: 502 }
    );
  }
}
