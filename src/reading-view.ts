import { MarkdownPostProcessorContext, setIcon } from "obsidian";
import { fetchLinkMetadata, getCachedMetadata } from "./metadata";

/**
 * Creates a styled `<a>` pill element displaying a favicon and title
 * for an external link. Used by the reading-view post-processor to
 * replace bare `[](url)` links.
 *
 * @internal exported for testing
 */
export function createPill(title: string, favicon: string, href: string, author = ""): HTMLElement {
	const pill = document.createElement("a");
	pill.className = "link-mention external-link";
	pill.href = href;
	pill.setAttribute("target", "_blank");
	pill.setAttribute("rel", "noopener");

	if (favicon) {
		const img = document.createElement("img");
		img.className = "link-mention-favicon";
		img.src = favicon;
		img.alt = "";
		img.addEventListener("error", () => { img.style.display = "none"; });
		pill.appendChild(img);
	} else {
		const iconEl = document.createElement("span");
		iconEl.className = "link-mention-favicon link-mention-default-icon";
		setIcon(iconEl, "link");
		pill.appendChild(iconEl);
	}

	if (author) {
		const authorSpan = document.createElement("span");
		authorSpan.className = "link-mention-author";
		authorSpan.textContent = author;
		pill.appendChild(authorSpan);
	}

	const span = document.createElement("span");
	span.className = "link-mention-title";
	span.textContent = title;

	pill.appendChild(span);
	return pill;
}

/**
 * Returns `true` if an anchor has no meaningful display text — i.e. the
 * text content is empty or identical to the href. This identifies links
 * rendered from the `[](url)` markdown pattern.
 *
 * @internal exported for testing
 */
export function isEmptyTextLink(el: HTMLAnchorElement): boolean {
	const href = el.getAttribute("href") || "";
	const text = el.textContent?.trim() || "";
	// Obsidian renders [](url) with the URL itself as visible text
	return text === "" || text === href;
}

/**
 * Markdown post-processor for reading view. Finds all `a.external-link`
 * elements with no display text (from `[](url)` syntax), replaces them
 * with styled mention pills, and triggers metadata fetches for uncached URLs.
 */
export function readingViewPostProcessor(
	el: HTMLElement,
	_ctx: MarkdownPostProcessorContext
): void {
	const links = el.querySelectorAll<HTMLAnchorElement>("a.external-link");

	for (const link of Array.from(links)) {
		if (!isEmptyTextLink(link)) continue;

		const href = link.getAttribute("href");
		if (!href) continue;

		const cached = getCachedMetadata(href);
		if (cached) {
			const pill = createPill(cached.title, cached.favicon, href, cached.author);
			link.replaceWith(pill);
		} else {
			// Show hostname placeholder, then upgrade when fetch completes
			let host: string;
			try {
				host = new URL(href).hostname;
			} catch {
				host = href;
			}
			const placeholder = createPill(host, "", href);
			link.replaceWith(placeholder);

			fetchLinkMetadata(href).then((meta) => {
				const pill = createPill(meta.title, meta.favicon, href, meta.author);
				placeholder.replaceWith(pill);
			});
		}
	}
}
