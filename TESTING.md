# Regression Testing Checklist

## Pill rendering

- [ ] `[](https://example.com)` renders as a collapsed pill with favicon + title
- [ ] Pill shows favicon image when the site provides one
- [ ] Pill shows default link icon when favicon fails to load
- [ ] Pill shows author prefix when the page has a `meta[name="author"]` tag
- [ ] YouTube/Vimeo links resolve titles via oEmbed (not HTML scraping)
- [ ] GitHub repo links show just the repo name (no description suffix)
- [ ] Reddit links show subreddit/post info
- [ ] Non-HTML URLs (JSON APIs, PDFs) fall back to hostname as title
- [ ] URLs with no `<title>` fall back to a readable path slug or hostname

## Cursor interaction

- [ ] Arrow into a pill — it expands to show raw `[](url)` markdown
- [ ] Arrow out of a pill — it collapses back into the pill widget
- [ ] Click on a pill — opens the URL in a new tab
- [ ] Click next to a pill — cursor lands at the click position, pill expands only if cursor is inside the link range
- [ ] Multiple cursors (Ctrl+click) — each cursor correctly expands its overlapping pill
- [ ] Modifier-clicks (Ctrl/Cmd/Alt + click) on a pill — bubble to Obsidian, don't intercept

## Search (Ctrl+F)

- [ ] Search term matching text inside a pill — that specific pill expands
- [ ] Navigate between matches (Enter/arrows) — only the currently-selected match's pill expands
- [ ] Close search panel — all pills collapse back to normal
- [ ] Search term not inside any pill — no pills expand

## Document editing

- [ ] Type a new `[](url)` — pill appears once metadata loads
- [ ] Delete a pill's text — decoration disappears cleanly
- [ ] Undo/redo through pill creation — no stale decorations or crashes
- [ ] Paste a URL inside `[]()` — pill renders after fetch

## Viewport & scrolling

- [ ] Scroll a long note — pills render correctly as they enter the viewport
- [ ] Scroll away and back — pills reappear (no blank gaps)
- [ ] Split panes with the same note — each pane renders pills independently

## Fetch behavior

- [ ] First visit to a URL triggers exactly one network request (check DevTools Network tab)
- [ ] Duplicate URLs on the same page share a single fetch (not one per occurrence)
- [ ] After a successful fetch, subsequent rebuilds use the cache (no new requests)
- [ ] Broken URL triggers one request, then no retries for 60 seconds
- [ ] After 60 seconds, broken URL retries once on next rebuild
- [ ] Concurrent fetches are limited (max 4 by default) — bulk links don't flood the network

## Automated

```sh
pnpm test        # all unit tests pass
pnpm run build   # lint, format, typecheck, and bundle all pass
```
