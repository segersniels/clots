/** Keeps the `dark` class, which the shadcn theme reads, in step with the system setting. */
export const followSystemColorScheme = () => {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => document.documentElement.classList.toggle("dark", prefersDark.matches);

  apply();
  prefersDark.addEventListener("change", apply);
};
