import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { WebBookmark } from '../services/bookmarkService';
import { extractArticle, type ExtractedArticle } from '../services/articleExtractor';
import { openExternal } from '../lib/tauriFetch';

type LoadStatus = 'idle' | 'loading' | 'done' | 'error';

interface BookmarkReaderProps {
  bookmark: WebBookmark | null;
  onMarkRead?: (id: string) => void;
}

export function BookmarkReader({ bookmark, onMarkRead }: BookmarkReaderProps) {
  const [article, setArticle] = useState<ExtractedArticle | null>(null);
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [viewMode, setViewMode] = useState<'reader' | 'web'>('reader');
  const [fontSize, setFontSize] = useState(16);
  const contentRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const prevUrlRef = useRef<string | null>(null);

  // Extract article content when bookmark changes
  useEffect(() => {
    if (!bookmark) {
      setArticle(null);
      setStatus('idle');
      prevUrlRef.current = null;
      return;
    }

    // Don't refetch if same URL
    if (bookmark.url === prevUrlRef.current) return;
    prevUrlRef.current = bookmark.url;

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

  if (!bookmark) {
    return (
      <div className="bk-reader-empty">
        <span className="bk-reader-empty-icon">🔖</span>
        <p>Sélectionnez un bookmark pour le lire</p>
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
              title="Mode lecture"
            >
              ¶
            </button>
            <button
              className={`bk-reader-viewbtn ${viewMode === 'web' ? 'active' : ''}`}
              onClick={() => setViewMode('web')}
              title="Mode web"
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
                title="Réduire"
              >
                A−
              </button>
              <button
                className="bk-reader-fontbtn"
                onClick={() => setFontSize(s => Math.min(24, s + 1))}
                title="Agrandir"
              >
                A+
              </button>
            </div>
          )}
          {/* External link */}
          <button className="bk-reader-extbtn" onClick={handleOpenExternal} title="Ouvrir dans le navigateur">
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
                  <span>Extraction de l'article...</span>
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
                <h3>Impossible de charger l'article</h3>
                <p>Le contenu de cette page n'a pas pu être extrait.</p>
                <div className="bk-reader-error-actions">
                  <button className="bk-reader-error-btn primary" onClick={handleOpenExternal}>
                    Ouvrir dans le navigateur ↗
                  </button>
                  <button className="bk-reader-error-btn" onClick={handleRetry}>
                    Réessayer
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
                <h1 className="bk-reader-title">{article.title || bookmark.title}</h1>
                <div className="bk-reader-meta">
                  {article.byline && <span className="bk-reader-byline">{article.byline}</span>}
                  {article.siteName && <span className="bk-reader-sitename">{article.siteName}</span>}
                  <span className="bk-reader-date">{formatDate(bookmark.created_at)}</span>
                </div>
                <div
                  className="bk-reader-body"
                  dangerouslySetInnerHTML={{ __html: article.content }}
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
    </div>
  );
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
