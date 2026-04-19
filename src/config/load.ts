import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { Config } from "./schema.ts";

export interface LoadSuccess {
  ok: true;
  path: string;
  config: Config;
}

export interface LoadFailure {
  ok: false;
  path: string;
  errors: ConfigError[];
}

export type LoadResult = LoadSuccess | LoadFailure;

export interface ConfigError {
  path: string;
  message: string;
}

export async function loadConfig(filePath: string): Promise<LoadResult> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      path: filePath,
      errors: [{ path: "", message: `cannot read file: ${msg}` }],
    };
  }
  return parseConfig(raw, filePath);
}

export function parseConfig(source: string, filePath = "<inline>"): LoadResult {
  let parsed: unknown;
  try {
    parsed = parseYaml(source);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      path: filePath,
      errors: [{ path: "", message: `invalid YAML: ${msg}` }],
    };
  }

  if (parsed === null || parsed === undefined) {
    return {
      ok: false,
      path: filePath,
      errors: [{ path: "", message: "config file is empty" }],
    };
  }

  const result = Config.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      path: filePath,
      errors: formatZodError(result.error),
    };
  }

  return { ok: true, path: filePath, config: result.data };
}

function formatZodError(error: z.ZodError): ConfigError[] {
  return error.issues.map((issue) => ({
    path: issue.path.length ? issue.path.join(".") : "",
    message: issue.message,
  }));
}

export function formatConfigErrors(result: LoadFailure): string {
  const lines = [`Invalid configuration in ${result.path}:`];
  for (const err of result.errors) {
    const where = err.path ? ` at ${err.path}` : "";
    lines.push(`  \u2022${where} \u2014 ${err.message}`);
  }
  return lines.join("\n");
}
