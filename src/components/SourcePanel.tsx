import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { Feed, FeedCategory, FeedSource } from "../types";
import { SyncButton } from "./SyncButton";
import { AddFeedModal, type NewFeedData } from "./AddFeedModal";
import { SettingsModal } from "./SettingsModal";
import { AnimatedThemeToggler } from "./ui/animated-theme-toggler";
import { UserMenu } from "./UserMenu";

interface SourcePanelProps {
  categories: FeedCategory[];
  selectedFeedId: string | null;
  selectedSource: FeedSource | null;
  showFavorites: boolean;
  favoritesCount: number;
  showReadLater: boolean;
  readLaterCount: number;
  onSelectFeed: (feedId: string, source: FeedSource) => void;
  onSelectSource: (source: FeedSource) => void;
  onSelectAll: () => void;
  onSelectFavorites: () => void;
  onSelectReadLater: () => void;
  onAddFeed: (feed: NewFeedData) => void;
  onImportOpml: (feeds: { url: string; name: string; source: FeedSource }[]) => number;
  onRemoveFeed: (feedId: string) => void;
  onSync: () => void;
  isSyncing: boolean;
  syncProgress: number;
  onCreateFolder: (categoryId: string, name: string, parentPath?: string) => void;
  onRenameFolder: (categoryId: string, oldPath: string, newName: string) => void;
  onDeleteFolder: (categoryId: string, path: string) => void;
  onMoveFeedToFolder: (feedId: string, folder: string | undefined) => void;
  onClose?: () => void;
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
  onSelectFeed,
  onSelectSource,
  onSelectAll,
  onSelectFavorites,
  onSelectReadLater,
  onAddFeed,
  onImportOpml,
  onRemoveFeed,
  onSync,
  isSyncing,
  syncProgress,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveFeedToFolder,
  onClose,
}: SourcePanelProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(categories.map((c) => c.id)),
  );
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [moveSubmenuFeedId, setMoveSubmenuFeedId] = useState<string | null>(null);

  // Inline inputs (parentPath: where to create; oldPath: which folder to rename)
  const [newFolderInput, setNewFolderInput] = useState<{ categoryId: string; value: string; parentPath?: string } | null>(null);
  const [renameFolderInput, setRenameFolderInput] = useState<{ categoryId: string; oldPath: string; value: string } | null>(null);
  const newFolderRef = useRef<HTMLInputElement>(null);
  const renameFolderRef = useRef<HTMLInputElement>(null);

  // Drag-and-drop state
  const [dragFeedId, setDragFeedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // Auto-focus inline inputs
  useEffect(() => {
    if (newFolderInput) newFolderRef.current?.focus();
  }, [newFolderInput]);
  useEffect(() => {
    if (renameFolderInput) renameFolderRef.current?.focus();
  }, [renameFolderInput]);

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

  const handleDropOnRoot = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const feedId = e.dataTransfer.getData('text/plain');
    if (feedId) onMoveFeedToFolder(feedId, undefined);
    setDragFeedId(null);
    setDropTarget(null);
  }, [onMoveFeedToFolder]);

  const handleDropOnFolder = useCallback((e: React.DragEvent, folderPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    const feedId = e.dataTransfer.getData('text/plain');
    if (feedId) onMoveFeedToFolder(feedId, folderPath);
    setDragFeedId(null);
    setDropTarget(null);
  }, [onMoveFeedToFolder]);

  const totalUnread = categories.reduce(
    (sum, cat) => sum + cat.feeds.reduce((s, f) => s + f.unreadCount, 0),
    0,
  );


  // ── Render helpers ──

  const renderFeed = (feed: Feed, feedIdx: number, categoryId: string, depth: number) => (
    <motion.button
      key={feed.id}
      className={`feed-item-btn ${selectedFeedId === feed.id ? "active" : ""} ${dragFeedId === feed.id ? "dragging" : ""}`}
      style={{ paddingLeft: FEED_BASE_INDENT + depth * INDENT_STEP }}
      onClick={() => onSelectFeed(feed.id, feed.source)}
      onContextMenu={(e) => handleFeedContextMenu(e, feed, categoryId)}
      draggable
      {...{ onDragStart: (e: React.DragEvent) => handleDragStart(e, feed.id) } as any}
      {...{ onDragEnd: (e: React.DragEvent) => handleDragEnd(e) } as any}
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
    </motion.button>
  );

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
    const folderFeeds = category.feeds.filter(f => f.folder === node.path);
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
          <span className="brand-name">SuperFlux</span>
          <AnimatedThemeToggler className="theme-toggle-btn" />
          {onClose && (
            <button className="panel-close-btn" onClick={onClose} title="Replier le panneau Sources (1)">
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="source-panel-content">
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
            const rootFeeds = category.feeds.filter(f => !f.folder);
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
      </div>

      <div className="source-panel-footer">
        <SyncButton
          showLabel={false}
          onSync={onSync}
          isSyncing={isSyncing}
          progress={syncProgress}
        />
        <button
          className="footer-btn footer-btn-add"
          title="Ajouter un flux"
          onClick={() => setIsAddModalOpen(true)}
        >
          <span>+</span>
        </button>
        <button className="footer-btn" title="Paramètres" onClick={() => setIsSettingsOpen(true)}>
          <span>⚙</span>
        </button>
        <UserMenu />
      </div>

      <AddFeedModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAdd={handleAddFeed}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onImportOpml={onImportOpml}
      />

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
              setNewFolderInput({ categoryId: contextMenu.categoryId, value: '', parentPath: undefined });
              setContextMenu(null);
            }}
          >
            <span className="feed-context-menu-icon">📁</span>
            Créer un sous-dossier
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
            Créer un sous-dossier
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
