import type { Theme } from "@/types/types";

const media = window.matchMedia("(prefers-color-scheme: dark)");
let current: Theme = "system";

const apply = () =>
  document.documentElement.classList.toggle("dark", current === "dark" || (current === "system" && media.matches));

// system の時は、popup を開いている間の OS の切り替えにも追従する
media.addEventListener("change", apply);

export const setTheme = (t: Theme) => {
  current = t;
  apply();
};
