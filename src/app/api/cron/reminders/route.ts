import { NextResponse } from "next/server";
import { isCronRequest } from "@/lib/server/auth";
import { dispatchDue } from "@/lib/server/dispatch";
import { supabaseAdmin } from "@/lib/supabase/server";
import { loadState } from "@/lib/backend/supabase-state";
import { reminderEvents } from "@/lib/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled job: raises Hour-1 Bundle pending/overdue, bundle-review, laboratory delay
 * and follow-up reminders using the same rules as the application, then sends queued
 * notifications. emit_event is idempotent, so running it every minute is safe.
 */
export async function GET(req: Request) {
  if (!isCronRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = supabaseAdmin();
  try {
    const state = await loadState(admin, { auditLimit: 1, deliveryLimit: 1 });
    const candidates = reminderEvents(state, new Date().toISOString());
    let created = 0;
    for (const c of candidates) {
      const { data, error } = await admin.rpc("emit_event", { p_type: c.eventType, p_case: c.caseId, p_dedupe: c.dedupeKey, p_dept_ids: null, p_is_test: false });
      if (error) throw new Error(error.message);
      if (data) created++;
    }
    const sent = await dispatchDue(admin, 50);
    return NextResponse.json({ candidates: candidates.length, created, dispatch: sent });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
