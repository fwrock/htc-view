"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes"
import { useI18n } from "@/components/i18n-provider"

function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      <ThemeHotkey />
      {children}
    </NextThemesProvider>
  )
}

const subscribe = () => () => {}

function ThemeSelector() {
  const { theme, setTheme } = useTheme()
  const { t } = useI18n()
  // The saved preference is only available in the browser. Keep the server
  // and first client render identical until hydration finishes.
  const mounted = React.useSyncExternalStore(subscribe, () => true, () => false)

  return (
    <label className="mb-3 flex flex-col gap-1 text-[10px] text-muted-foreground">
      {t("Tema")}
      <select
        aria-label={t("Tema")}
        value={mounted ? theme : "dark"}
        disabled={!mounted}
        onChange={(event) => setTheme(event.target.value)}
        className="h-8 w-full rounded-sm border border-input bg-background px-2 text-xs text-foreground"
      >
        <option value="light">{t("Claro")}</option>
        <option value="dark">{t("Escuro")}</option>
        <option value="system">{t("Sistema")}</option>
      </select>
    </label>
  )
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  )
}

function ThemeHotkey() {
  const { resolvedTheme, setTheme } = useTheme()

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) {
        return
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      // some browsers (autofill, datalist picks) dispatch keydown without a key
      if (typeof event.key !== "string" || event.key.toLowerCase() !== "d") {
        return
      }

      if (isTypingTarget(event.target)) {
        return
      }

      setTheme(resolvedTheme === "dark" ? "light" : "dark")
    }

    window.addEventListener("keydown", onKeyDown)

    return () => {
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [resolvedTheme, setTheme])

  return null
}

export { ThemeProvider, ThemeSelector }
