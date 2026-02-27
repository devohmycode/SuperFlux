import { supabase, isSupabaseConfigured } from '../lib/supabase';

export interface DrawDocRow {
  id: string;
  title: string;
  content: string;
  folder: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchDrawDocs(userId: string): Promise<DrawDocRow[]> {
  if (!isSupabaseConfigured) return [];

  const { data, error } = await supabase
    .from('draw_documents')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('[draw-docs] fetch error:', error);
    return [];
  }

  return data ?? [];
}

export async function upsertDrawDoc(
  userId: string,
  doc: { id: string; title: string; content: string; folder?: string | null }
): Promise<DrawDocRow | null> {
  if (!isSupabaseConfigured) return null;

  const { data, error } = await supabase
    .from('draw_documents')
    .upsert({
      id: doc.id,
      user_id: userId,
      title: doc.title,
      content: doc.content,
      folder: doc.folder ?? null,
    }, { onConflict: 'id,user_id' })
    .select()
    .single();

  if (error) {
    console.error('[draw-docs] upsert error:', error);
    return null;
  }

  return data;
}

export async function removeDrawDoc(userId: string, docId: string): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  const { error } = await supabase
    .from('draw_documents')
    .delete()
    .eq('id', docId)
    .eq('user_id', userId);

  if (error) {
    console.error('[draw-docs] remove error:', error);
    return false;
  }

  return true;
}

export async function updateDrawDocContent(
  userId: string,
  docId: string,
  content: string
): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  const { error } = await supabase
    .from('draw_documents')
    .update({ content })
    .eq('id', docId)
    .eq('user_id', userId);

  if (error) {
    console.error('[draw-docs] update content error:', error);
    return false;
  }

  return true;
}

export async function updateDrawDocMeta(
  userId: string,
  docId: string,
  meta: { title?: string; folder?: string | null }
): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  const { error } = await supabase
    .from('draw_documents')
    .update(meta)
    .eq('id', docId)
    .eq('user_id', userId);

  if (error) {
    console.error('[draw-docs] update meta error:', error);
    return false;
  }

  return true;
}
