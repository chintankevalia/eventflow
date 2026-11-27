"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/**
 * Re-reads the page's server data on an interval, so a dashboard or the approval queue stays
 * current without anyone pressing reload.
 *
 * `router.refresh()` re-runs the server components in place: scroll position, open menus and
 * half-typed input survive. It pauses while the tab is hidden — no point querying for a page
 * nobody is looking at — and refreshes at once when the tab comes back, which is the moment a
 * reader most wants fresh figures.
 */
export function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();

  React.useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const begin = () => {
      if (timer) clearInterval(timer);
      timer = setInterval(() => router.refresh(), seconds * 1000);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
        begin();
      } else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    if (document.visibilityState === "visible") begin();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router, seconds]);

  return null;
}
