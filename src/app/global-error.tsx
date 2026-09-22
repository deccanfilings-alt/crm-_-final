"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log fatal root layout error to console or error tracking service
    console.error("[CRITICAL] Unhandled global application error:", error);
  }, [error]);

  return (
    <html lang="en">
      <head>
        <title>Application Error — Deccan Filings CRM</title>
      </head>
      <body
        style={{
          margin: 0,
          padding: 0,
          backgroundColor: "#0d0f14",
          color: "#f8fafc",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            maxWidth: "480px",
            width: "90%",
            backgroundColor: "#181c29",
            border: "1px solid #262c3f",
            borderRadius: "16px",
            padding: "32px",
            textAlign: "center",
            boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
          }}
        >
          <div
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "12px",
              backgroundColor: "rgba(239, 68, 68, 0.12)",
              color: "#ef4444",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px auto",
              fontSize: "24px",
            }}
          >
            ⚠️
          </div>
          <h1
            style={{
              fontSize: "20px",
              fontWeight: 700,
              margin: "0 0 8px 0",
              letterSpacing: "-0.02em",
            }}
          >
            System Recovery
          </h1>
          <p
            style={{
              fontSize: "14px",
              color: "#94a3b8",
              lineHeight: 1.5,
              margin: "0 0 24px 0",
            }}
          >
            A critical error prevented the application layout from rendering.
            Our team has been notified.
          </p>

          {error.digest && (
            <div
              style={{
                fontSize: "11px",
                fontFamily: "monospace",
                color: "#64748b",
                backgroundColor: "#141721",
                padding: "6px 10px",
                borderRadius: "6px",
                marginBottom: "20px",
              }}
            >
              Digest: {error.digest}
            </div>
          )}

          <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
            <button
              onClick={() => reset()}
              style={{
                backgroundColor: "#8b5cf6",
                color: "#ffffff",
                border: "none",
                borderRadius: "10px",
                padding: "10px 20px",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              Try Again
            </button>
            <button
              onClick={() => window.location.assign("/dashboard")}
              style={{
                backgroundColor: "#202638",
                color: "#f8fafc",
                border: "1px solid #262c3f",
                borderRadius: "10px",
                padding: "10px 18px",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Reload CRM
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
