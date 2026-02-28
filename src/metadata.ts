import { requestUrl } from "obsidian";
import {
  extractAuthor,
  extractDocTitle,
  extractFaviconUrl,
  extractGithubTitle,
  extractOgTitle,
} from "./parsers/html";

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

/** Maximum bytes of HTML to parse — only the `<head>` matters. */
const MAX_HTML_BYTES = 51200;

/** Maximum concurrent `doFetch` calls to avoid overwhelming the network. */
const MAX_CONCURRENT = 3;
let activeCount = 0;
const waiting: (() => void)[] = [];

/** Acquires a fetch slot, waiting if the concurrency limit is reached. */
function acquireSlot(): Promise<void> {
  if (activeCount < MAX_CONCURRENT) {
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
    const parsed = new URL(raw);
    const parts = parsed.hostname.split(".");
    // Add www. only for bare domains like "google.com" (2 segments)
    if (parts.length === 2) {
      parsed.hostname = `www.${parsed.hostname}`;
    }
    return parsed.href;
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
  let binary = "";
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
    if (key.toLowerCase() === "content-type") {
      return headers[key].split(";")[0].trim();
    }
  }
  return "image/png";
}

/**
 * Fetches an image from {@link imageUrl} and returns it as a `data:` URI.
 * Returns an empty string on any failure (network error, non-image response).
 */
async function fetchImageAsDataUri(imageUrl: string): Promise<string> {
  try {
    const response = await requestUrl({ url: imageUrl, method: "GET" });
    const contentType = getContentType(response.headers);

    if (!contentType.startsWith("image/")) return "";

    const base64 = arrayBufferToBase64(response.arrayBuffer);

    return `data:${contentType};base64,${base64}`;
  } catch {
    return "";
  }
}

/**
 * Resolves a favicon URL from the page's `<link>` elements.
 * Returns empty string if no favicon is found.
 */
function fetchFavicon(pageUrl: string, doc: Document | null): string {
  if (doc) {
    const fromHtml = extractFaviconUrl(doc, pageUrl);
    if (fromHtml) return fromHtml;
  }
  try {
    return new URL("/favicon.ico", pageUrl).href;
  } catch {
    return "";
  }
}

/** oEmbed endpoints for sites whose HTML is too heavy or JS-rendered. */
const OEMBED_ENDPOINTS: { pattern: RegExp; endpoint: string }[] = [
  {
    pattern: /^https?:\/\/(www\.)?youtube\.com\/watch/,
    endpoint: "https://www.youtube.com/oembed?format=json&url=",
  },
  {
    pattern: /^https?:\/\/youtu\.be\//,
    endpoint: "https://www.youtube.com/oembed?format=json&url=",
  },
  {
    pattern: /^https?:\/\/(www\.)?vimeo\.com\/\d+/,
    endpoint: "https://vimeo.com/api/oembed.json?url=",
  },
];

/**
 * Attempts to fetch a title via oEmbed for supported sites.
 * Returns the title string or `undefined` if the URL isn't oEmbed-eligible
 * or the request fails.
 *
 * @internal exported for testing
 */
export async function fetchOembedTitle(
  url: string,
): Promise<string | undefined> {
  for (const { pattern, endpoint } of OEMBED_ENDPOINTS) {
    if (pattern.test(url)) {
      try {
        const response = await requestUrl({
          url: `${endpoint}${encodeURIComponent(url)}`,
          method: "GET",
        });
        const title = response.json?.title?.trim();
        return title || undefined;
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
  const oembedTitle = await fetchOembedTitle(url);
  if (oembedTitle) {
    const favicon = fetchFavicon(url, null);
    return { title: oembedTitle, favicon, author: "" };
  }

  // Fetch the page HTML — let errors propagate so callers can
  // distinguish a failed fetch from a successful one (and avoid
  // permanently caching a hostname fallback).
  const response = await requestUrl({
    url,
    method: "GET",
    headers: { Range: `bytes=0-${MAX_HTML_BYTES}` },
  });

  const ct = getContentType(response.headers);

  if (!ct.startsWith("text/html")) throw new Error("not html");

  const html = response.text.slice(0, MAX_HTML_BYTES);
  doc = new DOMParser().parseFromString(html, "text/html");

  let title: string | undefined;

  try {
    const hostname = new URL(url).hostname;
    if (hostname === "github.com" || hostname === "www.github.com") {
      title = extractGithubTitle(doc);
    }
  } catch {
    /* ignore parse errors, fall through to generic */
  }

  title ??= extractDocTitle(doc) ?? extractOgTitle(doc);

  if (!title) {
    title = new URL(url).hostname;
  }

  const author = extractAuthor(doc);
  const favicon = fetchFavicon(url, doc);

  return { title, favicon, author: author ?? "" };
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
  if (cached) return cached;

  let pending = inflight.get(normalized);
  if (pending) return pending;

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
      // Return hostname fallback without caching so the next
      // decoration rebuild will retry the fetch.
      let hostname: string;
      try {
        hostname = new URL(normalized).hostname;
      } catch {
        hostname = normalized;
      }
      return { title: hostname, favicon: "", author: "" } as LinkMetadata;
    });
  inflight.set(normalized, pending);
  return pending;
}
