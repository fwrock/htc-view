import { cookies } from "next/headers"
import { I18nProvider } from "@/components/i18n-provider"
import { LOCALE_COOKIE, normalizeLocale, createTranslator } from "@/lib/i18n"
import { Geist_Mono, Noto_Sans, Playfair_Display } from "next/font/google"

import "@workspace/ui/globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { AppSidebar } from "@/components/app-sidebar"
import { cn } from "@workspace/ui/lib/utils"

const playfairDisplayHeading = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-heading",
})
const notoSans = Noto_Sans({ subsets: ["latin"], variable: "--font-sans" })
const fontMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" })

export async function generateMetadata() {
  const locale = normalizeLocale((await cookies()).get(LOCALE_COOKIE)?.value)
  const t = createTranslator(locale)
  return {
    title: "HTC Panel",
    description: t("Hyperbolic Time Chamber — Painel de pesquisa"),
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const locale = normalizeLocale((await cookies()).get(LOCALE_COOKIE)?.value)
  return (
    <html
      lang={locale}
      className={cn(
        "dark antialiased",
        fontMono.variable,
        "font-sans",
        notoSans.variable,
        playfairDisplayHeading.variable
      )}
      suppressHydrationWarning
    >
      <body>
        <I18nProvider initialLocale={locale}>
          <ThemeProvider>
            <div className="flex h-screen overflow-hidden">
              <AppSidebar />
              <main className="flex flex-1 flex-col overflow-y-auto">
                {children}
              </main>
            </div>
          </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  )
}
