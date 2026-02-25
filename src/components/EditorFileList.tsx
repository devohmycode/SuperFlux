import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';

export interface EditorDoc {
  id: string;
  title: string;
  content: string;
  folder?: string;
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = 'superflux_editor_docs';
const FOLDERS_KEY = 'superflux_editor_folders';

export function loadEditorDocs(): EditorDoc[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveEditorDocs(docs: EditorDoc[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(docs)); }
  catch { /* ignore */ }
}

export function loadEditorFolders(): string[] {
  try {
    const raw = localStorage.getItem(FOLDERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveEditorFolders(folders: string[]) {
  try { localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders)); }
  catch { /* ignore */ }
}

interface EditorFileListProps {
  docs: EditorDoc[];
  folders: string[];
  selectedDocId: string | null;
  selectedFolder: string | null;
  onSelectDoc: (id: string) => void;
  onSelectFolder: (folder: string | null) => void;
  onAddDoc: () => void;
  onDeleteDoc: (id: string) => void;
  onRenameDoc: (id: string, title: string) => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (oldName: string, newName: string) => void;
  onDeleteFolder: (name: string) => void;
  onMoveDocToFolder: (docId: string, folder: string | undefined) => void;
}

type ContextMenuState =
  | { kind: 'doc'; x: number; y: number; docId: string; currentFolder?: string }
  | { kind: 'folder'; x: number; y: number; folder: string }
  | null;

export function EditorFileList({
  docs,
  folders,
  selectedDocId,
  selectedFolder,
  onSelectDoc,
  onSelectFolder,
  onAddDoc,
  onDeleteDoc,
  onRenameDoc,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveDocToFolder,
}: EditorFileListProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(folders));
  const [newFolderInput, setNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renamingDocId, setRenamingDocId] = useState<string | null>(null);
  const [docRenameValue, setDocRenameValue] = useState('');
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

  const handleRenameFolder = useCallback(() => {
    const name = renameValue.trim();
    if (name && renamingFolder && name !== renamingFolder && !folders.includes(name)) {
      onRenameFolder(renamingFolder, name);
    }
    setRenamingFolder(null);
    setRenameValue('');
  }, [renameValue, renamingFolder, folders, onRenameFolder]);

  const handleDocRename = useCallback(() => {
    if (renamingDocId && docRenameValue.trim()) {
      onRenameDoc(renamingDocId, docRenameValue.trim());
    }
    setRenamingDocId(null);
    setDocRenameValue('');
  }, [renamingDocId, docRenameValue, onRenameDoc]);

  const handleDocContext = useCallback((e: React.MouseEvent, docId: string, currentFolder?: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMoveSubmenuOpen(false);
    setContextMenu({ kind: 'doc', x: e.clientX, y: e.clientY, docId, currentFolder });
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

  const sorted = [...docs].sort((a, b) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
  const rootDocs = sorted.filter(d => !d.folder);

  const renderDocItem = (doc: EditorDoc) => (
    <div
      key={doc.id}
      className={`nsrc-note ${selectedDocId === doc.id ? 'active' : ''}`}
      onClick={() => onSelectDoc(doc.id)}
      onContextMenu={(e) => handleDocContext(e, doc.id, doc.folder)}
    >
      {renamingDocId === doc.id ? (
        <div className="editor-filelist-rename" onClick={e => e.stopPropagation()}>
          <input
            className="nsrc-folder-input inline"
            value={docRenameValue}
            onChange={e => setDocRenameValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleDocRename();
              if (e.key === 'Escape') { setRenamingDocId(null); setDocRenameValue(''); }
            }}
            onBlur={handleDocRename}
            autoFocus
          />
        </div>
      ) : (
        <>
          <span className="nsrc-note-icon">📄</span>
          <span className="nsrc-note-title">{doc.title || 'Sans titre'}</span>
        </>
      )}
    </div>
  );

  return (
    <div className="nsrc">
      {/* All documents button */}
      <button
        className={`source-all-btn ${selectedFolder === null && !selectedDocId ? 'active' : ''}`}
        onClick={() => onSelectFolder(null)}
      >
        <span className="source-all-icon">📄</span>
        <span className="source-all-label">Tous les documents</span>
        <span className="source-all-count">{docs.length}</span>
      </button>

      {/* New document button */}
      <button
        className="nsrc-add-folder-btn"
        onClick={onAddDoc}
        title="Nouveau document"
      >
        <span className="nsrc-add-folder-icon">+</span>
        <span className="nsrc-add-folder-label">Nouveau document</span>
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

      {/* Root documents (no folder) */}
      <div className="nsrc-root-zone">
        {rootDocs.map(renderDocItem)}
      </div>

      {/* Folders */}
      {folders.map((folder, idx) => {
        const folderDocs = sorted.filter(d => d.folder === folder);
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
                    if (e.key === 'Enter') handleRenameFolder();
                    if (e.key === 'Escape') { setRenamingFolder(null); setRenameValue(''); }
                  }}
                  onBlur={handleRenameFolder}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                />
              ) : (
                <span className="nsrc-folder-name">{folder}</span>
              )}
              <span className="nsrc-folder-count">{folderDocs.length}</span>
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
                  {folderDocs.map(renderDocItem)}
                  {folderDocs.length === 0 && (
                    <div className="nsrc-folder-empty">Dossier vide</div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}

      {/* Empty state */}
      {docs.length === 0 && folders.length === 0 && (
        <div className="editor-filelist-empty">
          Aucun document
        </div>
      )}

      {/* ── Context menus ── */}

      {/* Document context menu */}
      {contextMenu?.kind === 'doc' && (
        <div
          className="feed-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x, position: 'fixed', zIndex: 1000 }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="feed-context-menu-item"
            onClick={() => {
              const doc = docs.find(d => d.id === contextMenu.docId);
              if (doc) {
                setRenamingDocId(doc.id);
                setDocRenameValue(doc.title);
              }
              closeContextMenu();
            }}
          >
            <span className="feed-context-menu-icon">✎</span>
            Renommer
          </button>

          {folders.length > 0 && (
            <div className="feed-context-menu-submenu-wrapper">
              <button
                className="feed-context-menu-item"
                onMouseEnter={() => setMoveSubmenuOpen(true)}
              >
                <span className="feed-context-menu-icon">→</span>
                Déplacer vers
                <span className="feed-context-menu-arrow">›</span>
              </button>

              {moveSubmenuOpen && (
                <div className="context-submenu">
                  {contextMenu.currentFolder && (
                    <button
                      className="feed-context-menu-item"
                      onClick={() => {
                        onMoveDocToFolder(contextMenu.docId, undefined);
                        closeContextMenu();
                      }}
                    >
                      Hors dossier
                    </button>
                  )}
                  {folders
                    .filter(f => f !== contextMenu.currentFolder)
                    .map(folder => (
                      <button
                        key={folder}
                        className="feed-context-menu-item"
                        onClick={() => {
                          onMoveDocToFolder(contextMenu.docId, folder);
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
                onMoveDocToFolder(contextMenu.docId, undefined);
                closeContextMenu();
              }}
            >
              <span className="feed-context-menu-icon">→</span>
              Retirer du dossier
            </button>
          )}

          <button
            className="feed-context-menu-item feed-context-menu-item--danger"
            onClick={() => {
              onDeleteDoc(contextMenu.docId);
              closeContextMenu();
            }}
          >
            <span className="feed-context-menu-icon">✕</span>
            Supprimer
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
