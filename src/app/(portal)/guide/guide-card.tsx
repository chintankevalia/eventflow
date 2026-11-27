"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, PlayCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTour } from "@/components/tour/tour-provider";
import type { TourSection } from "@/lib/tour-content";

export function GuideCard({
  section,
  seen,
  accessible,
}: {
  section: TourSection;
  seen: boolean;
  /** Whether the viewer's own roles give them access to this area — a walkthrough of a screen
   * they cannot open would just redirect them to "forbidden" mid-tour, so it is disabled rather
   * than offered under "show all topics". */
  accessible: boolean;
}) {
  const { start } = useTour();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>{section.title}</CardTitle>
          {seen && (
            <Badge tone="success" className="gap-1">
              <CheckCircle2 className="size-3" aria-hidden /> Seen
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{section.description}</p>
      </CardHeader>
      <CardContent>
        <Button
          size="sm"
          variant="outline"
          disabled={!accessible}
          title={accessible ? undefined : "This needs access you don't currently have."}
          onClick={() => start([section.key])}
          className="mb-3 gap-1.5"
        >
          <PlayCircle className="size-4" aria-hidden />
          {!accessible ? "Requires access" : seen ? "Replay this walkthrough" : "Start walkthrough"}
        </Button>
        <ul className="space-y-1.5">
          {section.steps.map((step) => (
            <li key={step.href + step.title}>
              <Link
                href={step.href}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                {step.title}
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
