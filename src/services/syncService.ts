import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { Feed, FeedItem, FeedSource } from '../types';

// Custom event dispatched after remote data is merged into localStorage
const SYNC_EVENT = 'superflux-sync-update';

function dispatchSyncEvent() {
  window.dispatchEvent(new CustomEvent(SYNC_EVENT));
}

// --------------- storage helpers (re-use same keys as useFeedStore) ------

const STORAGE_KEYS = {
  FEEDS: 'superflux_feeds',
  ITEMS: 'superflux_items',
};

function loadLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveLocal<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error('[sync] localStorage write failed', e);
  }
}

// --------------- mapping helpers: local ↔ DB -------------------------

function feedToRow(feed: Feed, userId: string) {
  return {
    id: feed.id,
    user_id: userId,
    name: feed.name,
    source: feed.source,
    icon: feed.icon,
    url: feed.url,
    color: feed.color,
    folder: feed.folder ?? null,
    updated_at: feed.updated_at ?? new Date().toISOString(),
  };
}

function rowToFeed(row: Record<string, unknown>): Feed {
  return {
    id: row.id as string,
    name: row.name as string,
    source: row.source as FeedSource,
    icon: row.icon as string ?? '',
    url: row.url as string,
    unreadCount: 0,
    color: row.color as string ?? '',
    updated_at: row.updated_at as string,
    folder: (row.folder as string) || undefined,
  };
}

function itemToRow(item: FeedItem, userId: string) {
  return {
    id: item.id,
    user_id: userId,
    feed_id: item.feedId,
    title: item.title,
    excerpt: item.excerpt,
    author: item.author,
    published_at: item.publishedAt instanceof Date ? item.publishedAt.toISOString() : item.publishedAt,
    url: item.url,
    is_read: item.isRead,
    is_starred: item.isStarred,
    is_bookmarked: item.isBookmarked ?? false,
    source: item.source,
    feed_name: item.feedName,
    tags: item.tags ?? [],
    comment_count: item.commentCount ?? null,
    comments_url: item.commentsUrl ?? null,
    updated_at: item.updated_at ?? new Date().toISOString(),
  };
}

function rowToItem(row: Record<string, unknown>): Partial<FeedItem> {
  return {
    id: row.id as string,
    feedId: row.feed_id as string,
    title: row.title as string ?? '',
    excerpt: row.excerpt as string ?? '',
    author: row.author as string ?? '',
    publishedAt: row.published_at ? new Date(row.published_at as string) : new Date(),
    url: row.url as string ?? '',
    isRead: row.is_read as boolean ?? false,
    isStarred: row.is_starred as boolean ?? false,
    isBookmarked: row.is_bookmarked as boolean ?? false,
    source: row.source as FeedSource ?? 'article',
    feedName: row.feed_name as string ?? '',
    tags: row.tags as string[] ?? [],
    commentCount: row.comment_count as number | undefined,
    commentsUrl: row.comments_url as string | undefined,
    updated_at: row.updated_at as string,
  };
}

// --------------- Debounce queue for item status updates ---------------

let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
let _pendingItemUpdates: Map<string, FeedItem> = new Map();
let _currentUserId: string | null = null;

function _flushItemUpdates() {
  if (_pendingItemUpdates.size === 0 || !_currentUserId) return;

  const rows = Array.from(_pendingItemUpdates.values()).map(item =>
    itemToRow(item, _currentUserId!)
  );
  _pendingItemUpdates.clear();

  // Fire-and-forget upsert
  supabase
    .from('feed_items')
    .upsert(rows, { onConflict: 'id,user_id' })
    .then(({ error }) => {
      if (error) console.error('[sync] batch item upsert failed', error);
    });
}

// --------------- Public API -------------------------------------------

export const SyncService = {
  /** Call once after login to establish user context */
  setUserId(userId: string | null) {
    _currentUserId = userId;
    if (!userId) {
      _pendingItemUpdates.clear();
      if (_debounceTimer) clearTimeout(_debounceTimer);
    }
  },

  /**
   * Full bidirectional sync: pull remote, merge with local (last-write-wins), push diff.
   * Writes result to localStorage then dispatches a reload event.
   */
  async fullSync(): Promise<void> {
    if (!isSupabaseConfigured || !_currentUserId) return;

    const userId = _currentUserId;

    // ---- Pull remote feeds ----
    const { data: remoteFeeds, error: feedsErr } = await supabase
      .from('feeds')
      .select('*')
      .eq('user_id', userId);
    if (feedsErr) throw feedsErr;

    // ---- Pull remote items ----
    const { data: remoteItems, error: itemsErr } = await supabase
      .from('feed_items')
      .select('*')
      .eq('user_id', userId);
    if (itemsErr) throw itemsErr;

    // ---- Merge feeds (last-write-wins on updated_at) ----
    const localFeeds: Feed[] = loadLocal(STORAGE_KEYS.FEEDS, []);
    const feedMap = new Map<string, Feed>();

    for (const lf of localFeeds) {
      feedMap.set(lf.id, lf);
    }
    for (const row of remoteFeeds ?? []) {
      const rf = rowToFeed(row);
      const existing = feedMap.get(rf.id);
      if (!existing || (rf.updated_at && (!existing.updated_at || rf.updated_at > existing.updated_at))) {
        feedMap.set(rf.id, { ...existing, ...rf, unreadCount: existing?.unreadCount ?? 0 });
      }
    }
    const mergedFeeds = Array.from(feedMap.values());

    // ---- Merge items (last-write-wins on updated_at, keep local content) ----
    const localItems: FeedItem[] = loadLocal(STORAGE_KEYS.ITEMS, []).map((item: FeedItem) => ({
      ...item,
      publishedAt: new Date(item.publishedAt),
      isBookmarked: item.isBookmarked ?? false,
    }));
    const itemMap = new Map<string, FeedItem>();

    for (const li of localItems) {
      itemMap.set(li.id, li);
    }
    for (const row of remoteItems ?? []) {
      const ri = rowToItem(row);
      const existing = itemMap.get(ri.id!);
      if (existing) {
        // Merge: keep local content, take remote flags if newer
        if (ri.updated_at && (!existing.updated_at || ri.updated_at > existing.updated_at)) {
          itemMap.set(ri.id!, {
            ...existing,
            isRead: ri.isRead ?? existing.isRead,
            isStarred: ri.isStarred ?? existing.isStarred,
            isBookmarked: ri.isBookmarked ?? existing.isBookmarked,
            updated_at: ri.updated_at,
          });
        }
      } else {
        // Remote-only item: insert with empty content
        itemMap.set(ri.id!, {
          content: '',
          readTime: undefined,
          thumbnail: undefined,
          comments: undefined,
          ...ri,
        } as FeedItem);
      }
    }
    const mergedItems = Array.from(itemMap.values());

    // ---- Save locally ----
    saveLocal(STORAGE_KEYS.FEEDS, mergedFeeds);
    saveLocal(STORAGE_KEYS.ITEMS, mergedItems);

    // ---- Push local-only feeds to remote ----
    const remoteFeedIds = new Set((remoteFeeds ?? []).map((r: Record<string, unknown>) => r.id as string));
    const feedsToPush = mergedFeeds.filter(f => !remoteFeedIds.has(f.id));
    if (feedsToPush.length > 0) {
      const rows = feedsToPush.map(f => feedToRow(f, userId));
      await supabase.from('feeds').upsert(rows, { onConflict: 'id,user_id' });
    }

    // ---- Push local-only items to remote (batch 500) ----
    const remoteItemIds = new Set((remoteItems ?? []).map((r: Record<string, unknown>) => r.id as string));
    const itemsToPush = mergedItems.filter(i => !remoteItemIds.has(i.id));
    for (let i = 0; i < itemsToPush.length; i += 500) {
      const batch = itemsToPush.slice(i, i + 500);
      const rows = batch.map(item => itemToRow(item, userId));
      await supabase.from('feed_items').upsert(rows, { onConflict: 'id,user_id' });
    }

    // ---- Notify useFeedStore to reload ----
    dispatchSyncEvent();
  },

  /** Push a single feed to remote immediately */
  async pushFeed(feed: Feed): Promise<void> {
    if (!isSupabaseConfigured || !_currentUserId) return;
    const row = feedToRow(feed, _currentUserId);
    const { error } = await supabase.from('feeds').upsert([row], { onConflict: 'id,user_id' });
    if (error) console.error('[sync] pushFeed failed', error);
  },

  /** Delete a feed from remote immediately */
  async deleteFeed(feedId: string): Promise<void> {
    if (!isSupabaseConfigured || !_currentUserId) return;
    const { error } = await supabase
      .from('feeds')
      .delete()
      .eq('id', feedId)
      .eq('user_id', _currentUserId);
    if (error) console.error('[sync] deleteFeed failed', error);
  },

  /** Queue an item status change (debounced 2s) */
  queueItemUpdate(item: FeedItem): void {
    if (!isSupabaseConfigured || !_currentUserId) return;
    _pendingItemUpdates.set(item.id, { ...item, updated_at: new Date().toISOString() });
    if (_debounceTimer) clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(_flushItemUpdates, 2000);
  },

  /** Push new items after RSS sync (batch 500) */
  async pushNewItems(items: FeedItem[]): Promise<void> {
    if (!isSupabaseConfigured || !_currentUserId) return;
    const userId = _currentUserId;

    for (let i = 0; i < items.length; i += 500) {
      const batch = items.slice(i, i + 500);
      const rows = batch.map(item => itemToRow(item, userId));
      const { error } = await supabase
        .from('feed_items')
        .upsert(rows, { onConflict: 'id,user_id' });
      if (error) console.error('[sync] pushNewItems batch failed', error);
    }
  },
};
