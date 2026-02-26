import { requestUrl } from "obsidian";

export interface LinkMetadata {
  title: string;
  favicon: string;
}

const cache = new Map<string, LinkMetadata>();
const inflight = new Map<string, Promise<LinkMetadata>>();

/** @internal exported for testing */
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

/** @internal exported for testing */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

/** @internal exported for testing */
export function getContentType(headers: Record<string, string>): string {
  // Header keys may vary in casing across environments
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === "content-type") {
      return headers[key].split(";")[0].trim();
    }
  }
  return "image/png";
}

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

/** @internal exported for testing */
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

async function fetchFavicon(
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

/** @internal exported for testing */
export function extractOgTitle(doc: Document): string | undefined {
  return (
    doc
      .querySelector('meta[property="og:title"]')
      ?.getAttribute("content")
      ?.trim() || undefined
  );
}

/** @internal exported for testing */
export function extractOgSiteName(doc: Document): string | undefined {
  return (
    doc
      .querySelector('meta[property="og:site_name"]')
      ?.getAttribute("content")
      ?.trim() || undefined
  );
}

/** @internal exported for testing */
export function extractDocTitle(doc: Document): string | undefined {
  const raw = doc.querySelector("title")?.textContent?.trim();
  if (!raw) return undefined;
  // Split on common separators and take the first segment
  const segment = raw.split(/\s*[·|—–\-]\s*/)[0].trim();
  return segment || undefined;
}

async function doFetch(url: string): Promise<LinkMetadata> {
  let title: string | undefined;
  let doc: Document | null = null;

  try {
    const response = await requestUrl({ url, method: "GET" });
    const html = response.text;
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

export function getCachedMetadata(url: string): LinkMetadata | undefined {
  return cache.get(normalizeUrl(url));
}

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
