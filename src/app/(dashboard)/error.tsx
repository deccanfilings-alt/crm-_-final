"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw, LayoutDashboard } from "lucide-react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard-error] Error caught within dashboard layout:", error);
  }, [error]);

  return (
    <div className="flex h-full min-h-[500px] flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-border/80 bg-card p-6 text-center shadow-lg">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h3 className="text-lg font-bold text-foreground">
          Failed to load dashboard component
        </h3>
        <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
          {error.message && error.message.length < 160
            ? error.message
            : "An unexpected error occurred while fetching dashboard data. Please try reloading the view."}
        </p>

        {error.digest && (
          <p className="mt-2 text-[10px] font-mono text-muted-foreground/80">
            Error ID: {error.digest}
          </p>
        )}

        <div className="mt-6 flex justify-center gap-3">
          <Button onClick={() => reset()} size="sm" className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </Button>
          <Link
            href="/dashboard"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-2")}
          >
            <LayoutDashboard className="h-3.5 w-3.5" />
            Overview
          </Link>
        </div>
      </div>
    </div>
  );
}
