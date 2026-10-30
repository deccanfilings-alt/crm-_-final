// ============================================================
// POST /api/invitations/[token]/signup
//
// Public — validates an invitation token, then creates a confirmed
// auth user linked to the invite's target account.
// ============================================================

import { NextResponse } from "next/server";
import { hashInviteToken } from "@/lib/auth/invitations";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    if (!token || typeof token !== "string") {
      return NextResponse.json({ error: "Missing invitation token" }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
    }

    const { email, password, full_name } = body;

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json({ error: "A valid email address is required" }, { status: 400 });
    }

    if (!password || typeof password !== "string" || password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters long" },
        { status: 400 }
      );
    }

    const trimmedName = typeof full_name === "string" ? full_name.trim() : "";
    if (!trimmedName) {
      return NextResponse.json({ error: "Full name is required" }, { status: 400 });
    }

    // Look up the invite via peek_invitation RPC
    const supabase = await createClient();
    const { data: peekData, error: peekErr } = await supabase.rpc("peek_invitation", {
      p_token_hash: hashInviteToken(token),
    });

    if (peekErr) {
      console.error("[signup] peek error:", peekErr);
      return NextResponse.json({ error: "Failed to verify invitation" }, { status: 500 });
    }

    if (!peekData || !peekData.ok) {
      if (peekData?.reason === "expired" || peekData?.reason === "used") {
        return NextResponse.json(
          { error: "Invitation has expired or already been used" },
          { status: 410 }
        );
      }
      return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
    }

    // Create the confirmed user using admin service role
    const admin = supabaseAdmin();
    const { error: createErr } = await admin.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: { full_name: trimmedName },
    });

    if (createErr) {
      const errMsg = createErr.message.toLowerCase();
      if (
        errMsg.includes("already registered") ||
        errMsg.includes("already exists") ||
        errMsg.includes("unique")
      ) {
        return NextResponse.json(
          { error: "This email already has an account. Sign in instead." },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: createErr.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[signup] unexpected error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
