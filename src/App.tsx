import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { SourcePanel } from './components/SourcePanel';
import { FeedPanel } from './components/FeedPanel';
import { ReaderPanel } from './components/ReaderPanel';
import { ResizeHandle } from './components/ResizeHandle';
import { TitleBar } from './components/TitleBar';
import { useResizablePanels } from './hooks/useResizablePanels';
import { useFeedStore, type FeedStoreCallbacks } from './hooks/useFeedStore';
import { useHighlightStore } from './hooks/useHighlightStore';
import { useAuth } from './contexts/AuthContext';
import { SyncService } from './services/syncService';
import { getProviderConfig, ProviderSyncService } from './services/providerSync';
import type { NewFeedData } from './components/AddFeedModal';
import type { FeedItem, FeedSource } from './types';

const sourceLabels: Record<FeedSource, string> = {
  article: 'Articles',
  reddit: 'Reddit',
  youtube: 'YouTube',
  twitter: 'Réseaux',
  mastodon: 'Réseaux',
  podcast: 'Podcasts',
};

const SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes

export default function App() {
  const { user } = useAuth();

  // Sync callbacks wired to SyncService (fire-and-forget, errors logged)
  // Also notifies provider sync when item statuses change
  const syncCallbacks = useMemo<FeedStoreCallbacks>(() => ({
    onFeedAdded: (feed) => { SyncService.pushFeed(feed).catch(e => console.error('[sync] pushFeed', e)); },
    onFeedRemoved: (feedId) => { SyncService.deleteFeed(feedId).catch(e => console.error('[sync] deleteFeed', e)); },
    onItemsChanged: (items) => {
      items.forEach(item => SyncService.queueItemUpdate(item));
      // Push status changes to provider (if connected)
      const pConfig = getProviderConfig();
      if (pConfig?.syncEnabled) {
        items.forEach(item => {
          if (item.remoteId) {
            ProviderSyncService.pushItemStatus(item, pConfig).catch(e =>
              console.error('[providerSync] pushItemStatus', e)
            );
          }
        });
      }
    },
    onNewItemsFetched: (items) => { SyncService.pushNewItems(items).catch(e => console.error('[sync] pushNewItems', e)); },
  }), []);

  const store = useFeedStore(syncCallbacks);
  const highlightStore = useHighlightStore();

  const [selectedFeedId, setSelectedFeedId] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<FeedSource | null>(null);
  const [selectedItem, setSelectedItem] = useState<FeedItem | null>(null);
  const [feedPanelOpen, setFeedPanelOpen] = useState(true);
  const [sourcePanelOpen, setSourcePanelOpen] = useState(true);
  const [readerPanelOpen, setReaderPanelOpen] = useState(true);
  const [showFavorites, setShowFavorites] = useState(false);
  const [showReadLater, setShowReadLater] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const handleToggleCollapse = useCallback(() => {
    setIsCollapsed(prev => !prev);
  }, []);

  const { widths, handleMouseDown, containerRef } = useResizablePanels({
    panels: [
      { minWidth: 200, maxWidth: 800, defaultWidth: 18 },
      { minWidth: 300, maxWidth: 1200, defaultWidth: 32 },
      { minWidth: 400, maxWidth: 2400, defaultWidth: 50 },
    ],
  });

  // Track previous user to detect login/logout
  const prevUserRef = useRef<string | null>(null);

  useEffect(() => {
    const userId = user?.id ?? null;
    SyncService.setUserId(userId);

    // On login: run fullSync
    if (userId && prevUserRef.current !== userId) {
      SyncService.fullSync().catch(err => console.error('[sync] fullSync failed', err));
    }
    prevUserRef.current = userId;
  }, [user]);

  // Periodic fullSync every 5 minutes while logged in
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      SyncService.fullSync().catch(err => console.error('[sync] periodic fullSync failed', err));
    }, SYNC_INTERVAL);
    return () => clearInterval(interval);
  }, [user]);

  // Provider sync: initial sync + periodic interval (5 min)
  useEffect(() => {
    const pConfig = getProviderConfig();
    if (!pConfig?.syncEnabled) return;

    // Initial status sync + entry linking
    ProviderSyncService.linkEntries(pConfig)
      .then(() => ProviderSyncService.syncStatuses(pConfig))
      .catch(err => console.error('[providerSync] initial sync failed', err));

    const interval = setInterval(() => {
      const currentConfig = getProviderConfig();
      if (!currentConfig?.syncEnabled) return;
      ProviderSyncService.syncStatuses(currentConfig)
        .catch(err => console.error('[providerSync] periodic sync failed', err));
    }, SYNC_INTERVAL);

    return () => clearInterval(interval);
  }, []);

  // Get items based on selection
  const items = useMemo(() => {
    if (showFavorites) return store.getAllItems().filter(item => item.isStarred);
    if (showReadLater) return store.getAllItems().filter(item => item.isBookmarked);
    if (selectedFeedId) return store.getItemsByFeed(selectedFeedId);
    if (selectedSource) return store.getItemsBySource(selectedSource);
    return store.getAllItems();
  }, [selectedFeedId, selectedSource, showFavorites, showReadLater, store]);

  const allItems = useMemo(() => store.getAllItems(), [store]);

  const totalUnreadCount = useMemo(() =>
    allItems.filter(item => !item.isRead).length,
  [allItems]);

  const favoritesCount = useMemo(() =>
    allItems.filter(item => item.isStarred).length,
  [allItems]);

  const readLaterCount = useMemo(() =>
    allItems.filter(item => item.isBookmarked).length,
  [allItems]);

  // Breadcrumb data
  const feedName = useMemo(() => {
    if (selectedFeedId) {
      for (const cat of store.categories) {
        const feed = cat.feeds.find(f => f.id === selectedFeedId);
        if (feed) return feed.name;
      }
      return items[0]?.feedName || null;
    }
    return null;
  }, [selectedFeedId, store.categories, items]);

  const selectedHighlights = useMemo(() => {
    if (!selectedItem) return [];
    return highlightStore.getHighlights(selectedItem.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItem, highlightStore.data]);

  const sourceName = selectedSource ? sourceLabels[selectedSource] : null;

  const handleSelectFeed = useCallback((feedId: string, source: FeedSource) => {
    setSelectedFeedId(feedId);
    setSelectedSource(source);
    setSelectedItem(null);
    setShowFavorites(false);
    setShowReadLater(false);
    setFeedPanelOpen(true);
  }, []);

  const handleSelectSource = useCallback((source: FeedSource) => {
    setSelectedFeedId(null);
    setSelectedSource(source);
    setSelectedItem(null);
    setShowFavorites(false);
    setShowReadLater(false);
    setFeedPanelOpen(true);
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedFeedId(null);
    setSelectedSource(null);
    setSelectedItem(null);
    setShowFavorites(false);
    setShowReadLater(false);
    setFeedPanelOpen(true);
  }, []);

  const handleSelectFavorites = useCallback(() => {
    setSelectedFeedId(null);
    setSelectedSource(null);
    setSelectedItem(null);
    setShowFavorites(true);
    setShowReadLater(false);
    setFeedPanelOpen(true);
  }, []);

  const handleSelectReadLater = useCallback(() => {
    setSelectedFeedId(null);
    setSelectedSource(null);
    setSelectedItem(null);
    setShowFavorites(false);
    setShowReadLater(true);
    setFeedPanelOpen(true);
  }, []);

  const handleAddFeed = useCallback(async (feedData: NewFeedData) => {
    await store.addFeed(feedData.url, feedData.name, feedData.source);
  }, [store]);

  const handleSelectItem = useCallback((item: FeedItem) => {
    setSelectedItem(item);
    store.markAsRead(item.id);
  }, [store]);

  const handleSyncAll = useCallback(async () => {
    await store.syncAll();
  }, [store]);

  const handleCloseFeedPanel = useCallback(() => {
    setFeedPanelOpen(false);
  }, []);

  const handleBreadcrumbAll = useCallback(() => {
    setSelectedFeedId(null);
    setSelectedSource(null);
    setSelectedItem(null);
    setFeedPanelOpen(true);
  }, []);

  const handleBreadcrumbSource = useCallback(() => {
    setSelectedFeedId(null);
    setSelectedItem(null);
    setFeedPanelOpen(true);
  }, []);

  const handleBreadcrumbFeed = useCallback(() => {
    setSelectedItem(null);
    setFeedPanelOpen(true);
  }, []);

  const handleCloseSourcePanel = useCallback(() => {
    setSourcePanelOpen(false);
  }, []);

  const handleCloseReaderPanel = useCallback(() => {
    setReaderPanelOpen(false);
  }, []);

  // Keyboard shortcuts: 1/2/3 toggle panels
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;

      if (e.key === '1' || (e.altKey && e.key === '1')) {
        e.preventDefault();
        setSourcePanelOpen(prev => !prev);
      } else if (e.key === '2' || (e.altKey && e.key === '2')) {
        e.preventDefault();
        setFeedPanelOpen(prev => !prev);
      } else if (e.key === '3' || (e.altKey && e.key === '3')) {
        e.preventDefault();
        setReaderPanelOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // When some panels are closed, remaining open panels share the space via flex
  const allOpen = sourcePanelOpen && feedPanelOpen && readerPanelOpen;

  return (
    <div className={`app-wrapper ${isCollapsed ? 'app-wrapper--collapsed' : ''}`}>
      <TitleBar isCollapsed={isCollapsed} onToggleCollapse={handleToggleCollapse} unreadCount={totalUnreadCount} favoritesCount={favoritesCount} readLaterCount={readLaterCount} />
      {!isCollapsed && (
        <div className="app" ref={containerRef}>
          {sourcePanelOpen ? (
            <>
              <div className="panel panel-source" style={allOpen ? { width: `${widths[0]}%` } : { flex: 1 }}>
                <SourcePanel
                  categories={store.categories}
                  selectedFeedId={selectedFeedId}
                  selectedSource={selectedSource}
                  showFavorites={showFavorites}
                  favoritesCount={favoritesCount}
                  showReadLater={showReadLater}
                  readLaterCount={readLaterCount}
                  onSelectFeed={handleSelectFeed}
                  onSelectSource={handleSelectSource}
                  onSelectAll={handleSelectAll}
                  onSelectFavorites={handleSelectFavorites}
                  onSelectReadLater={handleSelectReadLater}
                  onAddFeed={handleAddFeed}
                  onImportOpml={store.importFeeds}
                  onRemoveFeed={store.removeFeed}
                  onSync={handleSyncAll}
                  isSyncing={store.isSyncing}
                  syncProgress={store.syncProgress}
                  onCreateFolder={store.createFolder}
                  onRenameFolder={store.renameFolder}
                  onDeleteFolder={store.deleteFolder}
                  onMoveFeedToFolder={store.moveFeedToFolder}
                  onClose={handleCloseSourcePanel}
                />
              </div>
              {allOpen && <ResizeHandle onMouseDown={(e) => handleMouseDown(0, e)} />}
            </>
          ) : (
            <div className="panel-strip" onClick={() => setSourcePanelOpen(true)} title="Ouvrir le panneau Sources (1)">
              <span className="panel-strip-icon">◈</span>
            </div>
          )}

          {feedPanelOpen ? (
            <>
              <div className="panel panel-feed" style={allOpen ? { width: `${widths[1]}%` } : { flex: 1 }}>
                <FeedPanel
                  categories={store.categories}
                  items={items}
                  selectedFeedId={selectedFeedId}
                  selectedSource={selectedSource}
                  selectedItemId={selectedItem?.id || null}
                  showFavorites={showFavorites}
                  showReadLater={showReadLater}
                  onSelectItem={handleSelectItem}
                  onMarkAllAsRead={() => store.markAllAsRead(selectedFeedId || undefined)}
                  onToggleRead={store.toggleRead}
                  onToggleStar={store.toggleStar}
                  onToggleBookmark={store.toggleBookmark}
                  onClose={handleCloseFeedPanel}
                />
              </div>
              {allOpen && <ResizeHandle onMouseDown={(e) => handleMouseDown(1, e)} />}
            </>
          ) : (
            <div className="panel-strip" onClick={() => setFeedPanelOpen(true)} title="Ouvrir le panneau Feed (2)">
              <span className="panel-strip-icon">☰</span>
            </div>
          )}

          {readerPanelOpen ? (
            <div className="panel panel-reader" style={{ flex: 1 }}>
              <ReaderPanel
                item={selectedItem}
                onToggleStar={() => selectedItem && store.toggleStar(selectedItem.id)}
                onSummaryGenerated={(itemId, summary) => store.setSummary(itemId, summary)}
                onFullContentExtracted={(itemId, fullContent) => store.setFullContent(itemId, fullContent)}
                breadcrumb={{
                  sourceName,
                  feedName,
                  itemTitle: selectedItem?.title || null,
                  onClickAll: handleBreadcrumbAll,
                  onClickSource: handleBreadcrumbSource,
                  onClickFeed: handleBreadcrumbFeed,
                }}
                feedPanelOpen={feedPanelOpen}
                highlights={selectedHighlights}
                onHighlightAdd={(itemId, text, color, prefix, suffix) =>
                  highlightStore.addHighlight(itemId, text, color, prefix, suffix)}
                onHighlightRemove={(itemId, highlightId) =>
                  highlightStore.removeHighlight(itemId, highlightId)}
                onHighlightNoteUpdate={(itemId, highlightId, note) =>
                  highlightStore.updateHighlightNote(itemId, highlightId, note)}
                onClose={handleCloseReaderPanel}
              />
            </div>
          ) : (
            <div className="panel-strip" onClick={() => setReaderPanelOpen(true)} title="Ouvrir le panneau Lecture (3)">
              <span className="panel-strip-icon">¶</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
