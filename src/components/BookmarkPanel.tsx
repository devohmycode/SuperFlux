import { useState, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { fetchBookmarks, removeBookmark, toggleBookmarkRead, type WebBookmark } from '../services/bookmarkService';
import GradientText from './GradientText';

type ViewMode = 'cards' | 'compact';

// Gradient palette per bookmark source
const sourceGradients: Record<string, string> = {
  chrome: 'from-blue-500 via-green-500 to-yellow-500',
  desktop: 'from-indigo-500 via-purple-500 to-pink-500',
  mobile: 'from-orange-500 via-red-500 to-pink-500',
};

interface BookmarkPanelProps {
  selectedBookmarkId?: string | null;
  onSelectBookmark?: (bookmark: WebBookmark) => void;
}

export function BookmarkPanel({ selectedBookmarkId, onSelectBookmark }: BookmarkPanelProps) {
  const { user } = useAuth();
  const [bookmarks, setBookmarks] = useState<WebBookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try { return (localStorage.getItem('superflux_bk_viewmode') as ViewMode) || 'cards'; }
    catch { return 'cards'; }
  });

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

  const filtered = filter === 'unread'
    ? bookmarks.filter(b => !b.is_read)
    : bookmarks;

  if (!user) {
    return (
      <div className="bookmark-panel-empty">
        <p>Connectez-vous pour voir vos bookmarks</p>
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
          <button
            className={`bookmark-filter-btn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            Tous
          </button>
          <button
            className={`bookmark-filter-btn ${filter === 'unread' ? 'active' : ''}`}
            onClick={() => setFilter('unread')}
          >
            Non lus
          </button>
          <button
            className={`bookmark-view-btn ${viewMode === 'cards' ? 'active' : ''}`}
            title="Vue cartes"
            onClick={() => setViewMode('cards')}
          >
            ▦
          </button>
          <button
            className={`bookmark-view-btn ${viewMode === 'compact' ? 'active' : ''}`}
            title="Vue compacte"
            onClick={() => setViewMode('compact')}
          >
            ☰
          </button>
          <button className="bookmark-refresh-btn" onClick={load} title="Actualiser">
            ↻
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="bookmark-panel-list">
        {loading ? (
          <div className="bookmark-panel-empty">Chargement...</div>
        ) : filtered.length === 0 ? (
          <div className="bookmark-panel-empty">
            <p>{filter === 'unread' ? 'Aucun bookmark non lu' : 'Aucun bookmark'}</p>
            <p className="bookmark-panel-hint">
              Installez l'extension Chrome SuperFlux pour sauvegarder des pages web
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
                    <h3 className="bk-compact-item__title">{bk.title}</h3>
                    <div className="bk-compact-item__meta">
                      <span className="bk-compact-item__site">{bk.site_name || new URL(bk.url).hostname}</span>
                      <span className="bk-compact-item__sep">·</span>
                      <span className="bk-compact-item__date">{formatDate(bk.created_at)}</span>
                      <span className={`bk-compact-item__source bk-compact-item__source--${bk.source}`}>
                        {bk.source}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="bk-compact-item__actions">
                  <button
                    className="bk-compact-item__btn"
                    onClick={(e) => handleToggleRead(bk.id, !bk.is_read, e)}
                    title={bk.is_read ? 'Marquer non lu' : 'Marquer lu'}
                  >
                    {bk.is_read ? '○' : '●'}
                  </button>
                  <button
                    className="bk-compact-item__btn bk-compact-item__btn--delete"
                    onClick={(e) => handleRemove(bk.id, e)}
                    title="Supprimer"
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
                    <span className="bk-blob-card__time">{formatDate(bk.created_at)}</span>
                  </div>

                  <div className="bk-blob-card__body">
                    <div className="bk-blob-card__title-row">
                      {!bk.is_read && <span className="bk-blob-card__unread" />}
                      <h3 className="bk-blob-card__title">{bk.title}</h3>
                    </div>
                    {bk.excerpt && (
                      <p className="bk-blob-card__excerpt">{bk.excerpt}</p>
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
                        className="bk-blob-card__action-btn"
                        onClick={(e) => handleToggleRead(bk.id, !bk.is_read, e)}
                        title={bk.is_read ? 'Marquer non lu' : 'Marquer lu'}
                      >
                        {bk.is_read ? '○' : '●'}
                      </button>
                      <button
                        className="bk-blob-card__action-btn bk-blob-card__action-btn--delete"
                        onClick={(e) => handleRemove(bk.id, e)}
                        title="Supprimer"
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
    </div>
  );
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / 86400000);

  if (days === 0) return "Aujourd'hui";
  if (days === 1) return 'Hier';
  if (days < 7) return `Il y a ${days}j`;
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
