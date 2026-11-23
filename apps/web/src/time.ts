const DAY_MS = 24 * 60 * 60 * 1000;

const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const weekday = new Intl.DateTimeFormat(undefined, { weekday: "long" });
const date = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/** Formats a time of day, for example "7:34 PM". */
export const formatClock = (time: number) => clock.format(time);

/** Formats a length of time, for example "3m 24s" or "12s". */
export const formatDuration = (milliseconds: number) => {
  const seconds = Math.max(1, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;

  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

/** Formats when something happened, as a chat list does: a time today, then "Yesterday", a weekday, a date. */
export const formatRecent = (time: number, now = Date.now()) => {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);

  if (time >= startOfToday) return clock.format(time);
  if (time >= startOfToday - DAY_MS) return "Yesterday";
  if (time >= startOfToday - 6 * DAY_MS) return weekday.format(time);

  return date.format(time);
};
