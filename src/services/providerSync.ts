import { createProvider, type ProviderConfig } from './providers';
import type { Feed, FeedItem, FeedSource } from '../types';

const STORAGE_KEYS = {
  PROVIDER_CONFIG: 'superflux_provider_config',
  REMOTE_MAPPING: 'superflux_remote_mapping',
  FEEDS: 'superflux_feeds',
  ITEMS: 'superflux_items',
};

// Source defaults (duplicated from useFeedStore to avoid circular deps)
const sourceDefaults: Record<FeedSource, { icon: string; color: string }> = {
  article: { icon: '◇', color: '#D4A853' },
  reddit: { icon: '⬢', color: '#FF4500' },
  youtube: { icon: '▶', color: '#FF0000' },
  twitter: { icon: '𝕏', color: '#1DA1F2' },
  mastodon: { icon: '🐘', color: '#6364FF' },
  podcast: { icon: '🎙', color: '#9B59B6' },
};

let idCounter = Date.now();
function generateId(prefix: string): string {
  return `${prefix}-${idCounter++}`;
}

// ── Storage helpers ──

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error(`[providerSync] Failed to save ${key}:`, e);
  }
}

// ── Config persistence ──

export function getProviderConfig(): ProviderConfig | null {
  return loadJSON<ProviderConfig | null>(STORAGE_KEYS.PROVIDER_CONFIG, null);
}

export function saveProviderConfig(config: ProviderConfig): void {
  saveJSON(STORAGE_KEYS.PROVIDER_CONFIG, config);
}

export function clearProviderConfig(): void {
  localStorage.removeItem(STORAGE_KEYS.PROVIDER_CONFIG);
  localStorage.removeItem(STORAGE_KEYS.REMOTE_MAPPING);
}

// ── ID Mapping: remoteId <-> localId ──

function getMapping(): Record<string, string> {
  return loadJSON(STORAGE_KEYS.REMOTE_MAPPING, {});
}

function saveMapping(mapping: Record<string, string>): void {
  saveJSON(STORAGE_KEYS.REMOTE_MAPPING, mapping);
}

// ── Detect feed source from URL ──

function detectSource(url: string): FeedSource {
  const lower = url.toLowerCase();
  if (lower.includes('reddit.com') || lower.includes('/r/')) return 'reddit';
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
  if (lower.includes('twitter.com') || lower.includes('x.com') || lower.includes('nitter')) return 'twitter';
  if (lower.includes('mastodon') || lower.includes('fosstodon') || lower.includes('hachyderm')) return 'mastodon';
  return 'article';
}

// ── Provider Sync Service ──

export const ProviderSyncService = {
  /**
   * Import feeds from the connected provider.
   * Creates local Feed objects with remoteId set.
   * Returns the number of feeds added.
   */
  async importFeeds(config: ProviderConfig): Promise<number> {
    const provider = createProvider(config);
    const remoteFeeds = await provider.getFeeds();

    const feeds: Feed[] = loadJSON(STORAGE_KEYS.FEEDS, []);
    const existingUrls = new Set(feeds.map(f => f.url));
    const existingRemoteIds = new Set(feeds.filter(f => f.remoteId).map(f => f.remoteId));

    const mapping = getMapping();
    let added = 0;

    for (const rf of remoteFeeds) {
      // Skip if we already have this feed (by remoteId or URL)
      if (existingRemoteIds.has(rf.remoteId)) continue;
      if (existingUrls.has(rf.feedUrl)) {
        // Link existing feed to remote
        const existing = feeds.find(f => f.url === rf.feedUrl);
        if (existing && !existing.remoteId) {
          existing.remoteId = rf.remoteId;
          existing.providerType = config.type;
          mapping[rf.remoteId] = existing.id;
        }
        continue;
      }

      const source = detectSource(rf.feedUrl);
      const defaults = sourceDefaults[source];

      const feed: Feed = {
        id: generateId('feed'),
        name: rf.title,
        source,
        icon: defaults.icon,
        url: rf.feedUrl,
        unreadCount: 0,
        color: defaults.color,
        updated_at: new Date().toISOString(),
        remoteId: rf.remoteId,
        providerType: config.type,
        folder: rf.category,
      };

      feeds.push(feed);
      mapping[rf.remoteId] = feed.id;
      existingUrls.add(rf.feedUrl);
      added++;
    }

    saveJSON(STORAGE_KEYS.FEEDS, feeds);
    saveMapping(mapping);

    // Notify UI to reload from storage
    window.dispatchEvent(new Event('superflux-sync-update'));

    return added;
  },

  /**
   * Bidirectional sync of read/starred statuses.
   * Compares local state with provider state and reconciles.
   */
  async syncStatuses(config: ProviderConfig): Promise<void> {
    const provider = createProvider(config);

    // Load current local state
    const feeds: Feed[] = loadJSON(STORAGE_KEYS.FEEDS, []);
    const items: FeedItem[] = loadJSON(STORAGE_KEYS.ITEMS, []).map((item: FeedItem) => ({
      ...item,
      publishedAt: new Date(item.publishedAt),
    }));

    // Build lookup: items that have a remoteId
    const itemsByRemoteId = new Map<string, FeedItem>();
    for (const item of items) {
      if (item.remoteId) {
        itemsByRemoteId.set(item.remoteId, item);
      }
    }

    // Build reverse lookup from feed remoteId -> local feedId
    const feedRemoteToLocal = new Map<string, string>();
    for (const feed of feeds) {
      if (feed.remoteId) {
        feedRemoteToLocal.set(feed.remoteId, feed.id);
      }
    }

    // Also build item lookup by URL for items without remoteId
    const itemsByUrl = new Map<string, FeedItem>();
    for (const item of items) {
      if (item.url && !item.remoteId) {
        itemsByUrl.set(item.url, item);
      }
    }

    // Fetch remote statuses
    const [remoteUnreadIds, remoteStarredIds] = await Promise.all([
      provider.getUnreadIds(),
      provider.getStarredIds(),
    ]);

    const remoteUnreadSet = new Set(remoteUnreadIds);
    const remoteStarredSet = new Set(remoteStarredIds);

    // ── Sync: local → remote ──
    const toMarkReadRemote: string[] = [];
    const toMarkUnreadRemote: string[] = [];
    const toStarRemote: string[] = [];
    const toUnstarRemote: string[] = [];

    // ── Sync: remote → local ──
    let localChanged = false;

    for (const item of items) {
      if (!item.remoteId) continue;

      const isRemoteUnread = remoteUnreadSet.has(item.remoteId);
      const isRemoteStarred = remoteStarredSet.has(item.remoteId);

      // Read status sync
      if (item.isRead && isRemoteUnread) {
        // Local is read, remote is unread → push read to remote
        toMarkReadRemote.push(item.remoteId);
      } else if (!item.isRead && !isRemoteUnread) {
        // Local is unread, remote is read → mark local as read
        item.isRead = true;
        item.updated_at = new Date().toISOString();
        localChanged = true;
      }

      // Star status sync
      if (item.isStarred && !isRemoteStarred) {
        // Local is starred, remote is not → push star to remote
        toStarRemote.push(item.remoteId);
      } else if (!item.isStarred && isRemoteStarred) {
        // Local is not starred, remote is → mark local as starred
        item.isStarred = true;
        item.updated_at = new Date().toISOString();
        localChanged = true;
      }
    }

    // Push local changes to remote (batch)
    const pushPromises: Promise<void>[] = [];
    if (toMarkReadRemote.length > 0) {
      pushPromises.push(provider.markAsRead(toMarkReadRemote));
    }
    if (toMarkUnreadRemote.length > 0) {
      pushPromises.push(provider.markAsUnread(toMarkUnreadRemote));
    }
    if (toStarRemote.length > 0) {
      pushPromises.push(provider.starEntries(toStarRemote));
    }
    if (toUnstarRemote.length > 0) {
      pushPromises.push(provider.unstarEntries(toUnstarRemote));
    }

    await Promise.all(pushPromises);

    // Save local changes
    if (localChanged) {
      // Strip fullContent before saving (like useFeedStore does)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const toSave = items.map(({ fullContent, ...rest }) => rest);
      saveJSON(STORAGE_KEYS.ITEMS, toSave);
      window.dispatchEvent(new Event('superflux-sync-update'));
    }

    console.log(
      `[providerSync] Status sync done: ${toMarkReadRemote.length} read→remote, ${toStarRemote.length} star→remote, localChanged=${localChanged}`
    );
  },

  /**
   * Link local items to remote entries by matching URLs.
   * Called after initial feed import + RSS fetch to establish remoteId mappings.
   */
  async linkEntries(config: ProviderConfig): Promise<void> {
    const provider = createProvider(config);

    const items: FeedItem[] = loadJSON(STORAGE_KEYS.ITEMS, []).map((item: FeedItem) => ({
      ...item,
      publishedAt: new Date(item.publishedAt),
    }));

    const mapping = getMapping();

    // Fetch recent entries from provider
    const remoteEntries = await provider.getEntries({ limit: 100 });

    // Build URL → remoteEntry lookup
    const remoteByUrl = new Map<string, { remoteId: string; feedRemoteId: string }>();
    for (const entry of remoteEntries) {
      if (entry.url) {
        remoteByUrl.set(entry.url, { remoteId: entry.remoteId, feedRemoteId: entry.feedRemoteId });
      }
    }

    let changed = false;
    for (const item of items) {
      if (item.remoteId) continue; // Already linked

      const remote = remoteByUrl.get(item.url);
      if (remote) {
        item.remoteId = remote.remoteId;
        item.remoteFeedId = remote.feedRemoteId;
        mapping[remote.remoteId] = item.id;
        changed = true;
      }
    }

    if (changed) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const toSave = items.map(({ fullContent, ...rest }) => rest);
      saveJSON(STORAGE_KEYS.ITEMS, toSave);
      saveMapping(mapping);
      window.dispatchEvent(new Event('superflux-sync-update'));
    }

    console.log(`[providerSync] Linked entries, changed=${changed}`);
  },

  /**
   * Notify provider when a local item status changes.
   * Called from FeedStoreCallbacks.
   */
  async pushItemStatus(item: FeedItem, config: ProviderConfig): Promise<void> {
    if (!item.remoteId) return;

    const provider = createProvider(config);

    try {
      if (item.isRead) {
        await provider.markAsRead([item.remoteId]);
      } else {
        await provider.markAsUnread([item.remoteId]);
      }
    } catch (e) {
      console.error('[providerSync] Failed to push read status:', e);
    }

    try {
      if (item.isStarred) {
        await provider.starEntries([item.remoteId]);
      } else {
        await provider.unstarEntries([item.remoteId]);
      }
    } catch (e) {
      console.error('[providerSync] Failed to push star status:', e);
    }
  },
};
