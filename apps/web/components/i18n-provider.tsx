"use client"

import { createContext, useContext, useEffect, useMemo, useState } from "react"
import {
  createTranslator,
  DEFAULT_LOCALE,
  INTL_LOCALES,
  LANGUAGE_NAMES,
  LOCALE_COOKIE,
  LOCALES,
  normalizeLocale,
  type Locale,
} from "@/lib/i18n"

interface I18nValue {
  locale: Locale
  intlLocale: string
  t: ReturnType<typeof createTranslator>
  setLocale: (locale: Locale) => void
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({
  children,
  initialLocale = DEFAULT_LOCALE,
}: {
  children: React.ReactNode
  initialLocale?: Locale
}) {
  const [locale, updateLocale] = useState(initialLocale)
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])
  const value = useMemo(
    () => ({
      locale,
      intlLocale: INTL_LOCALES[locale],
      t: createTranslator(locale),
      setLocale: (next: Locale) => {
        const language = normalizeLocale(next)
        document.cookie = `${LOCALE_COOKIE}=${language}; Path=/; Max-Age=31536000; SameSite=Lax`
        updateLocale(language)
      },
    }),
    [locale]
  )
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const value = useContext(I18nContext)
  if (!value) throw new Error("useI18n requires I18nProvider")
  return value
}

/** Also lets server-rendered pages display text in the active client language. */
export function LocalizedText({ children }: { children: React.ReactNode }) {
  const { t } = useI18n()
  return <>{t(children)}</>
}

export function LanguageSelector() {
  const { locale, setLocale, t } = useI18n()
  return (
    <label className="mb-3 flex flex-col gap-1 text-[10px] text-muted-foreground">
      {t("Idioma")}
      <select
        aria-label={t("Idioma")}
        value={locale}
        onChange={(event) => setLocale(normalizeLocale(event.target.value))}
        className="h-8 w-full rounded-sm border border-input bg-background px-2 text-xs text-foreground"
      >
        {LOCALES.map((language) => (
          <option key={language} value={language} lang={language}>
            {LANGUAGE_NAMES[language]}
          </option>
        ))}
      </select>
    </label>
  )
}
