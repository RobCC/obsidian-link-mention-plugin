import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { EditorSelection, Range } from "@codemirror/state";
import { fetchLinkMetadata, getCachedMetadata, LinkMetadata, normalizeUrl } from "./metadata";

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
    return this.url === other.url && this.meta.title === other.meta.title;
  }

  /** Builds the pill `<a>` element with favicon, title, and click handling. */
  toDOM(): HTMLElement {
    const pill = document.createElement("a");
    pill.className = "link-mention";
    pill.href = this.url;
    pill.setAttribute("target", "_blank");
    pill.setAttribute("rel", "noopener");

    if (this.meta.favicon) {
      const img = document.createElement("img");
      img.className = "link-mention-favicon";
      img.src = this.meta.favicon;
      img.alt = "";
      pill.appendChild(img);
    }

    const span = document.createElement("span");
    span.className = "link-mention-title";
    span.textContent = this.meta.title;

    pill.appendChild(span);

    // Prevent mousedown from moving the cursor into the widget range
    // (which would cause CM to remove the decoration and reveal markdown)
    pill.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    const normalized = normalizeUrl(this.url);
    pill.href = normalized;
    pill.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.open(normalized, "_blank");
    });

    return pill;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/** Regex for empty markdown links `[](url)`. Module-level to avoid re-creation. */
const EMPTY_LINK_RE = /\[]\(([^)]+)\)/g;

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

    constructor(view: EditorView) {
      const onFetch = () => {
        this.hasPendingFetches = true;
        view.dispatch();
      };
      const result = buildDecorations(view, onFetch);
      this.decorations = result.decorations;
      this.knownLinks = result.links;
    }

    update(update: ViewUpdate): void {
      const onFetch = () => {
        this.hasPendingFetches = true;
        update.view.dispatch();
      };

      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet
      ) {
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
  },
);
