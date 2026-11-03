import pt from "./messages/pt.json"
import en from "./messages/en.json"
import fr from "./messages/fr.json"
import es from "./messages/es.json"

/** `pt` always means Brazilian Portuguese in HTC View. */
export const LOCALES = ["pt", "en", "fr", "es"] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = "pt"
export const LOCALE_COOKIE = "htc.locale"
export const LANGUAGE_NAMES: Record<Locale, string> = {
  pt: "Português",
  en: "English",
  fr: "Français",
  es: "Español",
}
export const INTL_LOCALES: Record<Locale, string> = {
  pt: "pt-BR",
  en: "en-US",
  fr: "fr-FR",
  es: "es-ES",
}

export function normalizeLocale(value: unknown): Locale {
  if (typeof value !== "string") return DEFAULT_LOCALE
  const language = value.trim().toLowerCase().split(/[-_]/)[0]
  return LOCALES.find((locale) => locale === language) ?? DEFAULT_LOCALE
}

const catalogs: Record<Locale, Record<string, string>> = { pt, en, fr, es }
export type MessageValues = Record<string, unknown>

function lookup(locale: Locale, key: string): string | undefined {
  const catalog = catalogs[locale]
  return Object.prototype.hasOwnProperty.call(catalog, key)
    ? catalog[key]
    : undefined
}

// Strings assembled by existing status/error helpers are matched against known
// message templates. Values are inserted as text, never interpreted as markup.
const templates = Object.keys(pt)
  .filter(
    (key) =>
      /\{\d+\}/.test(key) && /[a-zÀ-ž]{3}/i.test(key.replace(/\{\d+\}/g, ""))
  )
  .sort(
    (a, b) =>
      b.replace(/\{\d+\}/g, "").length - a.replace(/\{\d+\}/g, "").length
  )
  .map((key) => {
    const names: string[] = []
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const pattern = escaped.replace(
      /\\\{(\d+)\\\}/g,
      (_token, name: string) => {
        names.push(name)
        return "(.*?)"
      }
    )
    return { key, names, pattern: new RegExp(`^${pattern}$`, "u") }
  })

/** Translate display text only; identifiers, API payloads and user input stay intact. */
export function translate<T>(
  locale: Locale,
  message: T,
  values?: MessageValues
): T {
  if (typeof message !== "string") return message
  const key = message.trim()
  if (!key) return message
  let translated = lookup(locale, key) ?? lookup(DEFAULT_LOCALE, key)
  if (translated === undefined && !values) {
    for (const template of templates) {
      const match = template.pattern.exec(key)
      if (match) {
        translated = lookup(locale, template.key) ?? template.key
        values = Object.fromEntries(
          template.names.map((name, i) => [name, match[i + 1]])
        )
        break
      }
    }
  }
  translated ??= key
  const result = values
    ? translated.replace(/\{(\w+)\}/g, (token, name: string) =>
        Object.prototype.hasOwnProperty.call(values, name)
          ? String(values[name] ?? "")
          : token
      )
    : translated
  return (message.slice(0, message.length - message.trimStart().length) +
    result +
    message.slice(message.trimEnd().length)) as T
}

export function createTranslator(locale: Locale) {
  return <T>(message: T, values?: MessageValues): T =>
    translate(locale, message, values)
}
