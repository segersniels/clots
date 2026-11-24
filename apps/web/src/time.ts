const DAY_MS = 24 * 60 * 60 * 1000;

const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const weekday = new Intl.DateTimeFormat(undefined, { weekday: "long" });
const shortWeekday = new Intl.DateTimeFormat(undefined, { weekday: "short" });
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

/** Formats the day of a coming time: "Today", "Tomorrow", then a short weekday such as "Mon". */
export const formatNextDay = (time: number, now = Date.now()) => {
  // Rounding keeps a day that daylight saving time makes 23 or 25 hours long at one day.
  const days = Math.round((new Date(time).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / DAY_MS);

  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";

  return shortWeekday.format(time);
};

/** Tells when a usage limit resets: "Resets in 3 h 10 min" within six hours, then "Resets today at 7:00 PM" or "Resets Mon at 7:00 PM". */
export const formatReset = (time: number, now = Date.now()) => {
  const minutes = Math.max(1, Math.round((time - now) / 60_000));

  if (minutes < 6 * 60) {
    const parts = [Math.floor(minutes / 60) > 0 ? `${Math.floor(minutes / 60)} h` : "", minutes % 60 > 0 ? `${minutes % 60} min` : ""];

    return `Resets in ${parts.filter((part) => part !== "").join(" ")}`;
  }

  const day = formatNextDay(time, now);

  return `Resets ${day === "Today" || day === "Tomorrow" ? day.toLowerCase() : day} at ${clock.format(time)}`;
};
