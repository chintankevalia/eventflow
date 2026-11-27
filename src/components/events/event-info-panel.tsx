import * as React from "react";
import { Tag, TrendingUp, Users } from "lucide-react";
import { Stat, StatGroup } from "@/components/ui/stat";
import { formatDate, formatINR } from "@/lib/format";

export type EventInfoPanelProps = {
  budget: {
    estimated: number;
    actual: number;
    motadata: number | null;
    partner: number | null;
    mdf: number | null;
  };
  info: {
    type: string;
    subtype: string | null;
    department: string;
    city: string | null;
    proposedDate: Date | null;
    partner: string | null;
  };
  people: {
    requester: string | null;
    owner: string | null;
    manager: string | null;
  };
};

/**
 * The event's at-a-glance facts. Rendered twice by the detail page — in the
 * right rail on wide screens, and inside a collapsible block under the tabs on
 * narrow ones — so this information is never unreachable on a phone.
 */
export function EventInfoPanel({ budget, info, people }: EventInfoPanelProps) {
  return (
    <div className="space-y-4">
      <StatGroup title="Budget" icon={TrendingUp}>
        <Stat variant="inline" label="Estimated" value={formatINR(budget.estimated)} />
        <Stat
          variant="inline"
          label="Actual"
          value={budget.actual > 0 ? formatINR(budget.actual) : null}
          tone={budget.actual > budget.estimated && budget.estimated > 0 ? "danger" : "default"}
        />
        {budget.motadata !== null && (
          <Stat variant="inline" label="Motadata" value={formatINR(budget.motadata)} />
        )}
        {budget.partner !== null && <Stat variant="inline" label="Partner" value={formatINR(budget.partner)} />}
        {budget.mdf !== null && <Stat variant="inline" label="MDF" value={formatINR(budget.mdf)} />}
      </StatGroup>

      <StatGroup title="Event info" icon={Tag}>
        <Stat variant="inline" label="Type" value={info.type} />
        {info.subtype && <Stat variant="inline" label="Subtype" value={info.subtype} />}
        <Stat variant="inline" label="Department" value={info.department} />
        {info.city && <Stat variant="inline" label="City" value={info.city} />}
        {info.proposedDate && <Stat variant="inline" label="Date" value={formatDate(info.proposedDate)} />}
        {info.partner && <Stat variant="inline" label="Partner" value={info.partner} />}
      </StatGroup>

      <StatGroup title="People" icon={Users}>
        <Stat variant="inline" label="Requester" value={people.requester} />
        <Stat variant="inline" label="Owner" value={people.owner ?? "Unassigned"} />
        <Stat variant="inline" label="Manager" value={people.manager} />
      </StatGroup>
    </div>
  );
}
