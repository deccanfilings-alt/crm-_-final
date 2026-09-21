import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const rawNext = requestUrl.searchParams.get("next");
  const isResetPasswordFlow = rawNext?.includes("reset-password");
  const next = rawNext ?? "/dashboard";
  const error = requestUrl.searchParams.get("error");
  const errorDescription = requestUrl.searchParams.get("error_description");

  // Determine origin, accounting for reverse proxies / forwarded host
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  const isLocalEnv = process.env.NODE_ENV === "development";

  let redirectBase = requestUrl.origin;
  if (!isLocalEnv && forwardedHost) {
    redirectBase = `${forwardedProto}://${forwardedHost}`;
  }

  const fallbackRedirect = isResetPasswordFlow ? "/forgot-password" : "/login";

  // If Supabase returned an error query parameter (e.g. otp_expired)
  if (error || errorDescription) {
    const errorMsg = encodeURIComponent(
      errorDescription || error || "Verification link is invalid or has expired."
    );
    return NextResponse.redirect(`${redirectBase}${fallbackRedirect}?error=${errorMsg}`);
  }

  if (code) {
    const supabase = await createClient();
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

    if (!exchangeError) {
      // Clean redirect target: ensure it is a relative path to prevent open redirects
      const safeNext = next.startsWith("/") ? next : "/dashboard";
      return NextResponse.redirect(`${redirectBase}${safeNext}`);
    } else {
      console.error("[auth/callback] exchangeCodeForSession failed:", exchangeError.message);
      const errorMsg = encodeURIComponent(
        exchangeError.message || "Invalid or expired verification link."
      );
      return NextResponse.redirect(`${redirectBase}${fallbackRedirect}?error=${errorMsg}`);
    }
  }

  // If neither code nor error was provided
  return NextResponse.redirect(`${redirectBase}${fallbackRedirect}`);
}
