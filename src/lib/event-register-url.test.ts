import { describe, expect, it } from "vitest";
import { eventListFiltersSchema, sortDirection as realSortDirection } from "@/server/events/queries";
import { queryFor, sortDirection } from "./event-register-url";

const parse = (raw: Record<string, unknown>) => eventListFiltersSchema.parse(raw);

describe("sortDirection", () => {
  it("matches the server's own default direction for every sort key — this file duplicates it so it can stay client-safe", () => {
    for (const sort of ["date", "created", "budget", "title", "status", "owner", "code"] as const) {
      const filters = parse({ sort });
      expect(sortDirection(filters)).toBe(realSortDirection(filters));
    }
  });

  it("lets an explicit direction win", () => {
    expect(sortDirection(parse({ sort: "date", dir: "asc" }))).toBe("asc");
  });
});

describe("queryFor", () => {
  it("omits a direction that matches the column's own default", () => {
    expect(queryFor(parse({}), { sort: "date", dir: "desc" })).toBe("");
  });

  it("keeps a direction that overrides the column's own default", () => {
    expect(queryFor(parse({}), { sort: "date", dir: "asc" })).toContain("dir=asc");
  });

  it("resets the page back to 1 implicitly", () => {
    expect(queryFor(parse({}), { page: 1 })).toBe("");
    expect(queryFor(parse({}), { page: 2 })).toContain("page=2");
  });
});
