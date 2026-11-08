"use client";

import Image from "next/image";
import { useState } from "react";
import { Lock, LogIn } from "lucide-react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { HOSPITAL } from "@/lib/constants";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const demo = !process.env.NEXT_PUBLIC_SUPABASE_URL;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) return setError("Sign-in failed. Check your email and password.");
    const next = new URLSearchParams(window.location.search).get("next");
    window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  };

  return (
    <div className="flex min-h-[80vh] items-center justify-center">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <Image src="/cluster-logo.png" alt="Hafar Al Batin Health Cluster" width={220} height={158} priority />
          <p className="mt-3 font-bold text-navy-900">{HOSPITAL.hospitalEn}</p>
          <p className="text-sm text-slate-500">{HOSPITAL.systemName}</p>
        </div>
        <form onSubmit={submit} className="card space-y-4 p-6">
          {demo && <Alert tone="amber">Demo mode — authentication is not configured. Open the dashboard directly.</Alert>}
          <Field label="Email" required>
            <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password" required>
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && <Alert tone="red">{error}</Alert>}
          <Button type="submit" size="lg" className="w-full" disabled={busy || demo}>
            <LogIn /> {busy ? "Signing in…" : "Sign in"}
          </Button>
          <p className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
            <Lock className="size-3.5" /> Authorized hospital staff only. Activity is audited.
          </p>
        </form>
      </div>
    </div>
  );
}
