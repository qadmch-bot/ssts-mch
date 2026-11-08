import Link from "next/link";

/** Public landing page: never queries or exposes patient-level records. */
export default function PublicDashboard() {
  return (
    <main className="min-h-screen bg-[#f5f8fc] px-5 py-14 text-[#0b2a55]">
      <div className="mx-auto max-w-5xl">
        <div className="mb-10 text-center">
          <p className="text-lg font-semibold text-sky-600">تجمع حفر الباطن الصحي</p>
          <h1 className="mt-3 text-3xl font-bold">Maternity &amp; Children Hospital</h1>
          <p className="mt-2 text-slate-600">Sepsis Surveillance &amp; Tracking System</p>
        </div>
        <section className="rounded-2xl bg-white p-8 shadow-sm">
          <h2 className="text-2xl font-bold">Sepsis Dashboard</h2>
          <p className="mt-3 text-slate-600">Welcome. This overview is accessible without signing in.</p>
          <div className="mt-7 grid gap-4 sm:grid-cols-3">
            {['Sepsis Cases', 'Hour-1 Bundle', 'Patient Outcomes'].map(label => (
              <div key={label} className="rounded-xl border border-slate-200 p-5">
                <h3 className="font-semibold">{label}</h3>
                <p className="mt-3 text-sm text-slate-500">Protected hospital data</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-slate-500">Patient-level records and live hospital metrics require authorized staff access.</p>
          <Link href="/login?next=%2Fdashboard" className="mt-6 inline-block rounded-lg bg-[#0b2a55] px-5 py-3 font-semibold text-white">Staff access to live dashboard</Link>
        </section>
      </div>
    </main>
  );
}
