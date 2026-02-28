/** Reddit post URL pattern: /r/{subreddit}/comments/{id}/{slug} */
const REDDIT_POST_RE = /^\/r\/([^/]+)\/comments\/[^/]+\/([^/]+)/;

/**
 * Extracts title and subreddit from a Reddit post URL.
 * Returns `undefined` for non-post Reddit URLs (homepage, subreddit listing).
 *
 * @internal exported for testing
 */
export function extractRedditTitle(url: string): { title: string; author: string } | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }

  const host = parsed.hostname;
  if (host !== 'reddit.com' && host !== 'www.reddit.com' && host !== 'old.reddit.com') {
    return undefined;
  }

  const match = REDDIT_POST_RE.exec(parsed.pathname);
  if (!match) {
    const subMatch = /^\/r\/([^/]+)/.exec(parsed.pathname);
    if (subMatch) {
      return { title: `r/${subMatch[1]}`, author: '' };
    }
    const userMatch = /^\/user\/([^/]+)/.exec(parsed.pathname);
    if (userMatch) {
      return { title: `u/${userMatch[1]}`, author: '' };
    }
    return undefined;
  }

  const subreddit = match[1];
  const slug = decodeURIComponent(match[2]);

  const title = slug
    .split(/[-_\s]+/)
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  return title ? { title, author: `r/${subreddit}` } : undefined;
}

/**
 * Extracts a human-readable title from a URL's path segments.
 * Picks the longest slug-like segment (hyphen/underscore-separated,
 * 2+ words, 10+ chars), title-cases it. Falls back to hostname.
 *
 * @internal exported for testing
 */
export function extractUrlTitle(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  const segments = parsed.pathname
    .split('/')
    .map((s) => decodeURIComponent(s))
    .filter(Boolean);

  let best: string | undefined;

  for (const seg of segments) {
    // Strip query-like suffixes that leak into path segments
    const cleaned = seg.replace(/[?=&].*/, '');
    const words = cleaned.split(/[-_\s]+/).filter((w) => w.length > 0);
    if (words.length < 2) {
      continue;
    }
    if (words.join('').length < 10) {
      continue;
    }

    if (!best || cleaned.length > best.length) {
      best = cleaned;
    }
  }

  if (!best) {
    return parsed.hostname;
  }

  return best
    .split(/[-_\s]+/)
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
