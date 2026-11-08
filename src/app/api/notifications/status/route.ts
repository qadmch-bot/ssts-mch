import { NextResponse } from "next/server";
import { emailConfig, whatsappConfig } from "@/lib/server/providers";
import { currentProfile } from "@/lib/server/auth";
import { supabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Reports whether providers are configured. Never returns secrets. */
export async function GET() {
  if (supabaseConfigured()) {
    const p = await currentProfile();
    if (!p) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const wa = whatsappConfig();
  const em = emailConfig();
  return NextResponse.json({
    whatsapp: {
      configured: wa.configured,
      detail: wa.configured
        ? `Cloud API ${wa.version} · template “${wa.template}” (${wa.lang}) · webhook ${process.env.WHATSAPP_APP_SECRET ? "signature check on" : "APP SECRET MISSING"}`
        : "WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_TEMPLATE_NAME missing",
    },
    email: { configured: em.configured, detail: em.detail },
    note: "Configured means credentials are present. Use 'Send test message' to confirm real delivery.",
  });
}
