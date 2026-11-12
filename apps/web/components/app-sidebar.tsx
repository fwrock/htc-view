"use client"

import { useI18n } from "@/components/i18n-provider"

import { LanguageSelector } from "@/components/i18n-provider"
import { ThemeSelector } from "@/components/theme-provider"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Activity,
  BarChart3,
  Cpu,
  FolderInput,
  FolderTree,
  FilePenLine,
  FlaskConical,
  LayoutDashboard,
  Timer,
} from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"

const navItems = [
  {
    label: "Dashboard",
    href: "/",
    icon: LayoutDashboard,
    available: true,
  },
  {
    label: "Simulator",
    href: "/simulator",
    icon: Timer,
    available: true,
    description: "HTC · simulador",
  },
  {
    label: "Preparar cenário",
    href: "/simulator/import",
    icon: FolderInput,
    available: true,
    description: "Cenário HTC, OSM ou população EQASim/MATSim",
  },
  {
    label: "Locais",
    href: "/locations",
    icon: FolderTree,
    available: true,
    description: "Onde estão as simulações",
  },
  {
    label: "Modificações",
    href: "/modifications",
    icon: FilePenLine,
    available: true,
    description: "What-if: alterar atores do cenário",
  },
  {
    label: "Experimento",
    href: "/experiment",
    icon: FlaskConical,
    available: true,
    description: "Descritor + orquestrador, em qualquer ambiente",
  },
  {
    label: "Simedape",
    href: "/simedape",
    icon: Activity,
    available: true,
    description: "Estimation Pipeline",
  },
]

export function AppSidebar() {
  const { t: translateText } = useI18n()

  const pathname = usePathname()
  const activeHref = navItems
    .filter((item) =>
      item.href === "/"
        ? pathname === "/"
        : pathname === item.href || pathname.startsWith(`${item.href}/`)
    )
    .sort((a, b) => b.href.length - a.href.length)[0]?.href

  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col border-r border-border bg-sidebar">
      {/* Brand */}
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-4">
        <div className="flex size-7 items-center justify-center rounded-sm bg-primary">
          <Cpu className="size-4 text-primary-foreground" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="font-heading text-[13px] font-semibold tracking-wide text-sidebar-foreground">
            {translateText("HTC Panel")}
          </span>
          <span className="text-[10px] tracking-widest text-muted-foreground uppercase">
            {translateText("PhD Research")}
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-0.5 px-2 py-3">
        <p className="px-2 pb-1.5 text-[9px] font-semibold tracking-widest text-muted-foreground uppercase">
          {translateText("Navigation")}
        </p>
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = item.href === activeHref
          return (
            <Link
              key={item.href}
              href={item.available ? item.href : "#"}
              aria-disabled={!item.available}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "group flex items-center gap-2.5 rounded-sm px-2 py-2 text-xs font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                !item.available &&
                  "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-sidebar-foreground"
              )}
            >
              <Icon className="size-3.5 shrink-0" />
              <span className="flex-1">{translateText(item.label)}</span>
              {!item.available && (
                <span className="rounded-sm border border-border px-1 py-0.5 text-[8px] font-semibold tracking-widest text-muted-foreground uppercase">
                  {translateText("soon")}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-border px-4 py-3">
        <ThemeSelector />
        <LanguageSelector />
        <div className="flex items-center gap-1.5">
          <BarChart3 className="size-3 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground">
            {translateText("Universidade de São Paulo")}
          </span>
        </div>
      </div>
    </aside>
  )
}
