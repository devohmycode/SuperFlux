import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';

export interface ClipEntry {
  id: string;
  content: string;
  pinned: boolean;
  timestamp: number;
  shortcut?: string;
}

interface ClipboardHistoryListProps {
  entries: ClipEntry[];
  selectedEntryId: string | null;
  searchQuery: string;
  onSelectEntry: (id: string) => void;
  onDeleteEntry: (id: string) => void;
  onPasteEntry: (id: string) => void;
  onTogglePin: (id: string) => void;
}

type ContextMenuState = { x: number; y: number; entryId: string } | null;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '...';
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export function ClipboardHistoryList({
  entries,
  selectedEntryId,
  searchQuery,
  onSelectEntry,
  onDeleteEntry,
  onPasteEntry,
  onTogglePin,
}: ClipboardHistoryListProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  const handleContext = useCallback((e: React.MouseEvent, entryId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, entryId });
  }, []);

  const sq = searchQuery.toLowerCase();
  const filtered = entries.filter(
    e => !sq || e.content.toLowerCase().includes(sq)
  );

  return (
    <div className="expander-file-list">
      <AnimatePresence mode="popLayout">
        {filtered.map(entry => (
          <motion.button
            key={entry.id}
            className={`nsrc-note ${selectedEntryId === entry.id ? 'active' : ''}`}
            onClick={() => onSelectEntry(entry.id)}
            onDoubleClick={() => onPasteEntry(entry.id)}
            onContextMenu={(e) => handleContext(e, entry.id)}
            onMouseEnter={() => setHoveredId(entry.id)}
            onMouseLeave={() => setHoveredId(null)}
            layout
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
          >
            <span className="nsrc-note-icon">{entry.pinned ? '📌' : '📋'}</span>
            <div className="nsrc-note-info">
              <span className="nsrc-note-title">{truncate(entry.content, 60)}</span>
              <span className="sc-entry-time">{formatTime(entry.timestamp)}</span>
            </div>
            {hoveredId === entry.id && (
              <button
                className="expander-copy-btn"
                title="Re-copier"
                onClick={(e) => {
                  e.stopPropagation();
                  onPasteEntry(entry.id);
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
          {searchQuery ? 'Aucun clip trouvé' : 'Historique vide'}
        </div>
      )}

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
              className="feed-context-menu-item"
              onClick={() => {
                onPasteEntry(contextMenu.entryId);
                setContextMenu(null);
              }}
            >
              <span>📋</span> Re-copier
            </button>
            <button
              className="feed-context-menu-item"
              onClick={() => {
                onTogglePin(contextMenu.entryId);
                setContextMenu(null);
              }}
            >
              <span>📌</span> {entries.find(e => e.id === contextMenu.entryId)?.pinned ? 'Désépingler' : 'Épingler'}
            </button>
            <button
              className="feed-context-menu-item feed-context-menu-item--danger"
              onClick={() => {
                onDeleteEntry(contextMenu.entryId);
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
