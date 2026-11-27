"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { DateInput } from "@/components/ui/date-input";
import { Field } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { FieldType } from "@/lib/form-schema";

export type FormFieldSpec = {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  help?: string;
  options?: { value: string; label: string }[];
};

/** Renders one configurable event-form field. The input's `name` is the field key. */
export function DynamicField({ field, value, error }: { field: FormFieldSpec; value: unknown; error?: string }) {
  const id = `f-${field.key.replace(/[^a-zA-Z0-9]/g, "-")}`;
  const common = { name: field.key, required: field.required };
  const text = value === null || value === undefined ? "" : String(value);

  return (
    <Field
      id={id}
      label={field.label}
      required={field.required}
      error={error}
      hint={field.help}
      className={field.type === "TEXTAREA" || field.type === "MULTISELECT" ? "sm:col-span-2" : undefined}
    >
      {field.type === "TEXTAREA" ? (
        <Textarea {...common} defaultValue={text} rows={3} maxLength={5000} />
      ) : field.type === "SELECT" ? (
        <Select {...common} defaultValue={text}>
          <option value="">Not set</option>
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ) : field.type === "MULTISELECT" ? (
        <MultiPick
          name={field.key}
          options={field.options ?? []}
          selected={Array.isArray(value) ? (value as string[]) : text ? [text] : []}
        />
      ) : field.type === "CHECKBOX" ? (
        <span className="flex h-10 items-center">
          <Checkbox name={field.key} defaultChecked={value === true} />
        </span>
      ) : field.type === "NUMBER" ? (
        <Input {...common} type="number" step="1" min="0" defaultValue={text} />
      ) : field.type === "CURRENCY" ? (
        <Input {...common} type="number" step="0.01" min="0" defaultValue={text} inputMode="decimal" placeholder="₹" />
      ) : field.type === "DATE" ? (
        <DateInput {...common} defaultValue={text} />
      ) : field.type === "EMAIL" ? (
        <Input {...common} type="email" defaultValue={text} maxLength={254} />
      ) : field.type === "PHONE" ? (
        <Input {...common} type="tel" defaultValue={text} maxLength={30} />
      ) : field.type === "URL" ? (
        <Input {...common} type="url" defaultValue={text} maxLength={500} placeholder="https://" />
      ) : (
        <Input {...common} type="text" defaultValue={text} maxLength={500} />
      )}
    </Field>
  );
}

/**
 * A tick-list for "choose any of these". Every ticked box posts under the field's own name, so
 * the server reads them back with `getAll` exactly as it did for the native multi-select this
 * replaced — which could not be styled like the rest of the form and needed Ctrl-click to pick
 * more than one, a gesture most people never discover.
 */
function MultiPick({
  name,
  options,
  selected,
}: {
  name: string;
  options: { value: string; label: string }[];
  selected: string[];
}) {
  if (options.length === 0) return <p className="text-sm text-muted-foreground">No options have been set up yet.</p>;
  return (
    <div className="grid gap-x-4 gap-y-1.5 rounded-md border border-input bg-card p-3 sm:grid-cols-2">
      {options.map((o) => (
        <label key={o.value} className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox name={name} value={o.value} defaultChecked={selected.includes(o.value)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}
