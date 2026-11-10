
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

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const cleanEmail = email.trim().toLowerCase();

      if (!cleanEmail || !password) {
        setError("يرجى إدخال البريد الإلكتروني وكلمة المرور.");
        return;
      }

      const { data, error: authError } =
        await supabaseBrowser().auth.signInWithPassword({
          email: cleanEmail,
          password,
        });

      if (authError) {
        console.error("Supabase login error:", {
          message: authError.message,
          status: authError.status,
          code: authError.code,
        });

        if (
          authError.message
            .toLowerCase()
            .includes("invalid login credentials")
        ) {
          setError(
            "البريد الإلكتروني أو كلمة المرور غير صحيحة. " +
            "تفاصيل Supabase: " +
            authError.message
          );
        } else if (
          authError.message
            .toLowerCase()
            .includes("email not confirmed")
        ) {
          setError(
            "البريد الإلكتروني غير مؤكد في Supabase."
          );
        } else {
          setError(
            `Supabase: ${authError.message} ` +
            `(Status: ${authError.status ?? "unknown"})`
          );
        }

        return;
      }

      if (!data.session || !data.user) {
        setError(
          "تم قبول بيانات الدخول ولكن لم يتم إنشاء جلسة. " +
          "يرجى التحقق من إعدادات Supabase."
        );
        return;
      }

      const next = new URLSearchParams(
        window.location.search
      ).get("next");

      const destination =
        next &&
        next.startsWith("/") &&
        !next.startsWith("//") &&
        !next.startsWith("/\\")
          ? next
          : "/";

      window.location.assign(destination);
    } catch (err) {
      console.error("Login connection error:", err);

      setError(
        err instanceof Error
          ? `خطأ في الاتصال: ${err.message}`
          : "تعذر الاتصال بخدمة تسجيل الدخول."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[80vh] items-center justify-center">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <Image
            src="/cluster-logo.png"
            alt="Hafar Al Batin Health Cluster"
            width={220}
            height={158}
            priority
          />

          <p className="mt-3 font-bold text-navy-900">
            {HOSPITAL.hospitalEn}
          </p>

          <p className="text-sm text-slate-500">
            {HOSPITAL.systemName}
          </p>
        </div>

        <form
          onSubmit={submit}
          className="card space-y-4 p-6"
        >
          {demo && (
            <Alert tone="amber">
              Demo mode — Supabase authentication
              is not configured.
            </Alert>
          )}

          <Field label="Email" required>
            <Input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              required
            />
          </Field>

          <Field label="Password" required>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              required
            />
          </Field>

          {error && (
            <Alert tone="red">
              {error}
            </Alert>
          )}

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={busy || demo}
          >
            <LogIn />
            {busy ? "Signing in…" : "Sign in"}
          </Button>

          <p className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
            <Lock className="size-3.5" />
            Authorized hospital staff only.
            Activity is audited.
          </p>
        </form>
      </div>
    </div>
  );
}
