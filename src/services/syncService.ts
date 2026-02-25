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
  SYNCED_FEED_IDS: 'superflux_synced_feed_ids',
  SYNCED_ITEM_IDS: 'superflux_synced_item_ids',
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

// --------------- Sync error event (surfaces errors in the UI) ---------

export const SYNC_ERROR_EVENT = 'superflux-sync-error';

function dispatchSyncError(operation: string, error: unknown) {
  const msg = error && typeof error === 'object' && 'message' in error
    ? (error as { message: string }).message
    : String(error);
  console.error(`[sync] ${operation}:`, error);
  window.dispatchEvent(new CustomEvent(SYNC_ERROR_EVENT, { detail: { operation, message: msg } }));
}

// --------------- Feed cache + in-flight tracking ----------------------
// Solves race condition: pushNewItems may fire before pushFeed completes
// and before React's useEffect saves the feed to localStorage.

const _feedsCache = new Map<string, Feed>();           // feedId → Feed
const _pushFeedPromises = new Map<string, Promise<void>>(); // feedId → in-flight promise

/** Ensure a feed exists in Supabase. Awaits any in-flight pushFeed, then upserts. */
async function ensureFeedInSupabase(feedId: string, userId: string): Promise<boolean> {
  // Wait for any in-flight pushFeed for this feedId
  const pending = _pushFeedPromises.get(feedId);
  if (pending) {
    await pending;
    return true; // pushFeed handled it
  }

  // Find feed data: in-memory cache first, then localStorage
  const feed = _feedsCache.get(feedId)
    ?? loadLocal<Feed[]>(STORAGE_KEYS.FEEDS, []).find(f => f.id === feedId);
  if (!feed) {
    console.warn('[sync] ensureFeed: feed not found anywhere:', feedId);
    return false;
  }

  const { error } = await supabase
    .from('feeds')
    .upsert([feedToRow(feed, userId)], { onConflict: 'id,user_id' });
  if (error) {
    dispatchSyncError(`ensureFeed "${feed.name}"`, error);
    return false;
  }
  return true;
}

// --------------- Debounce queue for item status updates ---------------

let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
let _pendingItemUpdates: Map<string, FeedItem> = new Map();
let _currentUserId: string | null = null;

async function _flushItemUpdates() {
  if (_pendingItemUpdates.size === 0 || !_currentUserId) return;

  const userId = _currentUserId;
  const items = Array.from(_pendingItemUpdates.values());
  _pendingItemUpdates.clear();

  // Ensure parent feeds exist in Supabase (FK constraint)
  const feedIds = [...new Set(items.map(i => i.feedId))];
  const failedFeedIds = new Set<string>();
  for (const feedId of feedIds) {
    const ok = await ensureFeedInSupabase(feedId, userId);
    if (!ok) failedFeedIds.add(feedId);
  }

  const safeItems = failedFeedIds.size > 0
    ? items.filter(i => !failedFeedIds.has(i.feedId))
    : items;
  if (safeItems.length === 0) return;

  const rows = safeItems.map(item => itemToRow(item, userId));
  const { error } = await supabase
    .from('feed_items')
    .upsert(rows, { onConflict: 'id,user_id' });
  if (error) dispatchSyncError('batch item upsert', error);
}

// --------------- Public API -------------------------------------------

export const SyncService = {
  /** Call once after login to establish user context */
  setUserId(userId: string | null) {
    console.log('[sync] setUserId:', userId);
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

    // ---- Detect remote deletions (feeds/items previously synced but no longer in Supabase) ----
    const prevSyncedFeedIds = new Set<string>(loadLocal(STORAGE_KEYS.SYNCED_FEED_IDS, []));
    const prevSyncedItemIds = new Set<string>(loadLocal(STORAGE_KEYS.SYNCED_ITEM_IDS, []));
    const remoteFeedIdSet = new Set((remoteFeeds ?? []).map((r: Record<string, unknown>) => r.id as string));
    const remoteItemIdSet = new Set((remoteItems ?? []).map((r: Record<string, unknown>) => r.id as string));
    const remoteItemUrlSet = new Set((remoteItems ?? []).map((r: Record<string, unknown>) => r.url as string).filter(Boolean));

    // Feeds previously synced but now missing from Supabase → deleted remotely
    const deletedFeedIds = new Set<string>();
    for (const id of prevSyncedFeedIds) {
      if (!remoteFeedIdSet.has(id)) deletedFeedIds.add(id);
    }
    // Items previously synced but now missing from Supabase → deleted remotely
    const deletedItemIds = new Set<string>();
    for (const id of prevSyncedItemIds) {
      if (!remoteItemIdSet.has(id)) deletedItemIds.add(id);
    }

    // ---- Merge feeds (last-write-wins on updated_at, match by id OR url) ----
    const localFeeds: Feed[] = loadLocal(STORAGE_KEYS.FEEDS, []);
    const feedMap = new Map<string, Feed>();
    const urlToFeedId = new Map<string, string>(); // URL → canonical local ID

    for (const lf of localFeeds) {
      // Skip feeds that were deleted remotely
      if (deletedFeedIds.has(lf.id)) continue;
      feedMap.set(lf.id, lf);
      if (lf.url) urlToFeedId.set(lf.url, lf.id);
    }
    for (const row of remoteFeeds ?? []) {
      const rf = rowToFeed(row);
      // Match by id first, then fall back to URL (handles cross-platform ID mismatch)
      const existingById = feedMap.get(rf.id);
      const existingByUrl = rf.url ? (urlToFeedId.has(rf.url) ? feedMap.get(urlToFeedId.get(rf.url)!) : undefined) : undefined;
      const existing = existingById ?? existingByUrl;

      if (existing) {
        if (rf.updated_at && (!existing.updated_at || rf.updated_at > existing.updated_at)) {
          feedMap.set(existing.id, { ...existing, ...rf, id: existing.id, unreadCount: existing.unreadCount ?? 0 });
        }
      } else {
        feedMap.set(rf.id, { ...rf, unreadCount: 0 });
        if (rf.url) urlToFeedId.set(rf.url, rf.id);
      }
    }
    const mergedFeeds = Array.from(feedMap.values());

    // Build remote-feed-id → local-feed-id map (for remapping item feedId)
    const remoteFeedIdToLocal = new Map<string, string>(); // remote id → local id
    const remoteFeedUrls = new Set<string>(); // URLs already present remotely
    for (const row of remoteFeeds ?? []) {
      const url = row.url as string;
      const remoteId = row.id as string;
      if (url) remoteFeedUrls.add(url);
      const localId = urlToFeedId.get(url);
      if (localId && localId !== remoteId) {
        remoteFeedIdToLocal.set(remoteId, localId);
      }
    }

    // ---- Merge items (last-write-wins on updated_at, keep local content) ----
    const localItems: FeedItem[] = loadLocal(STORAGE_KEYS.ITEMS, []).map((item: FeedItem) => ({
      ...item,
      publishedAt: new Date(item.publishedAt),
      isBookmarked: item.isBookmarked ?? false,
    }));
    const itemMap = new Map<string, FeedItem>();
    const urlToId = new Map<string, string>(); // URL → canonical ID for dedup

    for (const li of localItems) {
      // Skip items deleted remotely or belonging to deleted feeds
      if (deletedItemIds.has(li.id)) continue;
      if (deletedFeedIds.has(li.feedId)) continue;
      itemMap.set(li.id, li);
      if (li.url) urlToId.set(li.url, li.id);
    }
    for (const row of remoteItems ?? []) {
      const ri = rowToItem(row);
      // Remap feedId if the remote feed was matched to a local feed by URL
      if (ri.feedId && remoteFeedIdToLocal.has(ri.feedId)) {
        ri.feedId = remoteFeedIdToLocal.get(ri.feedId)!;
      }
      // Check if we already have this item by URL (handles cross-platform ID mismatch)
      const existingIdByUrl = ri.url ? urlToId.get(ri.url) : undefined;
      const existing = itemMap.get(ri.id!) ?? (existingIdByUrl ? itemMap.get(existingIdByUrl) : undefined);

      if (existing) {
        // Merge: keep local content, take remote flags if newer
        if (ri.updated_at && (!existing.updated_at || ri.updated_at > existing.updated_at)) {
          itemMap.set(existing.id, {
            ...existing,
            isRead: ri.isRead ?? existing.isRead,
            isStarred: ri.isStarred ?? existing.isStarred,
            isBookmarked: ri.isBookmarked ?? existing.isBookmarked,
            updated_at: ri.updated_at,
          });
        }
        // Don't add the remote duplicate under its own ID
      } else {
        // Remote-only item: insert with empty content
        itemMap.set(ri.id!, {
          content: '',
          readTime: undefined,
          thumbnail: undefined,
          comments: undefined,
          ...ri,
        } as FeedItem);
        if (ri.url) urlToId.set(ri.url, ri.id!);
      }
    }
    const mergedItems = Array.from(itemMap.values());

    // ---- Save locally ----
    saveLocal(STORAGE_KEYS.FEEDS, mergedFeeds);
    saveLocal(STORAGE_KEYS.ITEMS, mergedItems);

    // ---- Push local-only feeds to remote (skip feeds already synced by URL or deleted remotely) ----
    const feedsToPush = mergedFeeds.filter(f => !remoteFeedIdSet.has(f.id) && !remoteFeedUrls.has(f.url) && !deletedFeedIds.has(f.id));
    if (feedsToPush.length > 0) {
      // Use insert for new feeds (they don't exist remotely yet)
      for (const feed of feedsToPush) {
        const row = feedToRow(feed, userId);
        const { error } = await supabase.from('feeds').insert(row);
        if (error) dispatchSyncError(`fullSync push feed "${feed.name}"`, error);
      }
    }

    // ---- Push local-only items to remote (batch 500) ----
    const itemsToPush = mergedItems.filter(i => !remoteItemIdSet.has(i.id) && !(i.url && remoteItemUrlSet.has(i.url)) && !deletedItemIds.has(i.id) && !deletedFeedIds.has(i.feedId));
    // Ensure every referenced feed exists before inserting items
    // Populate cache so ensureFeedInSupabase can find them
    for (const f of mergedFeeds) _feedsCache.set(f.id, f);
    const itemFeedIds = [...new Set(itemsToPush.map(i => i.feedId))];
    const failedFeedIds = new Set<string>();
    for (const fid of itemFeedIds) {
      const ok = await ensureFeedInSupabase(fid, userId);
      if (!ok) failedFeedIds.add(fid);
    }
    const safeItemsToPush = failedFeedIds.size > 0
      ? itemsToPush.filter(i => !failedFeedIds.has(i.feedId))
      : itemsToPush;
    for (let i = 0; i < safeItemsToPush.length; i += 500) {
      const batch = safeItemsToPush.slice(i, i + 500);
      const rows = batch.map(item => itemToRow(item, userId));
      const { error } = await supabase.from('feed_items').insert(rows);
      if (error) dispatchSyncError('fullSync push items batch', error);
    }

    // ---- Track synced IDs for future orphan detection ----
    const allSyncedFeedIds = [...remoteFeedIdSet, ...feedsToPush.map(f => f.id)];
    const allSyncedItemIds = [...remoteItemIdSet, ...safeItemsToPush.map(i => i.id)];
    saveLocal(STORAGE_KEYS.SYNCED_FEED_IDS, allSyncedFeedIds);
    saveLocal(STORAGE_KEYS.SYNCED_ITEM_IDS, allSyncedItemIds);

    // ---- Notify useFeedStore to reload ----
    dispatchSyncEvent();
  },

  /** Push a single feed to remote immediately */
  async pushFeed(feed: Feed): Promise<void> {
    if (!isSupabaseConfigured) {
      console.warn('[sync] pushFeed skipped: Supabase not configured');
      return;
    }
    if (!_currentUserId) {
      console.warn('[sync] pushFeed skipped: no userId set');
      return;
    }
    // Cache feed data immediately so pushNewItems can find it
    _feedsCache.set(feed.id, feed);

    const doInsert = async () => {
      const row = feedToRow(feed, _currentUserId!);
      console.log('[sync] pushFeed inserting:', feed.name, feed.source, 'userId:', _currentUserId);
      const { error } = await supabase
        .from('feeds')
        .upsert([row], { onConflict: 'id,user_id' });
      if (error) {
        dispatchSyncError('pushFeed', error);
      } else {
        console.log('[sync] pushFeed OK:', feed.name);
      }
    };

    // Track the promise so pushNewItems can await it
    const promise = doInsert();
    _pushFeedPromises.set(feed.id, promise);
    await promise;
    _pushFeedPromises.delete(feed.id);
  },

  /** Delete a feed from remote immediately */
  async deleteFeed(feedId: string): Promise<void> {
    if (!isSupabaseConfigured || !_currentUserId) return;
    const { error } = await supabase
      .from('feeds')
      .delete()
      .eq('id', feedId)
      .eq('user_id', _currentUserId);
    if (error) dispatchSyncError('deleteFeed', error);
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

    // Ensure parent feeds exist in Supabase (awaits in-flight pushFeed + uses cache)
    const feedIds = [...new Set(items.map(i => i.feedId))];
    const failedFeedIds = new Set<string>();
    for (const feedId of feedIds) {
      const ok = await ensureFeedInSupabase(feedId, userId);
      if (!ok) failedFeedIds.add(feedId);
    }

    // Only push items whose parent feed is confirmed in Supabase
    const safeItems = failedFeedIds.size > 0
      ? items.filter(i => !failedFeedIds.has(i.feedId))
      : items;

    for (let i = 0; i < safeItems.length; i += 500) {
      const batch = safeItems.slice(i, i + 500);
      const rows = batch.map(item => itemToRow(item, userId));
      const { error } = await supabase
        .from('feed_items')
        .upsert(rows, { onConflict: 'id,user_id' });
      if (error) dispatchSyncError('pushNewItems batch', error);
    }
  },
};
