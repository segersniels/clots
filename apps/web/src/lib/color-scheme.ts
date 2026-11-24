/** The theme that the operator picks. `system` follows the system setting. */
export type Theme = "system" | "light" | "dark";

/** The storage key of the theme. Each device has its own. */
const THEME_KEY = "clots.theme";

const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");

/** Reads the stored theme. A missing value or a blocked storage gives the system setting. */
const readStoredTheme = (): Theme => {
  try {
    const stored = localStorage.getItem(THEME_KEY);

    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
};

let theme = readStoredTheme();

/** Gives the theme of this device. */
export const currentTheme = () => theme;

/** Sets the `dark` class, which the shadcn theme reads, from the theme and the system setting. */
const applyColorScheme = () =>
  document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && prefersDark.matches));

/** Keeps the `dark` class in step with the theme of this device and the system setting. */
export const followSystemColorScheme = () => {
  applyColorScheme();
  prefersDark.addEventListener("change", applyColorScheme);
};

/** Applies a theme at once and keeps it for the next start. A blocked storage only loses it at the next start. */
export const setTheme = (next: Theme) => {
  theme = next;
  applyColorScheme();

  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // The next start follows the system setting again.
  }
};
