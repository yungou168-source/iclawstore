import { Globe } from "lucide-react";
import { LOCALES, type Locale } from "../lib/i18n/config";
import { useLocale } from "../lib/i18n/context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Button } from "./ui/button";

export function LanguageSwitcher() {
  const { locale, setLocale } = useLocale();
  const currentLocale = LOCALES.find((l) => l.value === locale) ?? LOCALES[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="language-switcher-button"
          aria-label="切换语言"
          title="切换语言"
        >
          <Globe size={16} aria-hidden="true" />
          <span className="language-switcher-label">{currentLocale.label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LOCALES.map((l) => (
          <DropdownMenuItem
            key={l.value}
            onClick={() => setLocale(l.value as Locale)}
            className={locale === l.value ? "language-active" : ""}
          >
            <span className="language-flag">{l.flag}</span>
            <span>{l.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
