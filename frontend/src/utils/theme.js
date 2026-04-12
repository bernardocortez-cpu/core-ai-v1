export function applyTheme(theme) {
  const root = document.documentElement;

  if (theme === "light") {
    root.setAttribute("data-theme", "light");
  } else if (theme === "dark") {
    root.removeAttribute("data-theme");
  } else {
    // system
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches;

    if (prefersDark) {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", "light");
    }
  }
}
