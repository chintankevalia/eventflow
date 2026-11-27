import { describe, expect, it } from "vitest";
import { REGIONS, resolveRegion } from "./regions";

describe("resolveRegion", () => {
  it("reads every way the sheets write a single-region label", () => {
    expect(resolveRegion("Ind - East")).toBe("ind_east");
    expect(resolveRegion("Ind-North")).toBe("ind_north");
    expect(resolveRegion("ME")).toBe("me");
    expect(resolveRegion("SEA")).toBe("apac");
    expect(resolveRegion("APAC")).toBe("apac");
    expect(resolveRegion("Africa")).toBe("africa");
  });

  it("passes an already-converted value straight through, so a re-run changes nothing", () => {
    for (const r of REGIONS) expect(resolveRegion(r.value, "Anywhere")).toBe(r.value);
  });

  it("splits the old catch-all India by the city's part of the country", () => {
    expect(resolveRegion("INDIA", "Delhi")).toBe("ind_north");
    expect(resolveRegion("india", "Pune (Lonavala)")).toBe("ind_west");
    expect(resolveRegion("india", "Mumbai (Imagica)")).toBe("ind_west");
    expect(resolveRegion("india", "Kolkata")).toBe("ind_east");
    expect(resolveRegion("india", "Banglore")).toBe("ind_south"); // the sheet's own misspelling
  });

  it("does not leave Nepal, filed under India in the sheet, in India", () => {
    expect(resolveRegion("india", "Nepal")).toBe("saarc");
  });

  it("splits ME & Europe, and Africa & SAARC, by city", () => {
    expect(resolveRegion("ME & Europe", "Dubai")).toBe("me");
    expect(resolveRegion("me_europe", "Poland")).toBe("europe");
    expect(resolveRegion("ME & Europe", "Turkey (Cyprus)")).toBe("europe");
    expect(resolveRegion("AFRICA & SAARC", "Sri Lanka")).toBe("saarc");
    for (const city of ["Karachi", "Lahore", "Islamabad", "Kabul", "Thimphu", "Malé"]) {
      expect(resolveRegion("Africa & SAARC", city)).toBe("saarc");
    }
    expect(resolveRegion("africa_saarc", "Maldives (Malaysia)")).toBe("saarc");
    expect(resolveRegion("AFRICA & SAARC", "Nairobi")).toBe("africa");
  });

  it("stores no region for a label that spans regions or a city it cannot place", () => {
    expect(resolveRegion("Global", "Global")).toBeNull();
    expect(resolveRegion("Pan Ind")).toBeNull();
    expect(resolveRegion("india", "Atlantis")).toBeNull();
    expect(resolveRegion("ME & Europe", "Atlantis")).toBeNull();
    expect(resolveRegion("")).toBeNull();
    expect(resolveRegion(null)).toBeNull();
  });
});
