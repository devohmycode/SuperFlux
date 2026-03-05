import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { fetchBookmarks, removeBookmark, toggleBookmarkRead, type WebBookmark } from '../services/bookmarkService';
import { translateText, getTranslationConfig, saveTranslationConfig } from '../services/translationService';
import GradientText from './GradientText';
import GlassIconButton from './GlassIconButton';

type ViewMode = 'cards' | 'compact';

// Gradient palette per bookmark source
const sourceGradients: Record<string, string> = {
  chrome: 'from-blue-500 via-green-500 to-yellow-500',
  desktop: 'from-indigo-500 via-purple-500 to-pink-500',
  mobile: 'from-orange-500 via-red-500 to-pink-500',
};

interface BookmarkPanelProps {
  selectedBookmarkId?: string | null;
  selectedFolder?: string | null;
  bookmarkFolderMap?: Record<string, string>;
  bookmarkFolders?: string[];
  onSelectBookmark?: (bookmark: WebBookmark) => void;
  onMoveBookmarkToFolder?: (bookmarkId: string, folder: string | undefined) => void;
  translateActive?: boolean;
  onTranslateActiveChange?: (active: boolean) => void;
}

const IMPORTANT_FOLDER = 'Importants';

type ContextMenuState =
  | { kind: 'bookmark'; x: number; y: number; bookmarkId: string }
  | null;

export function BookmarkPanel({ selectedBookmarkId, selectedFolder, bookmarkFolderMap, bookmarkFolders, onSelectBookmark, onMoveBookmarkToFolder, translateActive: translateActiveProp, onTranslateActiveChange }: BookmarkPanelProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [bookmarks, setBookmarks] = useState<WebBookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try { return (localStorage.getItem('superflux_bk_viewmode') as ViewMode) || 'cards'; }
    catch { return 'cards'; }
  });
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [folderSubmenuOpen, setFolderSubmenuOpen] = useState(false);

  // ── Translation (controlled by parent) ──
  const translateActive = translateActiveProp ?? false;
  const setTranslateActive = useCallback((v: boolean) => { onTranslateActiveChange?.(v); }, [onTranslateActiveChange]);
  const [translateLoading, setTranslateLoading] = useState(false);
  const [translatedItems, setTranslatedItems] = useState<Record<string, { title: string; excerpt: string }>>({});

  useEffect(() => {
    try { localStorage.setItem('superflux_bk_viewmode', viewMode); }
    catch { /* ignore */ }
  }, [viewMode]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const data = await fetchBookmarks(user.id);
    setBookmarks(data);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // Close context menu on click/escape
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => { setContextMenu(null); setFolderSubmenuOpen(false); };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('click', close);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', handleKey);
    };
  }, [contextMenu]);

  const handleContextMenu = useCallback((e: React.MouseEvent, bookmarkId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setFolderSubmenuOpen(false);
    setContextMenu({ kind: 'bookmark', x: e.clientX, y: e.clientY, bookmarkId });
  }, []);

  const handleRemove = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;
    setBookmarks(prev => prev.filter(b => b.id !== id));
    await removeBookmark(user.id, id);
  };

  const handleToggleRead = async (id: string, isRead: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;
    setBookmarks(prev => prev.map(b => b.id === id ? { ...b, is_read: isRead } : b));
    await toggleBookmarkRead(user.id, id, isRead);
  };

  // Filter by read status
  let filtered = filter === 'unread'
    ? bookmarks.filter(b => !b.is_read)
    : [...bookmarks];

  // Filter by selected folder
  if (selectedFolder != null && bookmarkFolderMap) {
    filtered = filtered.filter(b => bookmarkFolderMap[b.id] === selectedFolder);
  }

  const handleTranslateList = useCallback(async () => {
    if (translateLoading) return;
    if (translateActive) {
      setTranslateActive(false);
      saveTranslationConfig({ autoTranslate: false });
      return;
    }
    setTranslateActive(true);
    saveTranslationConfig({ autoTranslate: true });

    setTranslateLoading(true);
    try {
      const config = getTranslationConfig();
      const toTranslate = filtered.filter(i => !translatedItems[i.id]);
      const results = await Promise.all(
        toTranslate.map(async (bk) => {
          const [title, excerpt] = await Promise.all([
            translateText(bk.title, config.targetLanguage),
            bk.excerpt ? translateText(bk.excerpt, config.targetLanguage) : Promise.resolve(''),
          ]);
          return { id: bk.id, title, excerpt };
        })
      );
      setTranslatedItems(prev => {
        const next = { ...prev };
        for (const r of results) next[r.id] = { title: r.title, excerpt: r.excerpt };
        return next;
      });
    } finally {
      setTranslateLoading(false);
    }
  }, [translateLoading, translateActive, filtered, translatedItems]);

  if (!user) {
    return (
      <div className="bookmark-panel-empty">
        <p>{t('bookmarks.loginToSee')}</p>
      </div>
    );
  }

  return (
    <div className="bookmark-panel">
      {/* Header */}
      <div className="bookmark-panel-header">
        <div className="bookmark-panel-title-row">
          <h2 className="bookmark-panel-title">
            <GradientText
              colors={["#5227FF","#FF9FFC","#B19EEF"]}
              animationSpeed={8}
              showBorder={false}
            >
              Bookmarks
            </GradientText>
          </h2>
          {bookmarks.length > 0 && (
            <span className="bookmark-panel-count">{bookmarks.length}</span>
          )}
        </div>
        <div className="bookmark-panel-actions">
          <GlassIconButton
            color="blue"
            icon="✱"
            title={t('bookmarks.allBookmarks')}
            onClick={() => setFilter('all')}
            active={filter === 'all'}
          />
          <GlassIconButton
            color="indigo"
            icon="○"
            title={t('bookmarks.unreadOnly')}
            onClick={() => setFilter('unread')}
            active={filter === 'unread'}
          />
          <GlassIconButton
            color="orange"
            icon="▦"
            title={t('common.cardsView')}
            onClick={() => setViewMode('cards')}
            active={viewMode === 'cards'}
          />
          <GlassIconButton
            color="green"
            icon="☰"
            title={t('common.compactView')}
            onClick={() => setViewMode('compact')}
            active={viewMode === 'compact'}
          />
          <GlassIconButton
            color="blue"
            icon={translateLoading ? <span className="btn-spinner" /> : '🌐'}
            title={t(translateActive ? 'common.viewOriginals' : 'common.translateList')}
            onClick={handleTranslateList}
            disabled={translateLoading || bookmarks.length === 0}
            active={translateActive}
          />
          <GlassIconButton
            color="purple"
            icon="↻"
            title={t('common.refresh')}
            onClick={load}
          />
        </div>
      </div>

      {/* Content */}
      <div className="bookmark-panel-list">
        {loading ? (
          <div className="bookmark-panel-empty">{t('common.loading')}</div>
        ) : filtered.length === 0 ? (
          <div className="bookmark-panel-empty">
            <p>{filter === 'unread' ? t('bookmarks.noUnreadBookmarks') : t('bookmarks.noBookmarks')}</p>
            <p className="bookmark-panel-hint">
              {t('bookmarks.installExtension')}
            </p>
          </div>
        ) : viewMode === 'compact' ? (
          /* ─── Compact List View ─── */
          <div className="bk-compact-list">
            {filtered.map((bk, idx) => (
              <motion.article
                key={bk.id}
                className={`bk-compact-item ${selectedBookmarkId === bk.id ? 'active' : ''} ${bk.is_read ? 'read' : ''}`}
                onClick={() => onSelectBookmark?.(bk)}
                onContextMenu={(e) => handleContextMenu(e, bk.id)}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.02, duration: 0.25 }}
              >
                <div className="bk-compact-item__left">
                  {!bk.is_read && <span className="bk-compact-item__dot" />}
                  {bk.favicon && (
                    <img
                      src={bk.favicon}
                      alt=""
                      className="bk-compact-item__favicon"
                      onError={(e) => (e.currentTarget.style.display = 'none')}
                    />
                  )}
                  <div className="bk-compact-item__text">
                    <h3 className="bk-compact-item__title">{translateActive && translatedItems[bk.id] ? translatedItems[bk.id].title : bk.title}</h3>
                    <div className="bk-compact-item__meta">
                      <span className="bk-compact-item__site">{bk.site_name || new URL(bk.url).hostname}</span>
                      <span className="bk-compact-item__sep">·</span>
                      <span className="bk-compact-item__date">{formatDate(bk.created_at, t)}</span>
                      <span className={`bk-compact-item__source bk-compact-item__source--${bk.source}`}>
                        {bk.source}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="bk-compact-item__actions">
                  <button
                    className={`bk-compact-item__btn bk-compact-item__btn--star ${bookmarkFolderMap?.[bk.id] === IMPORTANT_FOLDER ? 'active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      const isImportant = bookmarkFolderMap?.[bk.id] === IMPORTANT_FOLDER;
                      onMoveBookmarkToFolder?.(bk.id, isImportant ? undefined : IMPORTANT_FOLDER);
                    }}
                    title={bookmarkFolderMap?.[bk.id] === IMPORTANT_FOLDER ? t('bookmarks.removeFromImportant') : t('bookmarks.addToImportant')}
                  >
                    {bookmarkFolderMap?.[bk.id] === IMPORTANT_FOLDER ? '★' : '☆'}
                  </button>
                  <button
                    className="bk-compact-item__btn"
                    onClick={(e) => handleToggleRead(bk.id, !bk.is_read, e)}
                    title={bk.is_read ? t('bookmarks.markUnread') : t('bookmarks.markRead')}
                  >
                    {bk.is_read ? '○' : '●'}
                  </button>
                  <button
                    className="bk-compact-item__btn bk-compact-item__btn--delete"
                    onClick={(e) => handleRemove(bk.id, e)}
                    title={t('common.delete')}
                  >
                    ✕
                  </button>
                </div>
              </motion.article>
            ))}
          </div>
        ) : (
          /* ─── Cards Grid View ─── */
          <div className="bookmark-cards-grid">
            {filtered.map((bk, idx) => (
              <motion.article
                key={bk.id}
                className={`bk-blob-card ${selectedBookmarkId === bk.id ? 'active' : ''} ${bk.is_read ? 'read' : ''}`}
                onClick={() => onSelectBookmark?.(bk)}
                onContextMenu={(e) => handleContextMenu(e, bk.id)}
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: idx * 0.04, duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
                whileHover={{ scale: 1.02 }}
              >
                {/* Animated Gradient Blob */}
                <div
                  className={`bk-blob-card__blob bg-gradient-to-r ${sourceGradients[bk.source] || sourceGradients.chrome}`}
                  style={{ animationDelay: `${(idx % 5) * -1}s` }}
                />

                {/* Glassy Content Overlay */}
                <div className="bk-blob-card__glass">
                  <div className="bk-blob-card__meta">
                    <span className="bk-blob-card__source">
                      {bk.favicon && (
                        <img
                          src={bk.favicon}
                          alt=""
                          className="bk-blob-card__favicon"
                          onError={(e) => (e.currentTarget.style.display = 'none')}
                        />
                      )}
                      {bk.site_name || new URL(bk.url).hostname}
                    </span>
                    <span className="bk-blob-card__time">{formatDate(bk.created_at, t)}</span>
                  </div>

                  <div className="bk-blob-card__body">
                    <div className="bk-blob-card__title-row">
                      {!bk.is_read && <span className="bk-blob-card__unread" />}
                      <h3 className="bk-blob-card__title">{translateActive && translatedItems[bk.id] ? translatedItems[bk.id].title : bk.title}</h3>
                    </div>
                    {(bk.excerpt || (translateActive && translatedItems[bk.id]?.excerpt)) && (
                      <p className="bk-blob-card__excerpt">{translateActive && translatedItems[bk.id] ? translatedItems[bk.id].excerpt : bk.excerpt}</p>
                    )}
                  </div>

                  <div className="bk-blob-card__footer">
                    <div className="bk-blob-card__tags">
                      <span className={`bk-blob-card__tag bk-blob-card__tag--${bk.source}`}>
                        {bk.source}
                      </span>
                      {bk.author && (
                        <span className="bk-blob-card__tag">{bk.author}</span>
                      )}
                    </div>
                    <div className="bk-blob-card__actions">
                      <button
                        className={`bk-blob-card__action-btn bk-blob-card__action-btn--star ${bookmarkFolderMap?.[bk.id] === IMPORTANT_FOLDER ? 'active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          const isImportant = bookmarkFolderMap?.[bk.id] === IMPORTANT_FOLDER;
                          onMoveBookmarkToFolder?.(bk.id, isImportant ? undefined : IMPORTANT_FOLDER);
                        }}
                        title={bookmarkFolderMap?.[bk.id] === IMPORTANT_FOLDER ? t('bookmarks.removeFromImportant') : t('bookmarks.addToImportant')}
                      >
                        {bookmarkFolderMap?.[bk.id] === IMPORTANT_FOLDER ? '★' : '☆'}
                      </button>
                      <button
                        className="bk-blob-card__action-btn"
                        onClick={(e) => handleToggleRead(bk.id, !bk.is_read, e)}
                        title={bk.is_read ? t('bookmarks.markUnread') : t('bookmarks.markRead')}
                      >
                        {bk.is_read ? '○' : '●'}
                      </button>
                      <button
                        className="bk-blob-card__action-btn bk-blob-card__action-btn--delete"
                        onClick={(e) => handleRemove(bk.id, e)}
                        title={t('common.delete')}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                </div>
              </motion.article>
            ))}

            {/* Blob animation keyframes */}
            <style>{`
              @keyframes bkBlobFloat {
                0%   { transform: translate(-80%, -80%) rotate(0deg); }
                25%  { transform: translate(10%, -60%) rotate(90deg); }
                50%  { transform: translate(0%, 10%) rotate(180deg); }
                75%  { transform: translate(-60%, 0%) rotate(270deg); }
                100% { transform: translate(-80%, -80%) rotate(360deg); }
              }
              .bk-blob-card__blob {
                animation: bkBlobFloat 8s linear infinite;
              }
            `}</style>
          </div>
        )}
      </div>

      {/* Bookmark context menu */}
      {contextMenu?.kind === 'bookmark' && (
        <div
          className="feed-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x, position: 'fixed', zIndex: 1000 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="feed-context-menu-item"
            onMouseEnter={() => setFolderSubmenuOpen(true)}
            onMouseLeave={() => setFolderSubmenuOpen(false)}
            style={{ position: 'relative' }}
          >
            <span className="feed-context-menu-icon">📁</span>
            {t('common.folder')} ›
            {folderSubmenuOpen && (
              <div
                className="feed-context-menu"
                style={{ position: 'absolute', left: '100%', top: 0, zIndex: 1001, minWidth: 140 }}
              >
                <button
                  className={`feed-context-menu-item ${!bookmarkFolderMap?.[contextMenu.bookmarkId] ? 'active' : ''}`}
                  onClick={() => {
                    onMoveBookmarkToFolder?.(contextMenu.bookmarkId, undefined);
                    setContextMenu(null);
                  }}
                >
                  {t('common.noFolder')}
                </button>
                {(bookmarkFolders ?? []).map(folder => (
                  <button
                    key={folder}
                    className={`feed-context-menu-item ${bookmarkFolderMap?.[contextMenu.bookmarkId] === folder ? 'active' : ''}`}
                    onClick={() => {
                      onMoveBookmarkToFolder?.(contextMenu.bookmarkId, folder);
                      setContextMenu(null);
                    }}
                  >
                    📁 {folder}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className="feed-context-menu-item feed-context-menu-item--danger"
            onClick={(e) => {
              handleRemove(contextMenu.bookmarkId, e);
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

function formatDate(dateStr: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / 86400000);

  if (days === 0) return t('common.today');
  if (days === 1) return t('common.yesterday');
  if (days < 7) return t('common.daysAgo', { count: days });
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
