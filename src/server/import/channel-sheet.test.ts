import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  importChannelSheet,
  isDistributor,
  mapChannelItem,
  parseChannelGrid,
  parseMoney,
} from "./channel-sheet";

const HEADER = [
  "Name",
  "Subitems",
  "Status",
  "Date",
  "Region",
  "Country/City",
  "Budget",
  "Participant Name",
  "Collaboration",
  "Event Type",
  "Event Sub Type",
  "Venue",
  "Pipeline",
  "Closed won",
];

const SUB_HEADER = [
  "Subitems",
  "Name",
  "Owner",
  "Status",
  "Responsible",
  "Contact",
  "Budget (In Rs.)",
  "Item ID (auto generated)",
];

/** The shape of a Monday board export: board title, group titles, repeated headers, nested subitems. */
function grid(): string[][] {
  return [
    ["glob - events"],
    ["Event sheet 25-26"],
    HEADER,
    [
      "Amplify Awards Bangalore",
      "",
      "Completed",
      "2025-06-12",
      "INDIA",
      "Banglore",
      "322200",
      "Akshay, Naibedya",
      "Savex",
      "Partner Event",
      "Awards",
      "Park Hyatt",
      "",
      "",
    ],
    SUB_HEADER,
    ["", "Photographer", "", "Done", "Chintan", "Raj Studio 98765", "12000", "1234567890"],
    ["", "Venue", "", "Done", "Muskan", "Park Hyatt", "300000", "1234567891"],
    [
      "Gulf CXO Roundtable",
      "",
      "Sheduled",
      "",
      "ME & Europe",
      "Downtown Kuwait",
      "",
      "",
      "Individule",
      "Customer event",
      "Exibitor Event",
      "",
      "",
      "",
    ],
    ["", "", "", "2025-04-23 to 2026-03-23", "", "", "7971740"], // group total
    [],
    ["Event 2026 -27"],
    HEADER,
    [
      "Savex PRT",
      "",
      "Completed",
      "2026-09-24",
      "INDIA",
      "Ahmedabad",
      "150000",
      "",
      "Savex",
      "Distributor led partner event",
      "Round Table Event",
      "",
      "",
      "",
    ],
    [
      "Savex PRT",
      "",
      "Completed",
      "2026-09-24",
      "INDIA",
      "Banglore",
      "150000",
      "",
      "Savex",
      "Distributor led partner event",
      "Round Table Event",
      "",
      "",
      "",
    ],
    [
      "Kuwait Customer Roundtable",
      "",
      "TBD",
      "2026-11-03",
      "ME & Europe",
      "Downtown Kuwait",
      "184468.7 +",
      "",
      "Softsheild",
      "",
      "",
      "",
      "",
      "",
    ],
    [
      "Amplify Awards Colombo",
      "",
      "Completed",
      "2026-08-14",
      "AFRICA & SAARC",
      "Sri Laka",
      "266366.1",
      "",
      "Softshield",
      "Partner Event",
      "Awards",
      "",
      "",
      "",
    ],
    SUB_HEADER,
    ["", "Anchor/Host – Third party", "", "Done", "Dilip", "", "", "1234567892"],
    ["", "PPT Preparation", "", "Done", "Sonali", "", "", "1234567893"],
  ];
}

/** Just enough of the client for a dry run, which only reads. */
function stubDb(): PrismaClient {
  return {
    eventType: {
      findMany: async () => [
        { id: "t-partner", key: "partner_meet", name: "Partner event" },
        { id: "t-customer", key: "customer", name: "Customer event" },
        { id: "t-dist-partner", key: "distributor_partner", name: "Distributor-led partner event" },
      ],
    },
    eventSubtype: {
      findMany: async () => [
        { id: "s-awards", eventTypeId: "t-partner", name: "Awards" },
        { id: "s-exhibitor", eventTypeId: "t-customer", name: "Exhibitor event" },
        { id: "s-roundtable", eventTypeId: "t-dist-partner", name: "Round table event" },
      ],
    },
    lookupItem: {
      findMany: async () => ["ind_north", "ind_west", "ind_east", "ind_south", "me", "saarc", "africa", "apac", "europe"].map((value) => ({ value })),
    },
    expenseCategory: { findMany: async () => [{ id: "c-venue", name: "Venue" }] },
    formField: { findMany: async () => [{ key: "custom.venue" }, { key: "custom.participants" }] },
    importRow: { findMany: async () => [] },
    organization: { findMany: async () => [{ id: "o-savex", name: "savex" }] },
    event: { findMany: async () => [] },
  } as unknown as PrismaClient;
}

const plan = () =>
  importChannelSheet(stubDb(), parseChannelGrid(grid()), {
    actorId: "u-admin",
    fileName: "test.xlsx",
    commit: false,
  });

describe("parseChannelGrid", () => {
  const sheet = parseChannelGrid(grid());

  it("reads every event and ignores titles, headers, totals and blanks", () => {
    expect(sheet.items.map((i) => i.cells.Name)).toEqual([
      "Amplify Awards Bangalore",
      "Gulf CXO Roundtable",
      "Savex PRT",
      "Savex PRT",
      "Kuwait Customer Roundtable",
      "Amplify Awards Colombo",
    ]);
  });

  it("keeps reading events after a nested subitem block", () => {
    // The bug this guards against: treating the subitem header as a mode switch swallowed
    // every event that followed it.
    expect(sheet.items[1].cells.Name).toBe("Gulf CXO Roundtable");
    expect(sheet.items[1].subitems).toHaveLength(0);
  });

  it("attaches subitems to the event above them", () => {
    expect(sheet.items[0].subitems.map((s) => s.cells.Name)).toEqual(["Photographer", "Venue"]);
    expect(sheet.items[0].subitems[0].cells["Budget (In Rs.)"]).toBe("12000");
    expect(sheet.items[0].subitems[0].cells["Item ID (auto generated)"]).toBe("1234567890");
  });

  it("records the group each event sits in", () => {
    expect(sheet.items.map((i) => i.group)).toEqual([
      "Event sheet 25-26",
      "Event sheet 25-26",
      "Event 2026 -27",
      "Event 2026 -27",
      "Event 2026 -27",
      "Event 2026 -27",
    ]);
  });

  it("reports the row number the reviewer would look up", () => {
    expect(sheet.items[0].rowIndex).toBe(4);
    expect(sheet.items[0].subitems[0].rowIndex).toBe(6);
  });

  it("returns the parent columns", () => {
    expect(sheet.columns).toEqual(HEADER);
  });
});

describe("parseMoney", () => {
  it("reads plain and formatted numbers", () => {
    expect(parseMoney("322200")).toEqual({ amount: 322200 });
    expect(parseMoney("₹1,84,468.70")).toEqual({ amount: 184468.7 });
    expect(parseMoney("")).toEqual({ amount: null });
  });

  it("salvages a number from a cell with a stray character, and says so", () => {
    const result = parseMoney("184468.7 +");
    expect(result.amount).toBe(184468.7);
    expect(result.note).toContain("184468.7");
  });

  it("refuses a cell with no number in it", () => {
    expect(parseMoney("TBD").amount).toBeNull();
  });
});

describe("mapChannelItem", () => {
  const sheet = parseChannelGrid(grid());
  const [amplify, gulf, ahmedabad, bangalore, kuwait, colombo] = sheet.items.map(mapChannelItem);

  it("maps status to a lifecycle and approval state", () => {
    expect(amplify.lifecycleStatus).toBe("CLOSED");
    expect(amplify.approvalStatus).toBe("APPROVED");
    expect(gulf.lifecycleStatus).toBe("SCHEDULING");
    expect(gulf.approvalStatus).toBe("NOT_SUBMITTED");
    expect(kuwait.lifecycleStatus).toBe("DRAFT");
  });

  it("maps the sheet's spellings to the configured types and subtypes", () => {
    expect(amplify.typeKey).toBe("partner_meet");
    expect(amplify.subtypeName).toBe("Awards");
    expect(gulf.typeKey).toBe("customer");
    expect(gulf.subtypeName).toBe("Exhibitor event");
    expect(ahmedabad.typeKey).toBe("distributor_partner");
    expect(ahmedabad.subtypeName).toBe("Round table event");
  });

  it("maps regions and corrects city spellings, noting the correction", () => {
    expect(amplify.regionValue).toBe("ind_south"); // INDIA + Bangalore
    expect(amplify.city).toBe("Bangalore");
    expect(amplify.issues.some((i) => i.field === "Country/City" && i.message.includes("Bangalore"))).toBe(true);
    expect(gulf.regionValue).toBe("me"); // ME & Europe + Downtown Kuwait
    expect(gulf.city).toBe("Downtown Kuwait");
  });

  it("treats Individule as no partner and merges the misspelled one", () => {
    expect(gulf.partnerName).toBeNull();
    expect(amplify.partnerName).toBe("Savex");
    expect(kuwait.partnerName).toBe("Softshield");
  });

  it("flags a missing event type as an error and a missing date or budget as a warning", () => {
    expect(kuwait.issues.some((i) => i.severity === "error" && i.field === "Event Type")).toBe(true);
    expect(gulf.issues.some((i) => i.severity === "warning" && i.field === "Date")).toBe(true);
    expect(gulf.issues.some((i) => i.severity === "warning" && i.field === "Budget")).toBe(true);
    expect(amplify.issues.some((i) => i.severity === "error")).toBe(false);
  });

  it("says how much of the budget the priced subitems account for", () => {
    const warning = amplify.issues.find((i) => i.field === "Budget");
    expect(warning?.message).toContain("3,12,000"); // the two priced subitems
    expect(warning?.message).toContain("3,22,200"); // the event's own budget cell
    expect(warning?.message).toContain("10,200"); // the balance carried as its own line
  });

  it("says so when no subitem carries an amount at all", () => {
    const warning = colombo.issues.find((i) => i.field === "Budget");
    expect(warning?.message).toContain("None of the 2 subitems carry an amount");
    expect(warning?.message).toContain("2,66,366.1");
  });

  it("uses the event type the team supplied for a row the sheet leaves blank", () => {
    const row = (date: string) => ({
      rowIndex: 67,
      group: "Event 2026 -27",
      cells: {
        Name: "ETL Chapter Pune",
        Status: "Completed",
        Date: date,
        Region: "INDIA",
        "Country/City": "Pune",
        Budget: "236000",
        "Event Sub Type": "Exibitor Event",
      },
      subitems: [],
    });

    const supplied = mapChannelItem(row("2026-05-23"));
    expect(supplied.typeKey).toBe("customer");
    expect(supplied.typeLabel).toBe(""); // the preview still shows the sheet saying nothing
    expect(supplied.issues.some((i) => i.severity === "error")).toBe(false);
    expect(supplied.issues.find((i) => i.field === "Event Type")?.message).toContain("confirmed by the team");

    // The answer is pinned to this row's own details, so a row that changes is asked about again
    // rather than quietly inheriting someone else's answer.
    const moved = mapChannelItem(row("2026-05-24"));
    expect(moved.typeKey).toBeNull();
    expect(moved.issues.some((i) => i.severity === "error" && i.field === "Event Type")).toBe(true);
  });

  it("keeps two events of the same name on the same day apart by city", () => {
    expect(ahmedabad.sourceKey).not.toBe(bangalore.sourceKey);
    expect(ahmedabad.sourceKey).toBe("savex prt|2026-09-24|ahmedabad");
  });

  it("carries the venue and the participant list through to custom fields", () => {
    expect(amplify.venue).toBe("Park Hyatt");
    expect(amplify.participants).toBe("Akshay, Naibedya");
    expect(gulf.venue).toBeNull();
  });

  it("reads subitem amounts, responsibilities and contacts", () => {
    expect(amplify.subitems).toHaveLength(2);
    expect(amplify.subitems[0]).toMatchObject({
      title: "Photographer",
      responsible: "Chintan",
      contact: "Raj Studio 98765",
      amount: 12000,
      itemId: "1234567890",
    });
  });
});

describe("importChannelSheet (dry run)", () => {
  // The stub can only read. That is the point: a dry run has to plan the whole import without
  // writing anything, so a stray create would fail here with "not a function".
  const report = plan();

  it("resolves the configured type, subtype and partner for a row", async () => {
    const [amplify] = (await report).events;
    expect(amplify).toMatchObject({
      eventTypeId: "t-partner",
      subtypeId: "s-awards",
      partnerOrgId: "o-savex", // matched case-insensitively against the existing organisation
      partnerIsNew: false,
      skipReason: null,
    });
    expect((await report).missingConfig).toEqual([]);
  });

  it("plans one cost line per priced subitem and carries the remainder as its own line", async () => {
    const [amplify] = (await report).events;
    expect(amplify.costLines).toEqual([
      { description: "Photographer", estimated: 12000, vendor: "Raj Studio 98765", categoryId: null },
      { description: "Venue", estimated: 300000, vendor: "Park Hyatt", categoryId: "c-venue" },
      {
        description: "Unitemised balance (Channel Marketing Master Sheet budget column)",
        estimated: 10200,
        vendor: null,
        categoryId: null,
      },
    ]);
    // The event's lines add up to the sheet's own budget cell, which is what the team reports on.
    expect(amplify.costLines.reduce((n, l) => n + l.estimated, 0)).toBe(322200);
  });

  it("imports the whole budget as one line when no subitem carries an amount", async () => {
    const colombo = (await report).events[5];
    expect(colombo.costLines).toEqual([
      {
        description: "Event budget (Channel Marketing Master Sheet)",
        estimated: 266366.1,
        vendor: null,
        categoryId: null,
      },
    ]);
    // The subitems are still worth having: they are the checklist that was worked through.
    expect(colombo.tasks).toEqual([
      { title: "Anchor/Host – Third party", notes: "Responsible: Dilip" },
      { title: "PPT Preparation", notes: "Responsible: Sonali" },
    ]);
  });

  it("leaves an event with no budget and no subitems empty rather than inventing a line", async () => {
    const gulf = (await report).events[1];
    expect(gulf.costLines).toEqual([]);
    expect(gulf.tasks).toEqual([]);
  });

  it("files a partner the portal has never seen as a new PARTNER organisation", async () => {
    expect((await report).newPartners).toEqual([{ name: "Softshield", type: "PARTNER" }]);
  });

  it("holds back the row with no event type and reports it as an error", async () => {
    const { errors, events } = await report;
    expect(errors.map((e) => e.rowIndex)).toEqual([15]);
    expect(events[4].skipReason).toBe("Row has an error; nothing was created.");
  });

  it("totals only what it would actually create", async () => {
    const { totals, committed, batchId } = await report;
    expect(totals).toEqual({ events: 5, costLines: 6, tasks: 4, budget: 888566.1 });
    expect(committed).toBe(false);
    expect(batchId).toBeNull();
  });
});

describe("isDistributor", () => {
  const events = parseChannelGrid(grid()).items.map(mapChannelItem);

  it("calls an organisation a distributor when the sheet runs distributor-led events with it", () => {
    expect(isDistributor(events, "Savex")).toBe(true);
    expect(isDistributor(events, "Softshield")).toBe(false);
  });
});
