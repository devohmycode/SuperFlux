import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { FeedComment, FeedItem, SummaryFormat, TextHighlight, HighlightColor } from '../types';
import { AudioPlayer } from './AudioPlayer';
import { fetchViaBackend, openExternal } from '../lib/tauriFetch';
import { summarizeArticle } from '../services/llmService';
import { translateText, getTranslationConfig, saveTranslationConfig } from '../services/translationService';
import { extractArticle, isContentTruncated } from '../services/articleExtractor';
import { applyHighlights } from '../lib/highlightHtml';
import * as ttsService from '../services/ttsService';
import { usePro } from '../contexts/ProContext';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from './ui/breadcrumb';

type ViewMode = 'reader' | 'web';
type IframeStatus = 'idle' | 'loading' | 'loaded' | 'blocked' | 'error';
type RedditCommentsStatus = 'idle' | 'loading' | 'success' | 'error';
type TtsStatus = 'idle' | 'playing' | 'paused';

interface RedditCommentsState {
  status: RedditCommentsStatus;
  comments: FeedComment[];
  count: number | null;
  error: string | null;
}


interface BreadcrumbData {
  sourceName: string | null;
  feedName: string | null;
  itemTitle: string | null;
  onClickAll: () => void;
  onClickSource: () => void;
  onClickFeed: () => void;
}

type FullContentStatus = 'idle' | 'loading' | 'done' | 'error' | 'not-needed';

interface ReaderPanelProps {
  item: FeedItem | null;
  onToggleStar?: () => void;
  onSummaryGenerated?: (itemId: string, summary: string) => void;
  onFullContentExtracted?: (itemId: string, fullContent: string) => void;
  breadcrumb?: BreadcrumbData;
  feedPanelOpen?: boolean;
  highlights?: TextHighlight[];
  onHighlightAdd?: (itemId: string, text: string, color: HighlightColor, prefix: string, suffix: string) => void;
  onHighlightRemove?: (itemId: string, highlightId: string) => void;
  onHighlightNoteUpdate?: (itemId: string, highlightId: string, note: string) => void;
  onBackToFeeds?: () => void;
  onClose?: () => void;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatCommentCount(count: number): string {
  return `${count} ${count > 1 ? 'commentaires' : 'commentaire'}`;
}

function formatCommentTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "à l'instant";
  if (diffMins < 60) return `il y a ${diffMins}m`;
  if (diffHours < 24) return `il y a ${diffHours}h`;
  return `il y a ${diffDays}j`;
}

function getCommentsUrl(item: FeedItem): string | null {
  if (item.source !== 'reddit') return null;
  if (item.commentsUrl) return item.commentsUrl;
  if (item.url.includes('/comments/')) return item.url;
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function getListingChildren(value: unknown): unknown[] {
  const listing = asRecord(value);
  const data = listing ? asRecord(listing.data) : null;
  return data && Array.isArray(data.children) ? data.children : [];
}

function buildRedditCommentsApiUrl(url: string): string {
  const cleanUrl = url.split('#')[0].split('?')[0].replace(/\/+$/, '');
  const jsonUrl = cleanUrl.endsWith('.json') ? cleanUrl : `${cleanUrl}.json`;
  const parsedUrl = new URL(jsonUrl);
  const apiUrl = new URL(`https://api.reddit.com${parsedUrl.pathname}`);
  apiUrl.searchParams.set('raw_json', '1');
  apiUrl.searchParams.set('limit', '30');
  apiUrl.searchParams.set('sort', 'best');
  return apiUrl.toString();
}

function parseRedditPayload(payload: unknown, maxComments = 30): { comments: FeedComment[]; count: number | null } {
  if (!Array.isArray(payload)) {
    return { comments: [], count: null };
  }

  let count: number | null = null;
  const postChildren = getListingChildren(payload[0]);
  if (postChildren.length > 0) {
    const post = asRecord(postChildren[0]);
    const postData = post ? asRecord(post.data) : null;
    if (postData && typeof postData.num_comments === 'number') {
      count = postData.num_comments;
    }
  }

  const comments: FeedComment[] = [];

  const collect = (nodes: unknown[]) => {
    for (const node of nodes) {
      if (comments.length >= maxComments) return;

      const entry = asRecord(node);
      if (!entry || entry.kind !== 't1') continue;

      const data = asRecord(entry.data);
      if (!data) continue;

      const body = typeof data.body === 'string' ? data.body.trim() : '';
      if (!body) continue;

      const id = typeof data.id === 'string' ? data.id : `comment-${comments.length}`;
      const author = typeof data.author === 'string' ? data.author : '[deleted]';
      const score = typeof data.score === 'number' ? data.score : 0;
      const createdUtc = typeof data.created_utc === 'number' ? data.created_utc : null;

      comments.push({
        id,
        author,
        body,
        score,
        publishedAt: createdUtc ? new Date(createdUtc * 1000) : new Date(),
      });

      const replies = asRecord(data.replies);
      if (replies) {
        collect(getListingChildren(replies));
      }
    }
  };

  collect(getListingChildren(payload[1]));

  return { comments, count };
}

const HIGHLIGHT_COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'pink', 'orange'];

export function ReaderPanel({ item, onToggleStar, onSummaryGenerated, onFullContentExtracted, breadcrumb, feedPanelOpen, highlights, onHighlightAdd, onHighlightRemove, onHighlightNoteUpdate, onBackToFeeds, onClose }: ReaderPanelProps) {
  const { isPro, showUpgradeModal } = usePro();
  const [viewMode, setViewMode] = useState<ViewMode>('reader');
  const [iframeStatus, setIframeStatus] = useState<IframeStatus>('idle');
  const [summaryState, setSummaryState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [summaryText, setSummaryText] = useState('');
  const [summaryError, setSummaryError] = useState('');
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [fullContentStatus, setFullContentStatus] = useState<FullContentStatus>('idle');
  const [fullContentHtml, setFullContentHtml] = useState('');
  const [_fullContentError, setFullContentError] = useState('');
  const [redditCommentsState, setRedditCommentsState] = useState<RedditCommentsState>({
    status: 'idle',
    comments: [],
    count: null,
    error: null,
  });
  const [ttsStatus, setTtsStatus] = useState<TtsStatus>('idle');
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [translateState, setTranslateState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [translatedHtml, setTranslatedHtml] = useState('');
  const [translatedTitle, setTranslatedTitle] = useState('');
  const [translateError, setTranslateError] = useState('');
  const [showTranslation, setShowTranslation] = useState(false);
  const [colorPickerPos, setColorPickerPos] = useState<{ x: number; y: number } | null>(null);
  const [selectedText, setSelectedText] = useState('');
  const [selectedPrefix, setSelectedPrefix] = useState('');
  const [selectedSuffix, setSelectedSuffix] = useState('');
  const [webHtml, setWebHtml] = useState<string | null>(null);
  const [highlightsMenuOpen, setHighlightsMenuOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const readerBodyRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const probeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable ref for the callback to avoid re-triggering the fetch effect
  const onFullContentExtractedRef = useRef(onFullContentExtracted);
  onFullContentExtractedRef.current = onFullContentExtracted;

  // Sources that don't need full-text extraction
  const skipExtraction = item?.source === 'reddit' || item?.source === 'youtube' || item?.source === 'twitter';

  // HTML with highlights applied
  const rawHtml = fullContentStatus === 'done' && fullContentHtml ? fullContentHtml : item?.content ?? '';
  const processedHtml = useMemo(() => {
    if (!rawHtml) return '';
    return applyHighlights(rawHtml, highlights ?? []);
  }, [rawHtml, highlights]);

  // Reset to reader mode when article changes
  useEffect(() => {
    setViewMode('reader');
    setIframeStatus('idle');
    setWebHtml(null);
    if (probeTimerRef.current) clearTimeout(probeTimerRef.current);
    // Reset or restore summary
    if (item?.summary) {
      setSummaryState('done');
      setSummaryText(item.summary);
      setSummaryOpen(true);
    } else {
      setSummaryState('idle');
      setSummaryText('');
      setSummaryError('');
    }
    // Reset highlight UI
    setColorPickerPos(null);
    setSelectedText('');
    setHighlightsMenuOpen(false);
    setEditingNoteId(null);
    // Reset translation (keep autoTranslate intent)
    setTranslateState('idle');
    setTranslatedHtml('');
    setTranslatedTitle('');
    setTranslateError('');
    const { autoTranslate } = getTranslationConfig();
    setShowTranslation(autoTranslate);
    // Reset or restore full content
    if (item?.fullContent) {
      setFullContentStatus('done');
      setFullContentHtml(item.fullContent);
    } else {
      setFullContentStatus('idle');
      setFullContentHtml('');
      setFullContentError('');
    }
  }, [item?.id]);

  // Auto-translate when autoTranslate is enabled and a new article loads
  useEffect(() => {
    if (!item || !showTranslation || translateState !== 'idle') return;
    const config = getTranslationConfig();
    if (!config.autoTranslate) return;

    const contentToTranslate = item.fullContent || item.content;
    if (!contentToTranslate) return;

    setTranslateState('loading');
    setTranslateError('');
    Promise.all([
      translateText(contentToTranslate, config.targetLanguage),
      translateText(item.title, config.targetLanguage),
    ]).then(([result, titleResult]) => {
      setTranslatedHtml(result);
      setTranslatedTitle(titleResult);
      setTranslateState('done');
    }).catch((e) => {
      setTranslateError(e instanceof Error ? e.message : 'Erreur de traduction');
      setTranslateState('error');
      setShowTranslation(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, showTranslation, translateState]);

  // Auto-fetch full content when RSS content is truncated
  // Only depends on item?.id — all item properties are stable for a given id,
  // and the callback ref avoids re-triggering on parent re-renders.
  useEffect(() => {
    if (!item || skipExtraction) return;
    if (!item.url || item.url === '#') return;

    // If already have full content cached, skip
    if (item.fullContent) return;

    // Check if the RSS content looks truncated
    if (!isContentTruncated(item.content)) {
      setFullContentStatus('not-needed');
      return;
    }

    // Auto-fetch
    let cancelled = false;
    setFullContentStatus('loading');

    extractArticle(item.url)
      .then(article => {
        if (cancelled) return;
        setFullContentHtml(article.content);
        setFullContentStatus('done');
        onFullContentExtractedRef.current?.(item.id, article.content);
      })
      .catch(err => {
        if (cancelled) return;
        setFullContentError(err instanceof Error ? err.message : 'Erreur inconnue');
        setFullContentStatus('error');
      });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (probeTimerRef.current) clearTimeout(probeTimerRef.current);
    };
  }, []);

  // Cancel TTS when article changes or component unmounts
  useEffect(() => {
    ttsService.stop();
    setTtsStatus('idle');
    setTtsError(null);
  }, [item?.id]);

  useEffect(() => {
    return () => { ttsService.stop(); };
  }, []);

  const handleTts = useCallback(() => {
    const config = ttsService.getTtsConfig();

    if (ttsStatus === 'idle') {
      if (!item) return;
      // Always strip HTML to get plain text
      const bodyText = new DOMParser().parseFromString(
        showTranslation && translateState === 'done' && translatedHtml
          ? translatedHtml
          : fullContentHtml || item.fullContent || item.content,
        'text/html'
      ).body.innerText;
      const text = `${item.title}. ${bodyText}`;
      setTtsStatus('playing');
      setTtsError(null);
      ttsService.speak(text, () => setTtsStatus('idle')).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[TTS] ElevenLabs error:', msg);
        setTtsError(msg);
        setTtsStatus('idle');
      });
    } else if (ttsStatus === 'playing') {
      if (config.engine === 'browser') {
        ttsService.pauseBrowser();
        setTtsStatus('paused');
      } else {
        // Native and ElevenLabs don't support pause — stop instead
        ttsService.stop();
        setTtsStatus('idle');
      }
    } else {
      if (config.engine === 'browser') {
        ttsService.resumeBrowser();
        setTtsStatus('playing');
      }
    }
  }, [ttsStatus, item, fullContentHtml, showTranslation, translateState, translatedHtml]);

  const handleTtsStop = useCallback(() => {
    ttsService.stop();
    setTtsStatus('idle');
    setTtsError(null);
  }, []);

  // --- Highlight handlers ---
  const handleTextSelection = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      return;
    }
    const range = sel.getRangeAt(0);
    const container = readerBodyRef.current;
    if (!container || !container.contains(range.commonAncestorContainer)) {
      return;
    }
    const text = sel.toString().trim();
    if (!text) return;

    // Extract prefix/suffix from the container's text content
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
    if (!item || !selectedText) return;
    onHighlightAdd?.(item.id, selectedText, color, selectedPrefix, selectedSuffix);
    setColorPickerPos(null);
    setSelectedText('');
    window.getSelection()?.removeAllRanges();
  }, [item, selectedText, selectedPrefix, selectedSuffix, onHighlightAdd]);

  // Dismiss color picker on outside click
  useEffect(() => {
    if (!colorPickerPos) return;
    let listener: ((e: MouseEvent) => void) | null = null;
    const timer = setTimeout(() => {
      listener = (e: MouseEvent) => {
        const picker = document.querySelector('.highlight-color-picker');
        if (picker && !picker.contains(e.target as Node)) {
          setColorPickerPos(null);
          setSelectedText('');
        }
      };
      window.addEventListener('mousedown', listener);
    }, 100);
    return () => {
      clearTimeout(timer);
      if (listener) window.removeEventListener('mousedown', listener);
    };
  }, [colorPickerPos]);

  // Close highlights menu on outside click
  useEffect(() => {
    if (!highlightsMenuOpen) return;
    const handleDown = (e: MouseEvent) => {
      const menu = document.querySelector('.highlights-menu-dropdown');
      const btn = document.querySelector('.highlights-btn');
      if (menu && !menu.contains(e.target as Node) && btn && !btn.contains(e.target as Node)) {
        setHighlightsMenuOpen(false);
        setEditingNoteId(null);
      }
    };
    window.addEventListener('mousedown', handleDown);
    return () => window.removeEventListener('mousedown', handleDown);
  }, [highlightsMenuOpen]);

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
    if (!item || !editingNoteId) return;
    onHighlightNoteUpdate?.(item.id, editingNoteId, noteText);
    setEditingNoteId(null);
    setNoteText('');
  }, [item, editingNoteId, noteText, onHighlightNoteUpdate]);

  const hasValidUrl = item?.url && item.url !== '#';
  const redditComments = item?.source === 'reddit' ? redditCommentsState.comments : [];
  const displayedCommentCount = item?.source === 'reddit'
    ? (redditCommentsState.count ?? item.commentCount ?? redditComments.length)
    : null;

  useEffect(() => {
    if (!item || item.source !== 'reddit') {
      setRedditCommentsState({
        status: 'idle',
        comments: [],
        count: null,
        error: null,
      });
      return;
    }

    const fallbackComments = item.comments ?? [];
    const fallbackCount = item.commentCount ?? fallbackComments.length;
    const url = getCommentsUrl(item);

    if (!url) {
      setRedditCommentsState({
        status: 'success',
        comments: fallbackComments,
        count: fallbackCount,
        error: null,
      });
      return;
    }

    const controller = new AbortController();

    setRedditCommentsState({
      status: 'loading',
      comments: fallbackComments,
      count: fallbackCount,
      error: null,
    });

    const fetchComments = async () => {
      try {
        const apiUrl = buildRedditCommentsApiUrl(url);
        const text = await fetchViaBackend(apiUrl);
        const payload = JSON.parse(text);
        const parsed = parseRedditPayload(payload);
        const parsedComments = parsed.comments.length > 0 ? parsed.comments : fallbackComments;

        setRedditCommentsState({
          status: 'success',
          comments: parsedComments,
          count: parsed.count ?? fallbackCount,
          error: null,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        setRedditCommentsState({
          status: 'error',
          comments: fallbackComments,
          count: fallbackCount,
          error: error instanceof Error ? error.message : 'Erreur inconnue',
        });
      }
    };

    void fetchComments();

    return () => {
      controller.abort();
    };
  }, [item]);

  const handleWebView = useCallback(async () => {
    if (!hasValidUrl || !item?.url) return;
    setViewMode('web');
    setIframeStatus('loading');
    setWebHtml(null);

    try {
      const html = await fetchViaBackend(item.url);
      // Inject a <base> tag so relative URLs resolve correctly
      const baseTag = `<base href="${item.url}">`;
      const injected = html.replace(/(<head[^>]*>)/i, `$1${baseTag}`);
      setWebHtml(injected);
      setIframeStatus('loaded');
    } catch (e) {
      console.error('[ReaderPanel] web fetch failed:', e);
      setIframeStatus('error');
    }
  }, [hasValidUrl, item?.url]);

  const handleReaderView = useCallback(() => {
    setViewMode('reader');
    setIframeStatus('idle');
    if (probeTimerRef.current) clearTimeout(probeTimerRef.current);
  }, []);

  // Escape key returns to reader mode from web mode
  useEffect(() => {
    if (viewMode !== 'web') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleReaderView();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewMode, handleReaderView]);

  const handleIframeLoad = useCallback(() => {
    // X-Frame-Options blocks don't fire onError — the iframe loads
    // but shows a blank page. We probe after load to detect this.
    const iframe = iframeRef.current;
    if (!iframe) {
      setIframeStatus('loaded');
      return;
    }

    try {
      // Cross-origin pages throw on contentDocument access.
      // If we CAN access it and it's essentially empty, the page was blocked.
      const doc = iframe.contentDocument;
      if (doc) {
        const bodyText = doc.body?.innerText?.trim() || '';
        const bodyChildren = doc.body?.children?.length || 0;
        // Blank or near-empty body = likely blocked
        if (bodyChildren === 0 && bodyText.length === 0) {
          setIframeStatus('blocked');
          return;
        }
      }
    } catch {
      // SecurityError = cross-origin, which means the page actually loaded.
      // This is the expected case for a working cross-origin iframe.
    }

    setIframeStatus('loaded');

    // Secondary probe: some blocks render after a short delay.
    // Check again after 1.5s — if the iframe body is still empty, it's blocked.
    probeTimerRef.current = setTimeout(() => {
      try {
        const doc = iframe.contentDocument;
        if (doc) {
          const bodyText = doc.body?.innerText?.trim() || '';
          const bodyChildren = doc.body?.children?.length || 0;
          if (bodyChildren === 0 && bodyText.length === 0) {
            setIframeStatus('blocked');
          }
        }
      } catch {
        // Cross-origin — page is working fine
      }
    }, 1500);
  }, []);

  const handleIframeError = useCallback(() => {
    setIframeStatus('blocked');
  }, []);

  const handleRefresh = useCallback(() => {
    if (item?.url) {
      handleWebView();
    }
  }, [item?.url, handleWebView]);

  const handleOpenExternal = useCallback(() => {
    if (item?.url && item.url !== '#') {
      openExternal(item.url);
    }
  }, [item?.url]);

  const handleFetchFullContent = useCallback(async () => {
    if (!item || fullContentStatus === 'loading' || !item.url || item.url === '#') return;
    setFullContentStatus('loading');
    setFullContentError('');
    try {
      const article = await extractArticle(item.url);
      setFullContentHtml(article.content);
      setFullContentStatus('done');
      onFullContentExtractedRef.current?.(item.id, article.content);
    } catch (e) {
      setFullContentError(e instanceof Error ? e.message : 'Erreur inconnue');
      setFullContentStatus('error');
    }
  }, [item, fullContentStatus]);

  const handleSummarize = useCallback(async () => {
    if (!item || summaryState === 'loading') return;
    setSummaryState('loading');
    setSummaryError('');
    setSummaryOpen(true);
    try {
      const format = (localStorage.getItem('superflux_summary_format') || 'bullets') as SummaryFormat;
      const contentToSummarize = fullContentHtml || item.fullContent || item.content;
      const result = await summarizeArticle(contentToSummarize, item.title, format);
      setSummaryText(result);
      setSummaryState('done');
      onSummaryGenerated?.(item.id, result);
    } catch (e) {
      setSummaryError(e instanceof Error ? e.message : 'Erreur inconnue');
      setSummaryState('error');
    }
  }, [item, summaryState, onSummaryGenerated]);

  const handleTranslate = useCallback(async () => {
    if (!item) return;
    // Toggle: if already translated, just switch view and update global pref
    if (translateState === 'done') {
      const next = !showTranslation;
      setShowTranslation(next);
      saveTranslationConfig({ autoTranslate: next });
      return;
    }
    if (translateState === 'loading') return;

    setTranslateState('loading');
    setTranslateError('');
    setShowTranslation(true);
    saveTranslationConfig({ autoTranslate: true });
    try {
      const config = getTranslationConfig();
      const contentToTranslate = fullContentHtml || item.fullContent || item.content;
      const [result, titleResult] = await Promise.all([
        translateText(contentToTranslate, config.targetLanguage),
        translateText(item.title, config.targetLanguage),
      ]);
      setTranslatedHtml(result);
      setTranslatedTitle(titleResult);
      setTranslateState('done');
    } catch (e) {
      setTranslateError(e instanceof Error ? e.message : 'Erreur de traduction');
      setTranslateState('error');
      setShowTranslation(false);
    }
  }, [item, translateState, fullContentHtml]);

  const breadcrumbBar = breadcrumb && !feedPanelOpen ? (
    <div className="reader-breadcrumb">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="#" onClick={(e) => { e.preventDefault(); breadcrumb.onClickAll(); }}>
              Tous les flux
            </BreadcrumbLink>
          </BreadcrumbItem>
          {breadcrumb.sourceName && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {breadcrumb.feedName || breadcrumb.itemTitle ? (
                  <BreadcrumbLink href="#" onClick={(e) => { e.preventDefault(); breadcrumb.onClickSource(); }}>
                    {breadcrumb.sourceName}
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage>{breadcrumb.sourceName}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
            </>
          )}
          {breadcrumb.feedName && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {breadcrumb.itemTitle ? (
                  <BreadcrumbLink href="#" onClick={(e) => { e.preventDefault(); breadcrumb.onClickFeed(); }}>
                    {breadcrumb.feedName}
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage>{breadcrumb.feedName}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
            </>
          )}
          {breadcrumb.itemTitle && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{breadcrumb.itemTitle}</BreadcrumbPage>
              </BreadcrumbItem>
            </>
          )}
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  ) : null;

  if (!item) {
    return (
      <div className="reader-panel reader-empty">
        {onClose && (
          <div className="reader-toolbar reader-toolbar--empty">
            <div className="reader-toolbar-left" />
            <div className="reader-toolbar-right">
              <button className="panel-close-btn" onClick={onClose} title="Replier le panneau Lecture (3)">
                ✕
              </button>
            </div>
          </div>
        )}
        {breadcrumbBar}
        <motion.div
          className="reader-empty-content"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
        >
          <span className="reader-empty-icon">◈</span>
          <p className="reader-empty-text">Sélectionnez un article pour commencer la lecture</p>
          <div className="reader-empty-shortcuts">
            <div className="shortcut-row">
              <kbd>↑</kbd><kbd>↓</kbd>
              <span>Naviguer</span>
            </div>
            <div className="shortcut-row">
              <kbd>↵</kbd>
              <span>Ouvrir</span>
            </div>
            <div className="shortcut-row">
              <kbd>S</kbd>
              <span>Favoris</span>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="reader-panel">
      {breadcrumbBar}
      <div className="reader-toolbar">
        <div className="reader-toolbar-left">
          {viewMode === 'web' ? (
            <>
              <button className="reader-tool-btn back-btn" onClick={handleReaderView} title="Retour au mode lecture">
                ←
              </button>

              {onBackToFeeds && (
                <button className="reader-tool-btn back-feeds-btn" onClick={() => { handleReaderView(); onBackToFeeds(); }} title="Retour aux flux">
                  ◈
                </button>
              )}

              <div className="reader-toolbar-divider" />

              <div className="view-mode-toggle">
                <button
                  className="view-mode-btn active"
                  onClick={handleReaderView}
                  title="Mode lecture"
                >
                  <span className="view-mode-icon">¶</span>
                  <span className="view-mode-label">Lecture</span>
                </button>
                <button
                  className="view-mode-btn active"
                  title="Mode web"
                  disabled
                >
                  <span className="view-mode-icon">◎</span>
                  <span className="view-mode-label">Web</span>
                </button>
              </div>
            </>
          ) : (
            <>
              <button className="reader-tool-btn" title="Favoris" onClick={onToggleStar}>
                <span className={item.isStarred ? 'starred' : ''}>
                  {item.isStarred ? '★' : '☆'}
                </span>
              </button>
              <button className="reader-tool-btn" title="Partager">↗</button>
              <button className="reader-tool-btn" title="Copier le lien">⎘</button>
              <button
                className={`reader-tool-btn summarize ${summaryState === 'loading' ? 'loading' : ''}`}
                title={isPro ? "Résumer avec l'IA" : "Résumer (Pro)"}
                onClick={isPro ? handleSummarize : showUpgradeModal}
                disabled={summaryState === 'loading'}
              >
                {summaryState === 'loading' ? (
                  <span className="btn-spinner" />
                ) : isPro ? '✦' : '🔒'}
                <span className="summarize-label">{isPro ? 'Résumer' : 'Résumer (Pro)'}</span>
              </button>
              <button
                className={`reader-tool-btn tts ${ttsStatus !== 'idle' ? 'active' : ''} ${ttsError ? 'error' : ''}`}
                title={ttsError ? `Erreur: ${ttsError}` : ttsStatus === 'playing' ? 'Pause' : ttsStatus === 'paused' ? 'Reprendre' : 'Écouter'}
                onClick={handleTts}
              >
                {ttsError ? '⚠' : ttsStatus === 'playing' ? '⏸' : '▶'}
              </button>
              {ttsStatus !== 'idle' && (
                <button className="reader-tool-btn tts-stop" onClick={handleTtsStop} title="Arrêter">
                  ■
                </button>
              )}
              <button
                className={`reader-tool-btn ${showTranslation ? 'active' : ''}`}
                title={showTranslation ? 'Voir l\'original' : 'Traduire'}
                onClick={handleTranslate}
                disabled={translateState === 'loading'}
              >
                {translateState === 'loading' ? (
                  <span className="btn-spinner" />
                ) : '🌐'}
              </button>

              {/* Highlights menu */}
              <div style={{ position: 'relative' }}>
                <button
                  className="reader-tool-btn highlights-btn"
                  title={isPro ? "Surlignages" : "Surlignages (Pro)"}
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
                      <span className="highlights-menu-title">Surlignages</span>
                      {(highlights?.length ?? 0) > 0 && (
                        <span className="highlights-badge">{highlights!.length}</span>
                      )}
                    </div>
                    {(!highlights || highlights.length === 0) ? (
                      <div className="highlights-menu-empty">
                        Aucun surlignage pour cet article
                      </div>
                    ) : (
                      <div className="highlights-menu-list">
                        {highlights.map(hl => (
                          <div key={hl.id} className="highlight-menu-item">
                            <span className={`highlight-menu-dot ${hl.color}`} />
                            <div
                              className="highlight-menu-content"
                              onClick={() => handleScrollToHighlight(hl.id)}
                            >
                              <div className="highlight-menu-text">
                                {hl.text.length > 60 ? hl.text.slice(0, 60) + '…' : hl.text}
                              </div>
                              {editingNoteId === hl.id ? (
                                <input
                                  className="highlight-menu-note-input"
                                  value={noteText}
                                  onChange={e => setNoteText(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') handleSaveNote(); }}
                                  onBlur={handleSaveNote}
                                  onClick={e => e.stopPropagation()}
                                  placeholder="Ajouter une note..."
                                  autoFocus
                                />
                              ) : (
                                hl.note ? (
                                  <div
                                    className="highlight-menu-note"
                                    onClick={e => { e.stopPropagation(); handleStartEditNote(hl.id, hl.note); }}
                                  >
                                    {hl.note}
                                  </div>
                                ) : (
                                  <button
                                    className="highlight-menu-note-action"
                                    onClick={e => { e.stopPropagation(); handleStartEditNote(hl.id, ''); }}
                                  >
                                    + note
                                  </button>
                                )
                              )}
                            </div>
                            <button
                              className="highlight-menu-remove"
                              onClick={e => { e.stopPropagation(); item && onHighlightRemove?.(item.id, hl.id); }}
                              title="Supprimer"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="reader-toolbar-divider" />

              <div className="view-mode-toggle">
                <button
                  className={`view-mode-btn ${viewMode === 'reader' ? 'active' : ''}`}
                  onClick={handleReaderView}
                  title="Mode lecture"
                >
                  <span className="view-mode-icon">¶</span>
                  <span className="view-mode-label">Lecture</span>
                </button>
                <button
                  className={`view-mode-btn ${!hasValidUrl ? 'disabled' : ''}`}
                  onClick={handleWebView}
                  disabled={!hasValidUrl}
                  title={hasValidUrl ? 'Mode web' : 'URL non disponible'}
                >
                  <span className="view-mode-icon">◎</span>
                  <span className="view-mode-label">Web</span>
                </button>
              </div>
            </>
          )}
        </div>
        <div className="reader-toolbar-right">
          {viewMode === 'web' && (
            <button className="reader-tool-btn" onClick={handleRefresh} title="Actualiser">
              ↻
            </button>
          )}
          <button className="reader-tool-btn" onClick={handleOpenExternal} title="Ouvrir dans le navigateur">
            ⧉
          </button>
          {onClose && (
            <button className="panel-close-btn" onClick={onClose} title="Replier le panneau Lecture (3)">
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Webview URL bar */}
      {viewMode === 'web' && hasValidUrl && (
        <motion.div
          className="webview-urlbar"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <div className="urlbar-inner">
            <span className="urlbar-lock">◈</span>
            <span className="urlbar-url">{item.url}</span>
            <button
              className="urlbar-open"
              onClick={handleOpenExternal}
              title="Ouvrir dans un nouvel onglet"
            >
              ↗
            </button>
          </div>
        </motion.div>
      )}

      {/* Reader mode content */}
      {viewMode === 'reader' && (
        <AnimatePresence mode="wait">
          <motion.div
            key={item.id}
            className="reader-content"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <div className="reader-article-meta">
              <span className="reader-source">{item.feedName}</span>
              <span className="reader-meta-dot">·</span>
              <span className="reader-author">{item.author}</span>
            </div>

            <h1 className="reader-title">{showTranslation && translatedTitle ? translatedTitle : item.title}</h1>

            <div className="reader-info">
              <time className="reader-date">{formatDate(item.publishedAt)}</time>
              {item.readTime && (
                <>
                  <span className="reader-meta-dot">·</span>
                  <span className="reader-readtime">{item.readTime} min de lecture</span>
                </>
              )}
              {item.source === 'reddit' && typeof item.commentCount === 'number' && (
                <>
                  <span className="reader-meta-dot">·</span>
                  <span className="reader-comments-count">{formatCommentCount(item.commentCount)}</span>
                </>
              )}
            </div>

            {item.tags && item.tags.length > 0 && (
              <div className="reader-tags">
                {item.tags.map(tag => (
                  <span key={tag} className="reader-tag">{tag}</span>
                ))}
              </div>
            )}

            {item.enclosureUrl && (item.enclosureType?.startsWith('audio') || item.source === 'podcast') && (
              <AudioPlayer
                src={item.enclosureUrl}
                title={item.title}
                feedName={item.feedName}
                duration={item.duration}
                thumbnail={item.thumbnail}
              />
            )}

            <AnimatePresence>
              {summaryState !== 'idle' && (
                <motion.div
                  className="reader-summary"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
                >
                  <button
                    className="reader-summary-header"
                    onClick={() => setSummaryOpen(prev => !prev)}
                  >
                    <span className="reader-summary-icon">✦</span>
                    <span className="reader-summary-title">Résumé IA</span>
                    <span className={`reader-summary-chevron ${summaryOpen ? 'open' : ''}`}>›</span>
                  </button>
                  <AnimatePresence>
                    {summaryOpen && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        {summaryState === 'loading' && (
                          <div className="reader-summary-loading">
                            <div className="reader-summary-pulse" />
                            <div className="reader-summary-pulse short" />
                            <div className="reader-summary-pulse" />
                          </div>
                        )}
                        {summaryState === 'done' && (
                          <div className="reader-summary-content">{summaryText}</div>
                        )}
                        {summaryState === 'error' && (
                          <div className="reader-summary-error">{summaryError}</div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="reader-divider" />

            {/* Full content loading indicator */}
            {fullContentStatus === 'loading' && (
              <div className="reader-fullcontent-banner loading">
                <span className="btn-spinner" />
                <span>Récupération de l'article complet...</span>
              </div>
            )}

            {/* Full content error with retry */}
            {fullContentStatus === 'error' && (
              <div className="reader-fullcontent-banner error">
                <span>Impossible de récupérer l'article complet</span>
                <button className="reader-fullcontent-btn" onClick={handleFetchFullContent}>
                  Réessayer
                </button>
              </div>
            )}

            {showTranslation && translateState === 'loading' && (
              <div className="reader-fullcontent-banner loading">
                <span className="btn-spinner" />
                <span>Traduction en cours...</span>
              </div>
            )}
            {showTranslation && translateState === 'error' && (
              <div className="reader-fullcontent-banner error">
                <span>{translateError}</span>
                <button className="reader-fullcontent-btn" onClick={handleTranslate}>
                  Réessayer
                </button>
              </div>
            )}

            <div
              className="reader-body"
              ref={readerBodyRef}
              onMouseUp={isPro ? handleTextSelection : undefined}
              dangerouslySetInnerHTML={{ __html: showTranslation && translateState === 'done' ? translatedHtml : processedHtml }}
            />

            {/* Manual fetch button when content seems ok but user wants full version */}
            {!skipExtraction && fullContentStatus === 'not-needed' && hasValidUrl && (
              <div className="reader-fullcontent-fetch">
                <button className="reader-fullcontent-btn" onClick={handleFetchFullContent}>
                  ↻ Récupérer depuis le site original
                </button>
              </div>
            )}

            {item.source === 'reddit' && redditComments.length > 0 && (
              <section className="reader-comments-section">
                <div className="reader-comments-header">
                  <h2 className="reader-comments-title">Commentaires</h2>
                  <span className="reader-comments-badge">
                    {formatCommentCount(displayedCommentCount ?? redditComments.length)}
                  </span>
                  {redditCommentsState.status === 'loading' && (
                    <span className="reader-comments-status">Chargement en direct...</span>
                  )}
                </div>
                {redditCommentsState.status === 'error' && (
                  <p className="reader-comments-error">
                    Impossible de charger les commentaires en direct (accès direct et proxy). Affichage des données locales.
                  </p>
                )}
                <div className="reader-comments-list">
                  {redditComments.map((comment) => (
                    <article key={comment.id} className="reader-comment-card">
                      <div className="reader-comment-meta">
                        <span className="reader-comment-author">{comment.author}</span>
                        <span className="reader-meta-dot">·</span>
                        <span className="reader-comment-score">{comment.score} points</span>
                        <span className="reader-meta-dot">·</span>
                        <time className="reader-comment-time">{formatCommentTime(comment.publishedAt)}</time>
                      </div>
                      <p className="reader-comment-body">{comment.body}</p>
                    </article>
                  ))}
                </div>
              </section>
            )}
            {item.source === 'reddit' && redditComments.length === 0 && (
              <section className="reader-comments-section">
                <div className="reader-comments-header">
                  <h2 className="reader-comments-title">Commentaires</h2>
                  {redditCommentsState.status === 'loading' && (
                    <span className="reader-comments-status">Chargement en direct...</span>
                  )}
                </div>
                <p className="reader-comments-empty">Aucun commentaire disponible pour ce post.</p>
              </section>
            )}

            {hasValidUrl && (
              <div className="reader-footer">
                <button className="reader-original-link" onClick={handleOpenExternal}>
                  Ouvrir dans le navigateur ↗
                </button>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      )}

      {/* Webview mode */}
      {viewMode === 'web' && hasValidUrl && (
        <div className="webview-container">
          {/* Loading overlay */}
          <AnimatePresence>
            {iframeStatus === 'loading' && (
              <motion.div
                className="webview-loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <div className="webview-loading-bar" />
                <div className="webview-loading-content">
                  <span className="webview-loading-spinner" />
                  <span className="webview-loading-text">Chargement de la page...</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error state — fetch failed */}
          <AnimatePresence>
            {(iframeStatus === 'blocked' || iframeStatus === 'error') && (
              <motion.div
                className="webview-error"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                <span className="webview-error-icon">⊘</span>
                <h3 className="webview-error-title">Page non disponible</h3>
                <p className="webview-error-text">
                  Impossible de charger cette page.
                </p>
                <div className="webview-error-actions">
                  <button className="webview-error-btn primary" onClick={handleOpenExternal}>
                    Ouvrir dans le navigateur ↗
                  </button>
                  <button className="webview-error-btn" onClick={handleReaderView}>
                    Retour au mode lecture
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Floating action bar — always visible when loaded, in case iframe looks blank */}
          <AnimatePresence>
            {iframeStatus === 'loaded' && (
              <motion.div
                className="webview-floating-bar"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.25, delay: 0.5 }}
              >
                <span className="webview-floating-text">
                  La page ne s'affiche pas ?
                </span>
                <button className="webview-floating-btn" onClick={handleOpenExternal}>
                  Ouvrir dans le navigateur ↗
                </button>
                <button className="webview-floating-btn secondary" onClick={handleReaderView}>
                  Mode lecture
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {webHtml && (
            <iframe
              ref={iframeRef}
              className="webview-iframe"
              srcDoc={webHtml}
              title={item.title}
              sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
              referrerPolicy="no-referrer"
              onLoad={handleIframeLoad}
              onError={handleIframeError}
            />
          )}
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
        </div>
      )}
    </div>
  );
}
