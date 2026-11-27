import { Suspense } from "react";
import { Toaster } from "sonner";
import { NavigationProgress } from "@/components/layout/navigation-progress";
import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import { TourProvider } from "@/components/tour/tour-provider";
import { WelcomeTourPrompt } from "@/components/tour/welcome-tour-prompt";
import { requireUser } from "@/server/auth/session";

// Every portal page depends on the signed-in user.
export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <TourProvider>
      <div className="flex min-h-dvh">
        {/* Suspense because it reads the search params, which would otherwise opt the whole
            layout out of static rendering. */}
        <Suspense fallback={null}>
          <NavigationProgress />
        </Suspense>
        <Sidebar roles={user.roles} department={user.department} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header user={user} />
          <main id="main" className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            {children}
          </main>
        </div>
        <Toaster position="top-right" richColors closeButton />
      </div>
      <WelcomeTourPrompt roles={user.roles} tourDismissed={user.tourDismissed} tourSeenSections={user.tourSeenSections} />
    </TourProvider>
  );
}
