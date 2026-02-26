import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { WebBookmark } from '../services/bookmarkService';

interface BookmarkSourceListProps {
  folders: string[];
  folderCounts: Record<string, number>;
  selectedFolder: string | null;
  onSelectFolder: (folder: string | null) => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (oldName: string, newName: string) => void;
  onDeleteFolder: (name: string) => void;
  bookmarks?: WebBookmark[];
  bookmarkFolderMap?: Record<string, string>;
  selectedBookmarkId?: string | null;
  onSelectBookmark?: (bookmark: WebBookmark) => void;
  totalCount?: number;
}

type ContextMenuState =
  | { kind: 'folder'; x: number; y: number; folder: string }
  | null;

export function BookmarkSourceList({
  folders,
  folderCounts,
  selectedFolder,
  onSelectFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  bookmarks,
  bookmarkFolderMap,
  selectedBookmarkId,
  onSelectBookmark,
  totalCount,
}: BookmarkSourceListProps) {
  const [newFolderInput, setNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const newFolderRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  const toggleFolder = useCallback((folder: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  }, []);

  const handleCreateFolder = useCallback(() => {
    const name = newFolderName.trim();
    if (name && !folders.includes(name)) {
      onCreateFolder(name);
    }
    setNewFolderName('');
    setNewFolderInput(false);
  }, [newFolderName, folders, onCreateFolder]);

  const handleRename = useCallback(() => {
    const name = renameValue.trim();
    if (name && renamingFolder && name !== renamingFolder && !folders.includes(name)) {
      onRenameFolder(renamingFolder, name);
      // Update expanded key
      setExpandedFolders(prev => {
        if (!prev.has(renamingFolder)) return prev;
        const next = new Set(prev);
        next.delete(renamingFolder);
        next.add(name);
        return next;
      });
    }
    setRenamingFolder(null);
    setRenameValue('');
  }, [renameValue, renamingFolder, folders, onRenameFolder]);

  const handleFolderContext = useCallback((e: React.MouseEvent, folder: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ kind: 'folder', x: e.clientX, y: e.clientY, folder });
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('click', close);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', handleKey);
    };
  }, [contextMenu]);

  // Get bookmarks for a given folder
  const getBookmarksForFolder = (folder: string): WebBookmark[] => {
    if (!bookmarks || !bookmarkFolderMap) return [];
    return bookmarks.filter(bk => bookmarkFolderMap[bk.id] === folder);
  };

  return (
    <div className="nsrc">
      {/* All bookmarks */}
      <button
        className={`source-all-btn ${selectedFolder === null ? 'active' : ''}`}
        onClick={() => onSelectFolder(null)}
      >
        <span className="source-all-icon">🔖</span>
        <span className="source-all-label">Tous les bookmarks</span>
        {(totalCount ?? 0) > 0 && (
          <span className="source-all-count">{totalCount}</span>
        )}
      </button>

      {/* New folder button */}
      <button
        className="nsrc-add-folder-btn"
        onClick={() => {
          setNewFolderInput(true);
          setTimeout(() => newFolderRef.current?.focus(), 50);
        }}
        title="Nouveau dossier"
      >
        <span className="nsrc-add-folder-icon">+</span>
        <span className="nsrc-add-folder-label">Nouveau dossier</span>
      </button>

      {/* New folder input */}
      <AnimatePresence>
        {newFolderInput && (
          <motion.div
            className="nsrc-folder-input-row"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <input
              ref={newFolderRef}
              className="nsrc-folder-input"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateFolder();
                if (e.key === 'Escape') { setNewFolderInput(false); setNewFolderName(''); }
              }}
              onBlur={handleCreateFolder}
              placeholder="Nom du dossier"
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Folders (expandable, like SuperFlux subfolders) */}
      {folders.map((folder) => {
        const count = folderCounts[folder] || 0;
        const isExpanded = expandedFolders.has(folder);
        const folderBookmarks = getBookmarksForFolder(folder);

        return (
          <div key={folder} className="subfolder">
            {renamingFolder === folder ? (
              <div className="folder-inline-input-wrapper" style={{ paddingLeft: 12 }}>
                <input
                  ref={renameRef}
                  className="folder-inline-input"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRename();
                    if (e.key === 'Escape') { setRenamingFolder(null); setRenameValue(''); }
                  }}
                  onBlur={handleRename}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                />
              </div>
            ) : (
              <button
                className={`subfolder-header ${selectedFolder === folder ? 'active' : ''}`}
                style={{ paddingLeft: 12 }}
                onClick={() => {
                  toggleFolder(folder);
                  onSelectFolder(folder);
                }}
                onContextMenu={(e) => handleFolderContext(e, folder)}
              >
                <span className={`subfolder-chevron ${isExpanded ? 'expanded' : ''}`}>›</span>
                <span className="subfolder-icon">📁</span>
                <span className="subfolder-name">{folder}</span>
                <span className="subfolder-count">{count}</span>
              </button>
            )}

            {isExpanded && (
              <div className="subfolder-feeds">
                {folderBookmarks.length === 0 ? (
                  <div className="bksrc-empty" style={{ paddingLeft: 32, fontSize: 11, color: 'var(--text-tertiary)', padding: '4px 8px 4px 32px' }}>
                    Aucun bookmark
                  </div>
                ) : (
                  folderBookmarks.map((bk) => (
                    <button
                      key={bk.id}
                      className={`feed-item-btn ${selectedBookmarkId === bk.id ? 'active' : ''}`}
                      style={{ paddingLeft: 32 }}
                      onClick={() => onSelectBookmark?.(bk)}
                      title={bk.url}
                    >
                      {bk.favicon ? (
                        <img
                          src={bk.favicon}
                          alt=""
                          className="feed-icon"
                          style={{ width: 14, height: 14, borderRadius: 2 }}
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                      ) : (
                        <span className="feed-icon" style={{ fontSize: 11 }}>🔖</span>
                      )}
                      <span className="feed-name">{bk.title}</span>
                      {!bk.is_read && (
                        <span className="feed-unread" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Folder context menu */}
      {contextMenu?.kind === 'folder' && (
        <div
          className="feed-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x, position: 'fixed', zIndex: 1000 }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="feed-context-menu-item"
            onClick={() => {
              setRenamingFolder(contextMenu.folder);
              setRenameValue(contextMenu.folder);
              setContextMenu(null);
              setTimeout(() => renameRef.current?.focus(), 50);
            }}
          >
            <span className="feed-context-menu-icon">✎</span>
            Renommer
          </button>
          <button
            className="feed-context-menu-item feed-context-menu-item--danger"
            onClick={() => {
              onDeleteFolder(contextMenu.folder);
              setContextMenu(null);
            }}
          >
            <span className="feed-context-menu-icon">✕</span>
            Supprimer
          </button>
        </div>
      )}
    </div>
  );
}
