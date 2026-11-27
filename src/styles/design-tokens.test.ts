import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guards the design-token contract.
 *
 * Tailwind v4 silently drops a utility whose colour is not declared in the
 * `@theme inline` block of globals.css — `bg-brand` compiles to nothing and the
 * element renders transparent. That is how the lifecycle stepper, the approval
 * CTA and the whole import wizard shipped invisible. These tests fail the build
 * instead of letting it happen again.
 */

const SRC = fileURLToPath(new URL("..", import.meta.url));
const GLOBALS = join(SRC, "app", "globals.css");

/** Utility prefixes that take a colour from the theme. */
const COLOUR_UTILITIES = [
  "bg", "text", "border", "ring", "fill", "stroke", "outline", "shadow",
  "from", "via", "to", "divide", "decoration", "accent", "caret", "placeholder",
];

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, found);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts")) found.push(full);
  }
  return found;
}

/** Colour names declared as `--color-<name>` in the `@theme inline` block. */
function declaredColours(): Set<string> {
  const css = readFileSync(GLOBALS, "utf8");
  const theme = css.slice(css.indexOf("@theme inline"));
  return new Set([...theme.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((m) => m[1]));
}

/** First segment of each declared colour, e.g. `brand` from `brand-coral`. */
function declaredFamilies(colours: Set<string>): Set<string> {
  return new Set([...colours].map((name) => name.split("-")[0]));
}

const colours = declaredColours();
const families = declaredFamilies(colours);
const files = sourceFiles(SRC);

describe("design tokens", () => {
  it("declares the brand colours the token file defines", () => {
    expect(colours.has("brand-coral")).toBe(true);
    expect(colours.has("brand-ink")).toBe(true);
    // There is deliberately no bare `--color-brand`; `brand` alone must stay invalid.
    expect(colours.has("brand")).toBe(false);
  });

  it("only uses colour utilities that resolve to a declared token", () => {
    const utility = new RegExp(
      String.raw`(?:^|[\s"'\`{(\[])((?:[a-z][a-z0-9-]*(?:\[[^\]\s]*\])?:)*(?:${COLOUR_UTILITIES.join("|")})-([a-z][a-z0-9-]*))(?:\/\d+)?(?=$|[\s"'\`}),\]])`,
      "gm",
    );
    const offences: string[] = [];

    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(utility)) {
        const name = match[2];
        const family = name.split("-")[0];
        // Only judge names in a family this project declares; Tailwind's own
        // palette and the non-colour utilities (text-sm, border-2) are not ours.
        if (!families.has(family)) continue;
        if (colours.has(name)) continue;
        const line = text.slice(0, match.index).split("\n").length;
        offences.push(`${file.slice(SRC.length).replace(/\\/g, "/")}:${line}  ${match[1]}`);
      }
    }

    expect(offences, `undeclared colour tokens:\n${offences.join("\n")}`).toEqual([]);
  });

  it("never references a --color-* custom property that is not declared", () => {
    const offences: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/--color-([a-z0-9-]+)/g)) {
        if (colours.has(match[1])) continue;
        const line = text.slice(0, match.index).split("\n").length;
        offences.push(`${file.slice(SRC.length).replace(/\\/g, "/")}:${line}  --color-${match[1]}`);
      }
    }
    expect(offences, `undeclared custom properties:\n${offences.join("\n")}`).toEqual([]);
  });
});
