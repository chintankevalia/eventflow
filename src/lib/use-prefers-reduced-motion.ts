"use client";

import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Whether the viewer has asked their OS for reduced motion.
 *
 * `globals.css` already flattens CSS transitions and keyframes under that media
 * query, which covers almost everything in the portal. A chart is the exception:
 * recharts interpolates its own paths in JavaScript, so no stylesheet can switch
 * that animation off — it has to be told. Reading the same media query keeps the
 * two in agreement.
 *
 * Starts `false` and corrects itself in an effect, because the query cannot be
 * read while rendering on the server.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(QUERY);
    setReduced(query.matches);

    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
