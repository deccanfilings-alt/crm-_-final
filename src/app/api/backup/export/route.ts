// ============================================================
// GET /api/backup/export
//
// Generates a downloadable JSON backup archive of chat history.
// Query params:
//   - conversation_id (optional): export a specific chat thread
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/account";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getCurrentAccount();
    const supabase = ctx.supabase;
    const { searchParams } = new URL(req.url);
    const conversationId = searchParams.get("conversation_id");

    const exportedAt = new Date().toISOString();

    if (conversationId) {
      // Single conversation export
      const { data: conv, error: convError } = await supabase
        .from("conversations")
        .select("*, contact:contacts(*)")
        .eq("id", conversationId)
        .maybeSingle();

      if (convError || !conv) {
        return NextResponse.json(
          { error: "Conversation not found" },
          { status: 404 }
        );
      }

      const { data: messages, error: msgError } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      if (msgError) {
        return NextResponse.json(
          { error: "Failed to load messages" },
          { status: 500 }
        );
      }

      const payload = {
        version: "1.0",
        backup_type: "single_conversation",
        exported_at: exportedAt,
        conversation: conv,
        contact: conv.contact,
        messages: messages || [],
        total_messages: (messages || []).length,
      };

      const contactName =
        conv.contact?.name || conv.contact?.phone || "chat";
      const sanitizedName = contactName.replace(/[^a-zA-Z0-9_-]/g, "_");
      const filename = `backup_${sanitizedName}_${exportedAt.slice(0, 10)}.json`;

      return new NextResponse(JSON.stringify(payload, null, 2), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    // Full workspace export (conversations with latest messages)
    const { data: convs, error: convsError } = await supabase
      .from("conversations")
      .select("*, contact:contacts(*)")
      .order("last_message_at", { ascending: false });

    if (convsError) {
      return NextResponse.json(
        { error: "Failed to load conversations" },
        { status: 500 }
      );
    }

    // Fetch messages for these conversations
    const convIds = (convs || []).map((c) => c.id);
    let allMessages: any[] = [];
    if (convIds.length > 0) {
      const { data: msgs, error: msgsError } = await supabase
        .from("messages")
        .select("*")
        .in("conversation_id", convIds.slice(0, 100))
        .order("created_at", { ascending: true });

      if (!msgsError && msgs) {
        allMessages = msgs;
      }
    }

    const payload = {
      version: "1.0",
      backup_type: "workspace_full",
      exported_at: exportedAt,
      conversations: convs || [],
      messages: allMessages,
      total_conversations: (convs || []).length,
      total_messages: allMessages.length,
    };

    const filename = `crm_full_backup_${exportedAt.slice(0, 10)}.json`;

    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("[GET /api/backup/export] error:", error);
    return NextResponse.json(
      { error: "Failed to export backup data" },
      { status: 500 }
    );
  }
}
