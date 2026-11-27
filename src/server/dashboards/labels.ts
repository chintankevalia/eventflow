/**
 * Turning a stored value into the words a reader expects.
 *
 * The database stores `CHANNEL` and `CLOSED`; a chart axis has to say "Channel" and "Closed".
 * Doing it here rather than in SQL keeps one spelling of each label across the whole portal —
 * these are the same maps the badges and the register already use — and avoids a `CASE`
 * expression that would quietly drift from them.
 *
 * Lookup-backed values (region, format, product focus, partner tier) are *not* here: their
 * labels are admin-editable rows, so the registry joins `lookup_items` for those instead.
 */
import { APPROVAL_LABEL, LIFECYCLE_META } from "@/lib/lifecycle";
import { DEPARTMENT_LABEL } from "@/lib/permissions";

/** `NOT_RAISED` → `Not raised`. The fallback for every enum without a map of its own. */
function sentenceCase(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase().replace(/_/g, " ");
}

export const LABEL_SETS = {
  department: (v: string) => DEPARTMENT_LABEL[v as keyof typeof DEPARTMENT_LABEL] ?? sentenceCase(v),
  lifecycle: (v: string) => LIFECYCLE_META[v as keyof typeof LIFECYCLE_META]?.label ?? sentenceCase(v),
  approval: (v: string) => APPROVAL_LABEL[v as keyof typeof APPROVAL_LABEL] ?? sentenceCase(v),
  /** Any other SCREAMING_SNAKE enum. */
  enum: sentenceCase,
} as const;

export type LabelSet = keyof typeof LABEL_SETS;

/** Applies a label set, leaving anything it does not recognise exactly as it was. */
export function applyLabel(set: LabelSet | undefined, value: string): string {
  if (!set) return value;
  return LABEL_SETS[set](value);
}
