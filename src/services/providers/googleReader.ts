import { httpRequest } from '../../lib/tauriFetch';
import type { RSSProvider, ProviderConfig, ProviderFeed, ProviderEntry } from './types';

/**
 * Google Reader API provider — used by FreshRSS and BazQux
 * Auth: ClientLogin → SID/Auth token
 *
 * FreshRSS: baseUrl = "{user_url}/api/greader.php"
 * BazQux:   baseUrl = "https://www.bazqux.com/reader"
 */
export class GoogleReaderProvider implements RSSProvider {
  private baseUrl: string;
  private username: string;
  private password: string;
  private authToken: string;
  private providerType: 'freshrss' | 'bazqux';

  constructor(config: ProviderConfig) {
    this.providerType = config.type as 'freshrss' | 'bazqux';
    this.username = config.credentials.username || '';
    this.password = config.credentials.password || '';
    this.authToken = config.authToken || '';

    if (this.providerType === 'bazqux') {
      this.baseUrl = 'https://www.bazqux.com/reader';
    } else {
      // FreshRSS: user provides their server URL
      this.baseUrl = config.baseUrl.replace(/\/+$/, '') + '/api/greader.php';
    }
  }

  private async login(): Promise<string> {
    const loginUrl = this.providerType === 'bazqux'
      ? 'https://www.bazqux.com/accounts/ClientLogin'
      : `${this.baseUrl.replace('/api/greader.php', '')}/api/greader.php/accounts/ClientLogin`;

    const body = `Email=${encodeURIComponent(this.username)}&Passwd=${encodeURIComponent(this.password)}`;

    const resp = await httpRequest({
      method: 'POST',
      url: loginUrl,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (resp.status !== 200) {
      throw new Error(`Login failed: HTTP ${resp.status}`);
    }

    // Parse key=value response
    const lines = resp.body.split('\n');
    for (const line of lines) {
      if (line.startsWith('Auth=')) {
        this.authToken = line.substring(5);
        return this.authToken;
      }
    }

    throw new Error('No Auth token in login response');
  }

  private async ensureAuth(): Promise<void> {
    if (!this.authToken) {
      await this.login();
    }
  }

  private async request(method: string, path: string, body?: string, contentType?: string): Promise<{ status: number; body: string }> {
    await this.ensureAuth();

    const headers: Record<string, string> = {
      'Authorization': `GoogleLogin auth=${this.authToken}`,
    };
    if (contentType) {
      headers['Content-Type'] = contentType;
    }

    const url = `${this.baseUrl}${path}`;
    const resp = await httpRequest({ method, url, headers, body });

    // If 401, try re-login once
    if (resp.status === 401) {
      await this.login();
      headers['Authorization'] = `GoogleLogin auth=${this.authToken}`;
      const retry = await httpRequest({ method, url, headers, body });
      if (retry.status >= 400) {
        throw new Error(`Google Reader API error: HTTP ${retry.status}`);
      }
      return retry;
    }

    if (resp.status >= 400) {
      throw new Error(`Google Reader API error: HTTP ${resp.status} — ${resp.body}`);
    }

    return resp;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.login();
      const resp = await this.request('GET', '/api/0/user-info?output=json');
      return resp.status === 200;
    } catch {
      return false;
    }
  }

  async getFeeds(): Promise<ProviderFeed[]> {
    const resp = await this.request('GET', '/api/0/subscription/list?output=json');
    const data: {
      subscriptions: Array<{
        id: string;
        title: string;
        url: string;
        htmlUrl?: string;
        categories?: Array<{ label: string }>;
      }>;
    } = JSON.parse(resp.body);

    return data.subscriptions.map(sub => ({
      remoteId: sub.id,
      title: sub.title,
      feedUrl: sub.url,
      siteUrl: sub.htmlUrl,
      category: sub.categories?.[0]?.label,
    }));
  }

  async getUnreadIds(): Promise<string[]> {
    const resp = await this.request(
      'GET',
      '/api/0/stream/items/ids?output=json&s=user/-/state/com.google/reading-list&xt=user/-/state/com.google/read&n=10000'
    );
    const data: { itemRefs?: Array<{ id: string }> } = JSON.parse(resp.body);
    return (data.itemRefs || []).map(ref => ref.id);
  }

  async getStarredIds(): Promise<string[]> {
    const resp = await this.request(
      'GET',
      '/api/0/stream/items/ids?output=json&s=user/-/state/com.google/starred&n=10000'
    );
    const data: { itemRefs?: Array<{ id: string }> } = JSON.parse(resp.body);
    return (data.itemRefs || []).map(ref => ref.id);
  }

  async getEntries(opts?: { since?: string; limit?: number }): Promise<ProviderEntry[]> {
    let path = '/api/0/stream/contents/user/-/state/com.google/reading-list?output=json';
    path += `&n=${opts?.limit || 100}`;
    if (opts?.since) {
      const ts = Math.floor(new Date(opts.since).getTime() / 1000);
      path += `&ot=${ts}`;
    }

    const resp = await this.request('GET', path);
    const data: {
      items: Array<{
        id: string;
        origin?: { streamId: string };
        title: string;
        canonical?: Array<{ href: string }>;
        alternate?: Array<{ href: string }>;
        author?: string;
        summary?: { content: string };
        content?: { content: string };
        published?: number;
      }>;
    } = JSON.parse(resp.body);

    return data.items.map(item => ({
      remoteId: item.id,
      feedRemoteId: item.origin?.streamId || '',
      title: item.title,
      url: item.canonical?.[0]?.href || item.alternate?.[0]?.href || '',
      author: item.author,
      content: item.content?.content || item.summary?.content || '',
      publishedAt: new Date((item.published || 0) * 1000),
    }));
  }

  private async getToken(): Promise<string> {
    const resp = await this.request('GET', '/api/0/token');
    return resp.body.trim();
  }

  async markAsRead(remoteIds: string[]): Promise<void> {
    if (remoteIds.length === 0) return;
    const token = await this.getToken();
    const params = remoteIds.map(id => `i=${encodeURIComponent(id)}`).join('&');
    await this.request(
      'POST',
      '/api/0/edit-tag',
      `${params}&a=user/-/state/com.google/read&T=${token}`,
      'application/x-www-form-urlencoded'
    );
  }

  async markAsUnread(remoteIds: string[]): Promise<void> {
    if (remoteIds.length === 0) return;
    const token = await this.getToken();
    const params = remoteIds.map(id => `i=${encodeURIComponent(id)}`).join('&');
    await this.request(
      'POST',
      '/api/0/edit-tag',
      `${params}&r=user/-/state/com.google/read&T=${token}`,
      'application/x-www-form-urlencoded'
    );
  }

  async starEntries(remoteIds: string[]): Promise<void> {
    if (remoteIds.length === 0) return;
    const token = await this.getToken();
    const params = remoteIds.map(id => `i=${encodeURIComponent(id)}`).join('&');
    await this.request(
      'POST',
      '/api/0/edit-tag',
      `${params}&a=user/-/state/com.google/starred&T=${token}`,
      'application/x-www-form-urlencoded'
    );
  }

  async unstarEntries(remoteIds: string[]): Promise<void> {
    if (remoteIds.length === 0) return;
    const token = await this.getToken();
    const params = remoteIds.map(id => `i=${encodeURIComponent(id)}`).join('&');
    await this.request(
      'POST',
      '/api/0/edit-tag',
      `${params}&r=user/-/state/com.google/starred&T=${token}`,
      'application/x-www-form-urlencoded'
    );
  }
}
