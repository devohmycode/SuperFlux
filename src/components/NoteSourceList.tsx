import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import type { Note } from './NotePanel';

interface NoteSourceListProps {
  notes: Note[];
  folders: string[];
  selectedNoteId: string | null;
  selectedFolder: string | null;
  onSelectNote: (noteId: string) => void;
  onSelectFolder: (folder: string | null) => void;
  onAddNote: () => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (oldName: string, newName: string) => void;
  onDeleteFolder: (name: string) => void;
  onMoveNoteToFolder: (noteId: string, folder: string | undefined) => void;
  onDeleteNote: (noteId: string) => void;
}

type ContextMenuState =
  | { kind: 'note'; x: number; y: number; noteId: string; currentFolder?: string }
  | { kind: 'folder'; x: number; y: number; folder: string }
  | null;

export function NoteSourceList({
  notes,
  folders,
  selectedNoteId,
  selectedFolder,
  onSelectNote,
  onSelectFolder,
  onAddNote: _onAddNote,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveNoteToFolder,
  onDeleteNote,
}: NoteSourceListProps) {
  const { t } = useTranslation();
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(folders));
  const [newFolderInput, setNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [moveSubmenuOpen, setMoveSubmenuOpen] = useState(false);
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
      setExpandedFolders(prev => new Set(prev).add(name));
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

  const handleNoteContext = useCallback((e: React.MouseEvent, noteId: string, currentFolder?: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMoveSubmenuOpen(false);
    setContextMenu({ kind: 'note', x: e.clientX, y: e.clientY, noteId, currentFolder });
  }, []);

  const handleFolderContext = useCallback((e: React.MouseEvent, folder: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMoveSubmenuOpen(false);
    setContextMenu({ kind: 'folder', x: e.clientX, y: e.clientY, folder });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
    setMoveSubmenuOpen(false);
  }, []);

  // Close context menu on click/escape
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => { setContextMenu(null); setMoveSubmenuOpen(false); };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('click', close);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', handleKey);
    };
  }, [contextMenu]);

  const rootNotes = notes.filter(n => !n.folder);

  const renderNoteItem = (note: Note) => (
    <div
      key={note.id}
      className={`nsrc-note ${selectedNoteId === note.id ? 'active' : ''}`}
      onClick={() => onSelectNote(note.id)}
      onContextMenu={(e) => handleNoteContext(e, note.id, note.folder)}
    >
      <span className="nsrc-note-icon">✎</span>
      <span className="nsrc-note-title">{note.title || t('common.untitled')}</span>
    </div>
  );

  return (
    <div className="nsrc">
      {/* All notes */}
      <button
        className={`source-all-btn ${selectedFolder === null && !selectedNoteId ? 'active' : ''}`}
        onClick={() => onSelectFolder(null)}
      >
        <span className="source-all-icon">✎</span>
        <span className="source-all-label">{t('notes.allNotes')}</span>
        <span className="source-all-count">{notes.length}</span>
      </button>

      {/* New folder button */}
      <button
        className="nsrc-add-folder-btn"
        onClick={() => {
          setNewFolderInput(true);
          setTimeout(() => newFolderRef.current?.focus(), 50);
        }}
        title={t('common.newFolder')}
      >
        <span className="nsrc-add-folder-icon">+</span>
        <span className="nsrc-add-folder-label">{t('common.newFolder')}</span>
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
              placeholder={t('common.folderName')}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Root notes (no folder) */}
      <div className="nsrc-root-zone">
        {rootNotes.map(renderNoteItem)}
      </div>

      {/* Folders */}
      {folders.map((folder, idx) => {
        const folderNotes = notes.filter(n => n.folder === folder);
        const isExpanded = expandedFolders.has(folder);

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
              onClick={() => { onSelectFolder(folder); if (!isExpanded) toggleFolder(folder); }}
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
              <span className="nsrc-folder-count">{folderNotes.length}</span>
              <span
                className={`category-chevron ${isExpanded ? 'expanded' : ''}`}
                onClick={(e) => { e.stopPropagation(); toggleFolder(folder); }}
              >
                ›
              </span>
            </div>

            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  className="nsrc-folder-children"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {folderNotes.map(renderNoteItem)}
                  {folderNotes.length === 0 && (
                    <div className="nsrc-folder-empty">{t('notes.emptyFolder')}</div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}

      {/* ── Context menus ── */}

      {/* Note context menu */}
      {contextMenu?.kind === 'note' && (
        <div
          className="feed-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x, position: 'fixed', zIndex: 1000 }}
          onClick={(e) => e.stopPropagation()}
        >
          {folders.length > 0 && (
            <div className="feed-context-menu-submenu-wrapper">
              <button
                className="feed-context-menu-item"
                onMouseEnter={() => setMoveSubmenuOpen(true)}
              >
                <span className="feed-context-menu-icon">→</span>
                {t('notes.moveTo')}
                <span className="feed-context-menu-arrow">›</span>
              </button>

              {moveSubmenuOpen && (
                <div className="context-submenu">
                  {/* Move to root (remove from folder) */}
                  {contextMenu.currentFolder && (
                    <button
                      className="feed-context-menu-item"
                      onClick={() => {
                        onMoveNoteToFolder(contextMenu.noteId, undefined);
                        closeContextMenu();
                      }}
                    >
                      {t('notes.outOfFolder')}
                    </button>
                  )}
                  {/* Move to each folder */}
                  {folders
                    .filter(f => f !== contextMenu.currentFolder)
                    .map(folder => (
                      <button
                        key={folder}
                        className="feed-context-menu-item"
                        onClick={() => {
                          onMoveNoteToFolder(contextMenu.noteId, folder);
                          closeContextMenu();
                        }}
                      >
                        📁 {folder}
                      </button>
                    ))}
                </div>
              )}
            </div>
          )}
          {!folders.length && contextMenu.currentFolder && (
            <button
              className="feed-context-menu-item"
              onClick={() => {
                onMoveNoteToFolder(contextMenu.noteId, undefined);
                closeContextMenu();
              }}
            >
              <span className="feed-context-menu-icon">→</span>
              {t('notes.removeFromFolder')}
            </button>
          )}
          <button
            className="feed-context-menu-item feed-context-menu-item--danger"
            onClick={() => {
              onDeleteNote(contextMenu.noteId);
              closeContextMenu();
            }}
          >
            <span className="feed-context-menu-icon">✕</span>
            {t('common.delete')}
          </button>
        </div>
      )}

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
            {t('common.rename')}
          </button>
          <button
            className="feed-context-menu-item feed-context-menu-item--danger"
            onClick={() => {
              onDeleteFolder(contextMenu.folder);
              setContextMenu(null);
            }}
          >
            <span className="feed-context-menu-icon">✕</span>
            {t('common.delete')}
          </button>
        </div>
      )}
    </div>
  );
}
