import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import OpenAI from "openai";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: conversationId } = await params;
    const supabase = await createClient();

    // Verify auth
    const { data: userData, error: authError } = await supabase.auth.getUser();
    if (authError || !userData?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify conversation access
    const { data: conversation, error: convError } = await supabase
      .from("conversations")
      .select("id, account_id")
      .eq("id", conversationId)
      .single();

    if (convError || !conversation) {
      return NextResponse.json(
        { error: "Conversation not found or access denied" },
        { status: 404 }
      );
    }

    // Fetch conversation history (last 15 messages)
    const { data: history, error: historyError } = await supabase
      .from("messages")
      .select("content_text, sender_type")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(15);

    if (historyError) {
      return NextResponse.json(
        { error: "Failed to fetch conversation history" },
        { status: 500 }
      );
    }

    if (!history || history.length === 0) {
      return NextResponse.json(
        { error: "No conversation history to base suggestion on" },
        { status: 400 }
      );
    }

    // Reverse to chronological order
    const chronologicalHistory = history.reverse();

    // Fetch AI Providers ordered by priority
    const { data: providers } = await supabase
      .from("ai_providers")
      .select("provider, api_key")
      .eq("account_id", conversation.account_id)
      .eq("is_active", true);

    if (!providers || providers.length === 0) {
      return NextResponse.json(
        { error: "No active AI providers configured. Please configure one in Settings > AI Providers." },
        { status: 400 }
      );
    }

    // Priority: OpenAI -> OpenRouter -> Cohere -> Sarvam (based on what we usually use)
    let selectedProvider = providers.find(p => p.provider === 'openai');
    if (!selectedProvider) selectedProvider = providers.find(p => p.provider === 'openrouter');
    if (!selectedProvider) selectedProvider = providers.find(p => p.provider === 'cohere');
    if (!selectedProvider) selectedProvider = providers[0];

    const baseURL = selectedProvider.provider === "openrouter"
      ? "https://openrouter.ai/api/v1"
      : selectedProvider.provider === "sarvam"
      ? "https://api.sarvam.ai/v1"
      : undefined;

    // Use a reasonable default model based on provider
    let model = "gpt-4o-mini";
    if (selectedProvider.provider === "openrouter") model = "anthropic/claude-3.5-haiku";
    if (selectedProvider.provider === "cohere") model = "command-r-plus";
    if (selectedProvider.provider === "sarvam") model = "sarvam-2b"; // fallback

    const openai = new OpenAI({ apiKey: selectedProvider.api_key, baseURL });

    const chatHistory = chronologicalHistory
      .filter((m: any) => m.content_text && m.content_text.trim() !== '')
      .map((m: any) => ({
        role: m.sender_type === 'customer' ? 'user' : 'assistant',
        content: m.content_text,
      }));

    const systemPrompt = `You are a helpful AI assistant drafting a reply for a human customer service agent. 
    Analyze the following conversation history and draft a concise, professional, and helpful reply to the customer's latest message. 
    Do NOT include placeholders like [Name]. Just provide the exact text the agent should send.`;

    const finalMessages: any[] = [
      { role: "system", content: systemPrompt },
      ...chatHistory
    ];

    const completion = await openai.chat.completions.create({
      model: model,
      messages: finalMessages,
      temperature: 0.7,
    });

    const suggestion = completion.choices[0]?.message?.content;

    if (!suggestion) {
      return NextResponse.json({ error: "Empty response from LLM" }, { status: 500 });
    }

    return NextResponse.json({ suggestion });
  } catch (error: any) {
    console.error("AI Suggest Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate AI suggestion" },
      { status: 500 }
    );
  }
}
