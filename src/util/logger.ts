import * as core from "@actions/core";

// Thin wrapper around @actions/core so non-Actions contexts (tests,
// local runs) can still use the same API. When GITHUB_ACTIONS isn't
// set, the core functions degrade gracefully to console output.
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
  group<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

export const actionsLogger: Logger = {
  info: (m) => core.info(m),
  warn: (m) => core.warning(m),
  error: (m) => core.error(m),
  debug: (m) => core.debug(m),
  group: (name, fn) => core.group(name, fn),
};

export function silentLogger(): Logger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    group: async (_name, fn) => fn(),
  };
}
