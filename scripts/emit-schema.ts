// Emit JSON Schema from the Zod source of truth.
// Invoked via `pnpm emit-schema`. CI verifies the committed file is in
// sync with the schema source after every push.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Config, SCHEMA_VERSION } from "../src/config/schema.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outPath = resolve(repoRoot, "schema", `v${SCHEMA_VERSION}.json`);

const schemaUrl = `https://raw.githubusercontent.com/danburtenshaw/repo-manifest/main/schema/v${SCHEMA_VERSION}.json`;

const generated = z.toJSONSchema(Config, { target: "draft-7" });

// Zod v4 emits every `.default()`-ed field as both `default: X` AND
// `required: [field]`. LSP tooling then warns users about a "missing"
// field that the parser will happily default for them. Post-process
// the output so defaulted properties are dropped from their parent's
// `required` — the runtime Zod schema stays the source of truth; this
// only keeps the advertised JSON Schema honest.
const normalized = stripDefaultedRequired(generated);

const schema = {
  ...(isJsonObject(normalized) ? normalized : generated),
  $id: schemaUrl,
  title: `repo-manifest v${SCHEMA_VERSION}`,
  description: "Declarative GitHub repository settings managed by repo-manifest.",
};

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(schema, null, 2) + "\n", "utf8");
console.log(`wrote ${outPath}`);

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripDefaultedRequired(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripDefaultedRequired);
  if (!isJsonObject(node)) return node;

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(node)) {
    out[key] = stripDefaultedRequired(node[key]);
  }

  if (out.type === "object" && Array.isArray(out.required) && isJsonObject(out.properties)) {
    const props = out.properties;
    const pruned = out.required.filter((key) => {
      if (typeof key !== "string") return true;
      const propSchema = props[key];
      return !isJsonObject(propSchema) || !("default" in propSchema);
    });
    if (pruned.length > 0) {
      out.required = pruned;
    } else {
      delete out.required;
    }
  }

  return out;
}
