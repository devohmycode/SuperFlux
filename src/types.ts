export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'orange';

export interface TextHighlight {
  id: string;
  text: string;
  color: HighlightColor;
  prefix: string;
  suffix: string;
  note: string;
  createdAt: string;
}

export type FeedSource = 'article' | 'reddit' | 'youtube' | 'twitter' | 'mastodon' | 'podcast';
export type SummaryFormat = 'bullets' | 'paragraph';

export interface Feed {
  id: string;
  name: string;
  source: FeedSource;
  icon: string;
  url: string;
  unreadCount: number;
  color: string;
  updated_at?: string;
  folder?: string;
  remoteId?: string;       // ID du feed côté provider
  providerType?: string;   // 'miniflux' | 'freshrss' | etc.
}

export interface FeedItem {
  id: string;
  feedId: string;
  title: string;
  excerpt: string;
  content: string;
  fullContent?: string;
  author: string;
  publishedAt: Date;
  readTime?: number;
  thumbnail?: string;
  url: string;
  isRead: boolean;
  isStarred: boolean;
  isBookmarked: boolean;
  source: FeedSource;
  feedName: string;
  summary?: string;
  tags?: string[];
  commentCount?: number;
  commentsUrl?: string;
  comments?: FeedComment[];
  enclosureUrl?: string;
  enclosureType?: string;
  duration?: number;
  updated_at?: string;
  remoteId?: string;       // ID de l'entrée côté provider
  remoteFeedId?: string;   // ID du feed côté provider
}

export interface FeedComment {
  id: string;
  author: string;
  body: string;
  score: number;
  publishedAt: Date;
}

export interface FeedCategory {
  id: string;
  label: string;
  source: FeedSource;
  feeds: Feed[];
  folders: string[];
}
