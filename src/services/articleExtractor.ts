import { Readability } from '@mozilla/readability';
import { fetchViaBackend } from '../lib/tauriFetch';

export interface ExtractedArticle {
  title: string;
  content: string;
  textContent: string;
  excerpt: string;
  byline: string | null;
  length: number;
  siteName?: string;
}

// --- Site-specific rules ---

interface SiteRule {
  selectors?: string[];
  unwrapNoscript?: boolean;
}

const SITE_RULES: Record<string, SiteRule> = {
  'medium.com': { selectors: ['article'], unwrapNoscript: true },
  'substack.com': { selectors: ['.body.markup'] },
  '*.wordpress.com': { unwrapNoscript: true },
};

function matchSiteRule(hostname: string): SiteRule | null {
  if (SITE_RULES[hostname]) return SITE_RULES[hostname];
  for (const pattern of Object.keys(SITE_RULES)) {
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1); // e.g. ".wordpress.com"
      if (hostname.endsWith(suffix) || hostname === suffix.slice(1)) {
        return SITE_RULES[pattern];
      }
    }
  }
  // Also check if hostname contains the key as a substring (e.g. "blog.medium.com")
  for (const domain of Object.keys(SITE_RULES)) {
    if (!domain.startsWith('*.') && hostname.endsWith('.' + domain)) {
      return SITE_RULES[domain];
    }
  }
  return null;
}

// --- Tracking domains ---

const TRACKING_DOMAINS = [
  'pixel', 'beacon', 'tracker', 'analytics',
  'doubleclick', 'facebook.com/tr', 'bat.bing.com',
  'google-analytics.com', 'googletagmanager.com',
  'scorecardresearch.com', 'quantserve.com',
];

function isTrackingUrl(src: string): boolean {
  const lower = src.toLowerCase();
  return TRACKING_DOMAINS.some(d => lower.includes(d));
}

// --- Pre-processing: Lazy images ---

function unwrapLazyImages(doc: Document): void {
  const lazyAttrs = ['data-src', 'data-lazy-src', 'data-original', 'data-full-src'];

  for (const img of Array.from(doc.querySelectorAll('img'))) {
    // Promote lazy src attributes
    for (const attr of lazyAttrs) {
      const val = img.getAttribute(attr);
      if (val && !img.getAttribute('src')?.startsWith('http')) {
        img.setAttribute('src', val);
        break;
      }
    }
    // Promote data-srcset
    const dataSrcset = img.getAttribute('data-srcset');
    if (dataSrcset && !img.getAttribute('srcset')) {
      img.setAttribute('srcset', dataSrcset);
    }
  }

  // Handle <noscript> containing real images after lazy-load placeholders
  for (const noscript of Array.from(doc.querySelectorAll('noscript'))) {
    const content = noscript.textContent || '';
    if (!/<img\s/i.test(content)) continue;

    const prev = noscript.previousElementSibling;
    if (prev && prev.tagName === 'IMG') {
      // Parse the noscript content to extract the real image
      const tmp = doc.createElement('div');
      tmp.innerHTML = content;
      const realImg = tmp.querySelector('img');
      if (realImg && realImg.getAttribute('src')) {
        prev.replaceWith(realImg);
        noscript.remove();
      }
    }
  }
}

// --- Pre-processing: Remove clutter ---

const CLUTTER_SELECTORS = [
  'nav',
  'aside',
  '.share-buttons',
  '.social-share',
  '.newsletter-signup',
  '.ad',
  '.advertisement',
  '[role="banner"]',
  '[role="navigation"]',
  '.sidebar',
  '.related-posts',
  '.comments-section',
  'footer .widget',
];

function removeClutter(doc: Document): void {
  // Remove noise elements
  for (const selector of CLUTTER_SELECTORS) {
    for (const el of Array.from(doc.querySelectorAll(selector))) {
      el.remove();
    }
  }

  // Remove tracking pixels
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const w = img.getAttribute('width');
    const h = img.getAttribute('height');
    if ((w === '1' || w === '0') || (h === '1' || h === '0')) {
      img.remove();
      continue;
    }
    const src = img.getAttribute('src') || '';
    if (src && isTrackingUrl(src)) {
      img.remove();
    }
  }
}

// --- Fallback extraction ---

const FALLBACK_SELECTORS = [
  'article',
  '[role="article"]',
  '.post-content',
  '.entry-content',
  '.article-body',
  '.article-content',
  'main',
  '#content',
];

function fallbackExtract(doc: Document, siteRule: SiteRule | null): { content: string; textContent: string } | null {
  const selectors = [
    ...(siteRule?.selectors || []),
    ...FALLBACK_SELECTORS,
  ];

  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (el) {
      const text = (el.textContent || '').trim();
      if (text.length > 200) {
        return {
          content: el.innerHTML,
          textContent: text,
        };
      }
    }
  }

  // Last resort: cleaned body
  const bodyText = (doc.body?.textContent || '').trim();
  if (bodyText.length > 200) {
    return {
      content: doc.body.innerHTML,
      textContent: bodyText,
    };
  }

  return null;
}

// --- Post-processing: URL resolution ---

function resolveUrl(raw: string, base: string): string | null {
  if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return null;
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  try {
    return new URL(raw, base).href;
  } catch {
    return null;
  }
}

function resolveSrcset(srcset: string, base: string): string {
  return srcset
    .split(',')
    .map(entry => {
      const parts = entry.trim().split(/\s+/);
      if (parts.length === 0) return entry;
      const resolved = resolveUrl(parts[0], base);
      if (resolved) {
        parts[0] = resolved;
      }
      return parts.join(' ');
    })
    .join(', ');
}

function fixUrls(doc: Document, base: string): void {
  // <img src> and <img srcset>
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const src = img.getAttribute('src');
    if (src) {
      const resolved = resolveUrl(src, base);
      if (resolved) img.setAttribute('src', resolved);
    }
    const srcset = img.getAttribute('srcset');
    if (srcset) {
      img.setAttribute('srcset', resolveSrcset(srcset, base));
    }
  }

  // <source src> and <source srcset> in <picture> and <video>
  for (const source of Array.from(doc.querySelectorAll('source'))) {
    const src = source.getAttribute('src');
    if (src) {
      const resolved = resolveUrl(src, base);
      if (resolved) source.setAttribute('src', resolved);
    }
    const srcset = source.getAttribute('srcset');
    if (srcset) {
      source.setAttribute('srcset', resolveSrcset(srcset, base));
    }
  }

  // <video src> and <video poster>
  for (const video of Array.from(doc.querySelectorAll('video'))) {
    const src = video.getAttribute('src');
    if (src) {
      const resolved = resolveUrl(src, base);
      if (resolved) video.setAttribute('src', resolved);
    }
    const poster = video.getAttribute('poster');
    if (poster) {
      const resolved = resolveUrl(poster, base);
      if (resolved) video.setAttribute('poster', resolved);
    }
  }

  // <a href>
  for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
    const href = a.getAttribute('href');
    if (href && !href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('javascript:')) {
      const resolved = resolveUrl(href, base);
      if (resolved) a.setAttribute('href', resolved);
    }
  }
}

// --- Post-processing: Clean images ---

function cleanImages(doc: Document): void {
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const src = img.getAttribute('src');

    // Remove images with no src or empty src
    if (!src || src.trim() === '') {
      img.remove();
      continue;
    }

    // Remove tiny images (tracking pixels that slipped through), but keep emoji-sized
    const w = parseInt(img.getAttribute('width') || '', 10);
    const h = parseInt(img.getAttribute('height') || '', 10);
    if (w > 0 && w < 3 && h > 0 && h < 3) {
      img.remove();
      continue;
    }

    // Remove tracking domain images
    if (isTrackingUrl(src)) {
      img.remove();
    }
  }
}

// --- Post-processing: Remove empty elements ---

function removeEmptyElements(doc: Document): void {
  const selectors = ['div', 'p', 'span', 'section'];
  for (const tag of selectors) {
    for (const el of Array.from(doc.querySelectorAll(tag))) {
      if (
        el.children.length === 0 &&
        (el.textContent || '').trim() === '' &&
        !el.querySelector('img, video, iframe, audio, canvas, svg')
      ) {
        el.remove();
      }
    }
  }
}

// --- Hero image from og:image ---

function getOgImage(doc: Document): string | null {
  const ogImage = doc.querySelector('meta[property="og:image"]');
  if (ogImage) return ogImage.getAttribute('content');
  const twitterImage = doc.querySelector('meta[name="twitter:image"]');
  if (twitterImage) return twitterImage.getAttribute('content');
  return null;
}

function getSiteName(doc: Document): string | null {
  const meta = doc.querySelector('meta[property="og:site_name"]');
  return meta ? meta.getAttribute('content') : null;
}

function prependHeroImage(contentDoc: Document, heroUrl: string): void {
  // Only prepend if the content has no images at all
  if (contentDoc.querySelector('img')) return;

  const figure = contentDoc.createElement('figure');
  figure.className = 'hero-image';
  const img = contentDoc.createElement('img');
  img.setAttribute('src', heroUrl);
  img.setAttribute('loading', 'lazy');
  figure.appendChild(img);

  if (contentDoc.body.firstChild) {
    contentDoc.body.insertBefore(figure, contentDoc.body.firstChild);
  } else {
    contentDoc.body.appendChild(figure);
  }
}

// --- Truncation detection (unchanged) ---

/**
 * Heuristic to detect if RSS content is truncated/partial.
 * Returns true if the content looks like just an excerpt.
 */
export function isContentTruncated(content: string): boolean {
  if (!content) return true;

  const text = content.replace(/<[^>]*>/g, '').trim();

  // Very short content is likely truncated
  if (text.length < 600) return true;

  // Common truncation markers
  const truncationMarkers = [
    /\.{3}\s*$/,              // ends with ...
    /\[\.{3}\]\s*$/,          // ends with [...]
    /\[…\]\s*$/,              // ends with [&hellip;]
    /…\s*$/,                  // ends with &hellip;
    /continue\s+reading/i,
    /read\s+more/i,
    /lire\s+la\s+suite/i,
    /\(more\.\.\.\)/i,
    /the\s+post\s+.+appeared\s+first\s+on/i,
    /L['']article .+ est apparu en premier sur/i,
  ];

  for (const marker of truncationMarkers) {
    if (marker.test(text)) return true;
  }

  return false;
}

// --- Main extraction ---

/**
 * Fetch a web page and extract the main article content using Readability.
 */
export async function extractArticle(url: string): Promise<ExtractedArticle> {
  const html = await fetchViaBackend(url);

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Fix relative URLs to absolute
  const baseUrl = new URL(url);
  const base = doc.createElement('base');
  base.href = baseUrl.origin;
  doc.head.prepend(base);

  // Detect site-specific rules
  const siteRule = matchSiteRule(baseUrl.hostname);

  // Extract metadata before Readability clones/modifies the doc
  const ogImage = getOgImage(doc);
  const siteName = getSiteName(doc);

  // Pre-processing
  unwrapLazyImages(doc);
  removeClutter(doc);

  // Clone for Readability (it mutates the document)
  const readabilityDoc = doc.cloneNode(true) as Document;

  // Run Readability with improved config
  const reader = new Readability(readabilityDoc, {
    charThreshold: 100,
    keepClasses: false,
  });

  let article = reader.parse();

  // Fallback if Readability fails
  if (!article || !article.content) {
    const fallback = fallbackExtract(doc, siteRule);
    if (!fallback) {
      throw new Error('Impossible d\'extraire le contenu de l\'article');
    }
    article = {
      title: doc.title || '',
      content: fallback.content,
      textContent: fallback.textContent,
      excerpt: fallback.textContent.slice(0, 200),
      byline: null,
      length: fallback.textContent.length,
      lang: null,
      dir: null,
      siteName: null,
      publishedTime: null,
    };
  }

  // Post-processing on extracted content
  const contentDoc = parser.parseFromString(article.content!, 'text/html');

  fixUrls(contentDoc, url);
  cleanImages(contentDoc);
  removeEmptyElements(contentDoc);

  // Prepend hero image if content has no images
  if (ogImage) {
    const resolvedHero = resolveUrl(ogImage, url) || ogImage;
    prependHeroImage(contentDoc, resolvedHero);
  }

  const fixedContent = contentDoc.body.innerHTML;

  return {
    title: article.title || '',
    content: fixedContent,
    textContent: article.textContent || '',
    excerpt: article.excerpt || '',
    byline: article.byline || null,
    length: article.length || 0,
    siteName: siteName || undefined,
  };
}
