import { invoke } from '@tauri-apps/api/core';

export const isTauri = '__TAURI_INTERNALS__' in window;

const PROXY_URL = 'http://localhost:3001/?url=';

export async function fetchViaBackend(url: string): Promise<string> {
  if (isTauri) {
    return invoke<string>('fetch_url', { targetUrl: url });
  }
  // Fallback to proxy for pure browser dev
  const response = await fetch(`${PROXY_URL}${encodeURIComponent(url)}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.text();
}

export interface HttpRequestOptions {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface HttpResponseData {
  status: number;
  body: string;
  headers: Record<string, string>;
}

const PROXY_API_URL = 'http://localhost:3001/api';

export async function httpRequest(opts: HttpRequestOptions): Promise<HttpResponseData> {
  if (isTauri) {
    return invoke<HttpResponseData>('http_request', {
      method: opts.method,
      url: opts.url,
      headers: opts.headers || {},
      body: opts.body ?? null,
    });
  }
  // Fallback to proxy for pure browser dev
  const response = await fetch(PROXY_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: opts.method,
      url: opts.url,
      headers: opts.headers || {},
      body: opts.body,
    }),
  });
  if (!response.ok) {
    throw new Error(`Proxy error: HTTP ${response.status}`);
  }
  return response.json();
}

/** Open a URL in the system's default browser (not inside Tauri) */
export async function openExternal(url: string): Promise<void> {
  if (isTauri) {
    await invoke('open_external', { url });
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
