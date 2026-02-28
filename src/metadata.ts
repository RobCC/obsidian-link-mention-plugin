import { requestUrl } from 'obsidian';
import {
  extractAuthor,
  extractDocTitle,
  extractFaviconUrl,
  extractGithubTitle,
  extractOgTitle,
} from './parsers/html';
import { extractRedditTitle, extractUrlTitle } from './parsers/url';

/** Resolved metadata for an external link, used to render mention pills. */
export interface LinkMetadata {
  /** Display title extracted from the page (`<title>`, `og:title`, or hostname fallback). */
  title: string;
  /** Favicon URL, or empty string if unavailable. */
  favicon: string;
  /** Author or site name (`meta[name="author"]` or `og:site_name`), or empty string. */
  author: string;
}

const cache = new Map<string, LinkMetadata>();
const inflight = new Map<string, Promise<LinkMetadata>>();

/** Maximum bytes of HTML to parse to prevent fetching the whole page. Only the `<head>` matters. */
const MAX_HTML_BYTES = 51200;

/** Maximum concurrent `doFetch` calls to avoid overwhelming the network. */
let maxConcurrent = 4;
let activeCount = 0;
const waiting: (() => void)[] = [];

/** Updates the maximum number of concurrent fetches at runtime. */
export function setMaxConcurrent(n: number): void {
  maxConcurrent = n;
}

/** Acquires a fetch slot, waiting if the concurrency limit is reached. */
function acquireSlot(): Promise<void> {
  if (activeCount < maxConcurrent) {
    activeCount++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}

/** Releases a fetch slot, unblocking the next waiting caller. */
function releaseSlot(): void {
  activeCount--;
  const next = waiting.shift();
  if (next) {
    activeCount++;
    next();
  }
}

/**
 * Normalizes a URL for consistent caching and fetching.
 * Adds `www.` to bare two-segment domains (e.g. `example.com` → `www.example.com`).
 *
 * @internal exported for testing
 */
export function normalizeUrl(raw: string): string {
  try {
    return new URL(raw).href;
  } catch {
    return raw;
  }
}

/**
 * Converts an `ArrayBuffer` to a base-64 encoded string.
 * Used to inline fetched images as `data:` URIs.
 *
 * @internal exported for testing
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

/**
 * Extracts the MIME type from a response headers object, doing a
 * case-insensitive lookup for the `content-type` key and stripping
 * any charset or boundary parameters. Defaults to `"image/png"`.
 *
 * @internal exported for testing
 */
export function getContentType(headers: Record<string, string>): string {
  // Header keys may vary in casing across environments
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === 'content-type') {
      return headers[key].split(';')[0].trim();
    }
  }
  return 'image/png';
}

/**
 * Resolves a favicon URL from the page's `<link>` elements.
 * Returns empty string if no favicon is found.
 */
function fetchFavicon(pageUrl: string, doc: Document | null): string {
  if (doc) {
    const fromHtml = extractFaviconUrl(doc, pageUrl);
    if (fromHtml) {
      return fromHtml;
    }
  }
  try {
    return new URL('/favicon.ico', pageUrl).href;
  } catch {
    return '';
  }
}

/** oEmbed endpoints for sites whose HTML is too heavy or JS-rendered. */
const OEMBED_ENDPOINTS: { pattern: RegExp; endpoint: string }[] = [
  {
    pattern: /^https?:\/\/(www\.)?youtube\.com\/watch/,
    endpoint: 'https://www.youtube.com/oembed?format=json&url=',
  },
  {
    pattern: /^https?:\/\/youtu\.be\//,
    endpoint: 'https://www.youtube.com/oembed?format=json&url=',
  },
  {
    pattern: /^https?:\/\/(www\.)?vimeo\.com\/\d+/,
    endpoint: 'https://vimeo.com/api/oembed.json?url=',
  },
];

/**
 * Attempts to fetch a title via oEmbed for supported sites.
 * Returns the title string or `undefined` if the URL isn't oEmbed-eligible
 * or the request fails.
 *
 * @internal exported for testing
 */
export async function fetchOembed(
  url: string,
): Promise<{ title: string; author: string } | undefined> {
  for (const { pattern, endpoint } of OEMBED_ENDPOINTS) {
    if (pattern.test(url)) {
      try {
        const response = await requestUrl({
          url: `${endpoint}${encodeURIComponent(url)}`,
          method: 'GET',
        });
        const title = response.json?.title?.trim();
        if (!title) {
          return undefined;
        }
        const author = response.json?.author_name?.trim() ?? '';
        return { title, author };
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/**
 * Fetches a URL's HTML, parses its title, author, and favicon, and returns
 * a {@link LinkMetadata} object. For supported sites (YouTube, Vimeo),
 * uses oEmbed for reliable title extraction. Otherwise falls back to:
 * `<title>` (split) → `og:title` → hostname.
 */
async function doFetch(url: string): Promise<LinkMetadata> {
  let doc: Document | null = null;

  // Try oEmbed first for supported sites (avoids downloading heavy HTML)
  const oembed = await fetchOembed(url);
  if (oembed) {
    const favicon = fetchFavicon(url, null);
    return { title: oembed.title, favicon, author: oembed.author };
  }

  const response = await requestUrl({
    url,
    method: 'GET',
    headers: { Range: `bytes=0-${MAX_HTML_BYTES}` },
    throw: false,
  });

  const ct = getContentType(response.headers);

  if (!ct.startsWith('text/html')) {
    const title = extractUrlTitle(url);
    const favicon = fetchFavicon(url, null);
    return { title, favicon, author: '' };
  }

  const html = response.text.slice(0, MAX_HTML_BYTES);
  doc = new DOMParser().parseFromString(html, 'text/html');

  let title: string | undefined;

  try {
    const hostname = new URL(url).hostname;
    if (hostname === 'github.com' || hostname === 'www.github.com') {
      title = extractGithubTitle(doc);
    }
    if (
      hostname === 'reddit.com' ||
      hostname === 'www.reddit.com' ||
      hostname === 'old.reddit.com'
    ) {
      const reddit = extractRedditTitle(url);
      if (reddit) {
        const favicon = fetchFavicon(url, doc);
        return { title: reddit.title, favicon, author: reddit.author };
      }
    }
  } catch {
    /* ignore parse errors, fall through to generic */
  }

  title ??= extractDocTitle(doc) ?? extractOgTitle(doc);

  if (!title) {
    title = extractUrlTitle(url);
  }

  const author = extractAuthor(doc);
  const favicon = fetchFavicon(url, doc);

  return { title, favicon, author: author ?? '' };
}

/**
 * Returns previously fetched metadata from the in-memory cache,
 * or `undefined` if the URL hasn't been fetched yet.
 * The URL is normalized before lookup.
 */
export function getCachedMetadata(url: string): LinkMetadata | undefined {
  return cache.get(normalizeUrl(url));
}

/**
 * Fetches and caches metadata (title + favicon) for an external URL.
 * Normalizes the URL, deduplicates concurrent requests to the same
 * URL, and caches the result for subsequent calls.
 */
export async function fetchLinkMetadata(url: string): Promise<LinkMetadata> {
  const normalized = normalizeUrl(url);

  const cached = cache.get(normalized);
  if (cached) {
    return cached;
  }

  let pending = inflight.get(normalized);
  if (pending) {
    return pending;
  }

  pending = acquireSlot()
    .then(() => doFetch(normalized))
    .finally(releaseSlot)
    .then((meta) => {
      cache.set(normalized, meta);
      inflight.delete(normalized);
      return meta;
    })
    .catch(() => {
      inflight.delete(normalized);
      // Return fallback without caching so the next
      // decoration rebuild will retry the fetch.
      const title = extractUrlTitle(normalized);
      return { title, favicon: '', author: '' } as LinkMetadata;
    });
  inflight.set(normalized, pending);
  return pending;
}
