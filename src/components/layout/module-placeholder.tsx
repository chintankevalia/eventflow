import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

type ModulePlaceholderProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  phase: string;
  features: string[];
};

/** Empty state for modules built in later phases. Lists exactly what the module will do. */
export function ModulePlaceholder({ icon: Icon, title, description, phase, features }: ModulePlaceholderProps) {
  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader title={title} description={description} />
      <Card className="flex flex-col items-center px-6 py-12 text-center sm:py-16">
        <span className="flex size-14 items-center justify-center rounded-full bg-primary-soft">
          <Icon className="size-6 text-brand-coral" aria-hidden />
        </span>
        <Badge tone="brand" className="mt-5">
          {phase}
        </Badge>
        <h2 className="mt-3 text-lg font-semibold">This module is on its way</h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">Here is what it will include:</p>
        <ul className="mt-6 grid w-full max-w-2xl gap-2 text-left text-sm sm:grid-cols-2">
          {features.map((feature) => (
            <li key={feature} className="flex gap-2 rounded-md border border-border bg-background px-3 py-2">
              <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-coral" />
              {feature}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
