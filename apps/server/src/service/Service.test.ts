import { expect, test } from "bun:test";

import { launchdPlist, systemdUnit } from "./Service.ts";

const command = ["/usr/bin/bun", "/opt/clots/cli.ts", "serve"];
const environment = { PATH: "/usr/bin:/opt/a&b" };

test("the systemd unit restarts the server and keeps the PATH of the operator", () => {
  const unit = systemdUnit(command, environment);

  expect(unit).toContain("ExecStart=/usr/bin/bun /opt/clots/cli.ts serve");
  expect(unit).toContain('Environment="PATH=/usr/bin:/opt/a&b"');
  expect(unit).toContain("Restart=always");
});

test("the launchd plist escapes XML characters in values", () => {
  expect(launchdPlist(command, environment)).toContain("<string>/usr/bin:/opt/a&amp;b</string>");
});
