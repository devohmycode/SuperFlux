import { useState, useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { FeedSource } from '../types';
import { searchFeeds, isSearchableSource, searchLabels, type FeedSearchResult } from '../services/feedSearchService';

interface AddFeedModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (feed: NewFeedData) => void;
}

export interface NewFeedData {
  name: string;
  url: string;
  source: FeedSource;
}

const sourceOptions: { value: FeedSource; label: string; icon: string; placeholder: string; hint?: string }[] = [
  { value: 'article', label: 'Article / Blog', icon: '◇', placeholder: 'Rechercher un blog...', hint: 'Recherchez ou collez une URL RSS' },
  { value: 'reddit', label: 'Reddit', icon: '⬡', placeholder: 'Rechercher un subreddit...', hint: 'Recherchez ou collez r/nom' },
  { value: 'youtube', label: 'YouTube', icon: '▷', placeholder: '@fireship', hint: '@nom ou URL complète' },
  { value: 'twitter', label: 'Twitter / X', icon: '✦', placeholder: '@Anthropic', hint: '@nom ou URL complète' },
  { value: 'mastodon', label: 'Mastodon', icon: '🐘', placeholder: 'https://mastodon.social/@username.rss' },
  { value: 'podcast', label: 'Podcast', icon: '🎙', placeholder: 'Rechercher un podcast...', hint: 'Recherchez ou collez une URL RSS' },
];

function looksLikeUrl(input: string): boolean {
  const trimmed = input.trim().toLowerCase();
  return trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.includes('.xml');
}

function resolveInput(raw: string, currentSource: FeedSource): { url: string; name: string; source: FeedSource; shorthand: string | null } {
  const trimmed = raw.trim();

  // r/subredditname → Reddit
  const redditMatch = trimmed.match(/^r\/([A-Za-z0-9_]+)\/?$/);
  if (redditMatch) {
    const sub = redditMatch[1];
    return {
      url: `https://www.reddit.com/r/${sub}/.rss`,
      name: `r/${sub}`,
      source: 'reddit',
      shorthand: `reddit.com/r/${sub}`,
    };
  }

  // @username → Twitter or YouTube depending on selected source
  const atMatch = trimmed.match(/^@([A-Za-z0-9_.-]+)\/?$/);
  if (atMatch) {
    const user = atMatch[1];
    if (currentSource === 'twitter') {
      return {
        url: `rsshub://twitter/user/${user}`,
        name: `@${user}`,
        source: 'twitter',
        shorthand: `twitter.com/${user} (via RSSHub)`,
      };
    }
    return {
      url: `https://www.youtube.com/@${user}`,
      name: user,
      source: 'youtube',
      shorthand: `youtube.com/@${user} (RSS auto-discovery)`,
    };
  }

  // Full URL — keep as-is
  return { url: trimmed, name: '', source: currentSource, shorthand: null };
}

export function AddFeedModal({ isOpen, onClose, onAdd }: AddFeedModalProps) {
  const [name, setName] = useState('');
  const [input, setInput] = useState('');
  const [source, setSource] = useState<FeedSource>('article');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Feed search state
  const [searchResults, setSearchResults] = useState<FeedSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchVersionRef = useRef(0);

  const resolved = useMemo(() => resolveInput(input, source), [input, source]);

  const triggerSearch = useCallback((query: string, currentSource: FeedSource) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim() || query.trim().length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      setSearchQuery('');
      return;
    }

    setIsSearching(true);
    setSearchQuery(query);

    debounceRef.current = setTimeout(async () => {
      const version = ++searchVersionRef.current;
      try {
        const results = await searchFeeds(query.trim(), currentSource);
        if (version === searchVersionRef.current) {
          setSearchResults(results);
        }
      } catch {
        if (version === searchVersionRef.current) {
          setSearchResults([]);
        }
      } finally {
        if (version === searchVersionRef.current) {
          setIsSearching(false);
        }
      }
    }, 400);
  }, []);

  const handleInputChange = (value: string) => {
    setInput(value);
    setError(null);

    // Auto-switch source type on shorthand detection
    const r = resolveInput(value, source);
    if (r.shorthand && r.source !== source) {
      setSource(r.source);
    }

    // Search for searchable sources when input is not a URL and not a resolved shorthand
    if (isSearchableSource(source) && !looksLikeUrl(value) && !r.shorthand) {
      triggerSearch(value, source);
    } else {
      setSearchResults([]);
      setIsSearching(false);
      setSearchQuery('');
    }
  };

  const handleSelectResult = (result: FeedSearchResult) => {
    setInput(result.feedUrl);
    if (!name.trim()) {
      setName(result.name);
    }
    setSearchResults([]);
    setIsSearching(false);
    setSearchQuery('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSearchResults([]);
    setIsSearching(false);
    setSearchQuery('');

    if (!input.trim()) {
      setError("L'URL ou l'identifiant est requis");
      return;
    }

    const finalUrl = resolved.url;

    // Validate: either a shorthand was resolved or must be a valid URL
    if (!resolved.shorthand) {
      try {
        new URL(finalUrl);
      } catch {
        setError("URL invalide. Essayez r/nom pour Reddit ou @nom pour YouTube");
        return;
      }
    }

    setIsLoading(true);

    const finalName = name.trim() || resolved.name || (() => {
      try { return new URL(finalUrl).hostname; } catch { return input.trim(); }
    })();

    onAdd({
      name: finalName,
      url: finalUrl,
      source: resolved.source,
    });

    // Reset form
    setName('');
    setInput('');
    setSource('article');
    setIsLoading(false);
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleSourceChange = (newSource: FeedSource) => {
    setSource(newSource);
    setSearchResults([]);
    setIsSearching(false);
    setSearchQuery('');
  };

  const currentOption = sourceOptions.find(opt => opt.value === source);
  const isSearchable = isSearchableSource(source);
  const showDropdown = isSearchable && (searchResults.length > 0 || isSearching || (searchQuery && !isSearching && searchResults.length === 0));

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={handleBackdropClick}
        >
          <motion.div
            className="modal-content"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <div className="modal-header">
              <h2 className="modal-title">Ajouter un flux</h2>
              <button className="modal-close" onClick={onClose}>×</button>
            </div>

            <form onSubmit={handleSubmit} className="modal-form">
              <div className="form-group">
                <label htmlFor="feed-url" className="form-label">
                  {searchLabels[source] || 'Flux'}
                  {currentOption?.hint && (
                    <span className="form-hint"> — {currentOption.hint}</span>
                  )}
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    id="feed-url"
                    type="text"
                    className="form-input"
                    style={{ width: '100%' }}
                    placeholder={currentOption?.placeholder}
                    value={input}
                    onChange={(e) => handleInputChange(e.target.value)}
                    autoFocus
                  />
                  {showDropdown && (
                    <div className="feed-search-results">
                      {isSearching ? (
                        <div className="feed-search-loading">
                          <span className="btn-spinner" />
                          Recherche...
                        </div>
                      ) : searchResults.length === 0 ? (
                        <div className="feed-search-empty">
                          Aucun résultat trouvé
                        </div>
                      ) : (
                        searchResults.map((result, i) => (
                          <motion.button
                            key={result.feedUrl + i}
                            type="button"
                            className="feed-search-item"
                            onClick={() => handleSelectResult(result)}
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.12, delay: i * 0.03 }}
                          >
                            {result.imageUrl ? (
                              <img
                                className="feed-search-artwork"
                                src={result.imageUrl}
                                alt=""
                              />
                            ) : (
                              <div className="feed-search-artwork feed-search-artwork-placeholder" />
                            )}
                            <div className="feed-search-info">
                              <span className="feed-search-name">{result.name}</span>
                              {result.description && (
                                <span className="feed-search-description">{result.description}</span>
                              )}
                            </div>
                            {result.meta && (
                              <span className="feed-search-meta">
                                {result.meta}
                              </span>
                            )}
                          </motion.button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                {resolved.shorthand && (
                  <motion.div
                    className="form-resolved"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <span className="resolved-icon">→</span>
                    <span className="resolved-url">{resolved.shorthand}</span>
                  </motion.div>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="feed-name" className="form-label">Nom (optionnel)</label>
                <input
                  id="feed-name"
                  type="text"
                  className="form-input"
                  placeholder={resolved.name || "Mon flux préféré"}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Type de source</label>
                <div className="source-selector">
                  {sourceOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`source-option ${source === opt.value ? 'active' : ''}`}
                      onClick={() => handleSourceChange(opt.value)}
                    >
                      <span className="source-option-icon">{opt.icon}</span>
                      <span className="source-option-label">{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {error && (
                <motion.div
                  className="form-error"
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  {error}
                </motion.div>
              )}

              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={onClose}>
                  Annuler
                </button>
                <button type="submit" className="btn-primary" disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <span className="btn-spinner" />
                      Vérification...
                    </>
                  ) : (
                    'Ajouter'
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
