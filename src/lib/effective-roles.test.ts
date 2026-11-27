import { describe, expect, it } from "vitest";
import { can, effectiveRoles } from "./permissions";

describe("effectiveRoles — Sales only reviews", () => {
  it("drops the planning roles for Sales, keeps the rest", () => {
    expect(effectiveRoles(["REQUESTER", "EVENT_OWNER", "REPORTING"], "SALES")).toEqual(["REPORTING"]);
    expect(can(effectiveRoles(["REQUESTER"], "SALES"), "events.create")).toBe(false);
  });
  it("leaves admins and other departments alone", () => {
    expect(effectiveRoles(["ADMIN", "REQUESTER"], "SALES")).toEqual(["ADMIN", "REQUESTER"]);
    expect(effectiveRoles(["REQUESTER"], "MARKETING")).toEqual(["REQUESTER"]);
  });
});

describe("a Sales user with no remaining role", () => {
  it("keeps Reporting, so still sees the dashboard and event register, but cannot create", () => {
    const roles = effectiveRoles(["REQUESTER"], "SALES");
    expect(roles).toEqual(["REPORTING"]);
    expect(can(roles, "dashboard.view")).toBe(true);
    expect(can(roles, "events.view")).toBe(true);
    expect(can(roles, "events.create")).toBe(false);
  });
});
