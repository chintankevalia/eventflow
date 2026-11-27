import { describe, expect, it } from "vitest";
import { can } from "./permissions";
import { safeNextPath } from "./safe-redirect";
import { initials } from "./utils";

describe("safeNextPath (open-redirect protection)", () => {
  it("allows same-site paths with query strings", () => {
    expect(safeNextPath("/settings/users?status=ACTIVE")).toBe("/settings/users?status=ACTIVE");
  });

  it.each(["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "", undefined, 42, "/login"])(
    "falls back for %s",
    (value) => {
      expect(safeNextPath(value)).toBe("/dashboard");
    },
  );
});

describe("permissions", () => {
  it("only admins manage users and settings", () => {
    expect(can(["ADMIN"], "users.manage")).toBe(true);
    for (const role of ["REQUESTER", "APPROVER", "EXECUTIVE_APPROVER", "FINANCE", "REPORTING"] as const) {
      expect(can([role], "users.manage")).toBe(false);
      expect(can([role], "settings.manage")).toBe(false);
    }
  });

  it("approval center is for approvers", () => {
    expect(can(["APPROVER"], "approvals.view")).toBe(true);
    expect(can(["EXECUTIVE_APPROVER"], "approvals.view")).toBe(true);
    expect(can(["REQUESTER"], "approvals.view")).toBe(false);
  });

  it("combines roles and denies empty role lists", () => {
    expect(can(["REQUESTER", "FINANCE"], "reports.view")).toBe(true);
    expect(can([], "dashboard.view")).toBe(false);
    expect(can(undefined, "dashboard.view")).toBe(false);
  });

  it("only admins can import events or manage integrations", () => {
    expect(can(["ADMIN"], "import.manage")).toBe(true);
    expect(can(["ADMIN"], "integrations.manage")).toBe(true);
    for (const role of ["REQUESTER", "EVENT_OWNER", "EVENT_MANAGER", "APPROVER", "EXECUTIVE_APPROVER", "FINANCE", "REPORTING"] as const) {
      expect(can([role], "import.manage")).toBe(false);
      expect(can([role], "integrations.manage")).toBe(false);
    }
  });
});

describe("initials", () => {
  it.each([
    ["Amit Kumar Shah", "AS"],
    ["mitul", "MI"],
    ["  Akshay  ", "AK"],
    ["Priya Shah (test)", "PS"],
    ["Mitul (test)", "MI"],
    ["", "?"],
  ])("%s → %s", (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});
