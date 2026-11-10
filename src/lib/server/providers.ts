import "server-only";
// Notification providers. Credentials come ONLY from server-side environment variables.
// A provider returning success means "accepted for delivery" → status "sent".
// "delivered" is set only when the provider confirms it (WhatsApp status webhook).

import { createHmac, timingSafeEqual } from "node:crypto";

export interface SendResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
  retryable?: boolean;
}

export interface OutgoingMessage {
  to: string;
  subject: string;
  text: string;
  templateParams: string[];
  isTest: boolean;
}

// ------------------------------------------------------------ WhatsApp Business Platform (Cloud API)

export function whatsappConfig() {
  // Prefer the user's approved Twilio WhatsApp template; retain Meta as fallback.
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_WHATSAPP_FROM ?? process.env.TWILIO_PHONE_NUMBER;
  const twilioContentSid = process.env.TWILIO_SEPSIS_CONTENT_SID;
  if (twilioSid && twilioToken && twilioFrom && twilioContentSid) {
    return { configured: true, provider: "twilio" as const, twilioSid, twilioToken, twilioFrom, twilioContentSid, template: twilioContentSid, lang: "ar", version: "Twilio" };
  }
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const template = process.env.WHATSAPP_TEMPLATE_NAME;
  const lang = process.env.WHATSAPP_TEMPLATE_LANGUAGE ?? "en";
  const version = process.env.WHATSAPP_API_VERSION ?? "v21.0";
  return { configured: !!(token && phoneId && template), provider: "meta" as const, token, phoneId, template, lang, version };
}

/** Sends a preapproved business-initiated template, not an unapproved free-text message. */
export async function sendWhatsApp(m: OutgoingMessage): Promise<SendResult> {
  const c = whatsappConfig();
  if (!c.configured) return { ok: false, error: "WhatsApp provider not configured (Twilio credentials/template or Meta Cloud API missing)", retryable: false };
  if (c.provider === "twilio") {
    // Approved sepsis_notification_alert has exactly ONE {{1}} variable.
    // No patient identifiers, MRN, or clinical data in WhatsApp.
    const detail = m.isTest ? "رسالة اختبار لنظام تنبيهات الإنتان" : "تم تسجيل حالة إنتان جديدة. يرجى الدخول إلى نظام المستشفى الآمن للاطلاع.";
    const from = c.twilioFrom!.startsWith("whatsapp:") ? c.twilioFrom! : `whatsapp:${c.twilioFrom}`;
    const to = m.to.startsWith("whatsapp:") ? m.to : `whatsapp:${m.to}`;
    const body = new URLSearchParams({ From: from, To: to, ContentSid: c.twilioContentSid!, ContentVariables: JSON.stringify({ "1": detail }) });
    try {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(c.twilioSid!)}/Messages.json`, {
        method: "POST",
        headers: { Authorization: `Basic ${Buffer.from(`${c.twilioSid}:${c.twilioToken}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: AbortSignal.timeout(15000),
      });
      const result = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
      if (res.ok && result.sid) return { ok: true, providerMessageId: result.sid };
      return { ok: false, error: `Twilio ${res.status}${result.code ? ` (${result.code})` : ""}: ${result.message ?? "unknown error"}`, retryable: res.status === 429 || res.status >= 500 };
    } catch (e) {
      return { ok: false, error: `Twilio request failed: ${(e as Error).message}`, retryable: true };
    }
  }
  const params = m.isTest ? ["[TEST] " + m.templateParams[0], ...m.templateParams.slice(1)] : m.templateParams;
  try {
    const res = await fetch(`https://graph.facebook.com/${c.version}/${c.phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: m.to.replace(/^\+/, ""), type: "template", template: { name: c.template, language: { code: c.lang }, components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text: text.slice(0, 200) })) }] } }),
      signal: AbortSignal.timeout(15000),
    });
    const result = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
    if (res.ok && result.messages?.[0]?.id) return { ok: true, providerMessageId: result.messages[0].id };
    const code = result.error?.code;
    return { ok: false, error: `WhatsApp ${res.status}${code ? ` (code ${code})` : ""}: ${result.error?.message ?? "unknown error"}`, retryable: res.status >= 500 || res.status === 429 || code === 4 || code === 80007 || code === 130429 };
  } catch (e) {
    return { ok: false, error: `WhatsApp request failed: ${(e as Error).message}`, retryable: true };
  }
}

/** Verifies Meta's X-Hub-Signature-256 header for webhook calls. */
export function verifyWhatsAppSignature(raw: string, header: string | null) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from("sha256=" + createHmac("sha256", secret).update(raw).digest("hex"));
  const got = Buffer.from(header);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

// ------------------------------------------------------------ Email (SMTP e.g. Microsoft 365, or Resend)

export function emailConfig() {
  const provider = (process.env.EMAIL_PROVIDER ?? "").toLowerCase();
  const from = process.env.EMAIL_FROM;
  if (provider === "smtp") {
    const ok = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD && from);
    return { configured: ok, provider, from, detail: ok ? `SMTP ${process.env.SMTP_HOST}` : "SMTP_HOST / SMTP_USER / SMTP_PASSWORD / EMAIL_FROM missing" };
  }
  if (provider === "resend") {
    const ok = !!(process.env.RESEND_API_KEY && from);
    return { configured: ok, provider, from, detail: ok ? "Resend API" : "RESEND_API_KEY / EMAIL_FROM missing" };
  }
  return { configured: false, provider, from, detail: "EMAIL_PROVIDER not set (smtp or resend)" };
}

export async function sendEmail(m: OutgoingMessage): Promise<SendResult> {
  const c = emailConfig();
  if (!c.configured) return { ok: false, error: `Email provider not configured: ${c.detail}`, retryable: false };
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#0f2340">${escapeHtml(m.text)
    .replace(/\n/g, "<br>")
    .replace(/(https:\/\/[^\s<]+)/g, '<a href="$1">Open in the Sepsis Tracking System</a>')}</div>`;
  try {
    if (c.provider === "smtp") {
      const nodemailer = (await import("nodemailer")).default;
      const t = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_SECURE === "true",
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
      });
      const info = await t.sendMail({ from: c.from, to: m.to, subject: m.subject, text: m.text, html });
      if (info.rejected?.length) return { ok: false, error: `Rejected by mail server: ${info.rejected.join(", ")}`, retryable: false };
      return { ok: true, providerMessageId: info.messageId };
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: c.from, to: [m.to], subject: m.subject, text: m.text, html }),
      signal: AbortSignal.timeout(15000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (res.ok && body.id) return { ok: true, providerMessageId: body.id };
    return { ok: false, error: `Email ${res.status}: ${body.message ?? "unknown error"}`, retryable: res.status >= 500 || res.status === 429 };
  } catch (e) {
    return { ok: false, error: `Email send failed: ${(e as Error).message}`, retryable: true };
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Retry schedule after a retryable failure: 1, 5, 15, 60 minutes; then failed. */
export const RETRY_MINUTES = [1, 5, 15, 60];
export const MAX_ATTEMPTS = RETRY_MINUTES.length + 1;
