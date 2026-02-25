import { supabase, isSupabaseConfigured } from '../lib/supabase';

export interface NoteRow {
  id: string;
  title: string;
  content: string;
  folder: string | null;
  sticky_x: number | null;
  sticky_y: number | null;
  sticky_rotation: number | null;
  sticky_z_index: number | null;
  sticky_color: string | null;
  sticky_width: number | null;
  sticky_height: number | null;
  created_at: string;
  updated_at: string;
}

export async function fetchNotes(userId: string): Promise<NoteRow[]> {
  console.log('[notes] isSupabaseConfigured:', isSupabaseConfigured, 'userId:', userId);
  if (!isSupabaseConfigured) { console.warn('[notes] Supabase not configured'); return []; }

  const { data, error, status } = await supabase
    .from('notes')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  console.log('[notes] fetch response — status:', status, 'data:', data?.length, 'error:', error);

  if (error) {
    console.error('[notes] fetch error:', error);
    return [];
  }

  return data ?? [];
}

export async function upsertNote(
  userId: string,
  note: {
    id: string;
    title: string;
    content: string;
    folder?: string | null;
    sticky_x?: number | null;
    sticky_y?: number | null;
    sticky_rotation?: number | null;
    sticky_z_index?: number | null;
    sticky_color?: string | null;
    sticky_width?: number | null;
    sticky_height?: number | null;
  }
): Promise<NoteRow | null> {
  if (!isSupabaseConfigured) return null;

  const { data, error } = await supabase
    .from('notes')
    .upsert({
      id: note.id,
      user_id: userId,
      title: note.title,
      content: note.content,
      folder: note.folder ?? null,
      sticky_x: note.sticky_x ?? null,
      sticky_y: note.sticky_y ?? null,
      sticky_rotation: note.sticky_rotation ?? null,
      sticky_z_index: note.sticky_z_index ?? null,
      sticky_color: note.sticky_color ?? null,
      sticky_width: note.sticky_width ?? null,
      sticky_height: note.sticky_height ?? null,
    }, { onConflict: 'id,user_id' })
    .select()
    .single();

  if (error) {
    console.error('[notes] upsert error:', error);
    return null;
  }

  return data;
}

export async function removeNote(userId: string, noteId: string): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  const { error } = await supabase
    .from('notes')
    .delete()
    .eq('id', noteId)
    .eq('user_id', userId);

  if (error) {
    console.error('[notes] remove error:', error);
    return false;
  }

  return true;
}

export async function updateNoteContent(
  userId: string,
  noteId: string,
  content: string
): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  const { error } = await supabase
    .from('notes')
    .update({ content })
    .eq('id', noteId)
    .eq('user_id', userId);

  if (error) {
    console.error('[notes] update content error:', error);
    return false;
  }

  return true;
}

export async function updateNoteMeta(
  userId: string,
  noteId: string,
  meta: {
    title?: string;
    folder?: string | null;
    sticky_x?: number | null;
    sticky_y?: number | null;
    sticky_rotation?: number | null;
    sticky_z_index?: number | null;
    sticky_color?: string | null;
    sticky_width?: number | null;
    sticky_height?: number | null;
  }
): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  const { error } = await supabase
    .from('notes')
    .update(meta)
    .eq('id', noteId)
    .eq('user_id', userId);

  if (error) {
    console.error('[notes] update meta error:', error);
    return false;
  }

  return true;
}
