import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import type { ClipEntry } from './ClipboardHistoryList';

interface SuperClipboardProps {
  entries: ClipEntry[];
  entry: ClipEntry | null;
  onSelectEntry: (id: string) => void;
  onPasteEntry: (id: string) => void;
  onDeleteEntry: (id: string) => void;
  onTogglePin: (id: string) => void;
  onClearAll: () => void;
  onSetShortcut: (id: string, shortcut: string) => Promise<void>;
  onRemoveShortcut: (id: string) => Promise<void>;
  onConvertToNote?: (content: string) => void;
  searchQuery: string;
}

interface Group {
  label: string;
  items: ClipEntry[];
}

function groupEntries(entries: ClipEntry[]): Group[] {
  const now = Date.now();
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  const WEEK = 7 * DAY;

  const pinned: ClipEntry[] = [];
  const map: Record<string, ClipEntry[]> = {};
  const order: string[] = [];

  for (const e of entries) {
    if (e.pinned) {
      pinned.push(e);
      continue;
    }
    const age = now - e.timestamp;
    let label: string;
    if (age < HOUR) label = 'Dernière heure';
    else if (age < DAY) label = "Aujourd'hui";
    else if (age < WEEK) label = 'Cette semaine';
    else label = 'Plus ancien';

    if (!map[label]) {
      map[label] = [];
      order.push(label);
    }
    map[label].push(e);
  }

  const groups: Group[] = [];
  if (pinned.length > 0) groups.push({ label: '📌 Épinglés', items: pinned });
  for (const label of order) groups.push({ label, items: map[label] });
  return groups;
}

/** Format a shortcut string for display (e.g. "ctrl+shift+1" → ["Ctrl", "Shift", "1"]) */
function formatShortcutParts(shortcut: string): string[] {
  return shortcut.split('+').map(k => k.charAt(0).toUpperCase() + k.slice(1));
}

export function SuperClipboard({
  entries,
  entry,
  onSelectEntry,
  onPasteEntry,
  onDeleteEntry,
  onTogglePin,
  onClearAll,
  onSetShortcut,
  onRemoveShortcut,
  onConvertToNote,
  searchQuery,
}: SuperClipboardProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const [capturing, setCapturing] = useState(false);
  const [capturedParts, setCapturedParts] = useState<string[]>([]);
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; entry: ClipEntry } | null>(null);

  // Close context menu on outside click
  useEffect(() => {
    if (!ctxMenu) return;
    const close = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [ctxMenu]);

  const sq = searchQuery.toLowerCase();
  const filtered = useMemo(
    () => entries.filter(e => !sq || e.content.toLowerCase().includes(sq)),
    [entries, sq]
  );

  const groups = useMemo(() => groupEntries(filtered), [filtered]);

  // Reset capture state when selected entry changes
  useEffect(() => {
    setCapturing(false);
    setCapturedParts([]);
    setShortcutError(null);
  }, [entry?.id]);

  // Key capture handler (global, during capture mode)
  useEffect(() => {
    if (!capturing || !entry) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Escape cancels
      if (e.key === 'Escape') {
        setCapturing(false);
        setCapturedParts([]);
        return;
      }

      const parts: string[] = [];
      if (e.ctrlKey) parts.push('ctrl');
      if (e.shiftKey) parts.push('shift');
      if (e.altKey) parts.push('alt');

      // Skip if user only pressed a modifier
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
        setCapturedParts(parts.map(k => k.charAt(0).toUpperCase() + k.slice(1)));
        return;
      }

      // Must have at least one modifier
      if (parts.length === 0) return;

      // Normalize the key
      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      parts.push(key.toLowerCase());

      const shortcutStr = parts.join('+');
      setCapturing(false);
      setCapturedParts([]);
      setShortcutError(null);

      onSetShortcut(entry.id, shortcutStr).catch((err: unknown) => {
        setShortcutError(typeof err === 'string' ? err : (err as Error).message || 'Erreur');
      });
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [capturing, entry, onSetShortcut]);

  const handleKeydown = useCallback(
    (e: React.KeyboardEvent) => {
      // Don't handle navigation during shortcut capture
      if (capturing) return;

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const idx = filtered.findIndex(c => c.id === entry?.id);
        let next: number;
        if (e.key === 'ArrowDown') next = idx < filtered.length - 1 ? idx + 1 : 0;
        else next = idx > 0 ? idx - 1 : filtered.length - 1;
        const target = filtered[next];
        if (target) {
          onSelectEntry(target.id);
          listRef.current
            ?.querySelector(`[data-clip-id="${target.id}"]`)
            ?.scrollIntoView({ block: 'nearest' });
        }
      }
      if (e.key === 'Enter' && entry) {
        e.preventDefault();
        onPasteEntry(entry.id);
      }
      if (e.key === 'Delete' && e.shiftKey && entry) {
        e.preventDefault();
        onDeleteEntry(entry.id);
      }
      if (e.key === 'p' && e.ctrlKey && entry) {
        e.preventDefault();
        onTogglePin(entry.id);
      }
    },
    [filtered, entry, onSelectEntry, onPasteEntry, onDeleteEntry, onTogglePin, capturing]
  );

  if (filtered.length === 0) {
    return (
      <div className="sc-empty-state">
        <span className="sc-empty-icon">📋</span>
        <p>{searchQuery ? 'Aucun clip trouvé' : 'Historique du presse-papier vide'}</p>
        <p className="sc-empty-hint">Copiez du texte dans n'importe quelle application pour le voir apparaitre ici.</p>
      </div>
    );
  }

  return (
    <div className="sc-view" onKeyDown={handleKeydown} tabIndex={0}>
      <div className="sc-body">
        {/* Left: clip list */}
        <div className="sc-list-panel" ref={listRef}>
          {groups.map(group => (
            <div key={group.label}>
              <div className="se-group-label">{group.label}</div>
              {group.items.map(c => (
                <button
                  key={c.id}
                  className={`se-snippet-item ${c.id === entry?.id ? 'se-snippet-item--selected' : ''}`}
                  data-clip-id={c.id}
                  onClick={() => {
                    onSelectEntry(c.id);
                    onPasteEntry(c.id);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onSelectEntry(c.id);
                    setCtxMenu({ x: e.clientX, y: e.clientY, entry: c });
                  }}
                >
                  <span className="se-snippet-icon">{c.pinned ? '📌' : c.shortcut ? '⌨' : '📋'}</span>
                  <span className="se-snippet-name sc-clip-text">
                    {c.content.length > 80 ? c.content.slice(0, 80) + '...' : c.content}
                  </span>
                  {c.shortcut && (
                    <span className="sc-shortcut-badge">
                      {formatShortcutParts(c.shortcut).map((k, i) => (
                        <kbd key={i} className="se-kbd sc-kbd-mini">{k}</kbd>
                      ))}
                    </span>
                  )}
                  <span className="sc-clip-time">
                    {new Date(c.timestamp).toLocaleTimeString('fr-FR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Right: preview */}
        {entry && (
          <div className="sc-preview-panel">
            <div className="sc-preview-content">
              <pre className="se-preview-text">{entry.content}</pre>
            </div>

            {/* Shortcut section */}
            <div className="sc-shortcut-section">
              <div className="se-info-header">Raccourci global</div>
              {entry.shortcut ? (
                <div className="sc-shortcut-display">
                  <div className="sc-shortcut-keys">
                    {formatShortcutParts(entry.shortcut).map((k, i) => (
                      <kbd key={i} className="se-kbd">{k}</kbd>
                    ))}
                  </div>
                  <button
                    className="sc-action-btn sc-action-btn--danger sc-shortcut-remove"
                    onClick={() => onRemoveShortcut(entry.id)}
                  >
                    Supprimer
                  </button>
                </div>
              ) : capturing ? (
                <div className="sc-shortcut-capture">
                  <div className="sc-shortcut-capture-box">
                    {capturedParts.length > 0 ? (
                      capturedParts.map((k, i) => <kbd key={i} className="se-kbd">{k}</kbd>)
                    ) : (
                      <span className="sc-shortcut-hint">Appuyez sur une combinaison de touches...</span>
                    )}
                  </div>
                  <button className="sc-action-btn" onClick={() => { setCapturing(false); setCapturedParts([]); }}>
                    Annuler
                  </button>
                </div>
              ) : (
                <button className="sc-action-btn sc-shortcut-assign" onClick={() => { setCapturing(true); setShortcutError(null); }}>
                  ⌨ Assigner un raccourci
                </button>
              )}
              {shortcutError && <p className="sc-shortcut-error">{shortcutError}</p>}
            </div>

            <div className="sc-info-section">
              <div className="se-info-header">Information</div>
              <div className="se-info-rows">
                <div className="se-info-row">
                  <span className="se-info-label">Taille</span>
                  <span className="se-info-value">{entry.content.length} caractères</span>
                </div>
                <div className="se-info-row">
                  <span className="se-info-label">Lignes</span>
                  <span className="se-info-value">{entry.content.split('\n').length}</span>
                </div>
                <div className="se-info-row">
                  <span className="se-info-label">Copié le</span>
                  <span className="se-info-value">
                    {new Date(entry.timestamp).toLocaleString('fr-FR')}
                  </span>
                </div>
                <div className="se-info-row">
                  <span className="se-info-label">Épinglé</span>
                  <span className="se-info-value">{entry.pinned ? 'Oui' : 'Non'}</span>
                </div>
              </div>
            </div>
            <div className="sc-actions">
              <button className="sc-action-btn" onClick={() => onPasteEntry(entry.id)} title="Re-copier dans le presse-papier">
                📋 Copier
              </button>
              <button className="sc-action-btn" onClick={() => onTogglePin(entry.id)} title={entry.pinned ? 'Désépingler' : 'Épingler'}>
                📌 {entry.pinned ? 'Désépingler' : 'Épingler'}
              </button>
              {onConvertToNote && (
                <button className="sc-action-btn" onClick={() => onConvertToNote(entry.content)} title="Convertir en note">
                  📝 Note
                </button>
              )}
              <button className="sc-action-btn sc-action-btn--danger" onClick={() => onDeleteEntry(entry.id)} title="Supprimer">
                🗑 Supprimer
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="se-footer">
        <div className="se-footer-left">
          <span>📋</span>
          <span>Clipboard</span>
          <span className="sc-count">{entries.length} clips</span>
        </div>
        <div className="se-footer-right">
          <div className="se-footer-action">
            <span>Copier</span>
            <kbd className="se-kbd">&#9166;</kbd>
          </div>
          <div className="se-footer-sep" />
          <div className="se-footer-action">
            <span>Épingler</span>
            <kbd className="se-kbd">Ctrl</kbd>
            <kbd className="se-kbd">P</kbd>
          </div>
          <div className="se-footer-sep" />
          <div className="se-footer-action">
            <span>Supprimer</span>
            <kbd className="se-kbd">Shift</kbd>
            <kbd className="se-kbd">Del</kbd>
          </div>
          <div className="se-footer-sep" />
          <button className="sc-clear-btn" onClick={onClearAll} title="Tout effacer (sauf épinglés)">
            Tout effacer
          </button>
        </div>
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="feed-context-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <button className="feed-context-menu-item" onClick={() => { onPasteEntry(ctxMenu.entry.id); setCtxMenu(null); }}>
            <span>📋</span> Re-copier
          </button>
          <button className="feed-context-menu-item" onClick={() => { onTogglePin(ctxMenu.entry.id); setCtxMenu(null); }}>
            <span>📌</span> {ctxMenu.entry.pinned ? 'Désépingler' : 'Épingler'}
          </button>
          {onConvertToNote && (
            <button className="feed-context-menu-item" onClick={() => { onConvertToNote(ctxMenu.entry.content); setCtxMenu(null); }}>
              <span>📝</span> Convertir en note
            </button>
          )}
          <button className="feed-context-menu-item feed-context-menu-item--danger" onClick={() => { onDeleteEntry(ctxMenu.entry.id); setCtxMenu(null); }}>
            <span>🗑</span> Supprimer
          </button>
        </div>
      )}
    </div>
  );
}
