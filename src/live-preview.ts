import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { EditorSelection, Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { fetchLinkMetadata, getCachedMetadata, LinkMetadata, normalizeUrl } from "./metadata";

class LinkMentionWidget extends WidgetType {
  constructor(
    private readonly url: string,
    private readonly meta: LinkMetadata,
  ) {
    super();
  }

  eq(other: LinkMentionWidget): boolean {
    return this.url === other.url && this.meta.title === other.meta.title;
  }

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

/** @internal exported for testing */
export function cursorInRange(
  selection: EditorSelection,
  from: number,
  to: number,
): boolean {
  return selection.ranges.some((range) => range.from >= from && range.to <= to);
}

function buildDecorations(
  view: EditorView,
  onFetchComplete: () => void,
): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const doc = view.state.doc;

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        // Look for link nodes in the markdown syntax tree.
        // In Obsidian's CM6 Lezer grammar, links are represented as
        // nodes with type names containing "link" and "hmd-internal-link"
        // or formatting_formatting-link nodes. We match the full
        // [](url) pattern via regex on the text instead for reliability.
        if (
          node.name !== "hmd-internal-link" &&
          !node.name.startsWith("formatting")
        ) {
          return;
        }
      },
    });
  }

  // Instead of relying on the syntax tree node types (which vary across
  // Obsidian versions), scan the visible text with a regex.
  const emptyLinkRe = /\[]\(([^)]+)\)/g;

  for (const { from, to } of view.visibleRanges) {
    const text = doc.sliceString(from, to);
    let match: RegExpExecArray | null;
    while ((match = emptyLinkRe.exec(text)) !== null) {
      const matchFrom = from + match.index;
      const matchTo = matchFrom + match[0].length;
      const url = match[1];

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

  return Decoration.set(decorations, true);
}

export const livePreviewExtension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    hasPendingFetches = false;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view, () => {
        this.hasPendingFetches = true;
        view.dispatch();
      });
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        this.hasPendingFetches
      ) {
        this.hasPendingFetches = false;
        this.decorations = buildDecorations(update.view, () => {
          this.hasPendingFetches = true;
          update.view.dispatch();
        });
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);
