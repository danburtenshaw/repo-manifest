import type { UserConfig } from "@commitlint/types";

const config: UserConfig = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      ["feat", "fix", "perf", "refactor", "test", "docs", "chore", "deps", "ci", "build"],
    ],
    "scope-enum": [
      2,
      "always",
      [
        "labels",
        "rulesets",
        "metadata",
        "features",
        "merge",
        "security",
        "variables",
        "secrets",
        "core",
        "config",
        "ci",
        "deps",
        "docs",
      ],
    ],
    "header-max-length": [2, "always", 100],
  },
};

export default config;
