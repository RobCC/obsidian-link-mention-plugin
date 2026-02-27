import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { EditorSelection, Range } from "@codemirror/state";
import { fetchLinkMetadata, getCachedMetadata, LinkMetadata } from "./metadata";

/**
 * CodeMirror widget that renders a mention pill (favicon + title)
 * as a replacement decoration for an empty markdown link `[](url)`.
 */
class LinkMentionWidget extends WidgetType {
  constructor(
    private readonly url: string,
    private readonly meta: LinkMetadata,
  ) {
    super();
  }

  /** Two widgets are equal if they point to the same URL with the same title. */
  eq(other: LinkMentionWidget): boolean {
    return this.url === other.url && this.meta.title === other.meta.title && this.meta.author === other.meta.author;
  }

  /** Builds the pill `<a>` element with favicon, title, and click handling. */
  toDOM(): HTMLElement {
    const pill = document.createElement("a");
    pill.className = "link-mention external-link";
    pill.href = this.url;
    pill.setAttribute("target", "_blank");
    pill.setAttribute("rel", "noopener");

    if (this.meta.favicon) {
      const img = document.createElement("img");
      img.className = "link-mention-favicon";
      img.src = this.meta.favicon;
      img.alt = "";
      img.addEventListener("error", () => {
        img.style.display = "none";
      });
      pill.appendChild(img);
    }

    if (this.meta.author) {
      const author = document.createElement("span");
      author.className = "link-mention-author";
      author.textContent = this.meta.author;
      pill.appendChild(author);
    }

    const span = document.createElement("span");
    span.className = "link-mention-title";
    span.textContent = this.meta.title;

    pill.appendChild(span);

    // Always prevent mousedown from moving the cursor into the widget
    // (which would reveal the raw markdown). Only stop propagation for
    // plain left-clicks; let modifier-clicks bubble to Obsidian so it
    // can show/dismiss its context menu.
    pill.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || e.altKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      if (e.button === 0 && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.stopPropagation();
      }
    });

    pill.addEventListener("click", (e) => {
      if (e.button !== 0 || e.altKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();
      window.open(this.url, "_blank");
    });

    return pill;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/** Regex for empty markdown links `[](url)`. Module-level to avoid re-creation. */
const EMPTY_LINK_RE = /\[]\((https?:\/\/[^)\r\n]+)\)/g;

/** A link position found during a full scan. */
interface KnownLink {
  from: number;
  to: number;
  url: string;
}

/**
 * Returns `true` if any cursor in the editor selection falls within the
 * given `[from, to]` range. Used to avoid replacing the markdown source
 * when the user is actively editing within the link.
 *
 * @internal exported for testing
 */
export function cursorInRange(
  selection: EditorSelection,
  from: number,
  to: number,
): boolean {
  return selection.ranges.some((range) => range.from >= from && range.to <= to);
}

/**
 * Scans visible ranges for empty markdown links (`[](url)`), and builds
 * a {@link DecorationSet} of replacement widgets for each match that has
 * cached metadata. Links without cached metadata trigger a background
 * fetch; {@link onFetchComplete} is called when a fetch resolves so the
 * view can be re-decorated.
 *
 * Returns both the decoration set and the list of found link positions
 * so that fetch-only updates can skip the regex scan.
 */
function buildDecorations(
  view: EditorView,
  onFetchComplete: () => void,
): { decorations: DecorationSet; links: KnownLink[] } {
  const decorations: Range<Decoration>[] = [];
  const links: KnownLink[] = [];
  const doc = view.state.doc;

  // Scan the visible text with a regex (syntax tree node types vary
  // across Obsidian versions, so regex is more reliable).
  EMPTY_LINK_RE.lastIndex = 0;

  for (const { from, to } of view.visibleRanges) {
    const text = doc.sliceString(from, to);
    EMPTY_LINK_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = EMPTY_LINK_RE.exec(text)) !== null) {
      const matchFrom = from + match.index;
      const matchTo = matchFrom + match[0].length;
      const url = match[1];

      links.push({ from: matchFrom, to: matchTo, url });

      if (cursorInRange(view.state.selection, matchFrom, matchTo)) {
        continue;
      }

      const meta = getCachedMetadata(url);

      if (meta) {
        decorations.push(
          Decoration.replace({
            widget: new LinkMentionWidget(url, meta),
          }).range(matchFrom, matchTo),
        );
      } else {
        fetchLinkMetadata(url).then(onFetchComplete);
      }
    }
  }

  return { decorations: Decoration.set(decorations, true), links };
}

/**
 * Rebuilds decorations from previously-found link positions without
 * re-scanning with regex. Used when only a metadata fetch completed
 * (no doc/viewport/selection change).
 */
function rebuildFromKnown(
  view: EditorView,
  knownLinks: KnownLink[],
  onFetchComplete: () => void,
): DecorationSet {
  const decorations: Range<Decoration>[] = [];

  for (const { from, to, url } of knownLinks) {
    if (cursorInRange(view.state.selection, from, to)) {
      continue;
    }

    const meta = getCachedMetadata(url);

    if (meta) {
      decorations.push(
        Decoration.replace({
          widget: new LinkMentionWidget(url, meta),
        }).range(from, to),
      );
    } else {
      fetchLinkMetadata(url).then(onFetchComplete);
    }
  }

  return Decoration.set(decorations, true);
}

/**
 * CodeMirror ViewPlugin that powers live-preview mode. Rebuilds
 * decorations on document changes, viewport scrolls, selection moves,
 * or when a pending metadata fetch completes.
 */
export const livePreviewExtension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    hasPendingFetches = false;
    knownLinks: KnownLink[] = [];
    dispatchTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(view: EditorView) {
      const onFetch = () => this.scheduleDispatch(view);
      const result = buildDecorations(view, onFetch);
      this.decorations = result.decorations;
      this.knownLinks = result.links;
    }

    /**
     * Debounces `view.dispatch()` so multiple fetch completions within
     * 50ms trigger a single re-render instead of one per fetch.
     */
    scheduleDispatch(view: EditorView): void {
      this.hasPendingFetches = true;
      if (this.dispatchTimer) return;
      this.dispatchTimer = setTimeout(() => {
        this.dispatchTimer = null;
        view.dispatch();
      }, 50);
    }

    update(update: ViewUpdate): void {
      const onFetch = () => this.scheduleDispatch(update.view);

      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        // Full rescan needed — document or viewport changed
        this.hasPendingFetches = false;
        const result = buildDecorations(update.view, onFetch);
        this.decorations = result.decorations;
        this.knownLinks = result.links;
      } else if (this.hasPendingFetches) {
        // Only re-check cache for already-known positions (no regex scan)
        this.hasPendingFetches = false;
        this.decorations = rebuildFromKnown(
          update.view,
          this.knownLinks,
          onFetch,
        );
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    eventHandlers: {
      mousedown(this: { knownLinks: KnownLink[]; decorations: DecorationSet }, event: MouseEvent, view: EditorView) {
        if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey) return;
        const target = event.target as HTMLElement;
        const icon = target.closest(".external-link");
        if (!icon || icon.classList.contains("link-mention")) return;
        const pos = view.posAtDOM(icon);
        const link = this.knownLinks.find((l) => pos >= l.from && pos <= l.to + 2);
        if (link) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
      click(this: { knownLinks: KnownLink[]; decorations: DecorationSet }, event: MouseEvent, view: EditorView) {
        if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey) return;
        const target = event.target as HTMLElement;
        const icon = target.closest(".external-link");
        if (!icon || icon.classList.contains("link-mention")) return;
        const pos = view.posAtDOM(icon);
        const link = this.knownLinks.find((l) => pos >= l.from && pos <= l.to + 2);
        if (link) {
          event.preventDefault();
          event.stopPropagation();
          window.open(link.url, "_blank");
        }
      },
    },
  },
);
