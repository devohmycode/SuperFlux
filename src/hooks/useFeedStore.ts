import { useState, useEffect, useCallback, useRef } from 'react';
import type { Feed, FeedItem, FeedCategory, FeedSource } from '../types';
import { fetchAndParseFeed, discoverFeedInfo } from '../services/rssService';

// Storage keys
const STORAGE_KEYS = {
  FEEDS: 'superflux_feeds',
  ITEMS: 'superflux_items',
  LAST_SYNC: 'superflux_last_sync',
  FOLDERS: 'superflux_folders',
  FAVORITES_ORDER: 'superflux_favorites_order',
  READLATER_ORDER: 'superflux_readlater_order',
};

// Default source styling
export const sourceDefaults: Record<FeedSource, { icon: string; color: string }> = {
  article: { icon: '◇', color: '#D4A853' },
  reddit: { icon: '⬢', color: '#FF4500' },
  youtube: { icon: '▶', color: '#FF0000' },
  twitter: { icon: '𝕏', color: '#1DA1F2' },
  mastodon: { icon: '🐘', color: '#6364FF' },
  podcast: { icon: '🎙', color: '#9B59B6' },
};

// Category definitions
const categoryDefinitions: { id: string; label: string; sources: FeedSource[] }[] = [
  { id: 'cat-articles', label: 'Articles', sources: ['article'] },
  { id: 'cat-reddit', label: 'Reddit', sources: ['reddit'] },
  { id: 'cat-youtube', label: 'YouTube', sources: ['youtube'] },
  { id: 'cat-social', label: 'Réseaux', sources: ['twitter', 'mastodon'] },
  { id: 'cat-podcast', label: 'Podcasts', sources: ['podcast'] },
];

// Helper to generate unique IDs
let idCounter = Date.now();
function generateId(prefix: string): string {
  return `${prefix}-${idCounter++}`;
}

// Storage helpers
function loadFromStorage<T>(key: string, defaultValue: T): T {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return defaultValue;
    const parsed = JSON.parse(stored);
    // Handle date revival for items
    if (key === STORAGE_KEYS.ITEMS && Array.isArray(parsed)) {
      return parsed.map((item: FeedItem) => ({
        ...item,
        publishedAt: new Date(item.publishedAt),
        isBookmarked: item.isBookmarked ?? false,
      })) as T;
    }
    return parsed;
  } catch {
    return defaultValue;
  }
}

function saveToStorage<T>(key: string, value: T): void {
  try {
    const json = JSON.stringify(value);
    localStorage.setItem(key, json);
  } catch (e) {
    console.error(`[store] Failed to save ${key} (${Math.round(JSON.stringify(value).length / 1024)}KB):`, e);
  }
}

// Deduplicate items — keeps the first occurrence (most recent by position)
// Detects dupes by: exact id, exact url, or same title+feedId
function deduplicateItems(items: FeedItem[]): FeedItem[] {
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  const seenTitleFeed = new Set<string>();
  const result: FeedItem[] = [];

  for (const item of items) {
    if (seenIds.has(item.id)) continue;
    if (item.url && seenUrls.has(item.url)) continue;
    const titleKey = `${item.feedId}::${item.title.trim().toLowerCase()}`;
    if (seenTitleFeed.has(titleKey)) continue;

    seenIds.add(item.id);
    if (item.url) seenUrls.add(item.url);
    seenTitleFeed.add(titleKey);
    result.push(item);
  }

  return result;
}

// Build categories from feeds
function buildCategories(feeds: Feed[], folders: Record<string, string[]>): FeedCategory[] {
  return categoryDefinitions
    .map(def => ({
      id: def.id,
      label: def.label,
      source: def.sources[0],
      feeds: feeds.filter(f => def.sources.includes(f.source)),
      folders: folders[def.id] || [],
    }))
    .filter(cat => cat.feeds.length > 0);
}

/** Callbacks that App.tsx can hook into for Supabase sync */
export interface FeedStoreCallbacks {
  onFeedAdded?: (feed: Feed) => void;
  onFeedRemoved?: (feedId: string) => void;
  onItemsChanged?: (items: FeedItem[]) => void;
  onNewItemsFetched?: (items: FeedItem[]) => void;
}

export interface FeedStore {
  // Data
  feeds: Feed[];
  items: FeedItem[];
  categories: FeedCategory[];
  lastSyncTime: Date | null;

  // Sync state
  isSyncing: boolean;
  syncProgress: number;
  syncError: string | null;

  // Actions
  addFeed: (url: string, name: string, source: FeedSource) => Promise<Feed>;
  removeFeed: (feedId: string) => void;
  renameFeed: (feedId: string, newName: string) => void;
  syncFeed: (feedId: string) => Promise<void>;
  syncAll: () => Promise<void>;
  markAsRead: (itemId: string) => void;
  markAllAsRead: (feedId?: string) => void;
  toggleRead: (itemId: string) => void;
  toggleStar: (itemId: string) => void;
  toggleBookmark: (itemId: string) => void;
  importFeeds: (feeds: { url: string; name: string; source: FeedSource }[]) => number;
  removeDuplicates: () => number;
  setSummary: (itemId: string, summary: string) => void;
  setFullContent: (itemId: string, fullContent: string) => void;
  getItemsByFeed: (feedId: string) => FeedItem[];
  getItemsBySource: (source: FeedSource) => FeedItem[];
  getAllItems: () => FeedItem[];

  // Ordering for favorites / read later
  getFavoritesOrder: () => string[];
  getReadLaterOrder: () => string[];
  reorderFavorites: (orderedIds: string[]) => void;
  reorderReadLater: (orderedIds: string[]) => void;

  // Folder actions (paths like "Tech/Frontend/React")
  createFolder: (categoryId: string, name: string, parentPath?: string) => void;
  renameFolder: (categoryId: string, oldPath: string, newName: string) => void;
  deleteFolder: (categoryId: string, path: string) => void;
  moveFeedToFolder: (feedId: string, folder: string | undefined) => void;
}

export function useFeedStore(callbacks?: FeedStoreCallbacks): FeedStore {
  const [feeds, setFeeds] = useState<Feed[]>(() => loadFromStorage(STORAGE_KEYS.FEEDS, []));
  const [items, setItems] = useState<FeedItem[]>(() => deduplicateItems(loadFromStorage(STORAGE_KEYS.ITEMS, [])));
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.LAST_SYNC);
    return stored ? new Date(stored) : null;
  });

  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [folders, setFolders] = useState<Record<string, string[]>>(() =>
    loadFromStorage(STORAGE_KEYS.FOLDERS, {}),
  );

  // Keep stable refs to avoid stale closures in async callbacks
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Persist feeds
  useEffect(() => {
    saveToStorage(STORAGE_KEYS.FEEDS, feeds);
  }, [feeds]);

  // Persist items (strip fullContent to avoid blowing localStorage quota)
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const itemsToSave = items.map(({ fullContent, ...rest }) => rest);
    saveToStorage(STORAGE_KEYS.ITEMS, itemsToSave);
  }, [items]);

  // Persist last sync time
  useEffect(() => {
    if (lastSyncTime) {
      localStorage.setItem(STORAGE_KEYS.LAST_SYNC, lastSyncTime.toISOString());
    }
  }, [lastSyncTime]);

  // Persist folders
  useEffect(() => {
    saveToStorage(STORAGE_KEYS.FOLDERS, folders);
  }, [folders]);

  // Listen for sync events from SyncService (reload from localStorage)
  useEffect(() => {
    const handler = () => {
      setFeeds(loadFromStorage(STORAGE_KEYS.FEEDS, []));
      setItems(deduplicateItems(loadFromStorage(STORAGE_KEYS.ITEMS, [])));
    };
    window.addEventListener('superflux-sync-update', handler);
    return () => window.removeEventListener('superflux-sync-update', handler);
  }, []);

  // Recalculate unread counts from actual items
  useEffect(() => {
    const unreadByFeed = new Map<string, number>();
    for (const item of items) {
      if (!item.isRead) {
        unreadByFeed.set(item.feedId, (unreadByFeed.get(item.feedId) || 0) + 1);
      }
    }
    setFeeds(prev => {
      const needsUpdate = prev.some(f => f.unreadCount !== (unreadByFeed.get(f.id) || 0));
      if (!needsUpdate) return prev;
      return prev.map(f => ({ ...f, unreadCount: unreadByFeed.get(f.id) || 0 }));
    });
  }, [items]);

  // Build categories dynamically
  const categories = buildCategories(feeds, folders);

  // Add a new feed
  const addFeed = useCallback(async (url: string, name: string, source: FeedSource): Promise<Feed> => {
    // Try to discover feed info
    let feedInfo: { name: string; description: string } | null = null;
    try {
      feedInfo = await discoverFeedInfo(url);
    } catch (e) {
      console.error('[store] discoverFeedInfo failed:', e);
    }
    const defaults = sourceDefaults[source];

    const feed: Feed = {
      id: generateId('feed'),
      name: feedInfo?.name || name || new URL(url).hostname,
      source,
      icon: defaults.icon,
      url,
      unreadCount: 0,
      color: defaults.color,
      updated_at: new Date().toISOString(),
    };

    console.log('[store] Adding feed:', feed.name, feed.source, feed.url);
    setFeeds(prev => [...prev, feed]);
    cbRef.current?.onFeedAdded?.(feed);

    // Immediately sync the new feed
    try {
      const existingIds = new Set<string>();
      const newItems = await fetchAndParseFeed(feed, existingIds);
      console.log(`[store] Fetched ${newItems.length} items for ${feed.name}`);

      if (newItems.length > 0) {
        const timestampedItems = newItems.map(item => ({ ...item, updated_at: new Date().toISOString() }));
        setItems(prev => deduplicateItems([...timestampedItems, ...prev]));
        cbRef.current?.onNewItemsFetched?.(timestampedItems);
      }
    } catch (e) {
      console.error(`[store] Failed to fetch items for ${feed.name}:`, e);
    }

    return feed;
  }, []);

  // Remove a feed
  const removeFeed = useCallback((feedId: string) => {
    setFeeds(prev => prev.filter(f => f.id !== feedId));
    setItems(prev => prev.filter(i => i.feedId !== feedId));
    cbRef.current?.onFeedRemoved?.(feedId);
  }, []);

  // Rename a feed
  const renameFeed = useCallback((feedId: string, newName: string) => {
    if (!newName.trim()) return;
    setFeeds(prev => prev.map(f => f.id === feedId ? { ...f, name: newName.trim() } : f));
    setItems(prev => prev.map(i => i.feedId === feedId ? { ...i, feedName: newName.trim() } : i));
  }, []);

  // Sync a single feed
  const syncFeed = useCallback(async (feedId: string) => {
    const feed = feeds.find(f => f.id === feedId);
    if (!feed) return;

    try {
      const existingIds = new Set(
        itemsRef.current.filter(i => i.feedId === feedId).map(i => i.id)
      );

      const newItems = await fetchAndParseFeed(feed, existingIds);

      if (newItems.length > 0) {
        const timestampedItems = newItems.map(item => ({ ...item, updated_at: new Date().toISOString() }));
        setItems(prev => deduplicateItems([...timestampedItems, ...prev]));
        cbRef.current?.onNewItemsFetched?.(timestampedItems);
      }
    } catch (e) {
      console.error(`Failed to sync feed ${feed.name}:`, e);
      throw e;
    }
  }, [feeds]);

  // Sync all feeds
  const syncAll = useCallback(async () => {
    if (feeds.length === 0) return;

    setIsSyncing(true);
    setSyncProgress(0);
    setSyncError(null);

    let completed = 0;
    const errors: string[] = [];

    for (const feed of feeds) {
      try {
        await syncFeed(feed.id);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        errors.push(`${feed.name} (${reason})`);
      }
      completed++;
      setSyncProgress((completed / feeds.length) * 100);
    }

    setIsSyncing(false);
    setLastSyncTime(new Date());

    if (errors.length > 0) {
      setSyncError(`Échec: ${errors.join(' · ')}`);
    }
  }, [feeds, syncFeed]);

  // Helper: update item + notify callback (callback runs AFTER state update via microtask)
  const updateItem = useCallback((itemId: string, updater: (item: FeedItem) => FeedItem) => {
    let changedItem: FeedItem | undefined;
    setItems(prev => {
      const next = prev.map(item => item.id === itemId ? updater(item) : item);
      changedItem = next.find(i => i.id === itemId);
      return next;
    });
    // Notify outside of setState to avoid breaking React batch on callback error
    queueMicrotask(() => {
      if (changedItem) cbRef.current?.onItemsChanged?.([changedItem]);
    });
  }, []);

  // Mark item as read
  const markAsRead = useCallback((itemId: string) => {
    updateItem(itemId, item =>
      !item.isRead ? { ...item, isRead: true, updated_at: new Date().toISOString() } : item
    );
  }, [updateItem]);

  // Mark all as read
  const markAllAsRead = useCallback((feedId?: string) => {
    let changedItems: FeedItem[] = [];
    setItems(prev => {
      const now = new Date().toISOString();
      const next = prev.map(item =>
        (!feedId || item.feedId === feedId) && !item.isRead
          ? { ...item, isRead: true, updated_at: now }
          : item
      );
      changedItems = next.filter((item, i) => item !== prev[i]);
      return next;
    });
    queueMicrotask(() => {
      if (changedItems.length > 0) cbRef.current?.onItemsChanged?.(changedItems);
    });
  }, []);

  // Toggle read/unread
  const toggleRead = useCallback((itemId: string) => {
    updateItem(itemId, item => ({ ...item, isRead: !item.isRead, updated_at: new Date().toISOString() }));
  }, [updateItem]);

  // Remove duplicates manually
  const removeDuplicates = useCallback((): number => {
    let removed = 0;
    setItems(prev => {
      const deduped = deduplicateItems(prev);
      removed = prev.length - deduped.length;
      return removed > 0 ? deduped : prev;
    });
    return removed;
  }, []);

  // Toggle star
  const toggleStar = useCallback((itemId: string) => {
    updateItem(itemId, item => ({ ...item, isStarred: !item.isStarred, updated_at: new Date().toISOString() }));
  }, [updateItem]);

  // Import feeds in batch (OPML import — no immediate sync)
  const importFeeds = useCallback((newFeeds: { url: string; name: string; source: FeedSource }[]): number => {
    let added = 0;
    let addedFeeds: Feed[] = [];
    setFeeds(prev => {
      const existingUrls = new Set(prev.map(f => f.url));
      const toAdd: Feed[] = [];
      for (const f of newFeeds) {
        if (existingUrls.has(f.url)) continue;
        const defaults = sourceDefaults[f.source];
        toAdd.push({
          id: generateId('feed'),
          name: f.name,
          source: f.source,
          icon: defaults.icon,
          url: f.url,
          unreadCount: 0,
          color: defaults.color,
          updated_at: new Date().toISOString(),
        });
        existingUrls.add(f.url);
      }
      added = toAdd.length;
      addedFeeds = toAdd;
      return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
    });
    queueMicrotask(() => {
      for (const feed of addedFeeds) cbRef.current?.onFeedAdded?.(feed);
    });
    return added;
  }, []);

  // Set summary on item
  const setSummary = useCallback((itemId: string, summary: string) => {
    setItems(prev => prev.map(item =>
      item.id === itemId ? { ...item, summary } : item
    ));
  }, []);

  // Set full extracted content on item
  const setFullContent = useCallback((itemId: string, fullContent: string) => {
    setItems(prev => prev.map(item =>
      item.id === itemId ? { ...item, fullContent } : item
    ));
  }, []);

  // Toggle bookmark (read later)
  const toggleBookmark = useCallback((itemId: string) => {
    updateItem(itemId, item => ({ ...item, isBookmarked: !item.isBookmarked, updated_at: new Date().toISOString() }));
  }, [updateItem]);

  // Get items by feed
  const getItemsByFeed = useCallback((feedId: string) => {
    return items
      .filter(i => i.feedId === feedId)
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  }, [items]);

  // Get items by source
  const getItemsBySource = useCallback((source: FeedSource) => {
    const sources = source === 'twitter' ? ['twitter', 'mastodon'] : [source];
    return items
      .filter(i => sources.includes(i.source))
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  }, [items]);

  // Get all items
  const getAllItems = useCallback(() => {
    return items.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  }, [items]);

  // ── Folder CRUD ──

  const createFolder = useCallback((categoryId: string, name: string, parentPath?: string) => {
    const path = parentPath ? `${parentPath}/${name}` : name;
    setFolders(prev => {
      const existing = prev[categoryId] || [];
      if (existing.includes(path)) return prev;
      return { ...prev, [categoryId]: [...existing, path] };
    });
  }, []);

  const renameFolder = useCallback((categoryId: string, oldPath: string, newName: string) => {
    if (!newName) return;
    const lastSlash = oldPath.lastIndexOf('/');
    const newPath = lastSlash >= 0 ? `${oldPath.substring(0, lastSlash)}/${newName}` : newName;
    if (oldPath === newPath) return;
    // Rename this path and all descendant paths
    setFolders(prev => {
      const existing = prev[categoryId] || [];
      return {
        ...prev,
        [categoryId]: existing.map(p => {
          if (p === oldPath) return newPath;
          if (p.startsWith(oldPath + '/')) return newPath + p.substring(oldPath.length);
          return p;
        }),
      };
    });
    // Update feeds in this folder or any descendant
    setFeeds(prev => prev.map(f => {
      if (!f.folder) return f;
      if (f.folder === oldPath) return { ...f, folder: newPath };
      if (f.folder.startsWith(oldPath + '/')) return { ...f, folder: newPath + f.folder.substring(oldPath.length) };
      return f;
    }));
  }, []);

  const deleteFolder = useCallback((categoryId: string, path: string) => {
    // Move feeds from deleted folder (and descendants) to parent
    const lastSlash = path.lastIndexOf('/');
    const parentPath = lastSlash >= 0 ? path.substring(0, lastSlash) : undefined;
    // Remove this path and all descendant paths
    setFolders(prev => {
      const existing = prev[categoryId] || [];
      return {
        ...prev,
        [categoryId]: existing.filter(p => p !== path && !p.startsWith(path + '/')),
      };
    });
    setFeeds(prev => prev.map(f => {
      if (!f.folder) return f;
      if (f.folder === path || f.folder.startsWith(path + '/')) {
        return { ...f, folder: parentPath };
      }
      return f;
    }));
  }, []);

  const moveFeedToFolder = useCallback((feedId: string, folder: string | undefined) => {
    setFeeds(prev => prev.map(f => f.id === feedId ? { ...f, folder } : f));
  }, []);

  // ── Favorites / Read Later ordering ──

  const getFavoritesOrder = useCallback((): string[] => {
    return loadFromStorage<string[]>(STORAGE_KEYS.FAVORITES_ORDER, []);
  }, []);

  const getReadLaterOrder = useCallback((): string[] => {
    return loadFromStorage<string[]>(STORAGE_KEYS.READLATER_ORDER, []);
  }, []);

  const reorderFavorites = useCallback((orderedIds: string[]) => {
    saveToStorage(STORAGE_KEYS.FAVORITES_ORDER, orderedIds);
  }, []);

  const reorderReadLater = useCallback((orderedIds: string[]) => {
    saveToStorage(STORAGE_KEYS.READLATER_ORDER, orderedIds);
  }, []);

  return {
    feeds,
    items,
    categories,
    lastSyncTime,
    isSyncing,
    syncProgress,
    syncError,
    addFeed,
    removeFeed,
    renameFeed,
    syncFeed,
    syncAll,
    markAsRead,
    markAllAsRead,
    toggleRead,
    toggleStar,
    toggleBookmark,
    setSummary,
    setFullContent,
    importFeeds,
    removeDuplicates,
    getItemsByFeed,
    getItemsBySource,
    getAllItems,
    getFavoritesOrder,
    getReadLaterOrder,
    reorderFavorites,
    reorderReadLater,
    createFolder,
    renameFolder,
    deleteFolder,
    moveFeedToFolder,
  };
}
