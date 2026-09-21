import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { session }, error: authError } = await (await supabase).auth.getSession();
    
    if (authError || !session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const query = searchParams.get("q");

    if (!query || query.trim().length < 2) {
      return NextResponse.json({ contacts: [], deals: [], action_items: [] });
    }

    const searchQuery = `%${query.trim()}%`;
    const supabaseClient = await supabase;

    // Search Contacts (name, phone, email)
    const { data: contacts } = await supabaseClient
      .from("contacts")
      .select("id, name, phone, email, avatar_url, instagram_username")
      .or(`name.ilike.${searchQuery},phone.ilike.${searchQuery},email.ilike.${searchQuery},instagram_username.ilike.${searchQuery}`)
      .limit(5);

    // Search Deals
    const { data: deals } = await supabaseClient
      .from("deals")
      .select("id, title, value, contact:contacts(name, phone)")
      .ilike("title", searchQuery)
      .limit(5);

    // Search Action Items
    const { data: actionItems } = await supabaseClient
      .from("action_items")
      .select("id, title, status, contact:contacts(name)")
      .ilike("title", searchQuery)
      .limit(5);

    return NextResponse.json({
      contacts: contacts || [],
      deals: deals || [],
      action_items: actionItems || [],
    });
  } catch (error: any) {
    console.error("Search API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
