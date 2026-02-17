export type ProviderType = 'miniflux' | 'freshrss' | 'feedbin' | 'bazqux';

export interface ProviderConfig {
  type: ProviderType;
  baseUrl: string;
  credentials: {
    apiKey?: string;       // Miniflux
    username?: string;     // Feedbin, FreshRSS, BazQux
    password?: string;
  };
  authToken?: string;      // Google Reader token (FreshRSS/BazQux)
  syncEnabled?: boolean;
}

export interface ProviderFeed {
  remoteId: string;
  title: string;
  feedUrl: string;
  siteUrl?: string;
  category?: string;
}

export interface ProviderEntry {
  remoteId: string;
  feedRemoteId: string;
  title: string;
  url: string;
  author?: string;
  content?: string;
  publishedAt: Date;
}

export interface RSSProvider {
  testConnection(): Promise<boolean>;
  getFeeds(): Promise<ProviderFeed[]>;
  getUnreadIds(): Promise<string[]>;
  getStarredIds(): Promise<string[]>;
  getEntries(opts?: { since?: string; limit?: number }): Promise<ProviderEntry[]>;
  markAsRead(remoteIds: string[]): Promise<void>;
  markAsUnread(remoteIds: string[]): Promise<void>;
  starEntries(remoteIds: string[]): Promise<void>;
  unstarEntries(remoteIds: string[]): Promise<void>;
}
