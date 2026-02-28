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
 * Extracts the `meta[name="author"]` content from a parsed document.
 *
 * @internal exported for testing
 */
export function extractAuthor(doc: Document): string | undefined {
  return (
    doc
      .querySelector('meta[name="author"]')
      ?.getAttribute("content")
      ?.trim() || undefined
  );
}

/**
 * Extracts the page `<title>`, splitting on common separators
 * (`·`, `|`, `—`) and returning only the first segment.
 * This strips verbose suffixes like "GitHub · Build and ship…".
 * En dash (`–`) and hyphen (`-`) are excluded — too common in real content.
 *
 * @internal exported for testing
 */
export function extractDocTitle(doc: Document): string | undefined {
  const raw = doc.querySelector("title")?.textContent?.trim();
  if (!raw) return undefined;
  // Split on common separators and take the first segment
  const segment = raw.split(/\s*[·|—]\s*/)[0].trim();
  return segment || undefined;
}

/**
 * Extracts a clean title from a GitHub page.
 *
 * Prefers `og:title` (which GitHub sets to e.g. `owner/repo` for
 * repository pages), stripping any `: description` suffix.
 * Falls back to {@link extractDocTitle} with the same stripping.
 *
 * @internal exported for testing
 */
export function extractGithubTitle(doc: Document): string | undefined {
  const ogTitle = extractOgTitle(doc);
  if (ogTitle) {
    const withoutDesc = ogTitle.split(":")[0].trim();
    return withoutDesc.split("/").pop()?.trim() || undefined;
  }
  const docTitle = extractDocTitle(doc);
  if (docTitle) {
    const withoutDesc = docTitle.split(":")[0].trim();
    return withoutDesc.split("/").pop()?.trim() || undefined;
  }
  return undefined;
}
