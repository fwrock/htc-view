import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import ts from "typescript"
import { registerHooks } from "node:module"

// The application bundles JSON catalogs; expose the same imports to Node's TS runner.
registerHooks({
  load(url, context, next) {
    if (url.includes("/lib/i18n/messages/") && url.endsWith(".json")) {
      return {
        format: "module",
        source: `export default ${readFileSync(new URL(url), "utf8")}`,
        shortCircuit: true,
      }
    }
    return next(url, context)
  },
})
const { LOCALES, DEFAULT_LOCALE, INTL_LOCALES, normalizeLocale, translate } =
  await import("../lib/i18n/index.ts")
const catalogs = Object.fromEntries(
  LOCALES.map((locale) => [
    locale,
    JSON.parse(
      readFileSync(
        new URL(`../lib/i18n/messages/${locale}.json`, import.meta.url),
        "utf8"
      )
    ),
  ])
)

test("Brazilian Portuguese defaults to the canonical pt identifier", () => {
  assert.deepEqual(LOCALES, ["pt", "en", "fr", "es"])
  assert.equal(DEFAULT_LOCALE, "pt")
  assert.equal(INTL_LOCALES.pt, "pt-BR")
  for (const input of [undefined, null, "", "de", "pt-BR", "pt_br", "PT"]) {
    assert.equal(normalizeLocale(input), "pt")
  }
  assert.equal(normalizeLocale("fr-FR"), "fr")
  assert.equal(normalizeLocale("es"), "es")
})

test("every catalog has the same keys and preserves interpolation placeholders", () => {
  const placeholders = (text) =>
    [...new Set(text.match(/\{\w+\}/g) ?? [])].sort()
  const keys = Object.keys(catalogs.pt).sort()
  for (const locale of LOCALES) {
    assert.deepEqual(Object.keys(catalogs[locale]).sort(), keys, locale)
    for (const [key, value] of Object.entries(catalogs[locale])) {
      assert.equal(typeof value, "string", `${locale}: ${key}`)
      assert.ok(value.length > 0, `${locale}: ${key}`)
      assert.deepEqual(
        placeholders(value),
        placeholders(key),
        `${locale}: ${key}`
      )
    }
  }
})

test("navigation and source English labels are translated for the default language", () => {
  assert.equal(translate("pt", "Simulator"), "Simulador")
  assert.equal(translate("pt", "Navigation"), "Navegação")
  assert.equal(translate("en", "Executar simulação"), "Run simulation")
  assert.equal(translate("fr", "Executar simulação"), "Lancer une simulation")
  assert.equal(translate("es", "Executar simulação"), "Ejecutar simulación")
})

test("interpolation supports explicit values and existing assembled status messages", () => {
  assert.equal(
    translate("en", "API de jobs online · {0} ativo(s)", { 0: 3 }),
    "Jobs API online · 3 active"
  )
  assert.equal(
    translate("en", "API de jobs online · 3 ativo(s)"),
    "Jobs API online · 3 active"
  )
  assert.equal(
    translate("es", "Remover {0}", { 0: "<my-scenario>" }),
    "Eliminar <my-scenario>"
  )
})

test("unknown data, technical identifiers, whitespace and non-string nodes survive unchanged", () => {
  for (const value of [
    "custom-scenario-123",
    "constructor",
    "__proto__",
    "  ",
    42,
    null,
    undefined,
    { id: 1 },
  ]) {
    assert.equal(translate("fr", value), value)
  }
  assert.equal(translate("en", "  Executar simulação "), "  Run simulation ")
})

test("static UI messages are present in all catalogs", () => {
  const missing = new Set()
  for (const folder of ["app", "components", "lib"]) {
    const root = new URL(`../${folder}/`, import.meta.url)
    for (const entry of readdirSync(root, { recursive: true })) {
      if (!/\.tsx?$/.test(entry)) continue
      const source = readFileSync(new URL(entry, root), "utf8")
      const file = ts.createSourceFile(
        entry,
        source,
        ts.ScriptTarget.Latest,
        true,
        entry.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      )
      const visit = (node) => {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          ["t", "translateText"].includes(node.expression.text)
        ) {
          const first = node.arguments[0]
          if (
            first &&
            (ts.isStringLiteral(first) ||
              ts.isNoSubstitutionTemplateLiteral(first))
          ) {
            const key = first.text.trim()
            if (/[a-zÀ-ž]/i.test(key) && !Object.hasOwn(catalogs.pt, key))
              missing.add(key)
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(file)
    }
  }
  assert.deepEqual([...missing].sort(), [])
})
