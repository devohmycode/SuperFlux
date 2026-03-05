import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';

export interface Snippet {
  id: string;
  name: string;
  keyword: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  shortcut?: string;
}

const STORAGE_KEY = 'superflux_snippets';

export function loadSnippets(): Snippet[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveSnippets(snippets: Snippet[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snippets)); }
  catch { /* ignore */ }
}

interface ExpanderFileListProps {
  snippets: Snippet[];
  selectedSnippetId: string | null;
  searchQuery: string;
  onSelectSnippet: (id: string) => void;
  onDeleteSnippet: (id: string) => void;
  onCopySnippet: (id: string) => void;
}

type ContextMenuState = { x: number; y: number; snippetId: string } | null;

export function ExpanderFileList({
  snippets,
  selectedSnippetId,
  searchQuery,
  onSelectSnippet,
  onDeleteSnippet,
  onCopySnippet,
}: ExpanderFileListProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [contextMenu]);

  const handleContext = useCallback((e: React.MouseEvent, snippetId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, snippetId });
  }, []);

  // Filter and sort
  const sq = searchQuery.toLowerCase();
  const filtered = snippets
    .filter(s => !sq || s.name.toLowerCase().includes(sq) || s.keyword.toLowerCase().includes(sq))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return (
    <div className="expander-file-list">
      <AnimatePresence mode="popLayout">
        {filtered.map(snippet => (
          <motion.button
            key={snippet.id}
            className={`nsrc-note ${selectedSnippetId === snippet.id ? 'active' : ''}`}
            onClick={() => onSelectSnippet(snippet.id)}
            onContextMenu={(e) => handleContext(e, snippet.id)}
            onMouseEnter={() => setHoveredId(snippet.id)}
            onMouseLeave={() => setHoveredId(null)}
            layout
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
          >
            <span className="nsrc-note-icon">⚡</span>
            <div className="nsrc-note-info">
              <span className="nsrc-note-title">{snippet.name || 'Sans titre'}</span>
              {snippet.keyword && (
                <span className="expander-keyword-badge">{snippet.keyword}</span>
              )}
            </div>
            {hoveredId === snippet.id && (
              <button
                className="expander-copy-btn"
                title="Copier le snippet"
                onClick={(e) => {
                  e.stopPropagation();
                  onCopySnippet(snippet.id);
                }}
              >
                📋
              </button>
            )}
          </motion.button>
        ))}
      </AnimatePresence>

      {filtered.length === 0 && (
        <div className="panel-empty-note" style={{ padding: '24px', opacity: 0.5, textAlign: 'center' }}>
          {searchQuery ? 'Aucun snippet trouvé' : 'Aucun snippet'}
        </div>
      )}

      {/* Context menu */}
      <AnimatePresence>
        {contextMenu && (
          <motion.div
            ref={menuRef}
            className="feed-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.1 }}
          >
            <button
              className="feed-context-menu-item feed-context-menu-item--danger"
              onClick={() => {
                onDeleteSnippet(contextMenu.snippetId);
                setContextMenu(null);
              }}
            >
              <span>🗑</span> Supprimer
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
