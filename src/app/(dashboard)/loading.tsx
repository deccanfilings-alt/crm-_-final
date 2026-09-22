export default function DashboardLoading() {
  return (
    <div className="flex-1 space-y-6 p-6 animate-pulse" aria-label="Loading dashboard content">
      {/* Top Banner Skeleton */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <div className="h-7 w-48 rounded-lg bg-muted/60" />
          <div className="h-4 w-72 rounded-md bg-muted/40" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-9 w-28 rounded-lg bg-muted/50" />
          <div className="h-9 w-32 rounded-lg bg-muted/70" />
        </div>
      </div>

      {/* Metric Cards Skeleton */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="rounded-2xl border border-border/60 bg-card/60 p-5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="h-3.5 w-24 rounded bg-muted/50" />
              <div className="h-8 w-8 rounded-lg bg-muted/60" />
            </div>
            <div className="h-8 w-20 rounded-md bg-muted/80" />
            <div className="h-3 w-32 rounded bg-muted/40" />
          </div>
        ))}
      </div>

      {/* Main Content Area Skeletons */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-border/60 bg-card/60 p-6 lg:col-span-2 space-y-4">
          <div className="h-5 w-36 rounded bg-muted/60" />
          <div className="space-y-3 pt-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-12 w-full rounded-xl bg-muted/30" />
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card/60 p-6 space-y-4">
          <div className="h-5 w-28 rounded bg-muted/60" />
          <div className="space-y-3 pt-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 w-full rounded-xl bg-muted/30" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
