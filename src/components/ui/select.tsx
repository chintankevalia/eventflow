"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Radix doesn't allow an item's `value` to be `""` — it's reserved to mean "nothing selected".
 * Every picker in this app uses `""` for its own placeholder option ("Not set", "All teams", …),
 * so every value is mapped through this sentinel going in and back out going out. Callers never
 * see it: `onChange` always reports `""`, and a submitted form posts `""` too — Radix's own hidden
 * form control would post the sentinel itself, so the field's `name` goes on a hidden input of
 * ours instead (a draft with no subtype was being refused as "Choose a valid subtype").
 */
const NONE = "__none__";
const toRadix = (v: string) => (v === "" ? NONE : v);
const fromRadix = (v: string) => (v === NONE ? "" : v);

type OptionEntry = { kind: "option"; value: string; label: React.ReactNode; disabled?: boolean };
type GroupEntry = { kind: "group"; label: string; options: Omit<OptionEntry, "kind">[] };

/** Reads `<option>` and `<optgroup>` children the way a native `<select>` would, so every call
 * site that already builds its options as JSX keeps working unchanged. */
function parseChildren(children: React.ReactNode): (OptionEntry | GroupEntry)[] {
  const entries: (OptionEntry | GroupEntry)[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === "option") {
      const p = child.props as React.OptionHTMLAttributes<HTMLOptionElement>;
      entries.push({ kind: "option", value: String(p.value ?? ""), label: p.children, disabled: p.disabled });
    } else if (child.type === "optgroup") {
      const p = child.props as React.OptgroupHTMLAttributes<HTMLOptGroupElement>;
      const options: Omit<OptionEntry, "kind">[] = [];
      React.Children.forEach(p.children, (opt) => {
        if (!React.isValidElement(opt) || opt.type !== "option") return;
        const op = opt.props as React.OptionHTMLAttributes<HTMLOptionElement>;
        options.push({ value: String(op.value ?? ""), label: op.children, disabled: op.disabled });
      });
      entries.push({ kind: "group", label: String(p.label ?? ""), options });
    }
  });
  return entries;
}

const triggerClass =
  "flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-xs transition-colors focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/40 disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-muted-foreground";

const itemClass =
  "relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-7 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[disabled]:opacity-50";

function Item({ entry }: { entry: Omit<OptionEntry, "kind"> }) {
  return (
    <SelectPrimitive.Item value={toRadix(entry.value)} disabled={entry.disabled} className={itemClass}>
      <span className="absolute left-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-3.5" aria-hidden />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{entry.label}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export type SelectProps = {
  className?: string;
  children: React.ReactNode;
  name?: string;
  id?: string;
  value?: string;
  /** A plain string, or — only together with `multiple` — the native multi-select's own
   * `string[]`/`readonly string[]` form. */
  defaultValue?: string | readonly string[];
  onChange?: (e: { target: { value: string } }) => void;
  disabled?: boolean;
  required?: boolean;
  /** Radix has no multi-select primitive, so this one case keeps the plain native `<select
   * multiple>` it always was — restyling it would mean building a different kind of control
   * (a checkbox list, a tag picker), which is a UX decision of its own, not a style fix. */
  multiple?: boolean;
  "aria-label"?: string;
};

/**
 * The app's one dropdown-picker component. A custom popover (Radix Select) rather than the
 * native element, so its open panel shares the exact same tokens as every other dropdown in the
 * app — DropdownMenuContent, the search results list — instead of falling back to OS chrome.
 * `<option>` (and `<optgroup>`) children are still how callers describe the choices; only what
 * renders them changed.
 */
export function Select({
  className,
  children,
  name,
  id,
  value,
  defaultValue,
  onChange,
  disabled,
  required,
  multiple,
  "aria-label": ariaLabel,
}: SelectProps) {
  // Computed unconditionally — the `multiple` branch below returns before using it, and a hook
  // can never be called conditionally.
  const entries = React.useMemo(() => parseChildren(children), [children]);
  // What the hidden input posts, for the uncontrolled case; a controlled `value` wins.
  const [chosen, setChosen] = React.useState(typeof defaultValue === "string" ? defaultValue : "");
  const posted = value !== undefined ? value : chosen;

  if (multiple) {
    return (
      <div className="relative">
        <select
          name={name}
          id={id}
          value={value}
          defaultValue={defaultValue}
          onChange={onChange}
          disabled={disabled}
          required={required}
          multiple
          aria-label={ariaLabel}
          className={cn(
            "flex h-10 w-full appearance-none rounded-md border border-input bg-card py-2 pr-9 pl-3 text-sm text-foreground shadow-xs transition-colors focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
      </div>
    );
  }

  return (
    <SelectPrimitive.Root
      value={value !== undefined ? toRadix(value) : undefined}
      defaultValue={value === undefined && typeof defaultValue === "string" ? toRadix(defaultValue) : undefined}
      onValueChange={(v) => {
        setChosen(fromRadix(v));
        onChange?.({ target: { value: fromRadix(v) } });
      }}
      disabled={disabled}
      required={required}
    >
      {name && <input type="hidden" name={name} value={posted} disabled={disabled} />}
      <SelectPrimitive.Trigger id={id} aria-label={ariaLabel} className={cn(triggerClass, className)}>
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          className="z-50 max-h-72 w-[var(--radix-select-trigger-width)] overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          <SelectPrimitive.Viewport>
            {entries.map((entry, i) =>
              entry.kind === "option" ? (
                <Item key={`o-${i}`} entry={entry} />
              ) : (
                <SelectPrimitive.Group key={`g-${i}`}>
                  <SelectPrimitive.Label className="px-2 py-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                    {entry.label}
                  </SelectPrimitive.Label>
                  {entry.options.map((o, j) => (
                    <Item key={`o-${i}-${j}`} entry={o} />
                  ))}
                </SelectPrimitive.Group>
              ),
            )}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
