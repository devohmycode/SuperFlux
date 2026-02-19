import { useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { FeedItem, FeedSource } from '../types';

interface StatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: FeedItem[];
}

const sourceLabels: Record<FeedSource, string> = {
  article: 'Articles',
  reddit: 'Reddit',
  youtube: 'YouTube',
  twitter: 'Réseaux',
  mastodon: 'Réseaux',
  podcast: 'Podcasts',
};

function formatTime(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

export function StatsModal({ isOpen, onClose, items }: StatsModalProps) {
  const stats = useMemo(() => {
    const totalArticles = items.length;
    const readItems = items.filter(i => i.isRead);
    const readArticles = readItems.length;
    const readPercent = totalArticles > 0 ? Math.round((readArticles / totalArticles) * 100) : 0;

    const totalReadTimeMin = readItems.reduce((sum, i) => sum + (i.readTime ?? 0), 0);
    const avgReadTime = readArticles > 0 ? totalReadTimeMin / readArticles : 0;

    // By source
    const bySourceMap = new Map<string, number>();
    for (const item of readItems) {
      const label = sourceLabels[item.source] || item.source;
      bySourceMap.set(label, (bySourceMap.get(label) || 0) + 1);
    }
    const bySource = [...bySourceMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count }));
    const maxSourceCount = bySource.length > 0 ? bySource[0].count : 1;

    // Top 5 feeds
    const byFeedMap = new Map<string, number>();
    for (const item of readItems) {
      byFeedMap.set(item.feedName, (byFeedMap.get(item.feedName) || 0) + 1);
    }
    const topFeeds = [...byFeedMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    return { totalArticles, readArticles, readPercent, totalReadTimeMin, avgReadTime, bySource, maxSourceCount, topFeeds };
  }, [items]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="modal-content stats-modal"
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 className="modal-title">Statistiques</h2>
              <button className="modal-close" onClick={onClose}>✕</button>
            </div>

            <div className="stats-body">
              {/* Cards grid */}
              <div className="stats-grid">
                <div className="stats-card">
                  <div className="stats-card-value">{stats.readArticles}<span className="stats-card-total">/{stats.totalArticles}</span></div>
                  <div className="stats-card-label">Articles lus</div>
                  <div className="stats-bar">
                    <div className="stats-bar-fill" style={{ width: `${stats.readPercent}%` }} />
                  </div>
                  <div className="stats-bar-label">{stats.readPercent}%</div>
                </div>

                <div className="stats-card">
                  <div className="stats-card-value">{formatTime(stats.totalReadTimeMin)}</div>
                  <div className="stats-card-label">Temps de lecture</div>
                </div>

                <div className="stats-card">
                  <div className="stats-card-value">{formatTime(stats.avgReadTime)}</div>
                  <div className="stats-card-label">Moyenne / article</div>
                </div>
              </div>

              {/* By source */}
              {stats.bySource.length > 0 && (
                <div className="stats-section">
                  <div className="stats-section-title">Par source</div>
                  {stats.bySource.map(({ label, count }) => (
                    <div key={label} className="stats-source-row">
                      <span className="stats-source-label">{label}</span>
                      <div className="stats-source-bar">
                        <div
                          className="stats-source-bar-fill"
                          style={{ width: `${(count / stats.maxSourceCount) * 100}%` }}
                        />
                      </div>
                      <span className="stats-source-count">{count}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Top feeds */}
              {stats.topFeeds.length > 0 && (
                <div className="stats-section">
                  <div className="stats-section-title">Top flux</div>
                  {stats.topFeeds.map(({ name, count }, i) => (
                    <div key={name} className="stats-feed-row">
                      <span className="stats-feed-rank">{i + 1}.</span>
                      <span className="stats-feed-name">{name}</span>
                      <span className="stats-feed-count">{count}</span>
                    </div>
                  ))}
                </div>
              )}

              <button className="stats-close-btn" onClick={onClose}>Fermer</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
