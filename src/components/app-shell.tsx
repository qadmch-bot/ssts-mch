"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  Bell,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  FlaskConical,
  Gauge,
  LayoutDashboard,
  Loader2,
  Menu,
  BedDouble,
  PlusSquare,
  BarChart3,
  Settings,
  Timer,
  UserCircle2,
  X,
  Activity,
} from "lucide-react";
import { HOSPITAL, ROLE_LABELS } from "@/lib/constants";
import { DEMO_USERS } from "@/lib/seed";
import { IS_DEMO, useStore } from "@/lib/store";
import { fmtDate, nowIso } from "@/lib/time";
import { cn } from "./ui";

export const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/cases/new", label: "New Sepsis Case", icon: PlusSquare },
  { href: "/cases", label: "Sepsis Cases", icon: ClipboardList },
  { href: "/bundle", label: "Hour-1 Bundle", icon: Timer },
  { href: "/laboratory", label: "Laboratory Results", icon: FlaskConical },
  { href: "/inpatient", label: "Inpatient Updates", icon: BedDouble },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

function isActive(path: string, href: string) {
  if (href === "/") return path === "/";
  if (href === "/cases") return path === "/cases" || path.startsWith("/cases/view");
  return path === href || path.startsWith(href + "/");
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { ready, state, user, setUserId } = useStore();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const unread = state.inApp.filter((n) => !n.readBy.includes(user.id)).length;
  if (path === "/") return <>{children}</>;
  if (path === "/login") return <main className="min-h-screen bg-[#f5f8fc] px-4 py-10">{children}</main>;

  const sidebar = (
    <nav className="flex h-full flex-col bg-gradient-to-b from-navy-900 to-navy-950 text-white">
      <div className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(path, href);
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3.5 py-3 text-[15px] font-medium transition-colors",
                active ? "bg-teal-500 text-white shadow-sm" : "text-slate-200 hover:bg-white/10 hover:text-white",
              )}
            >
              <Icon className="size-5 shrink-0" />
              <span>{label}</span>
              {href === "/notifications" && unread > 0 && <span className="ml-auto rounded-full bg-red-500 px-2 text-xs font-bold">{unread}</span>}
            </Link>
          );
        })}
      </div>
      <div className="border-t border-white/10 p-4 text-xs text-slate-300">
        <div className="flex items-center gap-2 font-semibold text-white">
          <Gauge className="size-4 text-teal-500" /> {HOSPITAL.shortName} v1.0
        </div>
        <p className="mt-1 leading-relaxed">Quality &amp; Patient Safety Department</p>
        {IS_DEMO && <p className="mt-2 rounded-md bg-amber-400/15 px-2 py-1 text-amber-200">Demo mode · synthetic data only</p>}
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <header className="no-print sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="flex h-16 items-center gap-3 px-3 sm:px-5 lg:h-[76px]">
          <button className="rounded-lg p-2 text-navy-900 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="size-6" />
          </button>
          <Link href="/" className="flex shrink-0 items-center gap-2.5">
            <Image src="/cluster-mark.png" alt="Hafar Al Batin Health Cluster" width={46} height={44} className="h-10 w-auto lg:h-11" priority />
            <div className="hidden leading-tight sm:block">
              <p className="text-[15px] font-bold text-navy-900" dir="rtl" lang="ar">
                {HOSPITAL.clusterAr}
              </p>
              <p className="text-xs font-semibold text-slate-600">{HOSPITAL.clusterEn}</p>
            </div>
          </Link>
          <div className="mx-1 hidden h-10 w-px bg-slate-200 xl:block" />
          <div className="hidden leading-tight xl:block">
            <p className="text-[15px] font-bold text-navy-900" dir="rtl" lang="ar">
              {HOSPITAL.hospitalAr}
            </p>
            <p className="text-xs font-semibold text-slate-600">{HOSPITAL.hospitalEn}</p>
          </div>
          <div className="mx-1 hidden h-10 w-px bg-slate-200 md:block" />
          <div className="hidden min-w-0 items-center gap-2 md:flex">
            <Activity className="size-7 shrink-0 text-teal-600" />
            <p className="truncate text-lg font-bold text-navy-900 2xl:text-2xl">{HOSPITAL.systemName}</p>
          </div>
          <p className="truncate text-base font-bold text-navy-900 md:hidden">Sepsis Tracking</p>

          <div className="ml-auto flex items-center gap-1.5 sm:gap-3">
            <Link href="/notifications" className="relative rounded-lg p-2 text-navy-900 hover:bg-slate-100" aria-label={`${unread} unread notifications`}>
              <Bell className="size-6" />
              {unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white">{unread > 99 ? "99+" : unread}</span>}
            </Link>
            <div className="hidden items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 lg:flex">
              <CalendarDays className="size-4 text-slate-500" />
              {new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", weekday: "short" }).format(new Date())}, {fmtDate(nowIso())}
            </div>
            <div className="relative">
              <button onClick={() => setMenu((m) => !m)} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-100">
                <UserCircle2 className="size-8 text-slate-400" />
                <div className="hidden text-left leading-tight sm:block">
                  <p className="font-semibold text-navy-900">{user.name}</p>
                  <p className="text-xs text-slate-500">{ROLE_LABELS[user.role]}</p>
                </div>
                <ChevronDown className="size-4 text-slate-500" />
              </button>
              {menu && (
                <div className="absolute right-0 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-xl" onMouseLeave={() => setMenu(false)}>
                  {IS_DEMO ? (
                    <>
                      <p className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Demo: switch role</p>
                      {DEMO_USERS.map((u) => (
                        <button
                          key={u.id}
                          onClick={() => {
                            setUserId(u.id);
                            setMenu(false);
                          }}
                          className={cn("flex w-full flex-col rounded-lg px-2.5 py-2 text-left text-sm hover:bg-slate-50", u.id === user.id && "bg-brand-50")}
                        >
                          <span className="font-semibold text-navy-900">{u.name}</span>
                          <span className="text-xs text-slate-500">{ROLE_LABELS[u.role]}</span>
                        </button>
                      ))}
                      <p className="px-2 pt-2 text-[11px] leading-snug text-slate-400">In production, users sign in with Supabase Auth and roles are assigned by Quality Admin.</p>
                    </>
                  ) : (
                    <form action="/auth/signout" method="post">
                      <button className="w-full rounded-lg px-2.5 py-2 text-left text-sm font-semibold text-red-600 hover:bg-red-50">Sign out</button>
                    </form>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="h-[3px] bg-gradient-to-r from-brand-600 via-teal-500 to-brand-100" />
      </header>

      <div className="flex flex-1">
        <aside className="no-print sticky top-[79px] hidden h-[calc(100vh-79px)] w-[240px] shrink-0 lg:block">{sidebar}</aside>
        {open && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-navy-950/50" onClick={() => setOpen(false)} />
            <div className="absolute inset-y-0 left-0 w-[270px] shadow-2xl">
              <button className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-white hover:bg-white/10" onClick={() => setOpen(false)} aria-label="Close menu">
                <X className="size-5" />
              </button>
              <div className="h-full pt-10 bg-navy-900">{sidebar}</div>
            </div>
          </div>
        )}
        <main className="print-full min-w-0 flex-1 px-3 py-5 sm:px-6 lg:px-8">
          {ready ? (
            children
          ) : (
            <div className="flex h-[60vh] items-center justify-center gap-2 text-slate-500">
              <Loader2 className="size-5 animate-spin" /> Loading…
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
