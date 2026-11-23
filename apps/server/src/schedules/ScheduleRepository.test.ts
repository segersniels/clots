import { expect, test } from "bun:test";

import { nextRunAt } from "./ScheduleRepository.ts";

test("the next run of a daily routine is within one day", () => {
  const now = Date.now();
  const next = nextRunAt("0 8 * * *", now);

  expect(next).toBeGreaterThan(now);
  expect(next! - now).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  expect(new Date(next!).getHours()).toBe(8);
});

test("a cron expression that does not parse has no next run", () => {
  expect(nextRunAt("every morning", Date.now())).toBeUndefined();
});
