export type Locale = "zh-CN" | "en";

export const LOCALES: { value: Locale; label: string; flag: string }[] = [
  { value: "zh-CN", label: "简体中文", flag: "🇨🇳" },
  { value: "en", label: "English", flag: "🇺🇸" },
];

export const DEFAULT_LOCALE: Locale = "zh-CN";

const LOCALE_COOKIE_KEY = "clawhub-locale";
const LOCALE_STORAGE_KEY = "clawhub-locale";

export function getLocaleFromStorage(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === "zh-CN" || stored === "en") return stored;
  } catch {}
  return DEFAULT_LOCALE;
}

export function setLocaleToStorage(locale: Locale): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    document.cookie = `${LOCALE_COOKIE_KEY}=${locale};path=/;max-age=31536000`;
  } catch {}
}
