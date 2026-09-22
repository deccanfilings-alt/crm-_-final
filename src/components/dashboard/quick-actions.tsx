"use client"

import Link from 'next/link'
import { UserPlus, Briefcase, Radio, Zap, ArrowUpRight } from 'lucide-react'
import type { ComponentType } from 'react'

interface Action {
  label: string
  href: string
  icon: ComponentType<{ className?: string }>
  iconStyles: string
}

const ACTIONS: Action[] = [
  {
    label: 'New Contact',
    href: '/contacts',
    icon: UserPlus,
    iconStyles: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 group-hover:bg-emerald-500 group-hover:text-white',
  },
  {
    label: 'New Deal',
    href: '/pipelines',
    icon: Briefcase,
    iconStyles: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 group-hover:bg-blue-600 group-hover:text-white',
  },
  {
    label: 'New Broadcast',
    href: '/broadcasts/new',
    icon: Radio,
    iconStyles: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 group-hover:bg-amber-500 group-hover:text-white',
  },
  {
    label: 'New Automation',
    href: '/automations/new',
    icon: Zap,
    iconStyles: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20 group-hover:bg-purple-600 group-hover:text-white',
  },
]

export function QuickActions() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {ACTIONS.map((a) => {
        const Icon = a.icon
        return (
          <Link
            key={a.href}
            href={a.href}
            className="group relative flex items-center justify-between overflow-hidden rounded-xl border border-border/80 bg-card p-3.5 shadow-2xs transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md active:scale-[0.99]"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-all duration-200 ${a.iconStyles}`}
              >
                <Icon className="h-4.5 w-4.5 transition-transform duration-200 group-hover:scale-110" />
              </div>
              <span className="truncate text-xs font-semibold text-foreground">
                {a.label}
              </span>
            </div>
            <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 -translate-x-1 translate-y-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0 group-hover:translate-y-0 shrink-0" />
          </Link>
        )
      })}
    </div>
  )
}
