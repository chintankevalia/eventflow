/**
 * The portal's regions, and how every older way of writing one becomes one of them.
 *
 * The team works to nine regions — four in India plus ME, SAARC, Africa, APAC and Europe — but the
 * first version of the portal (and the Monday board it was seeded from) only knew four: India, APAC,
 * "ME & Europe" and "Africa & SAARC". Three of those four are really two or more regions glued
 * together, so they cannot be converted by label alone; the *city* decides. Pure — no database, no
 * `server-only` — so the importers and the one-off remap script share exactly one definition.
 */

export const REGIONS: { value: string; label: string }[] = [
  { value: "ind_north", label: "Ind-North" },
  { value: "ind_west", label: "Ind-West" },
  { value: "ind_east", label: "Ind-East" },
  { value: "ind_south", label: "Ind-South" },
  { value: "me", label: "ME" },
  { value: "saarc", label: "SAARC" },
  { value: "africa", label: "Africa" },
  { value: "apac", label: "APAC" },
  { value: "europe", label: "Europe" },
];

/** Lookup values the portal used before the nine regions — retired once nothing refers to them. */
export const LEGACY_REGION_VALUES = ["india", "me_europe", "africa_saarc", "north", "south", "east", "west", "international"];

const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");

/** A label that already names exactly one region, in any of the spellings the sheets use. */
const DIRECT: Record<string, string> = {
  "ind north": "ind_north",
  "india north": "ind_north",
  "ind west": "ind_west",
  "india west": "ind_west",
  "ind east": "ind_east",
  "india east": "ind_east",
  "ind south": "ind_south",
  "india south": "ind_south",
  me: "me",
  "middle east": "me",
  saarc: "saarc",
  africa: "africa",
  apac: "apac",
  sea: "apac",
  europe: "europe",
};

/** A label that spans several regions: the city has to choose. */
const GROUPS = new Set(["india", "me & europe", "me europe", "africa & saarc", "africa saarc"]);

const cityKey = (city: string | null | undefined) =>
  norm((city ?? "").replace(/\(.*?\)/g, " ")) // "Pune (Lonavala)" → "pune"
    .trim();

const INDIA: Record<string, string> = Object.fromEntries([
  ...[
    "delhi", "new delhi", "noida", "gurgaon", "gurugram", "chandigarh", "dehradun", "lucknow", "jaipur",
    "neemrana", "amritsar", "ludhiana",
  ].map((c) => [c, "ind_north"]),
  ...[
    "ahmedabad", "mumbai", "pune", "lonavala", "mahabaleshwar", "goa", "surat", "bhopal", "nagpur", "vadodara",
    "indore", "rajkot", "nashik",
  ].map((c) => [c, "ind_west"]),
  ...["kolkata", "guwahati", "bhubaneswar", "bhubaneshwar", "patna", "ranchi", "siliguri"].map((c) => [c, "ind_east"]),
  ...[
    "bangalore", "banglore", "bengaluru", "chennai", "coimbatore", "hyderabad", "hydrabad", "hydarabad",
    "secunderabad", "kochi", "cochin", "madurai", "trivandrum", "thiruvananthapuram", "vizag", "visakhapatnam",
    "mysore", "mangalore",
  ].map((c) => [c, "ind_south"]),
]);

const SAARC = new Set(["nepal", "sri lanka", "sri laka", "maldives", "bangladesh", "bhutan", "pakistan", "afghanistan", "kathmandu", "colombo", "dhaka", "karachi", "lahore", "islamabad", "rawalpindi", "peshawar", "kabul", "thimphu", "male", "malé", "chittagong", "chattogram", "kandy"]);
const EUROPE = new Set(["poland", "turkey", "cyprus", "uk", "united kingdom", "germany", "france", "netherlands", "spain", "italy", "london"]);
const ME = new Set([
  "bahrain", "kuwait", "downtown kuwait", "dubai", "uae", "qatar", "doha", "saudi arabia", "saudi arebia", "saudi arab",
  "riyadh", "jeddah", "oman", "muscat", "abu dhabi", "jordan", "iraq", "lebanon",
]);

/**
 * The region for a label as written (a sheet cell, or an old lookup value) and the city beside it.
 * `null` means "no single region" — a webinar open to everyone ("Global"), a "Pan India" activity,
 * or a city we cannot place — and is stored as no region rather than a guess.
 */
export function resolveRegion(label: string | null | undefined, city?: string | null): string | null {
  const key = norm(label ?? "");
  if (!key) return null;
  const direct = DIRECT[key];
  if (direct) return direct;
  if (REGIONS.some((r) => r.value === key.replace(/ /g, "_"))) return key.replace(/ /g, "_");

  if (GROUPS.has(key) || key === "india" || key === "me europe" || key === "africa saarc") {
    const c = cityKey(city);
    if (SAARC.has(c)) return "saarc";
    if (key === "india") return INDIA[c] ?? null;
    if (key.startsWith("me")) return EUROPE.has(c) ? "europe" : ME.has(c) ? "me" : null;
    // "Africa & SAARC": SAARC is a short, closed list of countries, so anything else is Africa.
    return c ? "africa" : null;
  }
  return null;
}
