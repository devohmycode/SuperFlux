import type { Feed, FeedItem, FeedSource } from '../types';
import { fetchViaBackend } from '../lib/tauriFetch';

const SYNDICATION_URL = 'https://syndication.twitter.com/srv/timeline-profile/screen-name/';

interface RSSChannel {
  title: string;
  link: string;
  description: string;
  items: RSSItem[];
}

interface RSSItem {
  title: string;
  link: string;
  description: string;
  pubDate?: string;
  author?: string;
  content?: string;
  guid?: string;
  enclosure?: { url: string; type: string; length: number };
  duration?: number;
  thumbnail?: string;
}

function parseXML(xmlString: string): Document {
  const parser = new DOMParser();
  return parser.parseFromString(xmlString, 'text/xml');
}

function getTextContent(parent: Element, tagName: string): string {
  const el = parent.querySelector(tagName);
  return el?.textContent?.trim() || '';
}

function parseRSSDate(dateStr: string): Date {
  if (!dateStr) return new Date();
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

function extractContent(item: Element): string {
  // Try content:encoded first (common in RSS feeds)
  const contentEncoded = item.getElementsByTagName('content:encoded')[0];
  if (contentEncoded?.textContent) return contentEncoded.textContent;
  
  // Try media:description for YouTube
  const mediaDesc = item.getElementsByTagName('media:description')[0];
  if (mediaDesc?.textContent) return `<p>${mediaDesc.textContent}</p>`;
  
  // Fall back to description
  return getTextContent(item, 'description');
}

function estimateReadTime(content: string): number {
  const text = content.replace(/<[^>]*>/g, '');
  const words = text.split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 200));
}

function parseDuration(raw: string): number {
  const trimmed = raw.trim();
  // Pure number (seconds)
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  // HH:MM:SS or MM:SS
  const parts = trimmed.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function parseEnclosure(item: Element): { url: string; type: string; length: number } | undefined {
  const enc = item.querySelector('enclosure');
  if (!enc) return undefined;
  const url = enc.getAttribute('url') || '';
  const type = enc.getAttribute('type') || '';
  const length = parseInt(enc.getAttribute('length') || '0', 10);
  if (!url) return undefined;
  return { url, type, length };
}

function parseItunesData(item: Element): { duration?: number; thumbnail?: string } {
  const durationEl = item.getElementsByTagName('itunes:duration')[0];
  const imageEl = item.getElementsByTagName('itunes:image')[0];
  return {
    duration: durationEl?.textContent ? parseDuration(durationEl.textContent) : undefined,
    thumbnail: imageEl?.getAttribute('href') || undefined,
  };
}

function parseRSSFeed(xml: Document): RSSChannel {
  const channel = xml.querySelector('channel');
  if (!channel) {
    // Try Atom format
    return parseAtomFeed(xml);
  }

  const items = Array.from(channel.querySelectorAll('item')).map(item => {
    const enclosure = parseEnclosure(item);
    const itunes = parseItunesData(item);
    return {
      title: getTextContent(item, 'title'),
      link: getTextContent(item, 'link'),
      description: getTextContent(item, 'description'),
      pubDate: getTextContent(item, 'pubDate'),
      author: getTextContent(item, 'author') || getTextContent(item, 'dc\\:creator'),
      content: extractContent(item),
      guid: getTextContent(item, 'guid') || getTextContent(item, 'link'),
      enclosure,
      duration: itunes.duration,
      thumbnail: itunes.thumbnail,
    };
  });

  return {
    title: getTextContent(channel, 'title'),
    link: getTextContent(channel, 'link'),
    description: getTextContent(channel, 'description'),
    items,
  };
}

function parseAtomFeed(xml: Document): RSSChannel {
  const feed = xml.querySelector('feed');
  if (!feed) throw new Error('Invalid feed format');

  const items = Array.from(feed.querySelectorAll('entry')).map(entry => {
    const linkEl = entry.querySelector('link[rel="alternate"]') || entry.querySelector('link');
    const link = linkEl?.getAttribute('href') || '';
    
    return {
      title: getTextContent(entry, 'title'),
      link,
      description: getTextContent(entry, 'summary'),
      pubDate: getTextContent(entry, 'published') || getTextContent(entry, 'updated'),
      author: entry.querySelector('author name')?.textContent || '',
      content: getTextContent(entry, 'content') || getTextContent(entry, 'summary'),
      guid: getTextContent(entry, 'id') || link,
    };
  });

  const linkEl = feed.querySelector('link[rel="alternate"]') || feed.querySelector('link');
  
  return {
    title: getTextContent(feed, 'title'),
    link: linkEl?.getAttribute('href') || '',
    description: getTextContent(feed, 'subtitle'),
    items,
  };
}

async function resolveYouTubeRSS(url: string): Promise<string> {
  const match = url.match(/youtube\.com\/(@[\w.-]+|channel\/(UC[\w-]+))/i);
  if (!match) return url;

  // Already a channel ID URL — build RSS directly
  if (match[2]) {
    return `https://www.youtube.com/feeds/videos.xml?channel_id=${match[2]}`;
  }

  // @username — need to fetch the page and extract the channel ID
  const html = await fetchViaBackend(url);

  // Try JSON pattern first: "channelId":"UC..."
  const jsonMatch = html.match(/"channelId"\s*:\s*"(UC[\w-]+)"/);
  if (jsonMatch) {
    return `https://www.youtube.com/feeds/videos.xml?channel_id=${jsonMatch[1]}`;
  }

  // Try meta tag: <meta itemprop="channelId" content="UC...">
  const metaMatch = html.match(/<meta\s[^>]*itemprop="channelId"[^>]*content="(UC[\w-]+)"/);
  if (metaMatch) {
    return `https://www.youtube.com/feeds/videos.xml?channel_id=${metaMatch[1]}`;
  }

  // Try externalId pattern
  const extMatch = html.match(/"externalId"\s*:\s*"(UC[\w-]+)"/);
  if (extMatch) {
    return `https://www.youtube.com/feeds/videos.xml?channel_id=${extMatch[1]}`;
  }

  throw new Error('Could not resolve YouTube channel ID from page');
}

// Extract Twitter username from various URL formats
function extractTwitterUsername(url: string): string | null {
  // rsshub://twitter/user/USERNAME
  const rsshubMatch = url.match(/^rsshub:\/\/twitter\/user\/([A-Za-z0-9_]+)/);
  if (rsshubMatch) return rsshubMatch[1];

  // twitter.com/@user or x.com/user
  const match = url.match(/(?:twitter\.com|x\.com)\/@?([A-Za-z0-9_]+)\/?$/i);
  if (match) return match[1];

  // nitter instances
  const nitterMatch = url.match(/nitter\.[^/]+\/([A-Za-z0-9_]+)/i);
  if (nitterMatch) return nitterMatch[1];

  return null;
}

interface SyndicationTweet {
  id_str: string;
  text: string;
  full_text?: string;
  created_at: string;
  permalink: string;
  favorite_count: number;
  retweet_count: number;
  reply_count: number;
  user: {
    name: string;
    screen_name: string;
    profile_image_url_https: string;
  };
  entities?: {
    urls?: { url: string; expanded_url: string; display_url: string }[];
    media?: { media_url_https: string; type: string }[];
  };
  in_reply_to_screen_name?: string;
}

async function fetchWithRetry(url: string, retries = 3, delay = 2000): Promise<string> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fetchViaBackend(url);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('429')) throw e;
      if (i < retries - 1) {
        await new Promise(r => setTimeout(r, delay * (i + 1)));
      }
    }
  }
  throw new Error('Twitter rate limit exceeded — please wait a moment and try again');
}

async function fetchTwitterSyndication(username: string): Promise<RSSChannel> {
  const url = `${SYNDICATION_URL}${username}`;
  const html = await fetchWithRetry(url);
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('Could not parse Twitter syndication response');
  }

  const data = JSON.parse(match[1]);
  const entries = data?.props?.pageProps?.timeline?.entries;
  if (!entries || !Array.isArray(entries)) {
    throw new Error('No timeline entries found');
  }

  const items: RSSItem[] = entries
    .filter((e: { type: string; content?: { tweet?: SyndicationTweet } }) =>
      e.type === 'tweet' && e.content?.tweet && !e.content.tweet.in_reply_to_screen_name
    )
    .map((e: { content: { tweet: SyndicationTweet } }) => {
      const t = e.content.tweet;
      let text = t.full_text || t.text || '';

      // Expand shortened URLs in text
      if (t.entities?.urls) {
        for (const u of t.entities.urls) {
          text = text.replace(u.url, u.expanded_url);
        }
      }

      // Build content HTML
      let contentHtml = `<p>${text.replace(/\n/g, '<br/>')}</p>`;
      if (t.entities?.media) {
        for (const m of t.entities.media) {
          if (m.type === 'photo') {
            contentHtml += `<img src="${m.media_url_https}" />`;
          }
        }
      }

      // Title: first line or first 100 chars
      const firstLine = text.split('\n')[0];
      const title = firstLine.length > 100 ? firstLine.slice(0, 97) + '...' : firstLine;

      return {
        title,
        link: `https://x.com${t.permalink}`,
        description: text,
        pubDate: t.created_at,
        author: `@${t.user.screen_name}`,
        content: contentHtml,
        guid: t.id_str,
      };
    });

  const firstTweet = entries.find(
    (e: { type: string; content?: { tweet?: SyndicationTweet } }) => e.type === 'tweet' && e.content?.tweet
  )?.content?.tweet;

  return {
    title: firstTweet?.user?.name || `@${username}`,
    link: `https://x.com/${username}`,
    description: `Tweets de @${username}`,
    items,
  };
}

/** Convert Reddit URLs to old.reddit.com with .rss suffix for reliable fetching */
function resolveRedditRSS(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes('reddit.com')) return url;

    // Switch to old.reddit.com (less aggressive blocking)
    parsed.hostname = 'old.reddit.com';

    // Ensure path ends with .rss
    let path = parsed.pathname.replace(/\/+$/, ''); // trim trailing slashes
    if (!path.endsWith('.rss') && !path.endsWith('.json')) {
      path += '/.rss';
    }
    parsed.pathname = path;

    return parsed.toString();
  } catch {
    return url;
  }
}

export async function fetchFeed(url: string): Promise<RSSChannel> {
  // Twitter: use Syndication API
  const twitterUser = extractTwitterUsername(url);
  if (twitterUser) {
    return fetchTwitterSyndication(twitterUser);
  }

  // Reddit: use old.reddit.com + .rss for reliability
  let resolvedUrl = resolveRedditRSS(url);
  resolvedUrl = await resolveYouTubeRSS(resolvedUrl);
  const text = await fetchViaBackend(resolvedUrl);

  if (!text || text.trim().length === 0) {
    throw new Error('Empty response from feed URL');
  }

  const xml = parseXML(text);

  const parseError = xml.querySelector('parsererror');
  if (parseError) {
    console.error('[rss] XML parse error for', url, parseError.textContent?.slice(0, 200));
    throw new Error('Invalid XML format');
  }

  const channel = parseRSSFeed(xml);
  console.log(`[rss] Parsed ${channel.items.length} items from ${url}`);
  return channel;
}

export async function fetchAndParseFeed(
  feed: Feed,
  existingItemIds: Set<string>
): Promise<FeedItem[]> {
  const channel = await fetchFeed(feed.url);

  // Auto-detect podcast: if feed has audio enclosures, treat as podcast
  const hasAudioEnclosures = channel.items.some(
    item => item.enclosure?.type?.startsWith('audio')
  );
  const effectiveSource: FeedSource = (feed.source === 'article' && hasAudioEnclosures)
    ? 'podcast'
    : feed.source;

  return channel.items
    .filter(item => !existingItemIds.has(item.guid || item.link))
    .map((item, idx) => ({
      id: `${feed.id}-${item.guid || item.link || idx}`,
      feedId: feed.id,
      title: item.title || 'Sans titre',
      excerpt: item.description?.replace(/<[^>]*>/g, '').slice(0, 200) || '',
      content: item.content || item.description || '',
      author: item.author || feed.name,
      publishedAt: parseRSSDate(item.pubDate || ''),
      readTime: estimateReadTime(item.content || item.description || ''),
      thumbnail: item.thumbnail,
      url: item.link || feed.url,
      isRead: false,
      isStarred: false,
      isBookmarked: false,
      source: effectiveSource,
      feedName: feed.name,
      enclosureUrl: item.enclosure?.url,
      enclosureType: item.enclosure?.type,
      duration: item.duration,
    }));
}

export async function discoverFeedInfo(url: string): Promise<{ name: string; description: string } | null> {
  // For Twitter feeds, skip the network call to avoid rate limiting
  // The real name will be fetched during the first sync
  const twitterUser = extractTwitterUsername(url);
  if (twitterUser) {
    return { name: `@${twitterUser}`, description: `Tweets de @${twitterUser}` };
  }

  try {
    const channel = await fetchFeed(url);
    return {
      name: channel.title || new URL(url).hostname,
      description: channel.description || '',
    };
  } catch {
    return null;
  }
}

export function detectSourceFromUrl(url: string): FeedSource {
  const urlLower = url.toLowerCase();

  if (urlLower.includes('reddit.com') || urlLower.includes('.rss')) {
    if (urlLower.includes('reddit')) return 'reddit';
  }
  if (urlLower.includes('youtube.com') || urlLower.includes('youtu.be')) {
    return 'youtube';
  }
  if (urlLower.includes('twitter.com') || urlLower.includes('nitter') || urlLower.includes('x.com')) {
    return 'twitter';
  }
  if (urlLower.includes('mastodon') || urlLower.includes('@')) {
    return 'mastodon';
  }

  // Podcast hosting platforms
  const podcastHosts = [
    'podcasts.apple.com', 'anchor.fm', 'feeds.buzzsprout.com',
    'podbean.com', 'feeds.simplecast.com', 'feeds.megaphone.fm',
    'omnycontent.com', 'feeds.transistor.fm', 'feeds.acast.com',
    'feeds.feedburner.com/pod', 'spreaker.com', 'podtrac.com',
    'feeds.libsyn.com', 'rss.art19.com', 'audioboom.com',
    'soundcloud.com', 'spotify.com/show',
  ];
  if (podcastHosts.some(host => urlLower.includes(host))) {
    return 'podcast';
  }

  return 'article';
}
