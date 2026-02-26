import { supabase, isSupabaseConfigured } from '../lib/supabase';

export interface WebBookmark {
  id: string;
  url: string;
  title: string;
  excerpt: string | null;
  image: string | null;
  favicon: string | null;
  author: string | null;
  site_name: string | null;
  tags: string[];
  note: string | null;
  is_read: boolean;
  folder: string | null;
  source: 'chrome' | 'desktop' | 'mobile';
  created_at: string;
  updated_at: string;
}

export async function fetchBookmarks(userId: string): Promise<WebBookmark[]> {
  if (!isSupabaseConfigured) return [];

  const { data, error } = await supabase
    .from('bookmarks')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[bookmarks] fetch error:', error);
    return [];
  }

  return data ?? [];
}

export async function addBookmark(
  userId: string,
  bookmark: Omit<WebBookmark, 'created_at' | 'updated_at'>
): Promise<WebBookmark | null> {
  if (!isSupabaseConfigured) return null;

  const { data, error } = await supabase
    .from('bookmarks')
    .upsert({
      ...bookmark,
      user_id: userId,
    }, { onConflict: 'id,user_id' })
    .select()
    .single();

  if (error) {
    console.error('[bookmarks] add error:', error);
    return null;
  }

  return data;
}

export async function removeBookmark(userId: string, bookmarkId: string): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  const { error } = await supabase
    .from('bookmarks')
    .delete()
    .eq('id', bookmarkId)
    .eq('user_id', userId);

  if (error) {
    console.error('[bookmarks] remove error:', error);
    return false;
  }

  return true;
}

export async function toggleBookmarkRead(userId: string, bookmarkId: string, isRead: boolean): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  const { error } = await supabase
    .from('bookmarks')
    .update({ is_read: isRead })
    .eq('id', bookmarkId)
    .eq('user_id', userId);

  if (error) {
    console.error('[bookmarks] toggle read error:', error);
    return false;
  }

  return true;
}

export async function updateBookmarkFolder(
  userId: string,
  bookmarkId: string,
  folder: string | null,
): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  const { error } = await supabase
    .from('bookmarks')
    .update({ folder })
    .eq('id', bookmarkId)
    .eq('user_id', userId);

  if (error) {
    console.error('[bookmarks] update folder error:', error);
    return false;
  }

  return true;
}

export function generateBookmarkId(url: string): string {
  // Simple hash for desktop (sync compatible with Chrome extension's bk- prefix)
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const chr = url.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return `bk-${Math.abs(hash).toString(16).padStart(16, '0').slice(0, 16)}`;
}
