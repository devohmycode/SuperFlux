import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface BookmarkSourceListProps {
  folders: string[];
  folderCounts: Record<string, number>;
  selectedFolder: string | null;
  onSelectFolder: (folder: string | null) => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (oldName: string, newName: string) => void;
  onDeleteFolder: (name: string) => void;
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
}: BookmarkSourceListProps) {
  const [newFolderInput, setNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const newFolderRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

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

  return (
    <div className="nsrc">
      {/* All bookmarks */}
      <button
        className={`source-all-btn ${selectedFolder === null ? 'active' : ''}`}
        onClick={() => onSelectFolder(null)}
      >
        <span className="source-all-icon">🔖</span>
        <span className="source-all-label">Tous les bookmarks</span>
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

      {/* Folders */}
      {folders.map((folder, idx) => {
        const count = folderCounts[folder] || 0;

        return (
          <motion.div
            key={folder}
            className="nsrc-folder"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.04, duration: 0.25 }}
          >
            <div
              className={`nsrc-folder-header ${selectedFolder === folder ? 'active' : ''}`}
              onClick={() => onSelectFolder(folder)}
              onContextMenu={(e) => handleFolderContext(e, folder)}
            >
              <span className="nsrc-folder-icon">📁</span>
              {renamingFolder === folder ? (
                <input
                  ref={renameRef}
                  className="nsrc-folder-input inline"
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
              ) : (
                <span className="nsrc-folder-name">{folder}</span>
              )}
              <span className="nsrc-folder-count">{count}</span>
            </div>
          </motion.div>
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
