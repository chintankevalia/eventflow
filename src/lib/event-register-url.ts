/**
 * The register's URL ↔ filters mapping — shared by the server page (tabs, saved views, sort
 * links, pagination, the export link) and the client-side live filter bar, so both can never
 * build a different querystring for the same filters. `EventListFilters` is a type-only import
 * (erased at compile time), so this file stays importable from client components even though
 * `@/server/events/queries` itself transitively pulls in `server-only`.
 */
import type { EventListFilters, EventSortKey } from "@/server/events/queries";

/** Mirrors `SORT_COLUMNS`'s `defaultDir` in `@/server/events/queries` — duplicated rather than
 * imported, for the same reason the type above is type-only: this file must stay client-safe. */
const DEFAULT_SORT_DIR: Record<EventSortKey, "asc" | "desc"> = {
  date: "desc",
  created: "desc",
  budget: "desc",
  code: "desc",
  title: "asc",
  status: "asc",
  owner: "asc",
};

export const sortDirection = (filters: Pick<EventListFilters, "sort" | "dir">) =>
  filters.dir ?? DEFAULT_SORT_DIR[filters.sort];

export function queryFor(filters: EventListFilters, patch: Partial<EventListFilters>) {
  const merged = { ...filters, ...patch };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined || value === "" || value === false) continue;
    if (key === "page" && value === 1) continue;
    if (key === "sort" && value === "date") continue;
    // A direction that matches the column's own default is already implied.
    if (key === "dir" && value === sortDirection({ ...merged, dir: undefined })) continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function hrefWith(filters: EventListFilters, patch: Partial<EventListFilters>) {
  return `/events${queryFor(filters, patch)}`;
}
