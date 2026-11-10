
"use client";

import { createBrowserClient } from "@supabase/ssr";

export function supabaseBrowser() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !key) {
    throw new Error(
      "Supabase configuration is missing. Check Vercel environment variables."
    );
  }

  const expectedUrl =
    "https://ehpqviewbumetxwkeeg.supabase.co";

  if (url.replace(/\/+$/, "") !== expectedUrl) {
    throw new Error(
      "Incorrect Supabase URL in Vercel: " + url
    );
  }

  return createBrowserClient(expectedUrl, key);
}
