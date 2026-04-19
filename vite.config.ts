import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    ignorePatterns: [".claude/**", "dist/**", "coverage/**", "schema/**", "test/fixtures/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    ignorePatterns: [
      ".claude/**",
      "dist/**",
      "coverage/**",
      "schema/**",
      "test/fixtures/**",
      "pnpm-lock.yaml",
      "CHANGELOG.md",
    ],
  },
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
    },
  },
});
