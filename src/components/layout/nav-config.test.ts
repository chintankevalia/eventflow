import { describe, expect, it } from "vitest";
import { activeNavHref } from "./nav-config";

describe("activeNavHref", () => {
  it("highlights the most specific match", () => {
    expect(activeNavHref("/events/new")).toBe("/events/new");
    expect(activeNavHref("/events")).toBe("/events");
    expect(activeNavHref("/events/EF-2026-0001")).toBe("/events");
  });

  it("matches nested settings pages", () => {
    expect(activeNavHref("/settings/users")).toBe("/settings");
  });

  it("does not match on a shared prefix", () => {
    expect(activeNavHref("/eventsx")).toBeUndefined();
  });
});
