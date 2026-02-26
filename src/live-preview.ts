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
import { fetchLinkMetadata, getCachedMetadata, LinkMetadata } from "./metadata";

class LinkMentionWidget extends WidgetType {
	constructor(
		private readonly url: string,
		private readonly meta: LinkMetadata
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

		const img = document.createElement("img");
		img.className = "link-mention-favicon";
		img.src = this.meta.favicon;
		img.alt = "";

		const span = document.createElement("span");
		span.className = "link-mention-title";
		span.textContent = this.meta.title;

		pill.appendChild(img);
		pill.appendChild(span);
		return pill;
	}

	ignoreEvent(): boolean {
		return false;
	}
}

function cursorInRange(
	selection: EditorSelection,
	from: number,
	to: number
): boolean {
	return selection.ranges.some(
		(range) => range.from >= from && range.to <= to
	);
}

function buildDecorations(view: EditorView): DecorationSet {
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
					}).range(matchFrom, matchTo)
				);
			} else {
				// Trigger async fetch; the plugin will re-decorate once
				// the metadata arrives (via requestMeasure).
				fetchLinkMetadata(url).then(() => {
					view.dispatch();
				});
			}
		}
	}

	return Decoration.set(decorations, true);
}

export const livePreviewExtension = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = buildDecorations(view);
		}

		update(update: ViewUpdate): void {
			if (
				update.docChanged ||
				update.viewportChanged ||
				update.selectionSet
			) {
				this.decorations = buildDecorations(update.view);
			}
		}
	},
	{
		decorations: (v) => v.decorations,
	}
);
