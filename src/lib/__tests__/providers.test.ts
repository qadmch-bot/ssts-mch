import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { emailConfig, sendEmail, sendWhatsApp, verifyWhatsAppSignature, whatsappConfig } from "../server/providers";

const msg = { to: "+966500000001", subject: "s", text: "t", templateParams: ["NEW SEPSIS CASE ALERT", "SEP-2026-0001", "Pediatric ER", "New case"], isTest: false };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("WhatsApp provider", () => {
  it("reports not configured and never fakes success", async () => {
    expect(whatsappConfig().configured).toBe(false);
    const r = await sendWhatsApp(msg);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not configured/);
  });

  it("sends an approved template with 4 parameters and returns the provider id", async () => {
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "tok");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "123");
    vi.stubEnv("WHATSAPP_TEMPLATE_NAME", "ssts_alert");
    const f = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.X" }] }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    const r = await sendWhatsApp({ ...msg, isTest: true });
    expect(r).toEqual({ ok: true, providerMessageId: "wamid.X" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/123/messages");
    const body = JSON.parse(init.body as string);
    expect(body.to).toBe("966500000001");
    expect(body.template.name).toBe("ssts_alert");
    const params = body.template.components[0].parameters.map((p: { text: string }) => p.text);
    expect(params).toHaveLength(4);
    expect(params[0]).toMatch(/^\[TEST\]/);
    expect(JSON.stringify(body)).not.toMatch(/MRN|patient/i);
  });

  it("classifies permanent vs retryable failures", async () => {
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "tok");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "123");
    vi.stubEnv("WHATSAPP_TEMPLATE_NAME", "ssts_alert");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "Template not found", code: 132001 } }), { status: 400 })));
    expect((await sendWhatsApp(msg)).retryable).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    expect((await sendWhatsApp(msg)).retryable).toBe(true);
  });

  it("verifies webhook signatures", () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", "secret");
    const raw = '{"entry":[]}';
    const sig = "sha256=" + createHmac("sha256", "secret").update(raw).digest("hex");
    expect(verifyWhatsAppSignature(raw, sig)).toBe(true);
    expect(verifyWhatsAppSignature(raw, "sha256=deadbeef")).toBe(false);
    expect(verifyWhatsAppSignature(raw, null)).toBe(false);
  });
});

describe("Email provider", () => {
  it("is not configured by default", async () => {
    expect(emailConfig().configured).toBe(false);
    expect((await sendEmail(msg)).ok).toBe(false);
  });
  it("sends via Resend when configured", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "resend");
    vi.stubEnv("RESEND_API_KEY", "k");
    vi.stubEnv("EMAIL_FROM", "SSTS <a@example.org>");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "em_1" }), { status: 200 })));
    expect(await sendEmail({ ...msg, to: "q@example.org" })).toEqual({ ok: true, providerMessageId: "em_1" });
  });
});
