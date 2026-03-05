import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import type { WebBookmark } from '../services/bookmarkService';
import i18n from '../i18n';
import { extractArticle, type ExtractedArticle } from '../services/articleExtractor';
import { translateText, getTranslationConfig } from '../services/translationService';
import { applyHighlights } from '../lib/highlightHtml';
import { usePro } from '../contexts/ProContext';
import { openExternal } from '../lib/tauriFetch';
import type { HighlightColor, TextHighlight } from '../types';

type LoadStatus = 'idle' | 'loading' | 'done' | 'error';

const HIGHLIGHT_COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'pink', 'orange'];

interface BookmarkReaderProps {
  bookmark: WebBookmark | null;
  onMarkRead?: (id: string) => void;
  translateActive?: boolean;
  highlights?: TextHighlight[];
  onHighlightAdd?: (bookmarkId: string, text: string, color: HighlightColor, prefix: string, suffix: string) => void;
  onHighlightRemove?: (bookmarkId: string, highlightId: string) => void;
  onHighlightNoteUpdate?: (bookmarkId: string, highlightId: string, note: string) => void;
  onCreateNoteFromSelection?: (text: string, articleTitle: string) => void;
}

export function BookmarkReader({ bookmark, onMarkRead, translateActive: translateActiveProp, highlights, onHighlightAdd, onHighlightRemove, onHighlightNoteUpdate, onCreateNoteFromSelection }: BookmarkReaderProps) {
  const { t } = useTranslation();
  const { isPro, showUpgradeModal } = usePro();
  const [article, setArticle] = useState<ExtractedArticle | null>(null);
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [viewMode, setViewMode] = useState<'reader' | 'web'>('reader');
  const [fontSize, setFontSize] = useState(16);
  const [translateState, setTranslateState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [translatedHtml, setTranslatedHtml] = useState('');
  const [translatedTitle, setTranslatedTitle] = useState('');
  const showTranslation = translateActiveProp ?? false;

  // Highlight state
  const [colorPickerPos, setColorPickerPos] = useState<{ x: number; y: number } | null>(null);
  const [selectedText, setSelectedText] = useState('');
  const [selectedPrefix, setSelectedPrefix] = useState('');
  const [selectedSuffix, setSelectedSuffix] = useState('');
  const [highlightsMenuOpen, setHighlightsMenuOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');

  const contentRef = useRef<HTMLDivElement>(null);
  const readerBodyRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const prevUrlRef = useRef<string | null>(null);

  // Extract article content when bookmark changes
  useEffect(() => {
    if (!bookmark) {
      setArticle(null);
      setStatus('idle');
      setTranslateState('idle');
      setTranslatedHtml('');
      setTranslatedTitle('');
      prevUrlRef.current = null;
      return;
    }

    // Don't refetch if same URL
    if (bookmark.url === prevUrlRef.current) return;
    prevUrlRef.current = bookmark.url;
    setTranslateState('idle');
    setTranslatedHtml('');
    setTranslatedTitle('');

    let cancelled = false;
    setStatus('loading');
    setArticle(null);

    extractArticle(bookmark.url)
      .then((result) => {
        if (cancelled) return;
        setArticle(result);
        setStatus('done');
        // Mark as read when content loads
        if (!bookmark.is_read && onMarkRead) {
          onMarkRead(bookmark.id);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('error');
      });

    return () => { cancelled = true; };
  }, [bookmark, onMarkRead]);

  // Scroll to top when article changes
  useEffect(() => {
    contentRef.current?.scrollTo(0, 0);
  }, [article]);

  const handleOpenExternal = useCallback(() => {
    if (!bookmark) return;
    openExternal(bookmark.url);
  }, [bookmark]);

  // Auto-translate when translateActive prop is enabled
  useEffect(() => {
    if (!article || !showTranslation || translateState !== 'idle') return;
    const config = getTranslationConfig();
    setTranslateState('loading');
    Promise.all([
      translateText(article.content, config.targetLanguage),
      translateText(article.title || bookmark?.title || '', config.targetLanguage),
    ]).then(([result, titleResult]) => {
      setTranslatedHtml(result);
      setTranslatedTitle(titleResult);
      setTranslateState('done');
    }).catch(() => {
      setTranslateState('error');
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article, showTranslation, translateState]);

  const handleRetry = useCallback(() => {
    if (!bookmark) return;
    prevUrlRef.current = null; // force refetch
    setStatus('loading');
    setArticle(null);
    extractArticle(bookmark.url)
      .then((result) => {
        setArticle(result);
        setStatus('done');
      })
      .catch(() => setStatus('error'));
  }, [bookmark]);

  // ── Highlight handlers ──
  const processedHtml = useMemo(() => {
    if (!article) return '';
    const raw = showTranslation && translateState === 'done' && translatedHtml
      ? translatedHtml
      : article.content;
    return applyHighlights(raw, highlights ?? []);
  }, [article, showTranslation, translateState, translatedHtml, highlights]);

  const handleTextSelection = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;

    const range = sel.getRangeAt(0);
    const container = readerBodyRef.current;
    if (!container || !container.contains(range.commonAncestorContainer)) return;

    const text = sel.toString().trim();
    if (!text) return;

    // Extract prefix/suffix for disambiguation
    const fullText = container.textContent || '';
    const preRange = document.createRange();
    preRange.setStart(container, 0);
    preRange.setEnd(range.startContainer, range.startOffset);
    const offsetStart = preRange.toString().length;
    const prefix = fullText.slice(Math.max(0, offsetStart - 30), offsetStart);
    const suffix = fullText.slice(offsetStart + text.length, offsetStart + text.length + 30);

    setSelectedText(text);
    setSelectedPrefix(prefix);
    setSelectedSuffix(suffix);

    const rect = range.getBoundingClientRect();
    setColorPickerPos({
      x: rect.left + rect.width / 2,
      y: rect.top - 10,
    });
  }, []);

  const handleColorPick = useCallback((color: HighlightColor) => {
    if (!bookmark || !selectedText) return;
    onHighlightAdd?.(bookmark.id, selectedText, color, selectedPrefix, selectedSuffix);
    setColorPickerPos(null);
    setSelectedText('');
    window.getSelection()?.removeAllRanges();
  }, [bookmark, selectedText, selectedPrefix, selectedSuffix, onHighlightAdd]);

  const handleScrollToHighlight = useCallback((highlightId: string) => {
    const mark = readerBodyRef.current?.querySelector(`mark[data-highlight-id="${CSS.escape(highlightId)}"]`);
    if (mark) {
      mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
      mark.classList.add('highlight-pulse');
      setTimeout(() => mark.classList.remove('highlight-pulse'), 1500);
    }
    setHighlightsMenuOpen(false);
  }, []);

  const handleStartEditNote = useCallback((hlId: string, currentNote: string) => {
    setEditingNoteId(hlId);
    setNoteText(currentNote);
  }, []);

  const handleSaveNote = useCallback(() => {
    if (!bookmark || !editingNoteId) return;
    onHighlightNoteUpdate?.(bookmark.id, editingNoteId, noteText);
    setEditingNoteId(null);
    setNoteText('');
  }, [bookmark, editingNoteId, noteText, onHighlightNoteUpdate]);

  // Close color picker on click outside
  useEffect(() => {
    if (!colorPickerPos) return;
    const close = (e: MouseEvent) => {
      const picker = document.querySelector('.highlight-color-picker');
      if (picker && picker.contains(e.target as Node)) return;
      setColorPickerPos(null);
      setSelectedText('');
    };
    const timeout = setTimeout(() => document.addEventListener('click', close), 10);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener('click', close);
    };
  }, [colorPickerPos]);

  if (!bookmark) {
    return (
      <div className="bk-reader-empty">
        <span className="bk-reader-empty-icon">🔖</span>
        <p>{t('bookmarks.selectToRead')}</p>
      </div>
    );
  }

  return (
    <div className="bk-reader">
      {/* Toolbar */}
      <div className="bk-reader-toolbar">
        <div className="bk-reader-toolbar-left">
          {bookmark.favicon && (
            <img
              src={bookmark.favicon}
              alt=""
              className="bk-reader-favicon"
              onError={(e) => (e.currentTarget.style.display = 'none')}
            />
          )}
          <span className="bk-reader-site">{bookmark.site_name || new URL(bookmark.url).hostname}</span>
        </div>
        <div className="bk-reader-toolbar-right">
          {/* View mode toggle */}
          <div className="bk-reader-viewtoggle">
            <button
              className={`bk-reader-viewbtn ${viewMode === 'reader' ? 'active' : ''}`}
              onClick={() => setViewMode('reader')}
              title={t('bookmarks.readerMode')}
            >
              ¶
            </button>
            <button
              className={`bk-reader-viewbtn ${viewMode === 'web' ? 'active' : ''}`}
              onClick={() => setViewMode('web')}
              title={t('bookmarks.webMode')}
            >
              ◉
            </button>
          </div>
          {/* Font size */}
          {viewMode === 'reader' && (
            <div className="bk-reader-fontsize">
              <button
                className="bk-reader-fontbtn"
                onClick={() => setFontSize(s => Math.max(12, s - 1))}
                title={t('bookmarks.shrink')}
              >
                A−
              </button>
              <button
                className="bk-reader-fontbtn"
                onClick={() => setFontSize(s => Math.min(24, s + 1))}
                title={t('bookmarks.enlarge')}
              >
                A+
              </button>
            </div>
          )}
          {/* Highlights menu */}
          {viewMode === 'reader' && (
            <div style={{ position: 'relative' }}>
              <button
                className="bk-reader-viewbtn"
                title={isPro ? t('bookmarks.highlights') : t('bookmarks.highlightsPro')}
                onClick={isPro ? () => setHighlightsMenuOpen(prev => !prev) : showUpgradeModal}
              >
                {isPro ? (
                  <span style={{ fontSize: '13px' }}>🖍</span>
                ) : '🔒'}
                {isPro && (highlights?.length ?? 0) > 0 && (
                  <span className="highlights-badge">{highlights!.length}</span>
                )}
              </button>
              {highlightsMenuOpen && (
                <div className="highlights-menu-dropdown">
                  <div className="highlights-menu-header">
                    <span className="highlights-menu-title">{t('bookmarks.highlights')}</span>
                    {(highlights?.length ?? 0) > 0 && (
                      <span className="highlights-badge">{highlights!.length}</span>
                    )}
                  </div>
                  <div className="highlights-menu-list">
                    {(!highlights || highlights.length === 0) ? (
                      <div className="highlights-menu-empty">
                        {t('bookmarks.selectTextToHighlight')}
                      </div>
                    ) : highlights.map(hl => (
                      <div
                        key={hl.id}
                        className="highlight-menu-item"
                        onClick={() => handleScrollToHighlight(hl.id)}
                      >
                        <span
                          className="highlight-menu-dot"
                          style={{ background: `var(--highlight-${hl.color})` }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="highlight-menu-text">
                            {hl.text.length > 60 ? hl.text.slice(0, 60) + '…' : hl.text}
                          </div>
                          {editingNoteId === hl.id ? (
                            <input
                              className="highlight-menu-note-input"
                              value={noteText}
                              onChange={(e) => setNoteText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveNote();
                                if (e.key === 'Escape') { setEditingNoteId(null); setNoteText(''); }
                              }}
                              onBlur={handleSaveNote}
                              onClick={(e) => e.stopPropagation()}
                              autoFocus
                              placeholder={t('bookmarks.addNote')}
                            />
                          ) : hl.note ? (
                            <div
                              className="highlight-menu-note"
                              onClick={(e) => { e.stopPropagation(); handleStartEditNote(hl.id, hl.note); }}
                            >
                              {hl.note}
                            </div>
                          ) : (
                            <button
                              className="highlight-menu-note-action"
                              onClick={(e) => { e.stopPropagation(); handleStartEditNote(hl.id, ''); }}
                            >
                              + note
                            </button>
                          )}
                        </div>
                        <button
                          className="highlight-menu-note-action"
                          onClick={(e) => {
                            e.stopPropagation();
                            onHighlightRemove?.(bookmark.id, hl.id);
                          }}
                          title={t('common.delete')}
                          style={{ color: 'var(--red)', marginLeft: 4 }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {/* External link */}
          <button className="bk-reader-extbtn" onClick={handleOpenExternal} title={t('bookmarks.openInBrowser')}>
            ↗
          </button>
        </div>
      </div>

      {/* Reader mode */}
      {viewMode === 'reader' && (
        <div className="bk-reader-content" ref={contentRef}>
          <AnimatePresence mode="wait">
            {status === 'loading' && (
              <motion.div
                key="loading"
                className="bk-reader-loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div className="bk-reader-loading-bar" />
                <div className="bk-reader-loading-body">
                  <span className="bk-reader-spinner" />
                  <span>{t('bookmarks.extracting')}</span>
                </div>
              </motion.div>
            )}

            {status === 'error' && (
              <motion.div
                key="error"
                className="bk-reader-error"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
              >
                <span className="bk-reader-error-icon">⊘</span>
                <h3>{t('bookmarks.cannotLoad')}</h3>
                <p>{t('bookmarks.cannotExtract')}</p>
                <div className="bk-reader-error-actions">
                  <button className="bk-reader-error-btn primary" onClick={handleOpenExternal}>
                    {t('bookmarks.openInBrowserArrow')}
                  </button>
                  <button className="bk-reader-error-btn" onClick={handleRetry}>
                    {t('common.retry')}
                  </button>
                </div>
              </motion.div>
            )}

            {status === 'done' && article && (
              <motion.article
                key="article"
                className="bk-reader-article"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                style={{ fontSize: `${fontSize}px` }}
              >
                {bookmark.image && (
                  <div className="bk-reader-hero">
                    <img
                      src={bookmark.image}
                      alt=""
                      onError={(e) => (e.currentTarget.parentElement!.style.display = 'none')}
                    />
                  </div>
                )}
                <h1 className="bk-reader-title">
                  {showTranslation && translateState === 'done' && translatedTitle
                    ? translatedTitle
                    : (article.title || bookmark.title)}
                </h1>
                <div className="bk-reader-meta">
                  {article.byline && <span className="bk-reader-byline">{article.byline}</span>}
                  {article.siteName && <span className="bk-reader-sitename">{article.siteName}</span>}
                  <span className="bk-reader-date">{formatDate(bookmark.created_at)}</span>
                </div>
                {showTranslation && translateState === 'loading' && (
                  <div className="bk-reader-loading-body" style={{ padding: '12px 0' }}>
                    <span className="bk-reader-spinner" />
                    <span>{t('bookmarks.translating')}</span>
                  </div>
                )}
                <div
                  className="bk-reader-body"
                  ref={readerBodyRef}
                  onMouseUp={isPro ? handleTextSelection : undefined}
                  dangerouslySetInnerHTML={{ __html: processedHtml }}
                />
              </motion.article>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Web mode — iframe */}
      {viewMode === 'web' && (
        <div className="bk-reader-webview">
          <iframe
            ref={iframeRef}
            className="bk-reader-iframe"
            src={bookmark.url}
            title={bookmark.title}
            sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
            referrerPolicy="no-referrer"
          />
        </div>
      )}

      {/* Floating color picker */}
      {colorPickerPos && (
        <div
          className="highlight-color-picker"
          style={{
            left: colorPickerPos.x,
            top: colorPickerPos.y,
            transform: 'translate(-50%, -100%)',
          }}
        >
          {HIGHLIGHT_COLORS.map(color => (
            <button
              key={color}
              className={`highlight-color-swatch ${color}`}
              onClick={() => handleColorPick(color)}
              title={color}
            />
          ))}
          <div className="highlight-picker-divider" />
          <button
            className="highlight-note-btn"
            onClick={() => {
              if (selectedText && bookmark) {
                onCreateNoteFromSelection?.(selectedText, bookmark.title);
                setColorPickerPos(null);
                setSelectedText('');
                window.getSelection()?.removeAllRanges();
              }
            }}
            title={t('bookmarks.createNote')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

function formatDate(dateStr: string): string {
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US';
  return new Date(dateStr).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
