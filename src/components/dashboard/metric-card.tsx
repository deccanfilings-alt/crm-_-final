import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import type { ComponentType } from 'react'
import { cn } from '@/lib/utils'

interface MetricCardProps {
  title: string
  /** Pre-formatted value for display (e.g. "42" or "$1,250"). */
  value: string
  icon: ComponentType<{ className?: string }>
  /**
   * Delta-mode secondary row: arrow + delta text. Omit when the metric
   * doesn't have a sensible comparison (e.g. total pipeline value).
   */
  delta?: {
    /** Positive / negative / zero drives arrow + color. */
    sign: number
    /** Pre-formatted delta, e.g. "+3 vs yesterday". */
    label: string
  }
  /** Used instead of `delta` when the metric has a static subtitle. */
  subtitle?: string
}

export function MetricCard({ title, value, icon: Icon, delta, subtitle }: MetricCardProps) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border/80 bg-card p-5 shadow-2xs transition-all duration-300 hover:shadow-md hover:border-primary/40 hover:-translate-y-0.5">
      {/* Soft Ambient Light Halo */}
      <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-primary/5 blur-2xl group-hover:bg-primary/12 transition-all duration-500" />

      <div className="flex items-start justify-between relative z-10">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-2xs group-hover:scale-105 group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300">
          <Icon className="h-4.5 w-4.5" />
        </div>
      </div>

      <p className="mt-3 text-3xl font-extrabold tracking-tight tabular-nums text-foreground relative z-10">
        {value}
      </p>

      {delta ? (
        <div className="mt-3 relative z-10">
          <DeltaRow sign={delta.sign} label={delta.label} />
        </div>
      ) : subtitle ? (
        <p className="mt-2.5 text-xs text-muted-foreground font-medium relative z-10">{subtitle}</p>
      ) : null}
    </div>
  )
}

function DeltaRow({ sign, label }: { sign: number; label: string }) {
  const isPositive = sign > 0
  const isNegative = sign < 0

  const badgeStyle = isPositive
    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
    : isNegative
    ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20'
    : 'bg-muted/70 text-muted-foreground border-border'

  const Arrow = isPositive ? ArrowUp : isNegative ? ArrowDown : Minus

  return (
    <div className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold tabular-nums shadow-2xs', badgeStyle)}>
      <Arrow className="h-3 w-3 shrink-0" aria-hidden />
      <span>{label}</span>
    </div>
  )
}
