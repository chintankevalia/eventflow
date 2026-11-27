"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * A thin coral bar across the top of the window from the moment a link is clicked until the new
 * page arrives.
 *
 * Without it, clicking a module waits on the server render with no sign anything happened, which
 * reads as the app having frozen. The bar starts on the click itself — before any request — so
 * the response is immediate, creeps towards 90% while waiting, and completes when the URL changes.
 *
 * Only same-origin, same-tab, left-click navigations start it; a new tab, a download or a hash
 * jump on the same page would otherwise leave it hanging.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [progress, setProgress] = React.useState<number | null>(null);
  const timer = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = React.useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  // The URL changing is the page arriving: finish the bar, then hide it.
  React.useEffect(() => {
    stop();
    setProgress((p) => (p === null ? null : 100));
    const hide = setTimeout(() => setProgress(null), 250);
    return () => clearTimeout(hide);
  }, [pathname, searchParams, stop]);

  React.useEffect(() => {
    const start = () => {
      stop();
      setProgress(8);
      // Eases towards 90% and waits there; it never claims to be done before it is.
      timer.current = setInterval(() => setProgress((p) => (p === null ? null : p + (90 - p) * 0.08)), 200);
    };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const anchor = (event.target as HTMLElement).closest("a");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      start();
    };
    document.addEventListener("click", onClick, { capture: true });
    // Programmatic navigations (router.push after an action) announce themselves the same way.
    window.addEventListener("eventflow:navigate", start);
    return () => {
      document.removeEventListener("click", onClick, { capture: true });
      window.removeEventListener("eventflow:navigate", start);
      stop();
    };
  }, [stop]);

  if (progress === null) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 bg-brand-coral transition-[width] duration-200 ease-out motion-reduce:transition-none"
      style={{ width: `${progress}%` }}
    />
  );
}

/** Starts the bar for a navigation made in code, such as `router.push` after a save. */
export function startNavigation() {
  window.dispatchEvent(new Event("eventflow:navigate"));
}
