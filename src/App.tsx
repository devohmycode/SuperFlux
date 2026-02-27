import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { SourcePanel, getPinnedItems, type PinEntry } from './components/SourcePanel';
import { FeedPanel } from './components/FeedPanel';
import { ReaderPanel } from './components/ReaderPanel';
import { NotePanel, type Note } from './components/NotePanel';
import { NoteEditor } from './components/NoteEditor';
import { SuperEditor } from './components/SuperEditor';
import { SuperDraw } from './components/SuperDraw';
import { type EditorDoc, loadEditorDocs, saveEditorDocs, loadEditorFolders, saveEditorFolders } from './components/EditorFileList';
import { type DrawDoc, loadDrawDocs, saveDrawDocs, loadDrawFolders, saveDrawFolders } from './components/DrawFileList';
import { fetchEditorDocs, upsertEditorDoc, removeEditorDoc, updateEditorDocContent, updateEditorDocMeta } from './services/editorDocService';
import { fetchDrawDocs, upsertDrawDoc, removeDrawDoc, updateDrawDocContent, updateDrawDocMeta } from './services/drawDocService';
import { fetchNotes, upsertNote, removeNote, updateNoteContent, updateNoteMeta } from './services/noteService';
import { BookmarkPanel } from './components/BookmarkPanel';
import { BookmarkReader } from './components/BookmarkReader';
import type { WebBookmark } from './services/bookmarkService';
import { toggleBookmarkRead, addBookmark, fetchBookmarks, updateBookmarkFolder } from './services/bookmarkService';
import { CommandPalette } from './components/CommandPalette';
import { ShortcutsOverlay } from './components/ShortcutsOverlay';
import { useCommands, type Command } from './hooks/useCommands';
import { ResizeHandle } from './components/ResizeHandle';
import { TitleBar } from './components/TitleBar';
import { useResizablePanels } from './hooks/useResizablePanels';
import { useFeedStore, type FeedStoreCallbacks } from './hooks/useFeedStore';
import { useHighlightStore } from './hooks/useHighlightStore';
import { useAuth } from './contexts/AuthContext';
import { usePro } from './contexts/ProContext';
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
  const { isPro, showUpgradeModal } = usePro();
  const { commands, registerCommands, paletteOpen, closePalette, helpOpen, toggleHelp, closeHelp } = useCommands();

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
  const [brandMode, setBrandMode] = useState<'flux' | 'note' | 'bookmark' | 'editor' | 'draw'>('flux');
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

  // ── Draw documents state (SuperDraw mode) ──
  const [drawDocs, setDrawDocs] = useState<DrawDoc[]>(loadDrawDocs);
  const [selectedDrawId, setSelectedDrawId] = useState<string | null>(null);
  const [drawFolders, setDrawFolders] = useState<string[]>(loadDrawFolders);
  const [selectedDrawFolder, setSelectedDrawFolder] = useState<string | null>(null);

  useEffect(() => { saveDrawDocs(drawDocs); }, [drawDocs]);
  useEffect(() => { saveDrawFolders(drawFolders); }, [drawFolders]);

  const selectedDoc = useMemo(() =>
    editorDocs.find(d => d.id === selectedDocId) ?? null,
  [editorDocs, selectedDocId]);

  const selectedDraw = useMemo(() =>
    drawDocs.find(d => d.id === selectedDrawId) ?? null,
  [drawDocs, selectedDrawId]);

  // Debounce timers for Supabase content updates
  const contentSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drawSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Bookmark reader state (SuperBookmark mode) ──
  const [selectedBookmark, setSelectedBookmark] = useState<WebBookmark | null>(null);
  const [bookmarkList, setBookmarkList] = useState<WebBookmark[]>([]);

  // ── Bookmark folders (localStorage only, like notes) ──
  const [bookmarkFolders, setBookmarkFolders] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('superflux_bookmark_folders');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [bookmarkFolderMap, setBookmarkFolderMap] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem('superflux_bookmark_folder_map');
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  const [selectedBookmarkFolder, setSelectedBookmarkFolder] = useState<string | null>(null);

  useEffect(() => {
    try { localStorage.setItem('superflux_bookmark_folders', JSON.stringify(bookmarkFolders)); }
    catch { /* ignore */ }
  }, [bookmarkFolders]);

  useEffect(() => {
    try { localStorage.setItem('superflux_bookmark_folder_map', JSON.stringify(bookmarkFolderMap)); }
    catch { /* ignore */ }
  }, [bookmarkFolderMap]);

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
      folder: null,
      source: 'desktop' as const,
    });
    if (bk) {
      setSelectedBookmark(bk);
    }
  }, [user]);

  const handleSaveItemAsBookmark = useCallback(async (item: FeedItem) => {
    if (!user) return;
    const id = crypto.randomUUID();
    await addBookmark(user.id, {
      id,
      url: item.url,
      title: item.title,
      excerpt: item.excerpt || null,
      image: item.thumbnail || null,
      favicon: null,
      author: item.author || null,
      site_name: item.feedName || null,
      tags: item.tags ?? [],
      note: null,
      is_read: false,
      folder: null,
      source: 'desktop' as const,
    });
  }, [user]);

  // ── Bookmark folder handlers ──
  const handleCreateBookmarkFolder = useCallback((name: string) => {
    setBookmarkFolders(prev => [...prev, name]);
  }, []);

  const handleRenameBookmarkFolder = useCallback((oldName: string, newName: string) => {
    setBookmarkFolders(prev => prev.map(f => f === oldName ? newName : f));
    setBookmarkFolderMap(prev => {
      const next = { ...prev };
      const affectedIds: string[] = [];
      for (const key of Object.keys(next)) {
        if (next[key] === oldName) {
          next[key] = newName;
          affectedIds.push(key);
        }
      }
      // Sync renamed folder to Supabase for affected bookmarks
      if (user) {
        affectedIds.forEach(id => updateBookmarkFolder(user.id, id, newName));
      }
      return next;
    });
    if (selectedBookmarkFolder === oldName) setSelectedBookmarkFolder(newName);
  }, [selectedBookmarkFolder, user]);

  const handleDeleteBookmarkFolder = useCallback((name: string) => {
    setBookmarkFolders(prev => prev.filter(f => f !== name));
    setBookmarkFolderMap(prev => {
      const next = { ...prev };
      const affectedIds: string[] = [];
      for (const key of Object.keys(next)) {
        if (next[key] === name) {
          delete next[key];
          affectedIds.push(key);
        }
      }
      // Remove folder from affected bookmarks in Supabase
      if (user) {
        affectedIds.forEach(id => updateBookmarkFolder(user.id, id, null));
      }
      return next;
    });
    if (selectedBookmarkFolder === name) setSelectedBookmarkFolder(null);
  }, [selectedBookmarkFolder, user]);

  const handleMoveBookmarkToFolder = useCallback((bookmarkId: string, folder: string | undefined) => {
    setBookmarkFolderMap(prev => {
      const next = { ...prev };
      if (folder) {
        next[bookmarkId] = folder;
      } else {
        delete next[bookmarkId];
      }
      return next;
    });
    if (user) updateBookmarkFolder(user.id, bookmarkId, folder ?? null);
  }, [user]);

  const bookmarkFolderCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const folder of bookmarkFolders) counts[folder] = 0;
    for (const folder of Object.values(bookmarkFolderMap)) {
      if (counts[folder] !== undefined) counts[folder]++;
    }
    return counts;
  }, [bookmarkFolders, bookmarkFolderMap]);

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

  // ── Draw document handlers ──
  const handleAddDraw = useCallback(() => {
    const doc: DrawDoc = {
      id: crypto.randomUUID(),
      title: 'Sans titre',
      content: JSON.stringify({ elements: [], camera: { x: 0, y: 0, zoom: 1 } }),
      folder: selectedDrawFolder ?? undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setDrawDocs(prev => [doc, ...prev]);
    setSelectedDrawId(doc.id);
    if (user) upsertDrawDoc(user.id, { id: doc.id, title: doc.title, content: doc.content, folder: doc.folder });
  }, [user, selectedDrawFolder]);

  const handleDeleteDraw = useCallback((id: string) => {
    setDrawDocs(prev => prev.filter(d => d.id !== id));
    setSelectedDrawId(prev => prev === id ? null : prev);
    if (user) removeDrawDoc(user.id, id);
  }, [user]);

  const handleRenameDraw = useCallback((id: string, title: string) => {
    setDrawDocs(prev => prev.map(d =>
      d.id === id ? { ...d, title, updatedAt: new Date().toISOString() } : d
    ));
    if (user) updateDrawDocMeta(user.id, id, { title });
  }, [user]);

  const handleUpdateDrawContent = useCallback((id: string, content: string) => {
    setDrawDocs(prev => prev.map(d =>
      d.id === id ? { ...d, content, updatedAt: new Date().toISOString() } : d
    ));
    if (user) {
      if (drawSaveTimerRef.current) clearTimeout(drawSaveTimerRef.current);
      drawSaveTimerRef.current = setTimeout(() => {
        updateDrawDocContent(user.id, id, content);
      }, 1000);
    }
  }, [user]);

  const handleCreateDrawFolder = useCallback((name: string) => {
    setDrawFolders(prev => [...prev, name]);
  }, []);

  const handleRenameDrawFolder = useCallback((oldName: string, newName: string) => {
    setDrawFolders(prev => prev.map(f => f === oldName ? newName : f));
    setDrawDocs(prev => prev.map(d => d.folder === oldName ? { ...d, folder: newName } : d));
    if (selectedDrawFolder === oldName) setSelectedDrawFolder(newName);
    if (user) {
      drawDocs.filter(d => d.folder === oldName).forEach(d => {
        updateDrawDocMeta(user.id, d.id, { folder: newName });
      });
    }
  }, [selectedDrawFolder, user, drawDocs]);

  const handleDeleteDrawFolder = useCallback((name: string) => {
    setDrawFolders(prev => prev.filter(f => f !== name));
    setDrawDocs(prev => prev.map(d => d.folder === name ? { ...d, folder: undefined } : d));
    if (selectedDrawFolder === name) setSelectedDrawFolder(null);
    if (user) {
      drawDocs.filter(d => d.folder === name).forEach(d => {
        updateDrawDocMeta(user.id, d.id, { folder: null });
      });
    }
  }, [selectedDrawFolder, user, drawDocs]);

  const handleMoveDrawToFolder = useCallback((docId: string, folder: string | undefined) => {
    setDrawDocs(prev => prev.map(d =>
      d.id === docId ? { ...d, folder, updatedAt: new Date().toISOString() } : d
    ));
    if (user) updateDrawDocMeta(user.id, docId, { folder: folder ?? null });
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
    if (user) {
      upsertNote(user.id, {
        id: newNote.id,
        title: newNote.title,
        content: newNote.content,
        folder: newNote.folder ?? null,
      });
    }
  }, [selectedNoteFolder, user]);

  const handleDeleteNote = useCallback((noteId: string) => {
    setNotes(prev => prev.filter(n => n.id !== noteId));
    setSelectedNoteId(prev => prev === noteId ? null : prev);
    if (user) removeNote(user.id, noteId);
  }, [user]);

  const handleUpdateNote = useCallback((noteId: string, updates: Partial<Note>) => {
    setNotes(prev => prev.map(n =>
      n.id === noteId
        ? { ...n, ...updates, updatedAt: new Date().toISOString() }
        : n
    ));
    if (user) {
      // Separate content updates (debounced) from meta updates (immediate)
      if ('content' in updates) {
        if (noteSaveTimerRef.current) clearTimeout(noteSaveTimerRef.current);
        noteSaveTimerRef.current = setTimeout(() => {
          updateNoteContent(user.id, noteId, updates.content!);
        }, 1000);
      }
      // Sync non-content fields immediately
      const meta: Record<string, any> = {};
      if ('title' in updates) meta.title = updates.title;
      if ('folder' in updates) meta.folder = updates.folder ?? null;
      if ('stickyX' in updates) meta.sticky_x = updates.stickyX ?? null;
      if ('stickyY' in updates) meta.sticky_y = updates.stickyY ?? null;
      if ('stickyRotation' in updates) meta.sticky_rotation = updates.stickyRotation ?? null;
      if ('stickyZIndex' in updates) meta.sticky_z_index = updates.stickyZIndex ?? null;
      if ('stickyColor' in updates) meta.sticky_color = updates.stickyColor ?? null;
      if ('stickyWidth' in updates) meta.sticky_width = updates.stickyWidth ?? null;
      if ('stickyHeight' in updates) meta.sticky_height = updates.stickyHeight ?? null;
      if (Object.keys(meta).length > 0) {
        updateNoteMeta(user.id, noteId, meta);
      }
    }
  }, [user]);

  const handleCreateNoteFolder = useCallback((name: string) => {
    setNoteFolders(prev => [...prev, name]);
  }, []);

  const handleRenameNoteFolder = useCallback((oldName: string, newName: string) => {
    setNoteFolders(prev => prev.map(f => f === oldName ? newName : f));
    setNotes(prev => {
      const updated = prev.map(n => n.folder === oldName ? { ...n, folder: newName } : n);
      // Sync folder rename to Supabase for affected notes
      if (user) {
        updated.filter(n => n.folder === newName).forEach(n => {
          updateNoteMeta(user.id, n.id, { folder: newName });
        });
      }
      return updated;
    });
    if (selectedNoteFolder === oldName) setSelectedNoteFolder(newName);
  }, [selectedNoteFolder, user]);

  const handleDeleteNoteFolder = useCallback((name: string) => {
    setNoteFolders(prev => prev.filter(f => f !== name));
    setNotes(prev => {
      const updated = prev.map(n => n.folder === name ? { ...n, folder: undefined } : n);
      // Sync folder removal to Supabase for affected notes
      if (user) {
        updated.filter(n => !n.folder).forEach(n => {
          updateNoteMeta(user.id, n.id, { folder: null });
        });
      }
      return updated;
    });
    if (selectedNoteFolder === name) setSelectedNoteFolder(null);
  }, [selectedNoteFolder, user]);

  const handleMoveNoteToFolder = useCallback((noteId: string, folder: string | undefined) => {
    setNotes(prev => prev.map(n =>
      n.id === noteId ? { ...n, folder, updatedAt: new Date().toISOString() } : n
    ));
    if (user) updateNoteMeta(user.id, noteId, { folder: folder ?? null });
  }, [user]);

  // Refresh bookmark list when switching to bookmark mode
  useEffect(() => {
    if (brandMode === 'bookmark' && user) {
      fetchBookmarks(user.id).then(bks => {
        setBookmarkList(bks);
        // Also update folder map from Supabase data
        const map: Record<string, string> = {};
        for (const bk of bks) {
          if (bk.folder) map[bk.id] = bk.folder;
        }
        setBookmarkFolderMap(map);
        const folders = [...new Set(bks.map(b => b.folder).filter((f): f is string => !!f))];
        if (folders.length > 0) setBookmarkFolders(prev => [...new Set([...prev, ...folders])]);
      }).catch(err => console.error('[bookmarks] refresh failed', err));
    }
  }, [brandMode, user]);

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
    } else if (brandMode === 'draw') {
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
      fetchNotes(userId).then(rows => {
        console.log('[notes] fetched from Supabase:', rows.length);
        if (rows.length > 0) {
          const loaded: Note[] = rows.map(r => ({
            id: r.id,
            title: r.title,
            content: r.content,
            folder: r.folder ?? undefined,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
            stickyX: r.sticky_x ?? undefined,
            stickyY: r.sticky_y ?? undefined,
            stickyRotation: r.sticky_rotation ?? undefined,
            stickyZIndex: r.sticky_z_index ?? undefined,
            stickyColor: r.sticky_color ?? undefined,
            stickyWidth: r.sticky_width ?? undefined,
            stickyHeight: r.sticky_height ?? undefined,
          }));
          setNotes(loaded);
          const folders = [...new Set(loaded.map(n => n.folder).filter((f): f is string => !!f))];
          if (folders.length > 0) setNoteFolders(prev => [...new Set([...prev, ...folders])]);
        } else {
          // Initial push: sync existing local notes to Supabase
          const localNotes: Note[] = (() => {
            try {
              const raw = localStorage.getItem('superflux_notes');
              return raw ? JSON.parse(raw) : [];
            } catch { return []; }
          })();
          if (localNotes.length > 0) {
            console.log('[notes] pushing', localNotes.length, 'local notes to Supabase');
            localNotes.forEach(n => {
              upsertNote(userId, {
                id: n.id,
                title: n.title,
                content: n.content,
                folder: n.folder ?? null,
                sticky_x: n.stickyX ?? null,
                sticky_y: n.stickyY ?? null,
                sticky_rotation: n.stickyRotation ?? null,
                sticky_z_index: n.stickyZIndex ?? null,
                sticky_color: n.stickyColor ?? null,
                sticky_width: n.stickyWidth ?? null,
                sticky_height: n.stickyHeight ?? null,
              });
            });
          }
        }
      }).catch(err => console.error('[notes] fetch failed', err));

      // Fetch bookmarks to rebuild folder assignments from Supabase
      fetchBookmarks(userId).then(bks => {
        setBookmarkList(bks);
        const folders = [...new Set(bks.map(b => b.folder).filter((f): f is string => !!f))];
        if (folders.length > 0) setBookmarkFolders(prev => [...new Set([...prev, ...folders])]);
        const map: Record<string, string> = {};
        for (const bk of bks) {
          if (bk.folder) map[bk.id] = bk.folder;
        }
        setBookmarkFolderMap(map);
      }).catch(err => console.error('[bookmarks] fetch folders failed', err));

      // Fetch draw docs from Supabase
      fetchDrawDocs(userId).then(rows => {
        if (rows.length > 0) {
          const docs: DrawDoc[] = rows.map(r => ({
            id: r.id,
            title: r.title,
            content: r.content,
            folder: r.folder ?? undefined,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
          }));
          setDrawDocs(docs);
          const folders = [...new Set(docs.map(d => d.folder).filter((f): f is string => !!f))];
          if (folders.length > 0) setDrawFolders(prev => [...new Set([...prev, ...folders])]);
        }
      }).catch(err => console.error('[draw-docs] fetch failed', err));
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
    // Free users skip editor and draw modes
    setTimeout(() => {
      setBrandMode(m => {
        if (isPro) {
          return m === 'flux' ? 'bookmark' : m === 'bookmark' ? 'note' : m === 'note' ? 'editor' : m === 'editor' ? 'draw' : 'flux';
        }
        return m === 'flux' ? 'bookmark' : m === 'bookmark' ? 'note' : 'flux';
      });
      setSelectedNoteId(null);
      setSelectedBookmark(null);
      setSearchQuery('');
    }, 600);
    // Close the transition overlay after the animation completes
    setTimeout(() => {
      setBrandTransition(false);
    }, 1200);
  }, [isPro]);

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

  // ── Command Palette: register all commands ──
  const itemsRef = useRef(searchedItems);
  itemsRef.current = searchedItems;
  const selectedItemRef = useRef(selectedItem);
  selectedItemRef.current = selectedItem;

  useEffect(() => {
    const cmds: Command[] = [
      // ── Navigation ──
      { id: 'nav.next-item', label: 'Article suivant', category: 'Navigation', shortcut: 'j', action: () => {
        const items = itemsRef.current;
        const cur = selectedItemRef.current;
        const idx = cur ? items.findIndex(i => i.id === cur.id) : -1;
        const next = items[idx + 1];
        if (next) handleSelectItem(next);
      }},
      { id: 'nav.prev-item', label: 'Article précédent', category: 'Navigation', shortcut: 'k', action: () => {
        const items = itemsRef.current;
        const cur = selectedItemRef.current;
        const idx = cur ? items.findIndex(i => i.id === cur.id) : items.length;
        const prev = items[idx - 1];
        if (prev) handleSelectItem(prev);
      }},
      { id: 'nav.open-item', label: 'Ouvrir dans le navigateur', category: 'Navigation', shortcut: 'o', action: () => {
        const item = selectedItemRef.current;
        if (item?.url) window.open(item.url, '_blank');
      }},

      // ── Panels ──
      { id: 'panel.toggle-source', label: 'Toggle panel Sources', category: 'Panels', shortcut: 'Alt+1', action: () => setSourcePanelOpen(prev => !prev) },
      { id: 'panel.toggle-feed', label: 'Toggle panel Articles', category: 'Panels', shortcut: 'Alt+2', action: () => setFeedPanelOpen(prev => !prev) },
      { id: 'panel.toggle-reader', label: 'Toggle panel Lecteur', category: 'Panels', shortcut: 'Alt+3', action: () => setReaderPanelOpen(prev => !prev) },

      // ── Actions ──
      { id: 'action.toggle-read', label: 'Marquer lu / non lu', category: 'Actions', shortcut: 'r', action: () => {
        const item = selectedItemRef.current;
        if (item) store.toggleRead(item.id);
      }},
      { id: 'action.toggle-star', label: 'Ajouter / retirer des favoris', category: 'Actions', shortcut: 's', action: () => {
        const item = selectedItemRef.current;
        if (item) store.toggleStar(item.id);
      }},
      { id: 'action.toggle-bookmark', label: 'Ajouter / retirer de Lire plus tard', category: 'Actions', shortcut: 'b', action: () => {
        const item = selectedItemRef.current;
        if (item) store.toggleBookmark(item.id);
      }},
      { id: 'action.mark-all-read', label: 'Tout marquer comme lu', category: 'Actions', shortcut: 'Shift+r', action: () => store.markAllAsRead(selectedFeedId || undefined) },

      // ── Modes ──
      { id: 'mode.flux', label: 'Mode SuperFlux', category: 'Modes', shortcut: 'Ctrl+1', action: () => handleBrandSwitch('flux') },
      { id: 'mode.bookmark', label: 'Mode SuperBookmark', category: 'Modes', shortcut: 'Ctrl+2', action: () => handleBrandSwitch('bookmark') },
      { id: 'mode.note', label: 'Mode SuperNote', category: 'Modes', shortcut: 'Ctrl+3', action: () => handleBrandSwitch('note') },
      { id: 'mode.editor', label: isPro ? 'Mode SuperEditor' : 'Mode SuperEditor (Pro)', category: 'Modes', shortcut: 'Ctrl+4', action: () => handleBrandSwitch('editor') },
      { id: 'mode.draw', label: isPro ? 'Mode SuperDraw' : 'Mode SuperDraw (Pro)', category: 'Modes', shortcut: 'Ctrl+5', action: () => handleBrandSwitch('draw') },

      // ── Feeds ──
      { id: 'feed.sync', label: 'Synchroniser tous les feeds', category: 'Feeds', shortcut: 'Ctrl+Shift+s', action: () => handleSyncAll() },
      { id: 'feed.search', label: 'Rechercher', category: 'Feeds', shortcut: '/', action: () => {
        const input = document.querySelector<HTMLInputElement>('.source-search-input, .feed-search-input');
        input?.focus();
      }},

      // ── App ──
      { id: 'app.palette', label: 'Command Palette', category: 'App', shortcut: 'Ctrl+k', action: () => {} },
      { id: 'app.shortcuts', label: 'Aide raccourcis', category: 'App', shortcut: '?', action: () => toggleHelp() },
    ];
    registerCommands(cmds);
  }, [selectedFeedId, store, handleSelectItem, handleSyncAll, registerCommands]);

  // Brand switch helper (direct mode, with same animation as toggle)
  const handleBrandSwitch = useCallback((mode: 'flux' | 'note' | 'bookmark' | 'editor' | 'draw') => {
    if (!isPro && (mode === 'editor' || mode === 'draw')) {
      showUpgradeModal();
      return;
    }
    setBrandTransition(true);
    setTimeout(() => {
      setBrandMode(mode);
      setSearchQuery('');
    }, 600);
    setTimeout(() => setBrandTransition(false), 1200);
  }, [isPro, showUpgradeModal]);


  // When some panels are closed, remaining open panels share the space via flex
  const allOpen = sourcePanelOpen && feedPanelOpen && readerPanelOpen;

  return (
    <div className={`app-wrapper ${isCollapsed ? 'app-wrapper--collapsed' : ''}`}>
      <CommandPalette commands={commands} isOpen={paletteOpen} onClose={closePalette} />
      <ShortcutsOverlay commands={commands} isOpen={helpOpen} onClose={closeHelp} />
      <TitleBar isCollapsed={isCollapsed} onToggleCollapse={handleToggleCollapse} unreadCount={totalUnreadCount} favoritesCount={favoritesCount} readLaterCount={readLaterCount} pinnedItems={pinnedItems} categories={store.categories} onSelectFeed={handleSelectFeed} onSync={handleSyncAll} isSyncing={store.isSyncing} showSysInfo={showSysInfo} />
      {!isCollapsed && (
        <>
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
              <div className="panel panel-source" style={(allOpen || ((brandMode === 'editor' || brandMode === 'draw') && !feedPanelOpen)) ? { width: `${widths[0]}%` } : { flex: 1 }}>
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
                  onReorderFeed={store.reorderFeed}
                  onClose={handleCloseSourcePanel}
                  brandMode={brandMode}
                  onToggleBrand={handleToggleBrand}
                  onBrandSwitch={handleBrandSwitch}
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
                  drawDocs={drawDocs}
                  drawFolders={drawFolders}
                  selectedDrawId={selectedDrawId}
                  selectedDrawFolder={selectedDrawFolder}
                  onSelectDraw={setSelectedDrawId}
                  onSelectDrawFolder={setSelectedDrawFolder}
                  onAddDraw={handleAddDraw}
                  onDeleteDraw={handleDeleteDraw}
                  onRenameDraw={handleRenameDraw}
                  onCreateDrawFolder={handleCreateDrawFolder}
                  onRenameDrawFolder={handleRenameDrawFolder}
                  onDeleteDrawFolder={handleDeleteDrawFolder}
                  onMoveDrawToFolder={handleMoveDrawToFolder}
                  bookmarkFolders={bookmarkFolders}
                  bookmarkFolderCounts={bookmarkFolderCounts}
                  selectedBookmarkFolder={selectedBookmarkFolder}
                  onSelectBookmarkFolder={setSelectedBookmarkFolder}
                  onCreateBookmarkFolder={handleCreateBookmarkFolder}
                  onRenameBookmarkFolder={handleRenameBookmarkFolder}
                  onDeleteBookmarkFolder={handleDeleteBookmarkFolder}
                  bookmarkItems={bookmarkList}
                  bookmarkFolderMap={bookmarkFolderMap}
                  selectedBookmarkId={selectedBookmark?.id ?? null}
                  onSelectBookmark={handleSelectBookmark}
                  bookmarkTotalCount={bookmarkList.length}
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
                    selectedFolder={selectedBookmarkFolder}
                    bookmarkFolderMap={bookmarkFolderMap}
                    bookmarkFolders={bookmarkFolders}
                    onSelectBookmark={handleSelectBookmark}
                    onMoveBookmarkToFolder={handleMoveBookmarkToFolder}
                  />
                ) : brandMode === 'editor' || brandMode === 'draw' ? (
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
                    onSaveAsBookmark={user ? handleSaveItemAsBookmark : undefined}
                    onClose={handleCloseFeedPanel}
                  />
                )}
              </div>
              {allOpen && <ResizeHandle onMouseDown={(e) => handleMouseDown(1, e)} />}
            </>
          ) : (brandMode !== 'editor' && brandMode !== 'draw') ? (
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
              ) : brandMode === 'draw' ? (
                <SuperDraw doc={selectedDraw} onUpdateContent={handleUpdateDrawContent} onAddDoc={handleAddDraw} />
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
        </>
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
