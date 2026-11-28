import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readRemoteAccessChoice, writeRemoteAccessChoice } from "./Sidecar.ts";

const newHome = () => join(mkdtempSync(join(tmpdir(), "clots-sidecar-")), "home");

test("a server where the operator never chose has no remote access choice", () => {
  expect(readRemoteAccessChoice(newHome())).toBeUndefined();
});

test("the remote access choice survives a restart, and the last choice wins", () => {
  const home = newHome();

  writeRemoteAccessChoice(home, true);
  expect(readRemoteAccessChoice(home)).toBe(true);

  writeRemoteAccessChoice(home, false);
  expect(readRemoteAccessChoice(home)).toBe(false);
});
