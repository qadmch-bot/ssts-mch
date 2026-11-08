"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "./ui";

type Kind = "success" | "error" | "info" | "warning";
interface T {
  id: number;
  kind: Kind;
  title: string;
  body?: string;
}
const ToastCtx = createContext<(kind: Kind, title: string, body?: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<T[]>([]);
  const push = useCallback((kind: Kind, title: string, body?: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, kind, title, body }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === "error" ? 8000 : 5000);
  }, []);
  useEffect(() => {
    const h = (e: Event) => push("error", "Not saved on the server", (e as CustomEvent<string>).detail);
    window.addEventListener("ssts-sync-error", h);
    return () => window.removeEventListener("ssts-sync-error", h);
  }, [push]);
  const icon = { success: <CheckCircle2 />, error: <XCircle />, info: <Info />, warning: <AlertTriangle /> };
  const tone = {
    success: "border-emerald-200 text-emerald-700",
    error: "border-red-200 text-red-700",
    info: "border-brand-100 text-brand-700",
    warning: "border-amber-200 text-amber-700",
  };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="no-print pointer-events-none fixed bottom-4 right-4 left-4 z-[60] flex flex-col items-end gap-2 sm:left-auto">
        {items.map((t) => (
          <div key={t.id} role="status" className={cn("pointer-events-auto flex w-full max-w-sm gap-3 rounded-xl border bg-white px-4 py-3 shadow-lg [&>svg]:mt-0.5 [&>svg]:size-5 [&>svg]:shrink-0", tone[t.kind])}>
            {icon[t.kind]}
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{t.title}</p>
              {t.body && <p className="mt-0.5 text-sm text-slate-600">{t.body}</p>}
            </div>
            <button onClick={() => setItems((x) => x.filter((y) => y.id !== t.id))} className="text-slate-400 hover:text-slate-600" aria-label="Dismiss">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
