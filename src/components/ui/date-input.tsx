"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { formatIsoDayDMY } from "@/lib/date-range";
import { cn } from "@/lib/utils";

/**
 * A date field that states, in Indian order, which day is actually selected.
 *
 * `<input type="date">` is drawn by the browser in the *browser's* locale and
 * ignores the page's `lang`, so the same field reads `12/10/2026` on a default
 * Chrome and `10/12/2026` on one set to English (India) — both meaning
 * 10 December. Two colleagues can read one screen two months apart, and on a
 * proposed date or a budget filter that is not a cosmetic problem.
 *
 * The picker itself is worth keeping — calendar, keyboard, and a real date
 * keypad on a phone — so rather than rebuild it, the chosen day is printed
 * beside it in the one order nobody here will misread. An empty field shows a
 * dash rather than `dd-mm-yyyy`: the browser draws its own `mm/dd/yyyy`
 * placeholder in the field, and two disagreeing format strings side by side
 * would teach the wrong thing.
 *
 * The echo is `aria-hidden`: the input already announces its own value, and a
 * screen reader repeating it would just say the date twice.
 */
export function DateInput({
  className,
  wrapperClassName,
  onChange,
  ...props
}: React.ComponentProps<"input"> & { wrapperClassName?: string }) {
  const [picked, setPicked] = React.useState(String(props.defaultValue ?? props.value ?? ""));
  // Controlled callers own the value; uncontrolled ones are tracked here.
  const day = typeof props.value === "string" ? props.value : picked;

  return (
    <span className={cn("inline-flex items-center gap-2", wrapperClassName)}>
      <Input
        {...props}
        type="date"
        className={className}
        onChange={(e) => {
          setPicked(e.target.value);
          onChange?.(e);
        }}
      />
      <span
        aria-hidden
        className={cn("shrink-0 text-xs tabular-nums", day ? "text-foreground" : "text-muted-foreground/70")}
      >
        {day ? formatIsoDayDMY(day) : "—"}
      </span>
    </span>
  );
}
