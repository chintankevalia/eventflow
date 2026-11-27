import { cn } from "@/lib/utils";
import { CORAL_PATH, MARK_VIEWBOX, RING_PATH, WORDMARK_INK_PATHS, WORDMARK_VIEWBOX } from "./paths";

type LogoProps = { className?: string; title?: string };

/** Motadata wordmark. The ink follows the theme (black on light, white on dark); the quarter stays coral. */
export function MotadataLogo({ className, title = "Motadata" }: LogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={WORDMARK_VIEWBOX}
      role="img"
      aria-label={title}
      className={cn("h-6 w-auto text-brand-ink", className)}
    >
      <title>{title}</title>
      {WORDMARK_INK_PATHS.map((d) => (
        <path key={d.slice(0, 16)} d={d} fill="currentColor" />
      ))}
      <path d={CORAL_PATH} fill="var(--brand-coral)" />
    </svg>
  );
}

/** The "o" mark used as favicon and compact logo. */
export function MotadataMark({ className, title = "Motadata" }: LogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={MARK_VIEWBOX}
      role="img"
      aria-label={title}
      className={cn("size-7 text-brand-ink", className)}
    >
      <title>{title}</title>
      <path d={RING_PATH} fill="currentColor" />
      <path d={CORAL_PATH} fill="var(--brand-coral)" />
    </svg>
  );
}
