import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { DEFAULT_LOCALE, getLocaleFromStorage, setLocaleToStorage, type Locale } from "./config";
import { getTranslations, type TranslationKey } from "./translations";

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    setLocaleState(getLocaleFromStorage());
  }, []);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    setLocaleToStorage(newLocale);
  }, []);

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>): string => {
      const dict = getTranslations(locale) as Record<TranslationKey, string>;
      const template = dict[key] ?? key;
      return vars
        ? template.replace(/\{(\w+)\}/g, (_: string, name: string) =>
            String(vars[name] ?? `{${name}}`),
          )
        : template;
    },
    [locale],
  );

  return <I18nContext.Provider value={{ locale, setLocale, t }}>{children}</I18nContext.Provider>;
}

export function useLocale() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useLocale must be used within I18nProvider");
  }
  return ctx;
}
