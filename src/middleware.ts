import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// In production every page requires a signed-in user. Case links in notifications
// carry no token — opening one always goes through sign-in.
const PUBLIC = ["/login", "/api/webhooks/", "/api/cron/", "/api/notifications/dispatch"];

export async function middleware(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.next(); // demo mode
  let res = NextResponse.next({ request: req });
  const sb = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await sb.auth.getUser();
  const path = req.nextUrl.pathname;
  if (!data.user && !PUBLIC.some((p) => path.startsWith(p))) {
    const login = new URL("/login", req.url);
    login.searchParams.set("next", path + req.nextUrl.search);
    return NextResponse.redirect(login);
  }
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|cluster-.*\\.png).*)"] };
