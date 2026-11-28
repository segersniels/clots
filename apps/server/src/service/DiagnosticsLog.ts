import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

/** The size at which the diagnostics log moves to its one older file. The two files together stay under twice this size. */
export const DIAGNOSTICS_LOG_LIMIT = 5_000_000;

/** Builds the path of the diagnostics log, which holds one JSON report per line. */
export const diagnosticsLogPath = (home: string) => join(home, "logs", "diagnostics.log");

/**
 * Adds one report to the diagnostics log. A full log replaces the older file `diagnostics.log.1`,
 * so the logs never grow past two files.
 */
export const appendDiagnostics = (home: string, report: object, limit = DIAGNOSTICS_LOG_LIMIT) => {
  const path = diagnosticsLogPath(home);
  mkdirSync(join(home, "logs"), { recursive: true });

  const size = statSync(path, { throwIfNoEntry: false })?.size ?? 0;
  if (size >= limit) {
    renameSync(path, `${path}.1`);
  }

  appendFileSync(path, `${JSON.stringify(report)}\n`);
};
