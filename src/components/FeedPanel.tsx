import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { FeedCategory, FeedItem, FeedSource } from '../types';
import MorphingPageDots from './ui/morphing-page-dots';
import { usePro } from '../contexts/ProContext';
import { summarizeDigest } from '../services/llmService';
import { translateText, getTranslationConfig } from '../services/translationService';

const ITEMS_PER_PAGE = 8;

type ViewMode = 'normal' | 'compact' | 'cards';

function useLocalStorage<T>(key: string, defaultValue: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try { const stored = localStorage.getItem(key); return stored !== null ? JSON.parse(stored) : defaultValue; }
    catch { return defaultValue; }
  });
  const set = useCallback((v: T) => { setValue(v); localStorage.setItem(key, JSON.stringify(v)); }, [key]);
  return [value, set];
}

const sourceGradients: Record<FeedSource, string> = {
  article: 'from-pink-500 via-red-500 to-yellow-500',
  reddit: 'from-orange-500 via-red-500 to-pink-500',
  youtube: 'from-red-500 via-pink-500 to-purple-500',
  twitter: 'from-blue-500 via-cyan-500 to-teal-500',
  mastodon: 'from-indigo-500 via-purple-500 to-pink-500',
  podcast: 'from-green-500 via-teal-500 to-cyan-500',
};

interface FeedPanelProps {
  categories: FeedCategory[];
  items: FeedItem[];
  selectedFeedId: string | null;
  selectedSource: FeedSource | null;
  selectedItemId: string | null;
  showFavorites?: boolean;
  showReadLater?: boolean;
  onSelectItem: (item: FeedItem) => void;
  onMarkAllAsRead: () => void;
  onToggleRead: (itemId: string) => void;
  onToggleStar: (itemId: string) => void;
  onToggleBookmark: (itemId: string) => void;
  onClose: () => void;
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'à l\'instant';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}j`;
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function formatCommentCount(count: number): string {
  return `${count} ${count > 1 ? 'commentaires' : 'commentaire'}`;
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function groupByTime(items: FeedItem[]): { label: string; items: FeedItem[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);

  const groups: { label: string; items: FeedItem[] }[] = [
    { label: 'Aujourd\'hui', items: [] },
    { label: 'Hier', items: [] },
    { label: 'Plus ancien', items: [] },
  ];

  items.forEach(item => {
    if (item.publishedAt >= today) groups[0].items.push(item);
    else if (item.publishedAt >= yesterday) groups[1].items.push(item);
    else groups[2].items.push(item);
  });

  return groups.filter(g => g.items.length > 0);
}

const sourceLabels: Record<FeedSource, string> = {
  article: 'Articles',
  reddit: 'Reddit',
  youtube: 'YouTube',
  twitter: 'Réseaux',
  mastodon: 'Réseaux',
  podcast: 'Podcasts',
};

function findFeedName(categories: FeedCategory[], feedId: string): string | null {
  for (const cat of categories) {
    const feed = cat.feeds.find(f => f.id === feedId);
    if (feed) return feed.name;
  }
  return null;
}

export function FeedPanel({ categories, items, selectedFeedId, selectedSource, selectedItemId, showFavorites, showReadLater, onSelectItem, onMarkAllAsRead, onToggleRead, onToggleStar, onToggleBookmark, onClose }: FeedPanelProps) {
  const { isPro, showUpgradeModal } = usePro();
  const [viewMode, setViewMode] = useLocalStorage<ViewMode>('superflux_viewmode', 'normal');
  const compact = viewMode === 'compact';
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: FeedItem } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // ── Digest IA ──
  const [digestState, setDigestState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [digestText, setDigestText] = useState('');
  const [digestError, setDigestError] = useState('');
  const [digestOpen, setDigestOpen] = useState(true);

  // ── Translation ──
  const [translateActive, setTranslateActive] = useState(false);
  const [translateLoading, setTranslateLoading] = useState(false);
  const [translatedItems, setTranslatedItems] = useState<Record<string, { title: string; excerpt: string }>>({});

  // ── Pagination ──
  const [currentPage, setCurrentPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));

  // Reset to page 0 and digest when items source changes
  const itemsKey = `${selectedFeedId}-${selectedSource}-${showFavorites}-${showReadLater}`;
  useEffect(() => { setCurrentPage(0); setDigestState('idle'); setDigestText(''); setDigestError(''); setTranslateActive(false); setTranslatedItems({}); }, [itemsKey]);

  // Clamp page if items shrink
  useEffect(() => {
    if (currentPage >= totalPages) setCurrentPage(Math.max(0, totalPages - 1));
  }, [currentPage, totalPages]);

  const paginatedItems = useMemo(() => {
    const start = currentPage * ITEMS_PER_PAGE;
    return items.slice(start, start + ITEMS_PER_PAGE);
  }, [items, currentPage]);

  const paginatedGroups = useMemo(() => groupByTime(paginatedItems), [paginatedItems]);

  const handleContextMenu = useCallback((e: React.MouseEvent, item: FeedItem) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, item });
  }, []);

  const handleDigest = useCallback(async () => {
    if (digestState === 'loading' || items.length === 0) return;
    setDigestState('loading');
    setDigestError('');
    setDigestOpen(true);
    try {
      const articles = items.slice(0, 30).map(i => ({
        title: i.title,
        excerpt: i.excerpt || '',
        feedName: i.feedName,
      }));
      const result = await summarizeDigest(articles);
      setDigestText(result);
      setDigestState('done');
    } catch (e) {
      setDigestError(e instanceof Error ? e.message : 'Erreur inconnue');
      setDigestState('error');
    }
  }, [digestState, items]);

  const handleTranslateList = useCallback(async () => {
    if (translateLoading) return;
    if (translateActive) { setTranslateActive(false); return; }

    setTranslateActive(true);
    setTranslateLoading(true);
    try {
      const config = getTranslationConfig();
      const toTranslate = paginatedItems.filter(i => !translatedItems[i.id]);
      const results = await Promise.all(
        toTranslate.map(async (item) => {
          const [title, excerpt] = await Promise.all([
            translateText(item.title, config.targetLanguage),
            item.excerpt ? translateText(item.excerpt, config.targetLanguage) : Promise.resolve(''),
          ]);
          return { id: item.id, title, excerpt };
        })
      );
      setTranslatedItems(prev => {
        const next = { ...prev };
        for (const r of results) next[r.id] = { title: r.title, excerpt: r.excerpt };
        return next;
      });
    } catch {
      setTranslateActive(false);
    } finally {
      setTranslateLoading(false);
    }
  }, [translateLoading, translateActive, paginatedItems, translatedItems]);

  // Close on click outside or Escape
  useEffect(() => {
    if (!contextMenu) return;
    const handleClose = () => setContextMenu(null);
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextMenu(null); };
    document.addEventListener('click', handleClose);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('click', handleClose);
      document.removeEventListener('keydown', handleKey);
    };
  }, [contextMenu]);

  const unreadCount = items.filter(i => !i.isRead).length;
  const title = showFavorites
    ? 'Favoris'
    : showReadLater
      ? 'Lire plus tard'
      : selectedFeedId
      ? findFeedName(categories, selectedFeedId) || items[0]?.feedName || 'Flux'
      : selectedSource
        ? sourceLabels[selectedSource]
        : 'Tous les flux';

  return (
    <div className={`feed-panel ${compact ? 'compact' : ''}`}>
      <div className="feed-panel-header">
        <div className="feed-panel-title-row">
          <h2 className="feed-panel-title">{title}</h2>
          {unreadCount > 0 && (
            <span className="feed-panel-unread">{unreadCount} non lus</span>
          )}
        </div>
        <div className="feed-panel-actions">
          <button
            className={`feed-action-btn ${digestState === 'loading' ? 'loading' : ''}`}
            title={isPro ? "Résumer l'actualité" : "Résumer (Pro)"}
            onClick={isPro ? handleDigest : showUpgradeModal}
            disabled={digestState === 'loading' || items.length === 0}
          >
            {digestState === 'loading' ? <span className="btn-spinner" /> : isPro ? '✦' : '🔒'}
          </button>
          <button
            className={`feed-action-btn ${translateActive ? 'active' : ''}`}
            title={translateActive ? 'Voir les originaux' : 'Traduire la liste'}
            onClick={handleTranslateList}
            disabled={translateLoading || items.length === 0}
          >
            {translateLoading ? <span className="btn-spinner" /> : '🌐'}
          </button>
          <button
            className="feed-action-btn"
            title="Tout marquer comme lu"
            onClick={onMarkAllAsRead}
          >
            ✓
          </button>
          <button
            className={`feed-action-btn ${viewMode === 'cards' ? 'active' : ''}`}
            title="Vue cartes"
            onClick={() => setViewMode(viewMode === 'cards' ? 'normal' : 'cards')}
          >
            ▦
          </button>
          <button
            className={`feed-action-btn ${compact ? 'active' : ''}`}
            title={compact ? 'Vue normale' : 'Vue compacte'}
            onClick={() => setViewMode(viewMode === 'compact' ? 'normal' : 'compact')}
          >
            {compact ? '☰' : '≡'}
          </button>
          <button className="panel-close-btn" title="Fermer le panneau (2)" onClick={onClose}>✕</button>
        </div>
      </div>

      <AnimatePresence>
        {digestState !== 'idle' && (
          <motion.div
            className="feed-digest"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <button
              className="feed-digest-header"
              onClick={() => setDigestOpen(prev => !prev)}
            >
              <span className="feed-digest-icon">✦</span>
              <span className="feed-digest-title">Digest IA</span>
              <span className={`feed-digest-chevron ${digestOpen ? 'open' : ''}`}>›</span>
            </button>
            <AnimatePresence>
              {digestOpen && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {digestState === 'loading' && (
                    <div className="feed-digest-loading">
                      <div className="feed-digest-pulse" />
                      <div className="feed-digest-pulse short" />
                      <div className="feed-digest-pulse" />
                    </div>
                  )}
                  {digestState === 'done' && (
                    <div className="feed-digest-content">{digestText}</div>
                  )}
                  {digestState === 'error' && (
                    <div className="feed-digest-error">{digestError}</div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="feed-panel-list">
        {items.length === 0 && (
          <div className="feed-empty">
            <span className="feed-empty-icon">◇</span>
            <p className="feed-empty-text">Aucun article pour le moment</p>
            <p className="feed-empty-hint">Les nouveaux articles apparaîtront ici lors de la prochaine synchronisation</p>
          </div>
        )}

        {viewMode === 'cards' ? (
          /* ─── Cards Grid View ─── */
          <div className="feed-cards-grid">
            {paginatedItems.map((item, idx) => (
              <motion.article
                key={item.id}
                className={`feed-blob-card ${selectedItemId === item.id ? 'active' : ''} ${item.isRead ? 'read' : ''}`}
                onClick={() => onSelectItem(item)}
                onContextMenu={(e) => handleContextMenu(e, item)}
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: idx * 0.04, duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
                whileHover={{ scale: 1.02 }}
              >
                {/* Animated Gradient Blob */}
                <div
                  className={`feed-blob-card__blob bg-gradient-to-r ${sourceGradients[item.source]}`}
                  style={{ animationDelay: `${(idx % 5) * -1}s` }}
                />

                {/* Glassy Content Overlay */}
                <div className="feed-blob-card__glass">
                  <div className="feed-blob-card__meta">
                    <span className="feed-blob-card__source">{item.feedName}</span>
                    <span className="feed-blob-card__time">{formatTimeAgo(item.publishedAt)}</span>
                  </div>

                  <div className="feed-blob-card__body">
                    <div className="feed-blob-card__title-row">
                      {!item.isRead && <span className="feed-blob-card__unread" />}
                      <h3 className="feed-blob-card__title">{translateActive && translatedItems[item.id] ? translatedItems[item.id].title : item.title}</h3>
                    </div>
                    <p className="feed-blob-card__excerpt">{translateActive && translatedItems[item.id] ? translatedItems[item.id].excerpt : item.excerpt}</p>
                  </div>

                  <div className="feed-blob-card__footer">
                    <div className="feed-blob-card__tags">
                      {item.tags?.slice(0, 2).map(tag => (
                        <span key={tag} className="feed-blob-card__tag">{tag}</span>
                      ))}
                    </div>
                    <div className="feed-blob-card__actions">
                      {item.isStarred && <span className="feed-blob-card__star">★</span>}
                      {item.readTime && <span className="feed-blob-card__readtime">{item.readTime}m</span>}
                    </div>
                  </div>
                </div>
              </motion.article>
            ))}

            {/* Single style tag for the blob animation */}
            <style>{`
              @keyframes blobFloat {
                0%   { transform: translate(-80%, -80%) rotate(0deg); }
                25%  { transform: translate(10%, -60%) rotate(90deg); }
                50%  { transform: translate(0%, 10%) rotate(180deg); }
                75%  { transform: translate(-60%, 0%) rotate(270deg); }
                100% { transform: translate(-80%, -80%) rotate(360deg); }
              }
              .feed-blob-card__blob {
                animation: blobFloat 8s linear infinite;
              }
            `}</style>
          </div>
        ) : (
          /* ─── List View (normal / compact) ─── */
          paginatedGroups.map((group, groupIdx) => (
            <div key={group.label} className="feed-group">
              <motion.div
                className="feed-group-label"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: groupIdx * 0.08 }}
              >
                {group.label}
              </motion.div>
              {group.items.map((item, idx) => (
                <motion.article
                  key={item.id}
                  className={`feed-card ${selectedItemId === item.id ? 'active' : ''} ${item.isRead ? 'read' : ''}`}
                  onClick={() => onSelectItem(item)}
                  onContextMenu={(e) => handleContextMenu(e, item)}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: (groupIdx * group.items.length + idx) * 0.03, duration: 0.3 }}
                >
                  <div className="feed-card-meta">
                    <span className="feed-card-source">{item.feedName}</span>
                    <span className="feed-card-dot">·</span>
                    <span className="feed-card-time">{formatTimeAgo(item.publishedAt)}</span>
                    {item.isStarred && <span className="feed-card-star">★</span>}
                    <button
                      className={`feed-card-bookmark ${item.isBookmarked ? 'active' : ''}`}
                      title={item.isBookmarked ? 'Retirer de Lire plus tard' : 'Lire plus tard'}
                      onClick={(e) => { e.stopPropagation(); onToggleBookmark(item.id); }}
                    >
                      {item.isBookmarked ? '🔖' : '🏷'}
                    </button>
                  </div>
                  <div className="feed-card-title-row">
                    {!item.isRead && <span className="feed-card-unread-dot" />}
                    <h3 className="feed-card-title">{translateActive && translatedItems[item.id] ? translatedItems[item.id].title : item.title}</h3>
                  </div>
                  {!compact && (
                    <>
                      <p className="feed-card-excerpt">{translateActive && translatedItems[item.id] ? translatedItems[item.id].excerpt : item.excerpt}</p>
                      <div className="feed-card-footer">
                        {item.tags?.slice(0, 2).map(tag => (
                          <span key={tag} className="feed-card-tag">{tag}</span>
                        ))}
                        {item.source === 'reddit' && typeof item.commentCount === 'number' && (
                          <span className="feed-card-comments">{formatCommentCount(item.commentCount)}</span>
                        )}
                        {item.source === 'podcast' && item.duration ? (
                          <span className="feed-card-readtime">🎧 {formatDuration(item.duration)}</span>
                        ) : item.readTime ? (
                          <span className="feed-card-readtime">{item.readTime} min</span>
                        ) : null}
                      </div>
                    </>
                  )}
                </motion.article>
              ))}
            </div>
          ))
        )}
      </div>

      {/* ─── Pagination Dots ─── */}
      {totalPages > 1 && (
        <div className="feed-panel-pagination">
          <MorphingPageDots
            total={totalPages}
            activeIndex={currentPage}
            onChange={setCurrentPage}
          />
          <span className="feed-panel-pagination__info">
            {currentPage * ITEMS_PER_PAGE + 1}–{Math.min((currentPage + 1) * ITEMS_PER_PAGE, items.length)} / {items.length}
          </span>
        </div>
      )}

      {contextMenu && (
        <div
          ref={menuRef}
          className="feed-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            className="feed-context-menu-item"
            onClick={() => { onToggleRead(contextMenu.item.id); setContextMenu(null); }}
          >
            <span className="feed-context-menu-icon">{contextMenu.item.isRead ? '●' : '○'}</span>
            {contextMenu.item.isRead ? 'Marquer comme non lu' : 'Marquer comme lu'}
          </button>
          <button
            className="feed-context-menu-item"
            onClick={() => { onToggleStar(contextMenu.item.id); setContextMenu(null); }}
          >
            <span className="feed-context-menu-icon">{contextMenu.item.isStarred ? '★' : '☆'}</span>
            {contextMenu.item.isStarred ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          </button>
          <button
            className="feed-context-menu-item"
            onClick={() => { onToggleBookmark(contextMenu.item.id); setContextMenu(null); }}
          >
            <span className="feed-context-menu-icon">{contextMenu.item.isBookmarked ? '🔖' : '🏷'}</span>
            {contextMenu.item.isBookmarked ? 'Retirer de Lire plus tard' : 'Lire plus tard'}
          </button>
        </div>
      )}
    </div>
  );
}
