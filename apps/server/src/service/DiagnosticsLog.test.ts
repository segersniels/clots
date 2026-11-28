import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendDiagnostics, diagnosticsLogPath } from "./DiagnosticsLog.ts";

test("a full diagnostics log moves to one older file and never to more", () => {
  const home = mkdtempSync(join(tmpdir(), "clots-diagnostics-"));

  for (let report = 1; report <= 7; report++) {
    appendDiagnostics(home, { report }, 30);
  }

  expect(readdirSync(join(home, "logs")).toSorted()).toEqual([
    "diagnostics.log",
    "diagnostics.log.1",
  ]);
  expect(readFileSync(diagnosticsLogPath(home), "utf8")).toBe('{"report":7}\n');
  expect(readFileSync(`${diagnosticsLogPath(home)}.1`, "utf8")).toBe(
    '{"report":4}\n{"report":5}\n{"report":6}\n',
  );
});
