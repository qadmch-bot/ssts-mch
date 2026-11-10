"use client";

// Client store with two backends:
//  * DEMO (no Supabase env vars): state persists in localStorage so recipients, rules and
//    cases survive a refresh. Synthetic data only. External messages are never sent.
//  * PRODUCTION (Supabase configured): every action is validated locally for instant
//    feedback, then executed by its Postgres RPC (authoritative, RLS-protected). After
//    success the queued notifications are dispatched and state is reloaded from the DB.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { buildSeed, DEMO_USERS } from "./seed";
import { emptyState, runReminders, STATE_VERSION, type Ctx, type Result, type State } from "./engine";
import type { AppUser } from "./types";
import { nowIso } from "./time";
import { can, type Permission } from "./constants";

const KEY = "ssts-demo-state";
const USER_KEY = "ssts-demo-user";

export const IS_DEMO = !process.env.NEXT_PUBLIC_SUPABASE_URL;

export interface RemoteCall {
  fn: string;
  args: Record<string, unknown>;
}
export type Remote<T> = (value: T) => RemoteCall | RemoteCall[];

interface StoreValue {
  state: State;
  ready: boolean;
  user: AppUser;
  setUserId: (id: string) => void;
  can: (p: Permission) => boolean;
  /** Run an engine action. `remote` maps the local result to the server RPC(s) used in production. */
  act: <T>(fn: (s: State, ctx: Ctx) => Result<T>, remote?: Remote<T>) => Result<T>;
  resetDemo: () => void;
  reload: () => Promise<void>;
}

const StoreCtx = createContext<StoreValue | null>(null);

/** Server-side errors are broadcast so the toast layer can show them. */
export const SYNC_ERROR_EVENT = "ssts-sync-error";
function reportSyncError(message: string) {
  window.dispatchEvent(new CustomEvent(SYNC_ERROR_EVENT, { detail: message.replace(/^DUPLICATE:/, "Possible duplicate: open case ") }));
}

function loadDemo(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as State;
      if (s.version === STATE_VERSION) return s;
    }
  } catch {
    /* storage unavailable */
  }
  return buildSeed();
}

function saveDemo(s: State) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* quota / private mode */
  }
}

const GUEST: AppUser = { id: "", name: "Signed out", role: "leadership", departmentIds: [] };

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(() => emptyState());
  const [ready, setReady] = useState(false);
  const [userId, setUserIdState] = useState(IS_DEMO ? "u-qa" : "");
  const stateRef = useRef(state);
  stateRef.current = state;

  const user = useMemo(
    () => (IS_DEMO ? DEMO_USERS.find((u) => u.id === userId) ?? DEMO_USERS[0] : state.users.find((u) => u.id === userId) ?? GUEST),
    [userId, state.users],
  );

  // ------------------------------------------------ production loading
  const reload = useCallback(async () => {
    if (IS_DEMO) return;
    const [{ supabaseBrowser }, { loadState }] = await Promise.all([import("./supabase/client"), import("./backend/supabase-state")]);
    const sb = supabaseBrowser();
    const { data } = await sb.auth.getUser();
    if (!data.user) {
      if (!location.pathname.startsWith("/login")) location.href = "/login";
      return;
    }
    setUserIdState(data.user.id);
    try {
      const s = await loadState(sb);
      const status = await fetch("/api/notifications/status", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      s.providersConfigured = { whatsapp: !!status?.whatsapp?.configured, email: !!status?.email?.configured };
      stateRef.current = s;
      setState(s);
    } catch (e) {
      reportSyncError(`Could not load data: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => {
    if (IS_DEMO) {
      const s = loadDemo();
      try {
        const u = localStorage.getItem(USER_KEY);
        if (u) setUserIdState(u);
      } catch {}
      const withReminders = runReminders(s, { user: DEMO_USERS[0], now: nowIso() });
      setState(withReminders);
      saveDemo(withReminders);
      setReady(true);
      return;
    }
    reload().finally(() => setReady(true));
  }, [reload]);

  // Demo: simulate the scheduled reminder job. Production: refresh from the DB.
  useEffect(() => {
    if (!ready) return;
    const t = setInterval(() => {
      if (!IS_DEMO) return void reload();
      const next = runReminders(stateRef.current, { user: DEMO_USERS[0], now: nowIso() });
      if (next !== stateRef.current) {
        setState(next);
        saveDemo(next);
      }
    }, 60_000);
    return () => clearInterval(t);
  }, [ready, reload]);

  // ------------------------------------------------ actions
  const act = useCallback(
    <T,>(fn: (s: State, ctx: Ctx) => Result<T>, remote?: Remote<T>): Result<T> => {
      const r = fn(stateRef.current, { user, now: nowIso() });
      if (!r.ok) return r;
      if (IS_DEMO) {
        stateRef.current = r.state;
        setState(r.state);
        saveDemo(r.state);
        return r;
      }
      if (!remote) return { ok: false, error: "This action is not available in production mode", state: stateRef.current };
      // optimistic update, then authoritative server call
      stateRef.current = r.state;
      setState(r.state);
      const calls = ([] as RemoteCall[]).concat(remote(r.value));
      (async () => {
        const { supabaseBrowser } = await import("./supabase/client");
        const sb = supabaseBrowser();
        let saved = true;
        for (const c of calls) {
          const { error } = await sb.rpc(c.fn, c.args);
          if (error) {
            saved = false;
            reportSyncError(error.message);
            break;
          }
        }
        // Never dispatch if saving the case failed. The server-side cron is a fallback.
        if (saved) {
          try {
            const response = await fetch("/api/notifications/dispatch", { method: "POST" });
            if (!response.ok) reportSyncError(`Notification dispatch failed (HTTP ${response.status}); queued alerts will be retried by the scheduler.`);
          } catch {
            reportSyncError("Notification server unreachable; queued alerts will be retried by the scheduler.");
          }
        }
        await reload();
      })();
      return r;
    },
    [user, reload],
  );

  const setUserId = useCallback((id: string) => {
    if (!IS_DEMO) return;
    setUserIdState(id);
    try {
      localStorage.setItem(USER_KEY, id);
    } catch {}
  }, []);

  const resetDemo = useCallback(() => {
    if (!IS_DEMO) return;
    const s = buildSeed();
    setState(s);
    saveDemo(s);
  }, []);

  const value: StoreValue = { state, ready, user, setUserId, can: (p) => can(user.role, p), act, resetDemo, reload };
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore() {
  const v = useContext(StoreCtx);
  if (!v) throw new Error("useStore outside provider");
  return v;
}

/** Re-render every `ms` (for live Hour-1 timers). */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => nowIso());
  useEffect(() => {
    const t = setInterval(() => setNow(nowIso()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
