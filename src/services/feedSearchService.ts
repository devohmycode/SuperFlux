import { fetchViaBackend } from '../lib/tauriFetch';
import type { FeedSource } from '../types';

export interface FeedSearchResult {
  name: string;
  description: string;
  imageUrl?: string;
  feedUrl: string;
  meta?: string;
}

const SEARCHABLE_SOURCES: FeedSource[] = ['article', 'podcast', 'reddit'];

export function isSearchableSource(source: FeedSource): boolean {
  return SEARCHABLE_SOURCES.includes(source);
}

export const searchLabels: Partial<Record<FeedSource, string>> = {
  article: 'Rechercher un flux',
  podcast: 'Rechercher un podcast',
  reddit: 'Rechercher un subreddit',
};

export async function searchFeeds(query: string, source: FeedSource): Promise<FeedSearchResult[]> {
  switch (source) {
    case 'article': return searchArticleFeeds(query);
    case 'podcast': return searchPodcasts(query);
    case 'reddit': return searchSubreddits(query);
    default: return [];
  }
}

async function searchArticleFeeds(query: string): Promise<FeedSearchResult[]> {
  const url = `https://cloud.feedly.com/v3/search/feeds?query=${encodeURIComponent(query)}&count=10`;
  const raw = await fetchViaBackend(url);
  const data = JSON.parse(raw);
  return (data.results ?? [])
    .filter((r: any) => r.feedId)
    .map((r: any) => ({
      name: r.title || r.website || '',
      description: r.description?.slice(0, 80) || r.website || '',
      imageUrl: r.iconUrl || r.visualUrl || undefined,
      feedUrl: r.feedId.replace(/^feed\//, ''),
      meta: r.subscribers ? `${formatNumber(r.subscribers)} abonnés` : undefined,
    }));
}

async function searchPodcasts(query: string): Promise<FeedSearchResult[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=podcast&limit=10`;
  const raw = await fetchViaBackend(url);
  const data = JSON.parse(raw);
  return (data.results ?? [])
    .filter((r: any) => r.feedUrl)
    .map((r: any) => ({
      name: r.collectionName,
      description: r.artistName,
      imageUrl: r.artworkUrl100,
      feedUrl: r.feedUrl,
      meta: r.trackCount > 0 ? `${r.trackCount} ep.` : undefined,
    }));
}

async function searchSubreddits(query: string): Promise<FeedSearchResult[]> {
  const url = `https://www.reddit.com/subreddits/search.json?q=${encodeURIComponent(query)}&limit=10`;
  const raw = await fetchViaBackend(url);
  const data = JSON.parse(raw);
  return (data.data?.children ?? [])
    .map((child: any) => child.data)
    .filter((r: any) => r.display_name)
    .map((r: any) => ({
      name: `r/${r.display_name}`,
      description: r.public_description?.slice(0, 80) || r.title || '',
      imageUrl: cleanRedditIcon(r.community_icon || r.icon_img),
      feedUrl: `https://www.reddit.com/r/${r.display_name}/.rss`,
      meta: r.subscribers ? `${formatNumber(r.subscribers)} membres` : undefined,
    }));
}

function cleanRedditIcon(url: string | undefined): string | undefined {
  if (!url) return undefined;
  // Reddit icon URLs often have query params and HTML entities
  const cleaned = url.split('?')[0].replace(/&amp;/g, '&');
  return cleaned || undefined;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
