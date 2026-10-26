import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { buildMediaPath } from "@/lib/storage/upload-media";

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("account_id")
    .eq("user_id", user.id)
    .single();

  if (!profile?.account_id) {
    return NextResponse.json({ error: "Account not found" }, { status: 403 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const path = buildMediaPath(profile.account_id, file.name);
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error: upErr } = await supabase.storage
      .from("task-files")
      .upload(path, buffer, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

    if (upErr) throw upErr;

    // Create 7-day signed URL
    const { data: signedData, error: signErr } = await supabase.storage
      .from("task-files")
      .createSignedUrl(path, 60 * 60 * 24 * 7);

    if (signErr) throw signErr;

    return NextResponse.json({
      name: file.name,
      path,
      url: signedData.signedUrl,
      size: file.size,
      type: file.type,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
