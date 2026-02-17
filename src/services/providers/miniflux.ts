import { httpRequest } from '../../lib/tauriFetch';
import type { RSSProvider, ProviderConfig, ProviderFeed, ProviderEntry } from './types';

/**
 * Miniflux provider — REST v1 API
 * Auth: X-Auth-Token header with API key
 * Docs: https://miniflux.app/docs/api.html
 */
export class MinifluxProvider implements RSSProvider {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: ProviderConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.credentials.apiKey || '';
  }

  private async request(method: string, path: string, body?: unknown): Promise<{ status: number; body: string }> {
    const headers: Record<string, string> = {
      'X-Auth-Token': this.apiKey,
      'Content-Type': 'application/json',
    };

    const resp = await httpRequest({
      method,
      url: `${this.baseUrl}/v1${path}`,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (resp.status >= 400) {
      throw new Error(`Miniflux API error: HTTP ${resp.status} — ${resp.body}`);
    }

    return resp;
  }

  async testConnection(): Promise<boolean> {
    try {
      const resp = await this.request('GET', '/me');
      return resp.status === 200;
    } catch {
      return false;
    }
  }

  async getFeeds(): Promise<ProviderFeed[]> {
    const resp = await this.request('GET', '/feeds');
    const feeds: Array<{
      id: number;
      title: string;
      feed_url: string;
      site_url: string;
      category?: { title: string };
    }> = JSON.parse(resp.body);

    return feeds.map(f => ({
      remoteId: String(f.id),
      title: f.title,
      feedUrl: f.feed_url,
      siteUrl: f.site_url,
      category: f.category?.title,
    }));
  }

  async getUnreadIds(): Promise<string[]> {
    // Miniflux: get all unread entries (paginated)
    const ids: string[] = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const resp = await this.request('GET', `/entries?status=unread&limit=${limit}&offset=${offset}&direction=desc`);
      const data: { total: number; entries: Array<{ id: number }> } = JSON.parse(resp.body);

      for (const entry of data.entries) {
        ids.push(String(entry.id));
      }

      if (ids.length >= data.total || data.entries.length < limit) break;
      offset += limit;
    }

    return ids;
  }

  async getStarredIds(): Promise<string[]> {
    const ids: string[] = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const resp = await this.request('GET', `/entries?starred=true&limit=${limit}&offset=${offset}&direction=desc`);
      const data: { total: number; entries: Array<{ id: number }> } = JSON.parse(resp.body);

      for (const entry of data.entries) {
        ids.push(String(entry.id));
      }

      if (ids.length >= data.total || data.entries.length < limit) break;
      offset += limit;
    }

    return ids;
  }

  async getEntries(opts?: { since?: string; limit?: number }): Promise<ProviderEntry[]> {
    let path = `/entries?direction=desc&limit=${opts?.limit || 100}`;
    if (opts?.since) {
      // Miniflux uses Unix timestamps for after parameter
      const ts = Math.floor(new Date(opts.since).getTime() / 1000);
      path += `&after=${ts}`;
    }

    const resp = await this.request('GET', path);
    const data: {
      entries: Array<{
        id: number;
        feed_id: number;
        title: string;
        url: string;
        author: string;
        content: string;
        published_at: string;
      }>;
    } = JSON.parse(resp.body);

    return data.entries.map(e => ({
      remoteId: String(e.id),
      feedRemoteId: String(e.feed_id),
      title: e.title,
      url: e.url,
      author: e.author,
      content: e.content,
      publishedAt: new Date(e.published_at),
    }));
  }

  async markAsRead(remoteIds: string[]): Promise<void> {
    if (remoteIds.length === 0) return;
    await this.request('PUT', '/entries', {
      entry_ids: remoteIds.map(Number),
      status: 'read',
    });
  }

  async markAsUnread(remoteIds: string[]): Promise<void> {
    if (remoteIds.length === 0) return;
    await this.request('PUT', '/entries', {
      entry_ids: remoteIds.map(Number),
      status: 'unread',
    });
  }

  async starEntries(remoteIds: string[]): Promise<void> {
    // Miniflux: toggle star per entry
    for (const id of remoteIds) {
      await this.request('PUT', `/entries/${id}/bookmark`);
    }
  }

  async unstarEntries(remoteIds: string[]): Promise<void> {
    // Miniflux toggle — same endpoint, acts as toggle
    for (const id of remoteIds) {
      await this.request('PUT', `/entries/${id}/bookmark`);
    }
  }
}
