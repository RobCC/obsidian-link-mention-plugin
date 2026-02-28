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
    .split("/")
    .map((s) => decodeURIComponent(s))
    .filter(Boolean);

  let best: string | undefined;

  for (const seg of segments) {
    // Strip query-like suffixes that leak into path segments
    const cleaned = seg.replace(/[?=&].*/, "");
    const words = cleaned.split(/[-_\s]+/).filter((w) => w.length > 0);
    if (words.length < 2) continue;
    if (words.join("").length < 10) continue;

    if (!best || cleaned.length > best.length) {
      best = cleaned;
    }
  }

  if (!best) return parsed.hostname;

  return best
    .split(/[-_\s]+/)
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
