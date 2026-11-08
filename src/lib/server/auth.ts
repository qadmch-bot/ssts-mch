import "server-only";
import { timingSafeEqual } from "node:crypto";
import { supabaseServer } from "@/lib/supabase/server";

/** Scheduled jobs authenticate with `Authorization: Bearer $CRON_SECRET` (Vercel Cron sends this). */
export function isCronRequest(req: Request) {
  const secret = process.env.CRON_SECRET;
  const h = req.headers.get("authorization") ?? "";
  if (!secret || secret.length < 16) return false;
  const a = Buffer.from(h);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Returns the signed-in user's profile (role) or null. */
export async function currentProfile() {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return null;
  const { data } = await sb.from("profiles").select("id, full_name, role, active").eq("id", auth.user.id).maybeSingle();
  return data && data.active ? data : null;
}
