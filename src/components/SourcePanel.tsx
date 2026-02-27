import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { Feed, FeedCategory, FeedItem, FeedSource } from "../types";
import { SyncButton } from "./SyncButton";
import { AddFeedModal, type NewFeedData } from "./AddFeedModal";
import { SettingsModal } from "./SettingsModal";
import { StatsModal } from "./StatsModal";
import { ExpandingPanel } from "./ExpandingPanel";

import { AnimatedThemeToggler } from "./ui/animated-theme-toggler";
import { UserMenu } from "./UserMenu";
import { usePro } from "../contexts/ProContext";
import { PRO_LIMITS } from "../services/licenseService";
import { isRSSHubUrl } from "../services/rsshubService";
import { EditorFileList } from "./EditorFileList";
import { NoteSourceList } from "./NoteSourceList";
import { BookmarkSourceList } from "./BookmarkSourceList";
import { DrawFileList } from "./DrawFileList";
import type { Note } from "./NotePanel";
import { PalettePicker } from "./PalettePicker";
import { getStoredPaletteId, getPaletteById } from "../themes/palettes";
import ShinyText from "./ShinyText";

interface SourcePanelProps {
  categories: FeedCategory[];
  selectedFeedId: string | null;
  selectedSource: FeedSource | null;
  showFavorites: boolean;
  favoritesCount: number;
  showReadLater: boolean;
  readLaterCount: number;
  allItems: FeedItem[];
  onSelectFeed: (feedId: string, source: FeedSource) => void;
  onSelectSource: (source: FeedSource) => void;
  onSelectAll: () => void;
  onSelectFavorites: () => void;
  onSelectReadLater: () => void;
  onAddFeed: (feed: NewFeedData) => void;
  onImportOpml: (feeds: { url: string; name: string; source: FeedSource }[]) => number;
  onRemoveFeed: (feedId: string) => void;
  onRenameFeed: (feedId: string, newName: string) => void;
  onSync: () => void;
  isSyncing: boolean;
  syncProgress: number;
  syncError: string | null;
  onCreateFolder: (categoryId: string, name: string, parentPath?: string) => void;
  onRenameFolder: (categoryId: string, oldPath: string, newName: string) => void;
  onDeleteFolder: (categoryId: string, path: string) => void;
  onMoveFeedToFolder: (feedId: string, folder: string | undefined) => void;
  onClose?: () => void;
  brandMode: 'flux' | 'note' | 'bookmark' | 'editor' | 'draw';
  onToggleBrand: () => void;
  onBrandSwitch?: (mode: 'flux' | 'note' | 'bookmark' | 'editor' | 'draw') => void;
  onSyncIntervalChange?: (interval: number) => void;
  onShowSysInfoChange?: (show: boolean) => void;
  showSysInfo?: boolean;
  onPinsChange?: (pins: PinEntry[]) => void;
  // Note mode props
  notes?: Note[];
  noteFolders?: string[];
  selectedNoteId?: string | null;
  selectedNoteFolder?: string | null;
  onSelectNote?: (noteId: string) => void;
  onSelectNoteFolder?: (folder: string | null) => void;
  onAddNote?: () => void;
  onCreateNoteFolder?: (name: string) => void;
  onRenameNoteFolder?: (oldName: string, newName: string) => void;
  onDeleteNoteFolder?: (name: string) => void;
  onMoveNoteToFolder?: (noteId: string, folder: string | undefined) => void;
  onDeleteNote?: (noteId: string) => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  // Editor mode props
  editorDocs?: import('./EditorFileList').EditorDoc[];
  editorFolders?: string[];
  selectedDocId?: string | null;
  selectedEditorFolder?: string | null;
  onSelectDoc?: (id: string) => void;
  onSelectEditorFolder?: (folder: string | null) => void;
  onAddDoc?: () => void;
  onDeleteDoc?: (id: string) => void;
  onRenameDoc?: (id: string, title: string) => void;
  onCreateEditorFolder?: (name: string) => void;
  onRenameEditorFolder?: (oldName: string, newName: string) => void;
  onDeleteEditorFolder?: (name: string) => void;
  onMoveDocToFolder?: (docId: string, folder: string | undefined) => void;
  onAddBookmark?: (url: string) => void;
  onReorderFeed?: (feedId: string, targetFeedId: string, position: 'before' | 'after') => void;
  // Bookmark folder props
  bookmarkFolders?: string[];
  bookmarkFolderCounts?: Record<string, number>;
  selectedBookmarkFolder?: string | null;
  onSelectBookmarkFolder?: (folder: string | null) => void;
  onCreateBookmarkFolder?: (name: string) => void;
  onRenameBookmarkFolder?: (oldName: string, newName: string) => void;
  onDeleteBookmarkFolder?: (name: string) => void;
  bookmarkItems?: import('../services/bookmarkService').WebBookmark[];
  bookmarkFolderMap?: Record<string, string>;
  selectedBookmarkId?: string | null;
  onSelectBookmark?: (bookmark: import('../services/bookmarkService').WebBookmark) => void;
  bookmarkTotalCount?: number;
  // Draw mode props
  drawDocs?: import('./DrawFileList').DrawDoc[];
  drawFolders?: string[];
  selectedDrawId?: string | null;
  selectedDrawFolder?: string | null;
  onSelectDraw?: (id: string) => void;
  onSelectDrawFolder?: (folder: string | null) => void;
  onAddDraw?: () => void;
  onDeleteDraw?: (id: string) => void;
  onRenameDraw?: (id: string, title: string) => void;
  onCreateDrawFolder?: (name: string) => void;
  onRenameDrawFolder?: (oldName: string, newName: string) => void;
  onDeleteDrawFolder?: (name: string) => void;
  onMoveDrawToFolder?: (docId: string, folder: string | undefined) => void;
}

const sourceIcons: Record<string, string> = {
  article: "◇",
  reddit: "⬡",
  youtube: "▷",
  twitter: "✦",
  podcast: "🎙",
  mastodon: "🐘",
};

type ContextMenuState =
  | { kind: 'feed'; x: number; y: number; feed: Feed; categoryId: string }
  | { kind: 'category'; x: number; y: number; categoryId: string }
  | { kind: 'folder'; x: number; y: number; categoryId: string; folderPath: string }
  | null;

// ── Folder tree building ──

interface FolderNode {
  name: string;   // last path segment
  path: string;   // full path e.g. "Tech/Frontend"
  children: FolderNode[];
}

function buildFolderTree(paths: string[]): FolderNode[] {
  const root: FolderNode[] = [];
  const sorted = [...paths].sort();

  for (const path of sorted) {
    const parts = path.split('/');
    let currentLevel = root;
    let currentPath = '';

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      let existing = currentLevel.find(n => n.name === part);
      if (!existing) {
        existing = { name: part, path: currentPath, children: [] };
        currentLevel.push(existing);
      }
      currentLevel = existing.children;
    }
  }

  return root;
}

// ── Pinned feeds/folders ──
const PINS_KEY = 'superflux_pinned';

export type PinEntry =
  | { kind: 'feed'; feedId: string; label: string; icon: string }
  | { kind: 'folder'; categoryId: string; folderPath: string; label: string };

export function getPinnedItems(): PinEntry[] {
  try {
    const v = localStorage.getItem(PINS_KEY);
    if (v) return JSON.parse(v);
  } catch { /* ignore */ }
  return [];
}

function savePinnedItems(pins: PinEntry[]) {
  localStorage.setItem(PINS_KEY, JSON.stringify(pins));
}

function pinKey(pin: PinEntry): string {
  return pin.kind === 'feed' ? `feed::${pin.feedId}` : `folder::${pin.categoryId}::${pin.folderPath}`;
}

// Indentation constants (px per nesting depth)
const INDENT_STEP = 14;
const FOLDER_BASE_INDENT = 24;
const FEED_BASE_INDENT = 28;

export function SourcePanel({
  categories,
  selectedFeedId,
  selectedSource,
  showFavorites,
  favoritesCount,
  showReadLater,
  readLaterCount,
  allItems,
  onSelectFeed,
  onSelectSource,
  onSelectAll,
  onSelectFavorites,
  onSelectReadLater,
  onAddFeed,
  onImportOpml,
  onRemoveFeed,
  onRenameFeed,
  onSync,
  isSyncing,
  syncProgress,
  syncError,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveFeedToFolder,
  onClose,
  brandMode,
  onToggleBrand,
  onBrandSwitch,
  onSyncIntervalChange,
  onShowSysInfoChange,
  showSysInfo,
  onPinsChange,
  notes = [],
  noteFolders = [],
  selectedNoteId = null,
  selectedNoteFolder = null,
  onSelectNote,
  onSelectNoteFolder,
  onAddNote,
  onCreateNoteFolder,
  onRenameNoteFolder,
  onDeleteNoteFolder,
  onMoveNoteToFolder,
  onDeleteNote,
  searchQuery = '',
  onSearchChange: _onSearchChange,
  editorDocs = [],
  editorFolders = [],
  selectedDocId = null,
  selectedEditorFolder = null,
  onSelectDoc,
  onSelectEditorFolder,
  onAddDoc,
  onDeleteDoc,
  onRenameDoc,
  onCreateEditorFolder,
  onRenameEditorFolder,
  onDeleteEditorFolder,
  onMoveDocToFolder,
  onAddBookmark,
  onReorderFeed,
  bookmarkFolders,
  bookmarkFolderCounts,
  selectedBookmarkFolder,
  onSelectBookmarkFolder,
  onCreateBookmarkFolder,
  onRenameBookmarkFolder,
  onDeleteBookmarkFolder,
  bookmarkItems,
  bookmarkFolderMap,
  selectedBookmarkId,
  onSelectBookmark,
  bookmarkTotalCount,
  drawDocs = [],
  drawFolders = [],
  selectedDrawId = null,
  selectedDrawFolder = null,
  onSelectDraw,
  onSelectDrawFolder,
  onAddDraw,
  onDeleteDraw,
  onRenameDraw,
  onCreateDrawFolder,
  onRenameDrawFolder,
  onDeleteDrawFolder,
  onMoveDrawToFolder,
}: SourcePanelProps) {
  const { isPro, showUpgradeModal } = usePro();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [bookmarkUrlOpen, setBookmarkUrlOpen] = useState(false);
  const [bookmarkUrlValue, setBookmarkUrlValue] = useState('');
  const bookmarkUrlRef = useRef<HTMLInputElement>(null);

  const totalFeeds = categories.reduce((sum, cat) => sum + cat.feeds.length, 0);
  const totalFolders = categories.reduce((sum, cat) => sum + cat.folders.length, 0);

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(categories.map((c) => c.id)),
  );
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [moveSubmenuFeedId, setMoveSubmenuFeedId] = useState<string | null>(null);
  const [pinnedItems, setPinnedItems] = useState<PinEntry[]>(getPinnedItems);

  // Inline inputs (parentPath: where to create; oldPath: which folder to rename)
  const [newFolderInput, setNewFolderInput] = useState<{ categoryId: string; value: string; parentPath?: string } | null>(null);
  const [renameFolderInput, setRenameFolderInput] = useState<{ categoryId: string; oldPath: string; value: string } | null>(null);
  const [renameFeedInput, setRenameFeedInput] = useState<{ feedId: string; value: string } | null>(null);
  const newFolderRef = useRef<HTMLInputElement>(null);
  const renameFolderRef = useRef<HTMLInputElement>(null);
  const renameFeedRef = useRef<HTMLInputElement>(null);

  // Drag-and-drop state
  const [dragFeedId, setDragFeedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dropFeedTarget, setDropFeedTarget] = useState<{ feedId: string; position: 'before' | 'after' } | null>(null);

  // Auto-focus inline inputs
  useEffect(() => {
    if (newFolderInput) newFolderRef.current?.focus();
  }, [newFolderInput]);
  useEffect(() => {
    if (renameFolderInput) renameFolderRef.current?.focus();
  }, [renameFolderInput]);
  useEffect(() => {
    if (renameFeedInput) renameFeedRef.current?.focus();
  }, [renameFeedInput]);

  const handleAddFeed = (feedData: NewFeedData) => {
    onAddFeed(feedData);
  };

  const handleFeedContextMenu = useCallback((e: React.MouseEvent, feed: Feed, categoryId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMoveSubmenuFeedId(null);
    setContextMenu({ kind: 'feed', x: e.clientX, y: e.clientY, feed, categoryId });
  }, []);

  const handleCategoryContextMenu = useCallback((e: React.MouseEvent, categoryId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ kind: 'category', x: e.clientX, y: e.clientY, categoryId });
  }, []);

  const handleFolderContextMenu = useCallback((e: React.MouseEvent, categoryId: string, folderPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ kind: 'folder', x: e.clientX, y: e.clientY, categoryId, folderPath });
  }, []);

  const togglePin = useCallback((entry: PinEntry) => {
    setPinnedItems(prev => {
      const key = pinKey(entry);
      const exists = prev.some(p => pinKey(p) === key);
      const next = exists ? prev.filter(p => pinKey(p) !== key) : [...prev, entry];
      savePinnedItems(next);
      onPinsChange?.(next);
      return next;
    });
  }, [onPinsChange]);

  const isPinned = useCallback((entry: PinEntry) => {
    return pinnedItems.some(p => pinKey(p) === pinKey(entry));
  }, [pinnedItems]);

  // Close all context menus on click/escape
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => { setContextMenu(null); setMoveSubmenuFeedId(null); };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('click', close);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', handleKey);
    };
  }, [contextMenu]);

  const toggleCategory = (catId: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  };

  const toggleFolder = (key: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // ── Drag-and-drop handlers ──

  const handleDragStart = useCallback((e: React.DragEvent, feedId: string) => {
    setDragFeedId(feedId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', feedId);
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.5';
    }
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    setDragFeedId(null);
    setDropTarget(null);
    setDropFeedTarget(null);
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '';
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, targetKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(targetKey);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent, targetKey: string) => {
    const related = e.relatedTarget as Node | null;
    if (e.currentTarget instanceof HTMLElement && related && e.currentTarget.contains(related)) return;
    setDropTarget(prev => prev === targetKey ? null : prev);
  }, []);

  const handleFeedDragOver = useCallback((e: React.DragEvent, targetFeedId: string) => {
    if (!dragFeedId || dragFeedId === targetFeedId) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const position: 'before' | 'after' = e.clientY < midY ? 'before' : 'after';
    setDropFeedTarget(prev => {
      if (prev?.feedId === targetFeedId && prev?.position === position) return prev;
      return { feedId: targetFeedId, position };
    });
    setDropTarget(null);
  }, [dragFeedId]);

  const handleFeedDrop = useCallback((e: React.DragEvent, targetFeedId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const feedId = e.dataTransfer.getData('text/plain');
    if (feedId && feedId !== targetFeedId && dropFeedTarget) {
      onReorderFeed?.(feedId, targetFeedId, dropFeedTarget.position);
    }
    setDragFeedId(null);
    setDropTarget(null);
    setDropFeedTarget(null);
  }, [onReorderFeed, dropFeedTarget]);

  const handleFeedDragLeave = useCallback((e: React.DragEvent, targetFeedId: string) => {
    const related = e.relatedTarget as Node | null;
    if (e.currentTarget instanceof HTMLElement && related && e.currentTarget.contains(related)) return;
    setDropFeedTarget(prev => prev?.feedId === targetFeedId ? null : prev);
  }, []);

  const handleDropOnRoot = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const feedId = e.dataTransfer.getData('text/plain');
    if (feedId) onMoveFeedToFolder(feedId, undefined);
    setDragFeedId(null);
    setDropTarget(null);
    setDropFeedTarget(null);
  }, [onMoveFeedToFolder]);

  const handleDropOnFolder = useCallback((e: React.DragEvent, folderPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    const feedId = e.dataTransfer.getData('text/plain');
    if (feedId) onMoveFeedToFolder(feedId, folderPath);
    setDragFeedId(null);
    setDropTarget(null);
    setDropFeedTarget(null);
  }, [onMoveFeedToFolder]);

  const totalUnread = categories.reduce(
    (sum, cat) => sum + cat.feeds.reduce((s, f) => s + f.unreadCount, 0),
    0,
  );


  // ── Render helpers ──

  const renderFeed = (feed: Feed, feedIdx: number, categoryId: string, depth: number) => {
    if (renameFeedInput?.feedId === feed.id) {
      return (
        <div key={feed.id} className="folder-inline-input-wrapper" style={{ paddingLeft: FEED_BASE_INDENT + depth * INDENT_STEP }}>
          <span className="feed-icon" style={{ color: feed.color, marginRight: 6 }}>{feed.icon}</span>
          <input
            ref={renameFeedRef}
            className="folder-inline-input"
            type="text"
            value={renameFeedInput.value}
            onChange={(e) => setRenameFeedInput({ ...renameFeedInput, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && renameFeedInput.value.trim()) {
                onRenameFeed(feed.id, renameFeedInput.value.trim());
                setRenameFeedInput(null);
              } else if (e.key === 'Escape') {
                setRenameFeedInput(null);
              }
            }}
            onBlur={() => {
              if (renameFeedInput.value.trim() && renameFeedInput.value.trim() !== feed.name) {
                onRenameFeed(feed.id, renameFeedInput.value.trim());
              }
              setRenameFeedInput(null);
            }}
          />
        </div>
      );
    }

    const isDropBefore = dropFeedTarget?.feedId === feed.id && dropFeedTarget.position === 'before';
    const isDropAfter = dropFeedTarget?.feedId === feed.id && dropFeedTarget.position === 'after';

    return (
      <motion.button
        key={feed.id}
        className={`feed-item-btn ${selectedFeedId === feed.id ? "active" : ""} ${dragFeedId === feed.id ? "dragging" : ""} ${isDropBefore ? "drop-before" : ""} ${isDropAfter ? "drop-after" : ""}`}
        style={{ paddingLeft: FEED_BASE_INDENT + depth * INDENT_STEP }}
        onClick={() => onSelectFeed(feed.id, feed.source)}
        onContextMenu={(e) => handleFeedContextMenu(e, feed, categoryId)}
        draggable
        {...{ onDragStart: (e: React.DragEvent) => handleDragStart(e, feed.id) } as any}
        {...{ onDragEnd: (e: React.DragEvent) => handleDragEnd(e) } as any}
        {...{ onDragOver: (e: React.DragEvent) => handleFeedDragOver(e, feed.id) } as any}
        {...{ onDrop: (e: React.DragEvent) => handleFeedDrop(e, feed.id) } as any}
        {...{ onDragLeave: (e: React.DragEvent) => handleFeedDragLeave(e, feed.id) } as any}
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: feedIdx * 0.03, duration: 0.2 }}
      >
        <span className="feed-icon" style={{ color: feed.color }}>
          {feed.icon}
        </span>
        <span className="feed-name">{feed.name}</span>
        {feed.unreadCount > 0 && (
          <span className="feed-unread">{feed.unreadCount}</span>
        )}
        {isRSSHubUrl(feed.url) && (
          <span className="feed-rsshub-badge" title="Via RSSHub">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
            </svg>
          </span>
        )}
      </motion.button>
    );
  };

  /** Inline input for creating a new subfolder */
  const renderNewFolderInput = (categoryId: string, parentPath: string | undefined, depth: number) => {
    if (newFolderInput?.categoryId !== categoryId || newFolderInput.parentPath !== parentPath) return null;
    return (
      <div className="folder-inline-input-wrapper" style={{ paddingLeft: FOLDER_BASE_INDENT + depth * INDENT_STEP }}>
        <input
          ref={newFolderRef}
          className="folder-inline-input"
          type="text"
          placeholder="Nom du dossier..."
          value={newFolderInput.value}
          onChange={(e) => setNewFolderInput({ ...newFolderInput, value: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newFolderInput.value.trim()) {
              const name = newFolderInput.value.trim();
              onCreateFolder(categoryId, name, parentPath);
              const newPath = parentPath ? `${parentPath}/${name}` : name;
              setExpandedFolders(prev => new Set(prev).add(`${categoryId}::${newPath}`));
              setNewFolderInput(null);
            } else if (e.key === 'Escape') {
              setNewFolderInput(null);
            }
          }}
          onBlur={() => setNewFolderInput(null)}
        />
      </div>
    );
  };

  /** Recursive folder node renderer */
  const renderFolderNode = (node: FolderNode, category: FeedCategory, depth: number) => {
    const folderKey = `${category.id}::${node.path}`;
    const dropKey = `folder::${category.id}::${node.path}`;
    const sq = searchQuery.toLowerCase();
    const folderFeeds = category.feeds.filter(f =>
      f.folder === node.path && (!sq || f.name.toLowerCase().includes(sq))
    );
    const isExpanded = expandedFolders.has(folderKey);
    const isDropOver = dropTarget === dropKey && dragFeedId !== null;
    const headerIndent = FOLDER_BASE_INDENT + depth * INDENT_STEP;

    return (
      <div key={folderKey} className={`subfolder ${isDropOver ? 'drop-over' : ''}`}>
        {/* Rename inline input */}
        {renameFolderInput?.categoryId === category.id && renameFolderInput.oldPath === node.path ? (
          <div className="folder-inline-input-wrapper" style={{ paddingLeft: headerIndent }}>
            <input
              ref={renameFolderRef}
              className="folder-inline-input"
              type="text"
              value={renameFolderInput.value}
              onChange={(e) => setRenameFolderInput({ ...renameFolderInput, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && renameFolderInput.value.trim()) {
                  const newName = renameFolderInput.value.trim();
                  onRenameFolder(category.id, renameFolderInput.oldPath, newName);
                  // Update expanded key to match new path
                  const lastSlash = node.path.lastIndexOf('/');
                  const newPath = lastSlash >= 0 ? `${node.path.substring(0, lastSlash)}/${newName}` : newName;
                  setExpandedFolders(prev => {
                    const next = new Set<string>();
                    for (const k of prev) {
                      if (k === folderKey) {
                        next.add(`${category.id}::${newPath}`);
                      } else if (k.startsWith(folderKey + '/')) {
                        next.add(`${category.id}::${newPath}${k.substring(folderKey.length)}`);
                      } else {
                        next.add(k);
                      }
                    }
                    return next;
                  });
                  setRenameFolderInput(null);
                } else if (e.key === 'Escape') {
                  setRenameFolderInput(null);
                }
              }}
              onBlur={() => setRenameFolderInput(null)}
            />
          </div>
        ) : (
          <button
            className={`subfolder-header ${isDropOver ? 'drop-over' : ''}`}
            style={{ paddingLeft: headerIndent }}
            onClick={() => toggleFolder(folderKey)}
            onContextMenu={(e) => handleFolderContextMenu(e, category.id, node.path)}
            onDragOver={(e) => handleDragOver(e, dropKey)}
            onDragLeave={(e) => handleDragLeave(e, dropKey)}
            onDrop={(e) => handleDropOnFolder(e, node.path)}
          >
            <span className={`subfolder-chevron ${isExpanded ? "expanded" : ""}`}>›</span>
            <span className="subfolder-icon">📁</span>
            <span className="subfolder-name">{node.name}</span>
            <span className="subfolder-count">{folderFeeds.length}</span>
          </button>
        )}

        {isExpanded && (
          <div
            className="subfolder-feeds"
            onDragOver={(e) => handleDragOver(e, dropKey)}
            onDragLeave={(e) => handleDragLeave(e, dropKey)}
            onDrop={(e) => handleDropOnFolder(e, node.path)}
          >
            {folderFeeds.map((feed, idx) => renderFeed(feed, idx, category.id, depth + 1))}
            {node.children.map(child => renderFolderNode(child, category, depth + 1))}
            {/* New subfolder input at this level */}
            {renderNewFolderInput(category.id, node.path, depth + 1)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="source-panel">
      <div className="source-panel-header">
        <div className="source-panel-brand">
          <span className="brand-icon">◈</span>
          <button className="brand-name-btn" onClick={onToggleBrand}>
            <ShinyText
              text={brandMode === 'flux' ? 'SuperFlux' : brandMode === 'note' ? 'SuperNote' : brandMode === 'editor' ? 'SuperEditor' : brandMode === 'draw' ? 'SuperDraw' : 'SuperBookmark'}
              speed={2}
              delay={0}
              color="#787878"
              shineColor="#ffffff"
              spread={120}
              direction="left"
              yoyo={false}
              pauseOnHover={false}
            />
          </button>
          <AnimatedThemeToggler className="theme-toggle-btn" />
          {onClose && (
            <button className="panel-close-btn" onClick={onClose} title="Replier le panneau Sources (1)">
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="source-panel-content">
        {brandMode === 'note' ? (
          onSelectNote && onSelectNoteFolder && onAddNote && onCreateNoteFolder && onRenameNoteFolder && onDeleteNoteFolder && onMoveNoteToFolder && onDeleteNote ? (
            <NoteSourceList
              notes={notes}
              folders={noteFolders}
              selectedNoteId={selectedNoteId}
              selectedFolder={selectedNoteFolder}
              onSelectNote={onSelectNote}
              onSelectFolder={onSelectNoteFolder}
              onAddNote={onAddNote}
              onCreateFolder={onCreateNoteFolder}
              onRenameFolder={onRenameNoteFolder}
              onDeleteFolder={onDeleteNoteFolder}
              onMoveNoteToFolder={onMoveNoteToFolder}
              onDeleteNote={onDeleteNote}
            />
          ) : <div className="panel-empty-note" />
        ) : brandMode === 'editor' ? (
          onSelectDoc && onAddDoc && onDeleteDoc && onRenameDoc && onCreateEditorFolder && onRenameEditorFolder && onDeleteEditorFolder && onMoveDocToFolder && onSelectEditorFolder ? (
            <EditorFileList
              docs={editorDocs}
              folders={editorFolders}
              selectedDocId={selectedDocId}
              selectedFolder={selectedEditorFolder}
              onSelectDoc={onSelectDoc}
              onSelectFolder={onSelectEditorFolder}
              onAddDoc={onAddDoc}
              onDeleteDoc={onDeleteDoc}
              onRenameDoc={onRenameDoc}
              onCreateFolder={onCreateEditorFolder}
              onRenameFolder={onRenameEditorFolder}
              onDeleteFolder={onDeleteEditorFolder}
              onMoveDocToFolder={onMoveDocToFolder}
            />
          ) : <div className="panel-empty-note" />
        ) : brandMode === 'bookmark' ? (
          <BookmarkSourceList
            folders={bookmarkFolders ?? []}
            folderCounts={bookmarkFolderCounts ?? {}}
            selectedFolder={selectedBookmarkFolder ?? null}
            onSelectFolder={onSelectBookmarkFolder ?? (() => {})}
            onCreateFolder={onCreateBookmarkFolder ?? (() => {})}
            onRenameFolder={onRenameBookmarkFolder ?? (() => {})}
            onDeleteFolder={onDeleteBookmarkFolder ?? (() => {})}
            bookmarks={bookmarkItems}
            bookmarkFolderMap={bookmarkFolderMap}
            selectedBookmarkId={selectedBookmarkId}
            onSelectBookmark={onSelectBookmark}
            totalCount={bookmarkTotalCount}
          />
        ) : brandMode === 'draw' ? (
          <DrawFileList
            docs={drawDocs}
            folders={drawFolders}
            selectedDocId={selectedDrawId}
            selectedFolder={selectedDrawFolder}
            onSelectDoc={onSelectDraw ?? (() => {})}
            onSelectFolder={onSelectDrawFolder ?? (() => {})}
            onAddDoc={onAddDraw ?? (() => {})}
            onDeleteDoc={onDeleteDraw ?? (() => {})}
            onRenameDoc={onRenameDraw ?? (() => {})}
            onCreateFolder={onCreateDrawFolder ?? (() => {})}
            onRenameFolder={onRenameDrawFolder ?? (() => {})}
            onDeleteFolder={onDeleteDrawFolder ?? (() => {})}
            onMoveDocToFolder={onMoveDrawToFolder ?? (() => {})}
          />
        ) : (
        <>
        <button
          className={`source-all-btn ${!selectedFeedId && !selectedSource && !showFavorites && !showReadLater ? "active" : ""}`}
          onClick={onSelectAll}
        >
          <span className="source-all-icon">⊞</span>
          <span className="source-all-label">Tous les flux</span>
          <span className="source-all-count">{totalUnread}</span>
        </button>

        <button
          className={`source-all-btn source-favorites-btn ${showFavorites ? "active" : ""}`}
          onClick={onSelectFavorites}
        >
          <span className="source-all-icon">{showFavorites ? "★" : "☆"}</span>
          <span className="source-all-label">Favoris</span>
          {favoritesCount > 0 && (
            <span className="source-all-count">{favoritesCount}</span>
          )}
        </button>

        <button
          className={`source-all-btn source-readlater-btn ${showReadLater ? "active" : ""}`}
          onClick={onSelectReadLater}
        >
          <span className="source-all-icon">{showReadLater ? "🔖" : "🏷"}</span>
          <span className="source-all-label">Lire plus tard</span>
          {readLaterCount > 0 && (
            <span className="source-all-count">{readLaterCount}</span>
          )}
        </button>

        <div className="source-categories">
          {categories.map((category, catIdx) => {
            const sq = searchQuery.toLowerCase();
            const allCatFeeds = sq ? category.feeds.filter(f => f.name.toLowerCase().includes(sq)) : category.feeds;
            const rootFeeds = allCatFeeds.filter(f => !f.folder);
            const folderTree = buildFolderTree(category.folders);

            return (
              <motion.div
                key={category.id}
                className="source-category"
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: catIdx * 0.06, duration: 0.35 }}
              >
                <button
                  className={`category-header ${selectedSource === category.source && !selectedFeedId ? "active" : ""}`}
                  onClick={() => {
                    onSelectSource(category.source);
                    if (!expandedCategories.has(category.id)) {
                      toggleCategory(category.id);
                    }
                  }}
                  onContextMenu={(e) => handleCategoryContextMenu(e, category.id)}
                >
                  <span className="category-icon">
                    {sourceIcons[category.source] || "◇"}
                  </span>
                  <span className="category-label">{category.label}</span>
                  <span className="category-count">
                    {category.feeds.reduce((s, f) => s + f.unreadCount, 0)}
                  </span>
                  <span
                    className={`category-chevron ${expandedCategories.has(category.id) ? "expanded" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCategory(category.id);
                    }}
                  >
                    ›
                  </span>
                </button>

                <AnimatePresence>
                  {expandedCategories.has(category.id) && (
                    <motion.div
                      className="category-feeds"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
                    >
                      {/* New root-level folder input */}
                      {renderNewFolderInput(category.id, undefined, 0)}

                      {/* Root feeds drop zone */}
                      {(() => {
                        const rootKey = `root::${category.id}`;
                        const isOver = dropTarget === rootKey && dragFeedId !== null;
                        return (
                          <div
                            className={`category-root-zone ${isOver ? 'drop-over' : ''}`}
                            onDragOver={(e) => handleDragOver(e, rootKey)}
                            onDragLeave={(e) => handleDragLeave(e, rootKey)}
                            onDrop={handleDropOnRoot}
                          >
                            {rootFeeds.map((feed, feedIdx) => renderFeed(feed, feedIdx, category.id, 0))}
                          </div>
                        );
                      })()}

                      {/* Recursive folder tree */}
                      {folderTree.map(node => renderFolderNode(node, category, 0))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
        </>
        )}
      </div>

      {/* Mode tabs + Ctrl+K hint */}
      {onBrandSwitch && (
        <div className="mode-tab-bar">
          {([
            { mode: 'flux' as const, icon: '◈', label: 'Flux', shortcut: '1', pro: false },
            { mode: 'bookmark' as const, icon: '🔖', label: 'Signets', shortcut: '2', pro: false },
            { mode: 'note' as const, icon: '📝', label: 'Notes', shortcut: '3', pro: false },
            { mode: 'editor' as const, icon: '✏️', label: 'Éditeur', shortcut: '4', pro: true },
            { mode: 'draw' as const, icon: '🎨', label: 'Dessin', shortcut: '5', pro: true },
          ]).map(tab => {
            const locked = tab.pro && !isPro;
            return (
              <button
                key={tab.mode}
                className={`mode-tab ${brandMode === tab.mode ? 'mode-tab--active' : ''} ${locked ? 'mode-tab--locked' : ''}`}
                onClick={() => onBrandSwitch(tab.mode)}
                title={locked ? `${tab.label} (Pro)` : `${tab.label} (Ctrl+${tab.shortcut})`}
              >
                <span className="mode-tab-icon">{locked ? '🔒' : tab.icon}</span>
              </button>
            );
          })}
          <span className="mode-tab-kbd" title="Recherche / Commandes">Ctrl+K</span>
        </div>
      )}

      {brandMode === 'flux' && syncError && (
        <div className="sync-error-banner" title={syncError}>
          <span className="sync-error-icon">⚠</span>
          <span className="sync-error-text">{syncError}</span>
        </div>
      )}

      {/* ── Bookmark URL input ── */}
      <AnimatePresence>
        {bookmarkUrlOpen && brandMode === 'bookmark' && (
          <motion.div
            className="bk-url-input-bar"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const url = bookmarkUrlValue.trim();
                if (url) {
                  onAddBookmark?.(url);
                  setBookmarkUrlValue('');
                  setBookmarkUrlOpen(false);
                }
              }}
            >
              <input
                ref={bookmarkUrlRef}
                type="url"
                className="bk-url-input"
                placeholder="https://..."
                value={bookmarkUrlValue}
                onChange={(e) => setBookmarkUrlValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setBookmarkUrlOpen(false);
                    setBookmarkUrlValue('');
                  }
                }}
              />
              <button type="submit" className="bk-url-submit" disabled={!bookmarkUrlValue.trim()}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="2" y1="8" x2="14" y2="8" /><polyline points="9,3 14,8 9,13" />
                </svg>
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Footer ── */}
      <div className="source-panel-footer">
        <SyncButton
          showLabel={false}
          onSync={onSync}
          isSyncing={isSyncing}
          progress={syncProgress}
        />
        <button
          className="footer-btn footer-btn-add"
          title={
            brandMode === 'flux' ? 'Ajouter un flux' :
            brandMode === 'note' ? 'Nouvelle note' :
            brandMode === 'editor' ? 'Nouveau document' :
            'Ajouter un bookmark'
          }
          onClick={() => {
            if (brandMode === 'flux') {
              if (!isPro && totalFeeds >= PRO_LIMITS.maxFeeds) {
                showUpgradeModal();
              } else {
                setIsAddModalOpen(true);
              }
            } else if (brandMode === 'note') {
              onAddNote?.();
            } else if (brandMode === 'editor') {
              onAddDoc?.();
            } else if (brandMode === 'bookmark') {
              setBookmarkUrlOpen(prev => !prev);
              setTimeout(() => bookmarkUrlRef.current?.focus(), 50);
            }
          }}
        >
          <span>+</span>
          {brandMode === 'flux' && !isPro && totalFeeds >= PRO_LIMITS.maxFeeds - 5 && (
            <span className="feed-unread" style={{ fontSize: '9px', marginLeft: 4 }}>
              {totalFeeds}/{PRO_LIMITS.maxFeeds}
            </span>
          )}
        </button>
        <button className="footer-btn" title="Statistiques" onClick={() => setIsStatsOpen(true)}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="3" y1="12" x2="3" y2="7" />
            <line x1="8" y1="12" x2="8" y2="4" />
            <line x1="13" y1="12" x2="13" y2="9" />
          </svg>
        </button>
        <button className="footer-btn" title="Paramètres" onClick={() => setIsSettingsOpen(true)}>
          <span>⚙</span>
        </button>
        {!isPro && (
          <button className="footer-btn upgrade-btn" title="Passer à Pro" onClick={showUpgradeModal}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="8,1 10.5,5.5 15,6.5 12,10 12.5,15 8,12.5 3.5,15 4,10 1,6.5 5.5,5.5" />
            </svg>
          </button>
        )}
        <div style={{ position: 'relative', marginLeft: 'auto' }}>
          <button
            className="palette-btn"
            onClick={() => setPaletteOpen(prev => !prev)}
            title="Palette de couleurs"
          >
            {(() => {
              const p = getPaletteById(getStoredPaletteId());
              const isDark = document.documentElement.classList.contains('dark') || document.documentElement.classList.contains('amoled');
              const c = isDark ? p.dark : p.light;
              return (
                <span className="palette-btn-dots">
                  <span className="palette-dot" style={{ background: c.accent }} />
                  <span className="palette-dot" style={{ background: c.secondary }} />
                  <span className="palette-dot" style={{ background: c.tertiary }} />
                </span>
              );
            })()}
          </button>
          {paletteOpen && <PalettePicker onClose={() => setPaletteOpen(false)} />}
        </div>
        <UserMenu />
      </div>

      <AddFeedModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAdd={handleAddFeed}
        feedCount={totalFeeds}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onImportOpml={onImportOpml}
        feedCount={totalFeeds}
        onSyncIntervalChange={onSyncIntervalChange}
        onShowSysInfoChange={onShowSysInfoChange}
        showSysInfo={showSysInfo}
      />

      <StatsModal
        isOpen={isStatsOpen}
        onClose={() => setIsStatsOpen(false)}
        items={allItems}
      />

      <ExpandingPanel
        isOpen={isAboutOpen}
        onClose={() => setIsAboutOpen(false)}
        title="SuperFlux"
        corner="top-left"
      >
        <div className="panel-about">
          <div className="panel-about-hero">
            <div className="panel-about-logo">◈</div>
            <div className="panel-about-appname">SuperFlux</div>
            <div className="panel-about-version">v0.4.0</div>
            <p className="panel-about-desc">
              Lecteur RSS moderne et performant. Agrégez vos flux favoris, podcasts, Reddit, YouTube et réseaux sociaux en un seul endroit.
            </p>
          </div>

          <div className="panel-section">
            <div className="panel-section-title">Raccourcis clavier</div>
            <div className="panel-shortcuts">
              <div className="panel-shortcut-row">
                <span className="panel-shortcut-label">Panneau Sources</span>
                <span className="panel-shortcut-key">1</span>
              </div>
              <div className="panel-shortcut-row">
                <span className="panel-shortcut-label">Panneau Articles</span>
                <span className="panel-shortcut-key">2</span>
              </div>
              <div className="panel-shortcut-row">
                <span className="panel-shortcut-label">Panneau Lecture</span>
                <span className="panel-shortcut-key">3</span>
              </div>
              <div className="panel-shortcut-row">
                <span className="panel-shortcut-label">Fermer ce panneau</span>
                <span className="panel-shortcut-key">Esc</span>
              </div>
            </div>
          </div>

          <div className="panel-section">
            <div className="panel-section-title">Fonctionnalités</div>
            <div className="panel-features-grid">
              <div className="panel-feature">
                <span className="panel-feature-icon">◇</span>
                <span>Flux RSS & Atom</span>
              </div>
              <div className="panel-feature">
                <span className="panel-feature-icon">⬡</span>
                <span>Reddit</span>
              </div>
              <div className="panel-feature">
                <span className="panel-feature-icon">▷</span>
                <span>YouTube</span>
              </div>
              <div className="panel-feature">
                <span className="panel-feature-icon">✦</span>
                <span>Twitter / X</span>
              </div>
              <div className="panel-feature">
                <span className="panel-feature-icon">🎙</span>
                <span>Podcasts</span>
              </div>
              <div className="panel-feature">
                <span className="panel-feature-icon">🌐</span>
                <span>RSSHub</span>
              </div>
              <div className="panel-feature">
                <span className="panel-feature-icon">✦</span>
                <span>Résumés IA</span>
              </div>
              <div className="panel-feature">
                <span className="panel-feature-icon">🔊</span>
                <span>Lecture vocale</span>
              </div>
            </div>
          </div>
        </div>
      </ExpandingPanel>

      {/* ── Context menus ── */}

      {/* Category context menu */}
      {contextMenu?.kind === 'category' && (
        <div
          className="feed-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            className="feed-context-menu-item"
            onClick={(e) => {
              e.stopPropagation();
              if (!isPro && totalFolders >= PRO_LIMITS.maxFolders) {
                showUpgradeModal();
                setContextMenu(null);
                return;
              }
              setNewFolderInput({ categoryId: contextMenu.categoryId, value: '', parentPath: undefined });
              setContextMenu(null);
            }}
          >
            <span className="feed-context-menu-icon">📁</span>
            Créer un sous-dossier{!isPro ? ' (Pro)' : ''}
          </button>
        </div>
      )}

      {/* Folder context menu */}
      {contextMenu?.kind === 'folder' && (
        <div
          className="feed-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            className="feed-context-menu-item"
            onClick={(e) => {
              e.stopPropagation();
              if (!isPro && totalFolders >= PRO_LIMITS.maxFolders) {
                showUpgradeModal();
                setContextMenu(null);
                return;
              }
              // Create subfolder inside this folder
              const folderPath = contextMenu.folderPath;
              const folderKey = `${contextMenu.categoryId}::${folderPath}`;
              // Auto-expand parent so input is visible
              setExpandedFolders(prev => new Set(prev).add(folderKey));
              setNewFolderInput({ categoryId: contextMenu.categoryId, value: '', parentPath: folderPath });
              setContextMenu(null);
            }}
          >
            <span className="feed-context-menu-icon">📁</span>
            Créer un sous-dossier{!isPro ? ' (Pro)' : ''}
          </button>
          <button
            className="feed-context-menu-item"
            onClick={(e) => {
              e.stopPropagation();
              const path = contextMenu.folderPath;
              const lastSlash = path.lastIndexOf('/');
              const currentName = lastSlash >= 0 ? path.substring(lastSlash + 1) : path;
              setRenameFolderInput({
                categoryId: contextMenu.categoryId,
                oldPath: path,
                value: currentName,
              });
              setContextMenu(null);
            }}
          >
            <span className="feed-context-menu-icon">✎</span>
            Renommer
          </button>
          <button
            className="feed-context-menu-item"
            onClick={() => {
              const folderName = contextMenu.folderPath.split('/').pop()!;
              togglePin({ kind: 'folder', categoryId: contextMenu.categoryId, folderPath: contextMenu.folderPath, label: folderName });
              setContextMenu(null);
            }}
          >
            <span className="feed-context-menu-icon">{isPinned({ kind: 'folder', categoryId: contextMenu.categoryId, folderPath: contextMenu.folderPath, label: '' }) ? '✦' : '☆'}</span>
            {isPinned({ kind: 'folder', categoryId: contextMenu.categoryId, folderPath: contextMenu.folderPath, label: '' }) ? 'Désépingler' : 'Épingler en haut'}
          </button>
          <button
            className="feed-context-menu-item feed-context-menu-item--danger"
            onClick={() => {
              onDeleteFolder(contextMenu.categoryId, contextMenu.folderPath);
              setContextMenu(null);
            }}
          >
            <span className="feed-context-menu-icon">✕</span>
            Supprimer le dossier
          </button>
        </div>
      )}

      {/* Feed context menu (with move submenu) */}
      {contextMenu?.kind === 'feed' && (() => {
        const cat = categories.find(c => c.id === contextMenu.categoryId);
        const allFolderPaths = cat?.folders || [];
        const currentFolder = contextMenu.feed.folder;

        return (
          <div
            className="feed-context-menu"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="feed-context-menu-item"
              onClick={() => {
                const feed = contextMenu.feed;
                togglePin({ kind: 'feed', feedId: feed.id, label: feed.name, icon: feed.icon || sourceIcons[feed.source] || '◇' });
                setContextMenu(null);
              }}
            >
              <span className="feed-context-menu-icon">{isPinned({ kind: 'feed', feedId: contextMenu.feed.id, label: '', icon: '' }) ? '✦' : '☆'}</span>
              {isPinned({ kind: 'feed', feedId: contextMenu.feed.id, label: '', icon: '' }) ? 'Désépingler' : 'Épingler en haut'}
            </button>
            <button
              className="feed-context-menu-item"
              onClick={() => {
                setRenameFeedInput({ feedId: contextMenu.feed.id, value: contextMenu.feed.name });
                setContextMenu(null);
              }}
            >
              <span className="feed-context-menu-icon">✎</span>
              Renommer
            </button>
            <button
              className="feed-context-menu-item feed-context-menu-item--danger"
              onClick={() => { onRemoveFeed(contextMenu.feed.id); setContextMenu(null); }}
            >
              <span className="feed-context-menu-icon">✕</span>
              Supprimer
            </button>

            {allFolderPaths.length > 0 && (
              <div className="feed-context-menu-submenu-wrapper">
                <button
                  className="feed-context-menu-item"
                  onMouseEnter={() => setMoveSubmenuFeedId(contextMenu.feed.id)}
                >
                  <span className="feed-context-menu-icon">→</span>
                  Déplacer vers
                  <span className="feed-context-menu-arrow">›</span>
                </button>

                {moveSubmenuFeedId === contextMenu.feed.id && (
                  <div className="context-submenu">
                    {currentFolder && (
                      <button
                        className="feed-context-menu-item"
                        onClick={() => {
                          onMoveFeedToFolder(contextMenu.feed.id, undefined);
                          setContextMenu(null);
                        }}
                      >
                        Racine
                      </button>
                    )}
                    {allFolderPaths
                      .filter(p => p !== currentFolder)
                      .map(folderPath => {
                        // Show indented path: indent by depth
                        const depth = folderPath.split('/').length - 1;
                        const name = folderPath.split('/').pop()!;
                        return (
                          <button
                            key={folderPath}
                            className="feed-context-menu-item"
                            style={{ paddingLeft: 12 + depth * 12 }}
                            onClick={() => {
                              onMoveFeedToFolder(contextMenu.feed.id, folderPath);
                              setContextMenu(null);
                            }}
                          >
                            📁 {name}
                          </button>
                        );
                      })}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
