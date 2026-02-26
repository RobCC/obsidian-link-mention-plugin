import { requestUrl } from "obsidian";

/** Resolved metadata for an external link, used to render mention pills. */
export interface LinkMetadata {
  /** Display title extracted from the page (og:title, `<title>`, or hostname fallback). */
  title: string;
  /** Favicon as a `data:` URI, or empty string if unavailable. */
  favicon: string;
}

const cache = new Map<string, LinkMetadata>();
const inflight = new Map<string, Promise<LinkMetadata>>();
const faviconCache = new Map<string, Promise<string>>();

/** Maximum bytes of HTML to parse — only the `<head>` matters. */
const MAX_HTML_BYTES = 51200;

/**
 * Normalizes a user-entered URL for consistent caching and fetching.
 * Prepends `https://` if no protocol is present, and adds `www.` to
 * bare two-segment domains (e.g. `google.com` → `www.google.com`).
 *
 * @internal exported for testing
 */
export function normalizeUrl(raw: string): string {
  let url = raw;
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  try {
    const parsed = new URL(url);
    const parts = parsed.hostname.split(".");
    // Add www. only for bare domains like "google.com" (2 segments)
    if (parts.length === 2) {
      parsed.hostname = `www.${parsed.hostname}`;
    }
    return parsed.href;
  } catch {
    return url;
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
 * Extracts the favicon URL from a parsed HTML document by checking
 * `<link rel="icon">`, `<link rel="shortcut icon">`, and
 * `<link rel="apple-touch-icon">` in order. Resolves relative hrefs
 * against {@link pageUrl}. Returns `null` if no favicon link is found.
 *
 * @internal exported for testing
 */
export function extractFaviconUrl(
  doc: Document,
  pageUrl: string,
): string | null {
  // Try <link rel="icon"> and <link rel="shortcut icon"> in order
  const selectors = [
    'link[rel="icon"]',
    'link[rel="shortcut icon"]',
    'link[rel="apple-touch-icon"]',
  ];

  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    const href = el?.getAttribute("href");
    if (href) {
      try {
        // href may be relative — resolve against the page URL
        return new URL(href, pageUrl).href;
      } catch {
        continue;
      }
    }
  }
  return null;
}

/**
 * Resolves a favicon for a page using a three-step fallback:
 * 1. Favicon `<link>` element from the page HTML
 * 2. `/favicon.ico` at the page's origin
 * 3. Google Favicons API (`s2/favicons`)
 *
 * Returns a `data:` URI string, or empty string if all methods fail.
 */
async function doFetchFavicon(
  pageUrl: string,
  doc: Document | null,
): Promise<string> {
  // 1. Try favicon extracted from the page HTML
  if (doc) {
    const fromHtml = extractFaviconUrl(doc, pageUrl);
    if (fromHtml) {
      const dataUri = await fetchImageAsDataUri(fromHtml);

      if (dataUri) return dataUri;
    }
  }

  // 2. Try /favicon.ico at the origin
  try {
    const origin = new URL(pageUrl).origin;
    const dataUri = await fetchImageAsDataUri(`${origin}/favicon.ico`);

    if (dataUri) return dataUri;
  } catch {
    // invalid URL, skip
  }

  // 3. Try Google Favicons API as last resort
  try {
    const host = new URL(pageUrl).hostname;
    const dataUri = await fetchImageAsDataUri(
      `https://www.google.com/s2/favicons?domain=${host}&sz=32`,
    );

    if (dataUri) return dataUri;
  } catch {
    // skip
  }

  return "";
}

/**
 * Deduplicates favicon fetches by origin so multiple URLs on the same
 * domain (e.g. different GitHub pages) share a single favicon lookup.
 */
async function fetchFavicon(
  pageUrl: string,
  doc: Document | null,
): Promise<string> {
  let origin: string;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return doFetchFavicon(pageUrl, doc);
  }

  const cached = faviconCache.get(origin);
  if (cached) return cached;

  const promise = doFetchFavicon(pageUrl, doc);
  faviconCache.set(origin, promise);
  return promise;
}

/**
 * Extracts the `og:title` meta tag content from a parsed document.
 * Returns `undefined` if the tag is missing or empty.
 *
 * @internal exported for testing
 */
export function extractOgTitle(doc: Document): string | undefined {
  return (
    doc
      .querySelector('meta[property="og:title"]')
      ?.getAttribute("content")
      ?.trim() || undefined
  );
}

/**
 * Extracts the `og:site_name` meta tag content from a parsed document.
 * Useful for homepages where `og:title` may be missing but the site
 * name is declared (e.g. "GitHub").
 *
 * @internal exported for testing
 */
export function extractOgSiteName(doc: Document): string | undefined {
  return (
    doc
      .querySelector('meta[property="og:site_name"]')
      ?.getAttribute("content")
      ?.trim() || undefined
  );
}

/**
 * Extracts the page `<title>`, splitting on common separators
 * (`·`, `|`, `—`, `–`, `-`) and returning only the first segment.
 * This strips verbose suffixes like "GitHub · Build and ship…".
 *
 * @internal exported for testing
 */
export function extractDocTitle(doc: Document): string | undefined {
  const raw = doc.querySelector("title")?.textContent?.trim();
  if (!raw) return undefined;
  // Split on common separators and take the first segment
  const segment = raw.split(/\s*[·|—–\-]\s*/)[0].trim();
  return segment || undefined;
}

/**
 * Fetches a URL's HTML, parses its title and favicon, and returns
 * a {@link LinkMetadata} object. Title fallback chain:
 * `<title>` (split) → `og:site_name` → `og:title` → hostname.
 */
async function doFetch(url: string): Promise<LinkMetadata> {
  let title: string | undefined;
  let doc: Document | null = null;

  try {
    const response = await requestUrl({
      url,
      method: "GET",
      headers: { Range: `bytes=0-${MAX_HTML_BYTES}` },
    });

    const ct = getContentType(response.headers);
    if (!ct.startsWith("text/html")) throw new Error("not html");

    const html = response.text.slice(0, MAX_HTML_BYTES);
    doc = new DOMParser().parseFromString(html, "text/html");
    title =
      extractDocTitle(doc) ?? extractOgSiteName(doc) ?? extractOgTitle(doc);
  } catch {
    // title stays undefined, fall through
  }

  if (!title) {
    try {
      title = new URL(url).hostname;
    } catch {
      title = url;
    }
  }

  const favicon = await fetchFavicon(url, doc);

  return { title, favicon };
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

  pending = doFetch(normalized).then((meta) => {
    cache.set(normalized, meta);
    inflight.delete(normalized);
    return meta;
  });
  inflight.set(normalized, pending);
  return pending;
}
