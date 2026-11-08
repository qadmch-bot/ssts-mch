import { NextResponse } from "next/server";
import { dispatchDue } from "@/lib/server/dispatch";
import { currentProfile, isCronRequest } from "@/lib/server/auth";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Sends queued notifications. Called by the scheduler (Bearer CRON_SECRET) and,
 * right after each action, by the signed-in user's browser so alerts go out immediately.
 */
async function handle(req: Request) {
  if (!isCronRequest(req) && !(await currentProfile())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const stats = await dispatchDue(supabaseAdmin(), 50);
    return NextResponse.json(stats);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
export const GET = handle;
export const POST = handle;
