import { httpRequest } from '../../lib/tauriFetch';
import type { RSSProvider, ProviderConfig, ProviderFeed, ProviderEntry } from './types';

/**
 * Feedbin provider — REST v2 API
 * Auth: HTTP Basic (base64-encoded username:password)
 * Docs: https://github.com/feedbin/feedbin-api
 */
export class FeedbinProvider implements RSSProvider {
  private baseUrl = 'https://api.feedbin.com/v2';
  private authHeader: string;

  constructor(config: ProviderConfig) {
    const username = config.credentials.username || '';
    const password = config.credentials.password || '';
    // btoa is available in browsers and Tauri webview
    this.authHeader = 'Basic ' + btoa(`${username}:${password}`);
  }

  private async request(method: string, path: string, body?: unknown): Promise<{ status: number; body: string }> {
    const headers: Record<string, string> = {
      'Authorization': this.authHeader,
      'Content-Type': 'application/json; charset=utf-8',
    };

    const resp = await httpRequest({
      method,
      url: `${this.baseUrl}${path}`,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (resp.status >= 400) {
      throw new Error(`Feedbin API error: HTTP ${resp.status} — ${resp.body}`);
    }

    return resp;
  }

  async testConnection(): Promise<boolean> {
    try {
      const resp = await this.request('GET', '/authentication.json');
      return resp.status === 200;
    } catch {
      return false;
    }
  }

  async getFeeds(): Promise<ProviderFeed[]> {
    const resp = await this.request('GET', '/subscriptions.json');
    const subs: Array<{
      id: number;
      feed_id: number;
      title: string;
      feed_url: string;
      site_url: string;
    }> = JSON.parse(resp.body);

    // Also get taggings for category info
    let taggings: Array<{ feed_id: number; name: string }> = [];
    try {
      const tagResp = await this.request('GET', '/taggings.json');
      taggings = JSON.parse(tagResp.body);
    } catch { /* ignore */ }

    const feedCategoryMap = new Map<number, string>();
    for (const tag of taggings) {
      feedCategoryMap.set(tag.feed_id, tag.name);
    }

    return subs.map(sub => ({
      remoteId: String(sub.feed_id),
      title: sub.title,
      feedUrl: sub.feed_url,
      siteUrl: sub.site_url,
      category: feedCategoryMap.get(sub.feed_id),
    }));
  }

  async getUnreadIds(): Promise<string[]> {
    const resp = await this.request('GET', '/unread_entries.json');
    const ids: number[] = JSON.parse(resp.body);
    return ids.map(String);
  }

  async getStarredIds(): Promise<string[]> {
    const resp = await this.request('GET', '/starred_entries.json');
    const ids: number[] = JSON.parse(resp.body);
    return ids.map(String);
  }

  async getEntries(opts?: { since?: string; limit?: number }): Promise<ProviderEntry[]> {
    let path = '/entries.json?per_page=' + (opts?.limit || 100);
    if (opts?.since) {
      path += `&since=${encodeURIComponent(opts.since)}`;
    }

    const resp = await this.request('GET', path);
    const entries: Array<{
      id: number;
      feed_id: number;
      title: string;
      url: string;
      author: string | null;
      content: string | null;
      published: string;
    }> = JSON.parse(resp.body);

    return entries.map(e => ({
      remoteId: String(e.id),
      feedRemoteId: String(e.feed_id),
      title: e.title || '',
      url: e.url,
      author: e.author || undefined,
      content: e.content || undefined,
      publishedAt: new Date(e.published),
    }));
  }

  async markAsRead(remoteIds: string[]): Promise<void> {
    if (remoteIds.length === 0) return;
    // Feedbin: DELETE /unread_entries.json with entry_ids
    await this.request('DELETE', '/unread_entries.json', {
      unread_entries: remoteIds.map(Number),
    });
  }

  async markAsUnread(remoteIds: string[]): Promise<void> {
    if (remoteIds.length === 0) return;
    // Feedbin: POST /unread_entries.json with entry_ids
    await this.request('POST', '/unread_entries.json', {
      unread_entries: remoteIds.map(Number),
    });
  }

  async starEntries(remoteIds: string[]): Promise<void> {
    if (remoteIds.length === 0) return;
    await this.request('POST', '/starred_entries.json', {
      starred_entries: remoteIds.map(Number),
    });
  }

  async unstarEntries(remoteIds: string[]): Promise<void> {
    if (remoteIds.length === 0) return;
    await this.request('DELETE', '/starred_entries.json', {
      starred_entries: remoteIds.map(Number),
    });
  }
}
