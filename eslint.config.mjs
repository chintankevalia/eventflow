import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", ".data/**", "storage/**"],
  },
  {
    // The dashboard query engine builds SQL from saved, user-authored widget specs. Its whole
    // safety argument is that identifiers and keywords come only from `Prisma.sql` template
    // literals written at module scope, while every value from a spec is interpolated and so
    // becomes a bound parameter. `Prisma.raw` is the one call that can bypass that, so it may
    // only ever be handed a string literal. A test also asserts no registry fragment carries
    // parameters of its own; this rule stops the mistake being written in the first place.
    files: ["src/server/dashboards/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name='raw'][callee.object.name='Prisma'] > :first-child:not(Literal)",
          message:
            "Prisma.raw must be given a string literal. Anything derived from a widget spec has to be interpolated into Prisma.sql so it becomes a bound parameter.",
        },
      ],
    },
  },
];

export default eslintConfig;
