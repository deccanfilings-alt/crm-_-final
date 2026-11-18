import { supabaseAdmin } from "@/lib/flows/admin-client";
// ============================================================
// /api/account/members/[userId]
//
//   PATCH  — change a member's role or team (admin+), or their
//            display name (owner only).
//   DELETE — remove a member.          Admin+.
//
// Both delegate to SECURITY DEFINER RPCs from migration 018:
//   - set_member_role(p_user_id, p_new_role)
//   - remove_account_member(p_user_id)
//
// The RPCs do the *real* authorisation work — caller must be
// admin+, target must be in caller's account, target can't be the
// owner, can't be self. The TS layer here only forwards the call
// and maps Postgres SQLSTATEs back to HTTP statuses.
// ============================================================

import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { isAccountRole } from "@/lib/auth/roles";
import { validateDisplayName } from "@/lib/auth/display-name";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

// Map known SQLSTATEs from the RPCs (see migration 018) onto HTTP
// statuses. The `error.code` field is the SQLSTATE; the `message`
// is the human-readable RAISE message we put in the migration.
function rpcErrorToResponse(err: PostgrestError): NextResponse {
  if (err.code === "42501") {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err.code === "22023") {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  console.error("[members route] unexpected RPC error:", err);
  return NextResponse.json(
    { error: "Failed to update member" },
    { status: 500 },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:memberRole:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const body = (await request.json().catch(() => null)) as
      | { role?: unknown; team?: unknown; full_name?: unknown }
      | null;
    const role = body?.role;
    const team = body?.team;
    const fullName = body?.full_name;

    if (role === undefined && team === undefined && fullName === undefined) {
      return NextResponse.json(
        { error: "Provide 'role', 'team' or 'full_name'" },
        { status: 400 },
      );
    }

    // Display name: owners (co-owners included) only. Validated before
    // any other field is written so a bad name never leaves a partial
    // update behind.
    let nameValue: string | undefined;
    if (fullName !== undefined) {
      if (ctx.role !== "owner") {
        return NextResponse.json(
          { error: "Only an owner can change a member's name" },
          { status: 403 },
        );
      }
      const result = validateDisplayName(fullName);
      if ("error" in result) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      nameValue = result.name;
    }

    if (nameValue !== undefined) {
      const { data: updated, error: nameErr } = await supabaseAdmin()
        .from("profiles")
        .update({ full_name: nameValue })
        .eq("user_id", userId)
        .eq("account_id", ctx.accountId)
        .select("user_id");

      if (nameErr) {
        console.error("[members route] name update failed:", nameErr);
        return NextResponse.json(
          { error: "Failed to update name" },
          { status: 500 },
        );
      }
      if (!updated || updated.length === 0) {
        return NextResponse.json(
          { error: "Member not found in this account" },
          { status: 404 },
        );
      }
    }

    if (team !== undefined) {
      const teamValue = typeof team === "string" ? team.trim() : null;
      const { error: teamErr } = await supabaseAdmin()
        .from("profiles")
        .update({ team: teamValue || null })
        .eq("user_id", userId)
        .eq("account_id", ctx.accountId);

      if (teamErr) {
        return NextResponse.json({ error: teamErr.message }, { status: 500 });
      }
    }

    if (role !== undefined) {
      if (!isAccountRole(role)) {
        return NextResponse.json(
          { error: "'role' must be one of owner, admin, agent, viewer" },
          { status: 400 },
        );
      }

      if (role === "owner") {
        // Co-owners (migration 070): only an existing owner can add one.
        if (ctx.role !== "owner") {
          return NextResponse.json(
            { error: "Only an owner can make someone a co-owner" },
            { status: 403 },
          );
        }
        const { error } = await ctx.supabase.rpc("make_co_owner", {
          p_user_id: userId,
        });
        if (error) return rpcErrorToResponse(error);
        return NextResponse.json({ ok: true });
      }

      const { error } = await ctx.supabase.rpc("set_member_role", {
        p_user_id: userId,
        p_new_role: role,
      });

      if (error) return rpcErrorToResponse(error);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:memberRemove:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const { data, error } = await ctx.supabase.rpc("remove_account_member", {
      p_user_id: userId,
    });

    if (error) return rpcErrorToResponse(error);

    return NextResponse.json({ ok: true, newPersonalAccountId: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
