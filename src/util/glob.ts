// Tiny glob matcher for label ignore_patterns and similar.
//
// Semantics:
// - `*` matches any sequence of characters (including slashes).
// - Everything else is matched literally, case-sensitive.
//
// Intentionally minimal: patterns like `renovate/*` or `dependencies`
// cover the plan's stated examples without pulling in picomatch and
// its 20-odd transitive edge cases.
export function compileGlob(pattern: string): RegExp {
  let src = "^";
  for (const ch of pattern) {
    if (ch === "*") {
      src += ".*";
    } else if (/[.+?^${}()|[\]\\]/.test(ch)) {
      src += "\\" + ch;
    } else {
      src += ch;
    }
  }
  src += "$";
  return new RegExp(src);
}

export function matchesAny(value: string, patterns: string[]): boolean {
  for (const p of patterns) {
    if (compileGlob(p).test(value)) return true;
  }
  return false;
}
