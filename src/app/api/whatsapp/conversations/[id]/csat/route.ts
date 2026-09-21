import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { sendInteractiveButtons } from "@/lib/whatsapp/meta-api";
import { decrypt } from "@/lib/whatsapp/encryption";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Verify conversation access
  const { data: conversation } = await supabase
    .from("conversations")
    .select("*, contact:contacts(*), account:accounts(*)")
    .eq("id", id)
    .single();

  if (!conversation || !conversation.contact) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // We only send a CSAT if one hasn't been sent/answered recently.
  // For simplicity, we just send it if it's closed and has no score yet.
  if (conversation.csat_score) {
    return NextResponse.json({ error: "CSAT already completed" }, { status: 400 });
  }

  try {
    const { data: config, error: configError } = await supabase
      .from("whatsapp_config")
      .select("*")
      .eq("account_id", conversation.account_id)
      .single();

    if (configError || !config) {
      return NextResponse.json({ error: "WhatsApp not configured." }, { status: 400 });
    }

    const accessToken = decrypt(config.access_token);

    // Send WhatsApp Interactive Message with buttons
    await sendInteractiveButtons({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: conversation.contact.phone,
      bodyText: "How would you rate the support you received today?",
      buttons: [
        { id: `CSAT_5_${conversation.id}`, title: "😍 Great (5)" },
        { id: `CSAT_3_${conversation.id}`, title: "😐 Okay (3)" },
        { id: `CSAT_1_${conversation.id}`, title: "😡 Bad (1)" },
      ],
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("CSAT send error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
