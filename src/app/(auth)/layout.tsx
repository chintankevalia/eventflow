import { MotadataLogo } from "@/components/brand/logo";
import { CORAL_PATH, MARK_VIEWBOX, RING_PATH } from "@/components/brand/paths";

/** Split layout shared by sign-in, forgot password, invite and reset pages. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <section className="dark relative hidden overflow-hidden bg-[#0b1120] p-12 text-white lg:flex lg:flex-col">
        <MotadataLogo className="relative z-10 h-7" />
        <div className="relative z-10 mt-auto max-w-md">
          <p className="text-sm font-medium tracking-[0.18em] text-brand-coral uppercase">EventFlow</p>
          <p className="mt-3 text-4xl leading-tight font-semibold tracking-tight">
            Every event, from request to closure, in one place.
          </p>
          <p className="mt-4 text-base text-slate-300">
            Raise requests, plan and schedule, get approvals from the portal or straight from email, and track live
            spend across Sales, Marketing and Channel.
          </p>
        </div>
        <p className="mt-12 text-xs text-slate-400">www.motadata.com · support@motadata.com</p>
        <svg aria-hidden viewBox={MARK_VIEWBOX} className="pointer-events-none absolute top-12 right-12 size-44">
          <path d={RING_PATH} fill="rgba(255,255,255,0.08)" />
          <path d={CORAL_PATH} fill="var(--brand-coral)" />
        </svg>
      </section>

      <main id="main" className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <MotadataLogo className="mb-8 h-6 lg:hidden" />
          {children}
        </div>
      </main>
    </div>
  );
}
