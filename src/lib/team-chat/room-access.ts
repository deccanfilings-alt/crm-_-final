import type { SupabaseClient } from '@supabase/supabase-js';

/** Uses the CALLER's client (createClient from '@/lib/supabase/server') so auth.uid() is the user. */
export async function canViewRoom(supabase: SupabaseClient, roomId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('can_view_team_room', { p_room_id: roomId });
  return !error && data === true;
}
