import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import type { Snippet } from './ExpanderFileList';

const PLACEHOLDERS = ['{uuid}', '{clipboard}', '{date}', '{time}', '{datetime}', '{day}'];

function generateUUID(): string {
  return crypto.randomUUID?.() ??
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

export async function resolveSnippet(content: string): Promise<string> {
  const now = new Date();
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US';
  let result = content;

  result = result.replace(/\{date\}/g, now.toLocaleDateString(locale));
  result = result.replace(/\{time\}/g, now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }));
  result = result.replace(/\{datetime\}/g, `${now.toLocaleDateString(locale)} ${now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`);
  result = result.replace(/\{day\}/g, now.toLocaleDateString(locale, { weekday: 'long' }));

  while (result.includes('{uuid}')) {
    result = result.replace('{uuid}', generateUUID());
  }

  if (result.includes('{clipboard}')) {
    try {
      const clip = await navigator.clipboard.readText();
      result = result.replace(/\{clipboard\}/g, clip);
    } catch {
      result = result.replace(/\{clipboard\}/g, i18n.t('expander.clipboardUnavailable'));
    }
  }

  return result;
}

// ── Time grouping helpers ──
interface Group { label: string; items: Snippet[] }

function groupSnippets(snippets: Snippet[], t: (key: string) => string): Group[] {
  const now = Date.now();
  const DAY = 86_400_000;
  const WEEK = 7 * DAY;
  const MONTH = 30 * DAY;
  const YEAR = 365 * DAY;

  const map: Record<string, Snippet[]> = {};
  const order: string[] = [];

  for (const s of snippets) {
    const age = now - new Date(s.updatedAt).getTime();
    let label: string;
    if (age < DAY) label = t('common.today');
    else if (age < WEEK) label = t('expander.thisWeek');
    else if (age < MONTH) label = t('expander.thisMonth');
    else if (age < YEAR) label = t('expander.thisYear');
    else label = t('common.older');

    if (!map[label]) { map[label] = []; order.push(label); }
    map[label].push(s);
  }
  return order.map(label => ({ label, items: map[label] }));
}

// ── Props ──
interface SuperExpanderProps {
  snippets: Snippet[];
  snippet: Snippet | null;
  onUpdateSnippet: (id: string, updates: Partial<Pick<Snippet, 'name' | 'keyword' | 'content'>>) => void;
  onCopySnippet: (id: string) => void;
  onAddSnippet: (data?: { name: string; keyword: string; content: string }) => void;
  onDeleteSnippet: (id: string) => void;
  onSelectSnippet: (id: string) => void;
  onSetShortcut: (id: string, shortcut: string) => Promise<void>;
  onRemoveShortcut: (id: string) => Promise<void>;
  searchQuery: string;
}

function formatShortcutParts(shortcut: string): string[] {
  return shortcut.split('+').map(k => k.charAt(0).toUpperCase() + k.slice(1));
}

type SubMode = 'list' | 'create';

export function SuperExpander({
  snippets, snippet, onUpdateSnippet, onCopySnippet, onAddSnippet,
  onDeleteSnippet, onSelectSnippet, onSetShortcut, onRemoveShortcut, searchQuery,
}: SuperExpanderProps) {
  const { t } = useTranslation();
  const [subMode, setSubMode] = useState<SubMode>('list');

  return (
    <div className="super-expander">
      {/* Mode tabs */}
      <div className="se-mode-bar">
        <button
          className={`se-mode-tab ${subMode === 'list' ? 'se-mode-tab--active' : ''}`}
          onClick={() => setSubMode('list')}
        >
          {t('expander.snippets')}
        </button>
        <button
          className={`se-mode-tab ${subMode === 'create' ? 'se-mode-tab--active' : ''}`}
          onClick={() => setSubMode('create')}
        >
          + {t('expander.create')}
        </button>
      </div>

      {subMode === 'create' ? (
        <CreateView
          onAddSnippet={onAddSnippet}
          switchToList={() => setSubMode('list')}
        />
      ) : (
        <ListView
          snippets={snippets}
          selectedSnippet={snippet}
          searchQuery={searchQuery}
          onSelectSnippet={onSelectSnippet}
          onDeleteSnippet={onDeleteSnippet}
          onCopySnippet={onCopySnippet}
          onUpdateSnippet={onUpdateSnippet}
          onCreateSnippet={() => setSubMode('create')}
          onSetShortcut={onSetShortcut}
          onRemoveShortcut={onRemoveShortcut}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
// CREATE VIEW — like ComboBar's CreateSnippet
// ═══════════════════════════════════════════════

interface CreateViewProps {
  onAddSnippet: (data?: { name: string; keyword: string; content: string }) => void;
  switchToList: () => void;
}

function CreateView({ onAddSnippet, switchToList }: CreateViewProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [keyword, setKeyword] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  const insertPlaceholder = useCallback((p: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const newContent = content.slice(0, start) + p + content.slice(end);
    setContent(newContent);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + p.length;
      ta.setSelectionRange(pos, pos);
    });
  }, [content]);

  const handleSave = useCallback(() => {
    if (!content.trim() || !name.trim()) return;
    let kw = keyword.trim();
    if (kw.length > 0 && !kw.startsWith('/')) kw = '/' + kw;
    onAddSnippet({ name: name.trim(), keyword: kw, content });
    switchToList();
  }, [content, name, keyword, onAddSnippet, switchToList]);

  const handleKeydown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSave();
    }
  }, [handleSave]);

  return (
    <div className="se-create" onKeyDown={handleKeydown}>
      <div className="se-create-body">
        {/* Left: Content */}
        <div className="se-create-left">
          <label className="se-label">{t('expander.snippet')}</label>
          <textarea
            ref={textareaRef}
            className="se-content-textarea"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t('expander.snippetContent')}
            spellCheck={false}
          />
          <div className="se-placeholder-row">
            <span className="se-placeholder-label">{t('expander.placeholders')} :</span>
            {PLACEHOLDERS.map(p => (
              <button key={p} className="se-placeholder-btn" onClick={() => insertPlaceholder(p)}>{p}</button>
            ))}
          </div>
        </div>

        {/* Right: Metadata */}
        <div className="se-create-right">
          <div className="se-field">
            <label className="se-label">{t('expander.name')}</label>
            <input
              type="text"
              className="se-text-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('expander.snippetName')}
            />
          </div>
          <div className="se-field">
            <label className="se-label">Keyword</label>
            <input
              type="text"
              className="se-text-input"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="/keyword"
            />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="se-footer">
        <div className="se-footer-left">
          <span>⚡</span>
          <span>{t('expander.createSnippet')}</span>
        </div>
        <button
          className="se-save-btn"
          onClick={handleSave}
          disabled={!content.trim() || !name.trim()}
        >
          <span>{t('common.save')}</span>
          <kbd className="se-kbd">Ctrl</kbd>
          <kbd className="se-kbd">↵</kbd>
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// LIST VIEW — like ComboBar's SearchSnippets
// ═══════════════════════════════════════════════

interface ListViewProps {
  snippets: Snippet[];
  selectedSnippet: Snippet | null;
  searchQuery: string;
  onSelectSnippet: (id: string) => void;
  onDeleteSnippet: (id: string) => void;
  onCopySnippet: (id: string) => void;
  onUpdateSnippet: (id: string, updates: Partial<Pick<Snippet, 'name' | 'keyword' | 'content'>>) => void;
  onCreateSnippet: () => void;
  onSetShortcut: (id: string, shortcut: string) => Promise<void>;
  onRemoveShortcut: (id: string) => Promise<void>;
}

function ListView({
  snippets, selectedSnippet, searchQuery,
  onSelectSnippet, onDeleteSnippet, onCopySnippet, onUpdateSnippet, onCreateSnippet,
  onSetShortcut, onRemoveShortcut,
}: ListViewProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);
  const [editingField, setEditingField] = useState<'name' | 'keyword' | null>(null);
  const [editValue, setEditValue] = useState('');
  const [capturing, setCapturing] = useState(false);
  const [capturedParts, setCapturedParts] = useState<string[]>([]);
  const [shortcutError, setShortcutError] = useState<string | null>(null);

  // Filter
  const sq = searchQuery.toLowerCase();
  const filtered = useMemo(() =>
    snippets
      .filter(s => !sq || s.name.toLowerCase().includes(sq) || s.keyword.toLowerCase().includes(sq) || s.content.toLowerCase().includes(sq))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
  [snippets, sq]);

  const groups = useMemo(() => groupSnippets(filtered, t), [filtered, t]);

  // Reset capture state when selection changes
  useEffect(() => {
    setCapturing(false);
    setCapturedParts([]);
    setShortcutError(null);
  }, [selectedSnippet?.id]);

  // Key capture handler (global, during capture mode)
  useEffect(() => {
    if (!capturing || !selectedSnippet) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setCapturing(false); setCapturedParts([]); return; }
      const parts: string[] = [];
      if (e.ctrlKey) parts.push('ctrl');
      if (e.shiftKey) parts.push('shift');
      if (e.altKey) parts.push('alt');
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
        setCapturedParts(parts.map(k => k.charAt(0).toUpperCase() + k.slice(1)));
        return;
      }
      if (parts.length === 0) return;
      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      parts.push(key.toLowerCase());
      const shortcutStr = parts.join('+');
      setCapturing(false);
      setCapturedParts([]);
      setShortcutError(null);
      onSetShortcut(selectedSnippet.id, shortcutStr).catch((err: unknown) => {
        setShortcutError(typeof err === 'string' ? err : (err as Error).message || t('common.error'));
      });
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [capturing, selectedSnippet, onSetShortcut]);

  // Keyboard navigation
  const handleKeydown = useCallback((e: React.KeyboardEvent) => {
    if (capturing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const idx = filtered.findIndex(s => s.id === selectedSnippet?.id);
      let next: number;
      if (e.key === 'ArrowDown') next = idx < filtered.length - 1 ? idx + 1 : 0;
      else next = idx > 0 ? idx - 1 : filtered.length - 1;
      const target = filtered[next];
      if (target) {
        onSelectSnippet(target.id);
        listRef.current?.querySelector(`[data-snippet-id="${target.id}"]`)?.scrollIntoView({ block: 'nearest' });
      }
    }
    if (e.key === 'Enter' && selectedSnippet) {
      e.preventDefault();
      onCopySnippet(selectedSnippet.id);
    }
    if (e.key === 'Delete' && e.shiftKey && selectedSnippet) {
      e.preventDefault();
      onDeleteSnippet(selectedSnippet.id);
    }
  }, [filtered, selectedSnippet, onSelectSnippet, onCopySnippet, onDeleteSnippet]);

  const startEdit = useCallback((field: 'name' | 'keyword', value: string) => {
    setEditingField(field);
    setEditValue(value);
  }, []);

  const commitEdit = useCallback(() => {
    if (!selectedSnippet || !editingField) return;
    let val = editValue.trim();
    if (editingField === 'keyword' && val.length > 0 && !val.startsWith('/')) val = '/' + val;
    onUpdateSnippet(selectedSnippet.id, { [editingField]: val });
    setEditingField(null);
    setEditValue('');
  }, [selectedSnippet, editingField, editValue, onUpdateSnippet]);

  if (filtered.length === 0) {
    return (
      <div className="se-empty-state">
        <span className="se-empty-icon">⚡</span>
        <p>{searchQuery ? t('expander.noSnippetFound') : t('expander.noSnippetsCreated')}</p>
        <button className="se-empty-btn" onClick={onCreateSnippet}>+ {t('expander.createSnippet')}</button>
      </div>
    );
  }

  return (
    <div className="se-list-view" onKeyDown={handleKeydown} tabIndex={0}>
      <div className="se-list-body">
        {/* Left: snippet list */}
        <div className="se-list-panel" ref={listRef}>
          {groups.map(group => (
            <div key={group.label}>
              <div className="se-group-label">{group.label}</div>
              {group.items.map(s => (
                <button
                  key={s.id}
                  className={`se-snippet-item ${s.id === selectedSnippet?.id ? 'se-snippet-item--selected' : ''}`}
                  data-snippet-id={s.id}
                  onClick={() => onSelectSnippet(s.id)}
                  onDoubleClick={() => onCopySnippet(s.id)}
                >
                  <span className="se-snippet-icon">{s.shortcut ? '⌨' : '⚡'}</span>
                  <span className="se-snippet-name">{s.name || t('common.untitled')}</span>
                  {s.shortcut && (
                    <span className="sc-shortcut-badge">
                      {formatShortcutParts(s.shortcut).map((k, i) => (
                        <kbd key={i} className="se-kbd sc-kbd-mini">{k}</kbd>
                      ))}
                    </span>
                  )}
                  {s.keyword && <span className="se-snippet-keyword">{s.keyword}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Right: preview / edit */}
        {selectedSnippet && (
          <div className="se-preview-panel">
            <div className="se-preview-content">
              <pre className="se-preview-text">{selectedSnippet.content || `(${t('expander.empty')})`}</pre>
            </div>
            <div className="se-info-section">
              <div className="se-info-header">{t('expander.information')}</div>
              <div className="se-info-rows">
                <div className="se-info-row">
                  <span className="se-info-label">Label</span>
                  {editingField === 'name' ? (
                    <input
                      className="se-info-edit"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingField(null); }}
                      autoFocus
                    />
                  ) : (
                    <span className="se-info-value se-info-value--editable" onClick={() => startEdit('name', selectedSnippet.name)}>
                      {selectedSnippet.name || '—'}
                    </span>
                  )}
                </div>
                <div className="se-info-row">
                  <span className="se-info-label">Keyword</span>
                  {editingField === 'keyword' ? (
                    <input
                      className="se-info-edit"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingField(null); }}
                      autoFocus
                    />
                  ) : (
                    <span className="se-info-value se-info-value--editable" onClick={() => startEdit('keyword', selectedSnippet.keyword)}>
                      {selectedSnippet.keyword || '—'}
                    </span>
                  )}
                </div>
                <div className="se-info-row">
                  <span className="se-info-label">Type</span>
                  <span className="se-info-value">Text</span>
                </div>
              </div>
            </div>

            {/* Shortcut section */}
            <div className="sc-shortcut-section">
              <div className="se-info-header">{t('expander.globalShortcut')}</div>
              {selectedSnippet.shortcut ? (
                <div className="sc-shortcut-display">
                  <div className="sc-shortcut-keys">
                    {formatShortcutParts(selectedSnippet.shortcut).map((k, i) => (
                      <kbd key={i} className="se-kbd">{k}</kbd>
                    ))}
                  </div>
                  <button
                    className="sc-action-btn sc-action-btn--danger sc-shortcut-remove"
                    onClick={() => onRemoveShortcut(selectedSnippet.id)}
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
                      <span className="sc-shortcut-hint">{t('expander.pressKeyCombination')}</span>
                    )}
                  </div>
                  <button className="sc-action-btn" onClick={() => { setCapturing(false); setCapturedParts([]); }}>
                    {t('common.cancel')}
                  </button>
                </div>
              ) : (
                <button className="sc-action-btn sc-shortcut-assign" onClick={() => { setCapturing(true); setShortcutError(null); }}>
                  ⌨ {t('expander.assignShortcut')}
                </button>
              )}
              {shortcutError && <p className="sc-shortcut-error">{shortcutError}</p>}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="se-footer">
        <div className="se-footer-left">
          <span>⚡</span>
          <span>Snippets</span>
        </div>
        <div className="se-footer-right">
          <div className="se-footer-action">
            <span>{t('expander.copy')}</span>
            <kbd className="se-kbd">↵</kbd>
          </div>
          <div className="se-footer-sep" />
          <div className="se-footer-action">
            <span>{t('common.delete')}</span>
            <kbd className="se-kbd">Shift</kbd>
            <kbd className="se-kbd">Del</kbd>
          </div>
        </div>
      </div>
    </div>
  );
}
