import { describe, expect, it } from "vitest";
import { csvCell, csvDay, csvFile, csvRow } from "./csv";

describe("csvCell", () => {
  it("leaves plain text alone", () => {
    expect(csvCell("Partner meet")).toBe("Partner meet");
  });

  it("quotes a field containing a comma, so the row keeps its field count", () => {
    expect(csvCell("Gold partner meet, Ahmedabad")).toBe('"Gold partner meet, Ahmedabad"');
  });

  it("doubles embedded quotes", () => {
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
  });

  it("quotes a field containing a newline", () => {
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("renders null and undefined as empty", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  describe("formula injection", () => {
    it.each(["=SUM(A1:A9)", "+1+1", "-2+3", "@import", "\tcmd"])("defuses %j", (input) => {
      expect(csvCell(input)).toBe(`'${input}`);
    });

    it("still quotes a defused field that also needs quoting", () => {
      expect(csvCell("=A1,B2")).toBe("\"'=A1,B2\"");
    });

    it("leaves an equals sign that is not at the start", () => {
      expect(csvCell("E=mc2")).toBe("E=mc2");
    });
  });

  describe("numbers", () => {
    it("writes a number bare, so the column can be summed", () => {
      expect(csvCell(250000)).toBe("250000");
    });

    // The reason numbers skip the formula guard: `-500` must stay a number.
    it("keeps a negative amount numeric rather than defusing it", () => {
      expect(csvCell(-250000)).toBe("-250000");
    });

    it("keeps zero rather than treating it as empty", () => {
      expect(csvCell(0)).toBe("0");
    });

    it("writes a non-finite number as empty instead of NaN", () => {
      expect(csvCell(Number.NaN)).toBe("");
      expect(csvCell(Number.POSITIVE_INFINITY)).toBe("");
    });
  });
});

describe("csvRow", () => {
  it("joins escaped fields with commas", () => {
    expect(csvRow(["EF-2026-0001", "Meet, Delhi", 500, null])).toBe('EF-2026-0001,"Meet, Delhi",500,');
  });
});

describe("csvDay", () => {
  it("writes yyyy-mm-dd", () => {
    expect(csvDay(new Date("2026-12-09T00:00:00.000Z"))).toBe("2026-12-09");
  });

  it("exports the day the portal shows, not the UTC one", () => {
    // An event proposed for 10 December is stored as IST midnight. Read in UTC
    // it is still 9 December, and Finance would open a file whose dates are all
    // one day behind the screen they exported it from.
    expect(csvDay(new Date("2026-12-09T18:30:00.000Z"))).toBe("2026-12-10");
  });

  it("writes empty for no date", () => {
    expect(csvDay(null)).toBe("");
  });
});

describe("csvFile", () => {
  const header = ["Event ID", "Event name", "Estimated (INR)"];

  it("starts with a BOM so Windows Excel reads it as UTF-8", () => {
    expect(csvFile(header, [])).toMatch(/^﻿/);
  });

  it("separates rows with CRLF", () => {
    expect(csvFile(header, [["EF-1", "A", 1]])).toBe("﻿Event ID,Event name,Estimated (INR)\r\nEF-1,A,1");
  });

  // The defect this helper exists to prevent: a 12-column header over 24-field
  // rows, which is what formatting amounts into the CSV produced.
  it("gives every row the same field count as the header", () => {
    const rows = [
      ["EF-2026-0001", "Gold partner meet, Ahmedabad", 250000],
      ["EF-2026-0002", 'A "quoted" name', -500],
      ["EF-2026-0003", "=cmd", 0],
    ];
    const lines = csvFile(header, rows).replace(/^﻿/, "").split("\r\n");
    for (const line of lines) {
      expect(splitCsv(line)).toHaveLength(header.length);
    }
  });
});

/** A minimal RFC 4180 reader, so the field-count test parses rather than assumes. */
function splitCsv(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      fields.push(field);
      field = "";
    } else field += char;
  }
  fields.push(field);
  return fields;
}
