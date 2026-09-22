"use client";

import { useEffect } from "react";
import { AlertCircle, RefreshCw, Home } from "lucide-react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app-error] Route error caught by error boundary:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive mb-4 shadow-sm">
        <AlertCircle className="h-7 w-7" />
      </div>
      <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
        Something went wrong
      </h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        An unexpected error occurred while loading this view. You can retry the
        operation or navigate back to safety.
      </p>

      {error.digest && (
        <code className="mt-3 rounded bg-muted px-2 py-1 text-xs text-muted-foreground font-mono">
          Ref: {error.digest}
        </code>
      )}

      <div className="mt-6 flex items-center gap-3">
        <Button onClick={() => reset()} variant="default" className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Try Again
        </Button>
        <Link
          href="/dashboard"
          className={cn(buttonVariants({ variant: "outline" }), "gap-2")}
        >
          <Home className="h-4 w-4" />
          Return to Dashboard
        </Link>
      </div>
    </div>
  );
}
