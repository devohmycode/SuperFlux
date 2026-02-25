import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { SourcePanel, getPinnedItems, type PinEntry } from './components/SourcePanel';
import { FeedPanel } from './components/FeedPanel';
import { ReaderPanel } from './components/ReaderPanel';
import { NotePanel, type Note } from './components/NotePanel';
import { NoteEditor } from './components/NoteEditor';
import { SuperEditor } from './components/SuperEditor';
import { type EditorDoc, loadEditorDocs, saveEditorDocs, loadEditorFolders, saveEditorFolders } from './components/EditorFileList';
import { fetchEditorDocs, upsertEditorDoc, removeEditorDoc, updateEditorDocContent, updateEditorDocMeta } from './services/editorDocService';
import { BookmarkPanel } from './components/BookmarkPanel';
import { BookmarkReader } from './components/BookmarkReader';
import type { WebBookmark } from './services/bookmarkService';
import { toggleBookmarkRead, addBookmark } from './services/bookmarkService';
import { ResizeHandle } from './components/ResizeHandle';
import { TitleBar } from './components/TitleBar';
import { useResizablePanels } from './hooks/useResizablePanels';
import { useFeedStore, type FeedStoreCallbacks } from './hooks/useFeedStore';
import { useHighlightStore } from './hooks/useHighlightStore';
import { useAuth } from './contexts/AuthContext';
import { SyncService, SYNC_ERROR_EVENT } from './services/syncService';
import { getProviderConfig, ProviderSyncService } from './services/providerSync';
import type { NewFeedData } from './components/AddFeedModal';
import type { FeedItem, FeedSource } from './types';
import { UpgradeModal } from './components/UpgradeModal';

const sourceLabels: Record<FeedSource, string> = {
  article: 'Articles',
  reddit: 'Reddit',
  youtube: 'YouTube',
  twitter: 'Réseaux',
  mastodon: 'Réseaux',
  podcast: 'Podcasts',
};

const SYNC_INTERVAL_KEY = 'superflux_sync_interval';
const DEFAULT_SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes
const SHOW_SYSINFO_KEY = 'superflux_show_sysinfo';

function getSyncInterval(): number {
  try {
    const v = localStorage.getItem(SYNC_INTERVAL_KEY);
    if (v) return Number(v);
  } catch { /* ignore */ }
  return DEFAULT_SYNC_INTERVAL;
}

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

  // Surface sync errors as a visible toast
  const [syncError, setSyncError] = useState<string | null>(null);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { operation: string; message: string };
      setSyncError(`Sync: ${detail.operation} — ${detail.message}`);
      setTimeout(() => setSyncError(null), 8000);
    };
    window.addEventListener(SYNC_ERROR_EVENT, handler);
    return () => window.removeEventListener(SYNC_ERROR_EVENT, handler);
  }, []);

  const [selectedFeedId, setSelectedFeedId] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<FeedSource | null>(null);
  const [selectedItem, setSelectedItem] = useState<FeedItem | null>(null);
  const [feedPanelOpen, setFeedPanelOpen] = useState(true);
  const [sourcePanelOpen, setSourcePanelOpen] = useState(true);
  const [readerPanelOpen, setReaderPanelOpen] = useState(true);
  const [showFavorites, setShowFavorites] = useState(false);
  const [showReadLater, setShowReadLater] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [brandMode, setBrandMode] = useState<'flux' | 'note' | 'bookmark' | 'editor'>('flux');
  const [searchQuery, setSearchQuery] = useState('');
  const [brandTransition, setBrandTransition] = useState(false);
  const [syncInterval, setSyncInterval] = useState(getSyncInterval);
  const [pinnedItems, setPinnedItems] = useState<PinEntry[]>(getPinnedItems);
  const [showSysInfo, setShowSysInfo] = useState(() => {
    try { return localStorage.getItem(SHOW_SYSINFO_KEY) !== 'false'; }
    catch { return true; }
  });

  const handleShowSysInfoChange = useCallback((show: boolean) => {
    setShowSysInfo(show);
    localStorage.setItem(SHOW_SYSINFO_KEY, String(show));
  }, []);

  // ── Notes state (SuperNote mode) ──
  const [notes, setNotes] = useState<Note[]>(() => {
    try {
      const raw = localStorage.getItem('superflux_notes');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [noteFolders, setNoteFolders] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('superflux_note_folders');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [selectedNoteFolder, setSelectedNoteFolder] = useState<string | null>(null);

  useEffect(() => {
    try { localStorage.setItem('superflux_notes', JSON.stringify(notes)); }
    catch { /* ignore */ }
  }, [notes]);

  useEffect(() => {
    try { localStorage.setItem('superflux_note_folders', JSON.stringify(noteFolders)); }
    catch { /* ignore */ }
  }, [noteFolders]);

  // ── Editor documents state (SuperEditor mode) ──
  const [editorDocs, setEditorDocs] = useState<EditorDoc[]>(loadEditorDocs);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [editorFolders, setEditorFolders] = useState<string[]>(loadEditorFolders);
  const [selectedEditorFolder, setSelectedEditorFolder] = useState<string | null>(null);

  useEffect(() => { saveEditorDocs(editorDocs); }, [editorDocs]);
  useEffect(() => { saveEditorFolders(editorFolders); }, [editorFolders]);

  const selectedDoc = useMemo(() =>
    editorDocs.find(d => d.id === selectedDocId) ?? null,
  [editorDocs, selectedDocId]);

  // Debounce timer for Supabase content updates
  const contentSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Bookmark reader state (SuperBookmark mode) ──
  const [selectedBookmark, setSelectedBookmark] = useState<WebBookmark | null>(null);

  const handleSelectBookmark = useCallback((bk: WebBookmark) => {
    setSelectedBookmark(bk);
  }, []);

  const handleBookmarkMarkRead = useCallback((id: string) => {
    if (!user) return;
    setSelectedBookmark(prev => prev && prev.id === id ? { ...prev, is_read: true } : prev);
    toggleBookmarkRead(user.id, id, true);
  }, [user]);

  const handleAddBookmark = useCallback(async (url: string) => {
    if (!user) return;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const bk = await addBookmark(user.id, {
      id,
      url,
      title: url,
      excerpt: null,
      image: null,
      favicon: null,
      author: null,
      site_name: null,
      tags: [],
      note: null,
      is_read: false,
      source: 'desktop' as const,
    });
    if (bk) {
      setSelectedBookmark(bk);
    }
  }, [user]);

  const handleAddDoc = useCallback(() => {
    const doc: EditorDoc = {
      id: crypto.randomUUID(),
      title: 'Sans titre',
      content: '',
      folder: selectedEditorFolder ?? undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setEditorDocs(prev => [doc, ...prev]);
    setSelectedDocId(doc.id);
    if (user) upsertEditorDoc(user.id, { id: doc.id, title: doc.title, content: doc.content, folder: doc.folder });
  }, [user, selectedEditorFolder]);

  const handleDeleteDoc = useCallback((id: string) => {
    setEditorDocs(prev => prev.filter(d => d.id !== id));
    setSelectedDocId(prev => prev === id ? null : prev);
    if (user) removeEditorDoc(user.id, id);
  }, [user]);

  const handleRenameDoc = useCallback((id: string, title: string) => {
    setEditorDocs(prev => prev.map(d =>
      d.id === id ? { ...d, title, updatedAt: new Date().toISOString() } : d
    ));
    if (user) updateEditorDocMeta(user.id, id, { title });
  }, [user]);

  const handleUpdateDocContent = useCallback((id: string, content: string) => {
    setEditorDocs(prev => prev.map(d =>
      d.id === id ? { ...d, content, updatedAt: new Date().toISOString() } : d
    ));
    // Debounce Supabase content update (1s)
    if (user) {
      if (contentSaveTimerRef.current) clearTimeout(contentSaveTimerRef.current);
      contentSaveTimerRef.current = setTimeout(() => {
        updateEditorDocContent(user.id, id, content);
      }, 1000);
    }
  }, [user]);

  // ── Editor folder handlers ──
  const handleCreateEditorFolder = useCallback((name: string) => {
    setEditorFolders(prev => [...prev, name]);
  }, []);

  const handleRenameEditorFolder = useCallback((oldName: string, newName: string) => {
    setEditorFolders(prev => prev.map(f => f === oldName ? newName : f));
    setEditorDocs(prev => prev.map(d => d.folder === oldName ? { ...d, folder: newName } : d));
    if (selectedEditorFolder === oldName) setSelectedEditorFolder(newName);
    // Update folder on all affected docs in Supabase
    if (user) {
      editorDocs.filter(d => d.folder === oldName).forEach(d => {
        updateEditorDocMeta(user.id, d.id, { folder: newName });
      });
    }
  }, [selectedEditorFolder, user, editorDocs]);

  const handleDeleteEditorFolder = useCallback((name: string) => {
    setEditorFolders(prev => prev.filter(f => f !== name));
    setEditorDocs(prev => prev.map(d => d.folder === name ? { ...d, folder: undefined } : d));
    if (selectedEditorFolder === name) setSelectedEditorFolder(null);
    // Move docs out of folder in Supabase
    if (user) {
      editorDocs.filter(d => d.folder === name).forEach(d => {
        updateEditorDocMeta(user.id, d.id, { folder: null });
      });
    }
  }, [selectedEditorFolder, user, editorDocs]);

  const handleMoveDocToFolder = useCallback((docId: string, folder: string | undefined) => {
    setEditorDocs(prev => prev.map(d =>
      d.id === docId ? { ...d, folder, updatedAt: new Date().toISOString() } : d
    ));
    if (user) updateEditorDocMeta(user.id, docId, { folder: folder ?? null });
  }, [user]);

  const selectedNote = useMemo(() =>
    notes.find(n => n.id === selectedNoteId) ?? null,
  [notes, selectedNoteId]);

  // Notes filtered by selected folder + search query
  const filteredNotes = useMemo(() => {
    let result = selectedNoteFolder === null ? notes : notes.filter(n => n.folder === selectedNoteFolder);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(n =>
        (n.title && n.title.toLowerCase().includes(q)) ||
        (n.content && n.content.toLowerCase().includes(q))
      );
    }
    return result;
  }, [notes, selectedNoteFolder, searchQuery]);

  const handleAddNote = useCallback(() => {
    const newNote: Note = {
      id: crypto.randomUUID(),
      title: 'Nouvelle note',
      content: '',
      folder: selectedNoteFolder ?? undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setNotes(prev => [newNote, ...prev]);
    setSelectedNoteId(newNote.id);
  }, [selectedNoteFolder]);

  const handleDeleteNote = useCallback((noteId: string) => {
    setNotes(prev => prev.filter(n => n.id !== noteId));
    setSelectedNoteId(prev => prev === noteId ? null : prev);
  }, []);

  const handleUpdateNote = useCallback((noteId: string, updates: Partial<Note>) => {
    setNotes(prev => prev.map(n =>
      n.id === noteId
        ? { ...n, ...updates, updatedAt: new Date().toISOString() }
        : n
    ));
  }, []);

  const handleCreateNoteFolder = useCallback((name: string) => {
    setNoteFolders(prev => [...prev, name]);
  }, []);

  const handleRenameNoteFolder = useCallback((oldName: string, newName: string) => {
    setNoteFolders(prev => prev.map(f => f === oldName ? newName : f));
    setNotes(prev => prev.map(n => n.folder === oldName ? { ...n, folder: newName } : n));
    if (selectedNoteFolder === oldName) setSelectedNoteFolder(newName);
  }, [selectedNoteFolder]);

  const handleDeleteNoteFolder = useCallback((name: string) => {
    setNoteFolders(prev => prev.filter(f => f !== name));
    setNotes(prev => prev.map(n => n.folder === name ? { ...n, folder: undefined } : n));
    if (selectedNoteFolder === name) setSelectedNoteFolder(null);
  }, [selectedNoteFolder]);

  const handleMoveNoteToFolder = useCallback((noteId: string, folder: string | undefined) => {
    setNotes(prev => prev.map(n =>
      n.id === noteId ? { ...n, folder, updatedAt: new Date().toISOString() } : n
    ));
  }, []);

  const handleToggleCollapse = useCallback(() => {
    setIsCollapsed(prev => !prev);
  }, []);

  const { widths, setWidths, handleMouseDown, containerRef } = useResizablePanels({
    panels: [
      { minWidth: 200, maxWidth: 800, defaultWidth: 18 },
      { minWidth: 300, maxWidth: 1200, defaultWidth: 32 },
      { minWidth: 400, maxWidth: 2400, defaultWidth: 50 },
    ],
  });

  // Adjust panel widths when switching brand modes
  useEffect(() => {
    if (brandMode === 'note') {
      setWidths([18, 57, 25]);
    } else if (brandMode === 'editor') {
      setFeedPanelOpen(false);
      setWidths([18, 0, 82]);
    } else {
      setFeedPanelOpen(true);
      setWidths([18, 32, 50]);
    }
  }, [brandMode, setWidths]);

  // Track previous user to detect login/logout
  const prevUserRef = useRef<string | null>(null);

  useEffect(() => {
    const userId = user?.id ?? null;
    SyncService.setUserId(userId);

    // On login: run fullSync + fetch editor docs from Supabase
    if (userId && prevUserRef.current !== userId) {
      SyncService.fullSync().catch(err => console.error('[sync] fullSync failed', err));
      fetchEditorDocs(userId).then(rows => {
        if (rows.length > 0) {
          const docs: EditorDoc[] = rows.map(r => ({
            id: r.id,
            title: r.title,
            content: r.content,
            folder: r.folder ?? undefined,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
          }));
          setEditorDocs(docs);
        }
      }).catch(err => console.error('[editor-docs] fetch failed', err));
    }
    prevUserRef.current = userId;
  }, [user]);

  // Periodic fullSync at configured interval while logged in
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      SyncService.fullSync().catch(err => console.error('[sync] periodic fullSync failed', err));
    }, syncInterval);
    return () => clearInterval(interval);
  }, [user, syncInterval]);

  // Provider sync: initial sync + periodic interval
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
    }, syncInterval);

    return () => clearInterval(interval);
  }, [syncInterval]);

  // Get items based on selection
  const items = useMemo(() => {
    if (showFavorites) {
      const filtered = store.getAllItems().filter(item => item.isStarred);
      const order = store.getFavoritesOrder();
      if (order.length > 0) {
        const posMap = new Map(order.map((id, i) => [id, i]));
        return filtered.sort((a, b) => {
          const posA = posMap.get(a.id);
          const posB = posMap.get(b.id);
          if (posA !== undefined && posB !== undefined) return posA - posB;
          if (posA !== undefined) return -1;
          if (posB !== undefined) return 1;
          return b.publishedAt.getTime() - a.publishedAt.getTime();
        });
      }
      return filtered;
    }
    if (showReadLater) {
      const filtered = store.getAllItems().filter(item => item.isBookmarked);
      const order = store.getReadLaterOrder();
      if (order.length > 0) {
        const posMap = new Map(order.map((id, i) => [id, i]));
        return filtered.sort((a, b) => {
          const posA = posMap.get(a.id);
          const posB = posMap.get(b.id);
          if (posA !== undefined && posB !== undefined) return posA - posB;
          if (posA !== undefined) return -1;
          if (posB !== undefined) return 1;
          return b.publishedAt.getTime() - a.publishedAt.getTime();
        });
      }
      return filtered;
    }
    if (selectedFeedId) return store.getItemsByFeed(selectedFeedId);
    if (selectedSource) return store.getItemsBySource(selectedSource);
    return store.getAllItems();
  }, [selectedFeedId, selectedSource, showFavorites, showReadLater, store]);

  // Apply search filter to items
  const searchedItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(item =>
      item.title.toLowerCase().includes(q) ||
      (item.summary && item.summary.toLowerCase().includes(q))
    );
  }, [items, searchQuery]);

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

  const handleToggleBrand = useCallback(() => {
    setBrandTransition(true);
    // At the midpoint of the animation, switch the mode
    setTimeout(() => {
      setBrandMode(m => m === 'flux' ? 'bookmark' : m === 'bookmark' ? 'note' : m === 'note' ? 'editor' : 'flux');
      setSelectedNoteId(null);
      setSelectedBookmark(null);
      setSearchQuery('');
    }, 600);
    // Close the transition overlay after the animation completes
    setTimeout(() => {
      setBrandTransition(false);
    }, 1200);
  }, []);

  const handleCloseSourcePanel = useCallback(() => {
    setSourcePanelOpen(false);
  }, []);

  const handleCloseReaderPanel = useCallback(() => {
    setReaderPanelOpen(false);
  }, []);

  const handleReorderItems = useCallback((orderedIds: string[]) => {
    if (showFavorites) store.reorderFavorites(orderedIds);
    else if (showReadLater) store.reorderReadLater(orderedIds);
  }, [showFavorites, showReadLater, store]);

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
      <TitleBar isCollapsed={isCollapsed} onToggleCollapse={handleToggleCollapse} unreadCount={totalUnreadCount} favoritesCount={favoritesCount} readLaterCount={readLaterCount} pinnedItems={pinnedItems} categories={store.categories} onSelectFeed={handleSelectFeed} onSync={handleSyncAll} isSyncing={store.isSyncing} showSysInfo={showSysInfo} />
      {!isCollapsed && (
        <div className="app" ref={containerRef}>
          {/* Brand transition overlay */}
          {brandTransition && (
            <div
              className="brand-transition-overlay"
              style={{
                clipPath: `circle(${brandTransition ? '150%' : '0%'} at 0% 0%)`,
              }}
            />
          )}

          {sourcePanelOpen ? (
            <>
              <div className="panel panel-source" style={(allOpen || (brandMode === 'editor' && !feedPanelOpen)) ? { width: `${widths[0]}%` } : { flex: 1 }}>
                <SourcePanel
                  categories={store.categories}
                  selectedFeedId={selectedFeedId}
                  selectedSource={selectedSource}
                  showFavorites={showFavorites}
                  favoritesCount={favoritesCount}
                  showReadLater={showReadLater}
                  readLaterCount={readLaterCount}
                  allItems={allItems}
                  onSelectFeed={handleSelectFeed}
                  onSelectSource={handleSelectSource}
                  onSelectAll={handleSelectAll}
                  onSelectFavorites={handleSelectFavorites}
                  onSelectReadLater={handleSelectReadLater}
                  onAddFeed={handleAddFeed}
                  onImportOpml={store.importFeeds}
                  onRemoveFeed={store.removeFeed}
                  onRenameFeed={store.renameFeed}
                  onSync={handleSyncAll}
                  isSyncing={store.isSyncing}
                  syncProgress={store.syncProgress}
                  syncError={store.syncError}
                  onCreateFolder={store.createFolder}
                  onRenameFolder={store.renameFolder}
                  onDeleteFolder={store.deleteFolder}
                  onMoveFeedToFolder={store.moveFeedToFolder}
                  onClose={handleCloseSourcePanel}
                  brandMode={brandMode}
                  onToggleBrand={handleToggleBrand}
                  onSyncIntervalChange={setSyncInterval}
                  onShowSysInfoChange={handleShowSysInfoChange}
                  showSysInfo={showSysInfo}
                  onPinsChange={setPinnedItems}
                  notes={notes}
                  noteFolders={noteFolders}
                  selectedNoteId={selectedNoteId}
                  selectedNoteFolder={selectedNoteFolder}
                  onSelectNote={setSelectedNoteId}
                  onSelectNoteFolder={setSelectedNoteFolder}
                  onAddNote={handleAddNote}
                  onCreateNoteFolder={handleCreateNoteFolder}
                  onRenameNoteFolder={handleRenameNoteFolder}
                  onDeleteNoteFolder={handleDeleteNoteFolder}
                  onMoveNoteToFolder={handleMoveNoteToFolder}
                  onDeleteNote={handleDeleteNote}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  editorDocs={editorDocs}
                  editorFolders={editorFolders}
                  selectedDocId={selectedDocId}
                  selectedEditorFolder={selectedEditorFolder}
                  onSelectDoc={setSelectedDocId}
                  onSelectEditorFolder={setSelectedEditorFolder}
                  onAddDoc={handleAddDoc}
                  onDeleteDoc={handleDeleteDoc}
                  onRenameDoc={handleRenameDoc}
                  onCreateEditorFolder={handleCreateEditorFolder}
                  onRenameEditorFolder={handleRenameEditorFolder}
                  onDeleteEditorFolder={handleDeleteEditorFolder}
                  onMoveDocToFolder={handleMoveDocToFolder}
                  onAddBookmark={handleAddBookmark}
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
                {brandMode === 'note' ? (
                  <NotePanel
                    notes={filteredNotes}
                    selectedNoteId={selectedNoteId}
                    onSelectNote={setSelectedNoteId}
                    onAddNote={handleAddNote}
                    onDeleteNote={handleDeleteNote}
                    onUpdateNote={handleUpdateNote}
                  />
                ) : brandMode === 'bookmark' ? (
                  <BookmarkPanel
                    selectedBookmarkId={selectedBookmark?.id ?? null}
                    onSelectBookmark={handleSelectBookmark}
                  />
                ) : brandMode === 'editor' ? (
                  <div className="panel-empty-note" />
                ) : (
                  <FeedPanel
                    categories={store.categories}
                    items={searchedItems}
                    selectedFeedId={selectedFeedId}
                    selectedSource={selectedSource}
                    selectedItemId={selectedItem?.id || null}
                    showFavorites={showFavorites}
                    showReadLater={showReadLater}
                    onSelectItem={handleSelectItem}
                    onMarkAllAsRead={() => store.markAllAsRead(selectedFeedId || undefined)}
                    onMarkAllAsUnread={() => store.markAllAsUnread(selectedFeedId || undefined)}
                    onToggleRead={store.toggleRead}
                    onToggleStar={store.toggleStar}
                    onToggleBookmark={store.toggleBookmark}
                    onReorderItems={(showFavorites || showReadLater) ? handleReorderItems : undefined}
                    onClose={handleCloseFeedPanel}
                  />
                )}
              </div>
              {allOpen && <ResizeHandle onMouseDown={(e) => handleMouseDown(1, e)} />}
            </>
          ) : brandMode !== 'editor' ? (
            <div className="panel-strip" onClick={() => setFeedPanelOpen(true)} title="Ouvrir le panneau Feed (2)">
              <span className="panel-strip-icon">☰</span>
            </div>
          ) : null}

          {readerPanelOpen ? (
            <div className="panel panel-reader" style={{ flex: 1 }}>
              {brandMode === 'note' ? (
                <NoteEditor
                  note={selectedNote}
                  onUpdateNote={handleUpdateNote}
                  onClose={() => setSelectedNoteId(null)}
                />
              ) : brandMode === 'editor' ? (
                <SuperEditor doc={selectedDoc} onUpdateContent={handleUpdateDocContent} onAddDoc={handleAddDoc} />
              ) : brandMode === 'bookmark' ? (
                <BookmarkReader
                  bookmark={selectedBookmark}
                  onMarkRead={handleBookmarkMarkRead}
                />
              ) : (
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
                  onBackToFeeds={handleBreadcrumbAll}
                  onClose={handleCloseReaderPanel}
                />
              )}
            </div>
          ) : (
            <div className="panel-strip" onClick={() => setReaderPanelOpen(true)} title="Ouvrir le panneau Lecture (3)">
              <span className="panel-strip-icon">¶</span>
            </div>
          )}
        </div>
      )}
      <UpgradeModal />
      {syncError && (
        <div style={{
          position: 'fixed', bottom: 16, right: 16, zIndex: 9999,
          background: '#dc2626', color: '#fff', padding: '10px 16px',
          borderRadius: 8, fontSize: 13, maxWidth: 420, boxShadow: '0 4px 12px rgba(0,0,0,.3)',
          cursor: 'pointer',
        }} onClick={() => setSyncError(null)}>
          {syncError}
        </div>
      )}
    </div>
  );
}
