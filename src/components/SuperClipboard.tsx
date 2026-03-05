import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
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

function groupEntries(entries: ClipEntry[], t: (key: string) => string): Group[] {
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
    if (age < HOUR) label = t('clipboard.lastHour');
    else if (age < DAY) label = t('common.today');
    else if (age < WEEK) label = t('clipboard.thisWeek');
    else label = t('common.older');

    if (!map[label]) {
      map[label] = [];
      order.push(label);
    }
    map[label].push(e);
  }

  const groups: Group[] = [];
  if (pinned.length > 0) groups.push({ label: `📌 ${t('clipboard.pinned')}`, items: pinned });
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
  const { t } = useTranslation();
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

  const groups = useMemo(() => groupEntries(filtered, t), [filtered, t]);

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
        setShortcutError(typeof err === 'string' ? err : (err as Error).message || t('common.error'));
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
        <p>{searchQuery ? t('clipboard.noClipFound') : t('clipboard.emptyHistory')}</p>
        <p className="sc-empty-hint">{t('clipboard.copyHint')}</p>
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
                    {new Date(c.timestamp).toLocaleTimeString(i18n.language === 'fr' ? 'fr-FR' : 'en-US', {
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
              <div className="se-info-header">{t('clipboard.globalShortcut')}</div>
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
                    {t('common.delete')}
                  </button>
                </div>
              ) : capturing ? (
                <div className="sc-shortcut-capture">
                  <div className="sc-shortcut-capture-box">
                    {capturedParts.length > 0 ? (
                      capturedParts.map((k, i) => <kbd key={i} className="se-kbd">{k}</kbd>)
                    ) : (
                      <span className="sc-shortcut-hint">{t('clipboard.pressKeyCombination')}</span>
                    )}
                  </div>
                  <button className="sc-action-btn" onClick={() => { setCapturing(false); setCapturedParts([]); }}>
                    {t('common.cancel')}
                  </button>
                </div>
              ) : (
                <button className="sc-action-btn sc-shortcut-assign" onClick={() => { setCapturing(true); setShortcutError(null); }}>
                  ⌨ {t('clipboard.assignShortcut')}
                </button>
              )}
              {shortcutError && <p className="sc-shortcut-error">{shortcutError}</p>}
            </div>

            <div className="sc-info-section">
              <div className="se-info-header">{t('clipboard.information')}</div>
              <div className="se-info-rows">
                <div className="se-info-row">
                  <span className="se-info-label">{t('clipboard.size')}</span>
                  <span className="se-info-value">{entry.content.length} {t('clipboard.characters')}</span>
                </div>
                <div className="se-info-row">
                  <span className="se-info-label">{t('clipboard.lines')}</span>
                  <span className="se-info-value">{entry.content.split('\n').length}</span>
                </div>
                <div className="se-info-row">
                  <span className="se-info-label">{t('clipboard.copiedOn')}</span>
                  <span className="se-info-value">
                    {new Date(entry.timestamp).toLocaleString(i18n.language === 'fr' ? 'fr-FR' : 'en-US')}
                  </span>
                </div>
                <div className="se-info-row">
                  <span className="se-info-label">{t('clipboard.pinned')}</span>
                  <span className="se-info-value">{entry.pinned ? t('clipboard.yes') : t('clipboard.no')}</span>
                </div>
              </div>
            </div>
            <div className="sc-actions">
              <button className="sc-action-btn" onClick={() => onPasteEntry(entry.id)} title={t('clipboard.recopyToClipboard')}>
                📋 {t('clipboard.copy')}
              </button>
              <button className="sc-action-btn" onClick={() => onTogglePin(entry.id)} title={entry.pinned ? t('clipboard.unpin') : t('clipboard.pin')}>
                📌 {entry.pinned ? t('clipboard.unpin') : t('clipboard.pin')}
              </button>
              {onConvertToNote && (
                <button className="sc-action-btn" onClick={() => onConvertToNote(entry.content)} title={t('clipboard.convertToNote')}>
                  📝 {t('clipboard.note')}
                </button>
              )}
              <button className="sc-action-btn sc-action-btn--danger" onClick={() => onDeleteEntry(entry.id)} title={t('common.delete')}>
                🗑 {t('common.delete')}
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
          <span className="sc-count">{entries.length} {t('clipboard.clips')}</span>
        </div>
        <div className="se-footer-right">
          <div className="se-footer-action">
            <span>{t('clipboard.copy')}</span>
            <kbd className="se-kbd">&#9166;</kbd>
          </div>
          <div className="se-footer-sep" />
          <div className="se-footer-action">
            <span>{t('clipboard.pin')}</span>
            <kbd className="se-kbd">Ctrl</kbd>
            <kbd className="se-kbd">P</kbd>
          </div>
          <div className="se-footer-sep" />
          <div className="se-footer-action">
            <span>{t('common.delete')}</span>
            <kbd className="se-kbd">Shift</kbd>
            <kbd className="se-kbd">Del</kbd>
          </div>
          <div className="se-footer-sep" />
          <button className="sc-clear-btn" onClick={onClearAll} title={t('clipboard.clearAllExceptPinned')}>
            {t('clipboard.clearAll')}
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
            <span>📋</span> {t('clipboard.recopy')}
          </button>
          <button className="feed-context-menu-item" onClick={() => { onTogglePin(ctxMenu.entry.id); setCtxMenu(null); }}>
            <span>📌</span> {ctxMenu.entry.pinned ? t('clipboard.unpin') : t('clipboard.pin')}
          </button>
          {onConvertToNote && (
            <button className="feed-context-menu-item" onClick={() => { onConvertToNote(ctxMenu.entry.content); setCtxMenu(null); }}>
              <span>📝</span> {t('clipboard.convertToNote')}
            </button>
          )}
          <button className="feed-context-menu-item feed-context-menu-item--danger" onClick={() => { onDeleteEntry(ctxMenu.entry.id); setCtxMenu(null); }}>
            <span>🗑</span> {t('common.delete')}
          </button>
        </div>
      )}
    </div>
  );
}
