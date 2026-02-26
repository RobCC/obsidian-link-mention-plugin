import { MarkdownPostProcessorContext } from "obsidian";
import { fetchLinkMetadata, getCachedMetadata } from "./metadata";

function createPill(title: string, favicon: string, href: string): HTMLElement {
	const pill = document.createElement("a");
	pill.className = "link-mention external-link";
	pill.href = href;
	pill.setAttribute("target", "_blank");
	pill.setAttribute("rel", "noopener");

	const img = document.createElement("img");
	img.className = "link-mention-favicon";
	img.src = favicon;
	img.alt = "";

	const span = document.createElement("span");
	span.className = "link-mention-title";
	span.textContent = title;

	pill.appendChild(img);
	pill.appendChild(span);
	return pill;
}

function isEmptyTextLink(el: HTMLAnchorElement): boolean {
	const href = el.getAttribute("href") || "";
	const text = el.textContent?.trim() || "";
	// Obsidian renders [](url) with the URL itself as visible text
	return text === "" || text === href;
}

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
			const pill = createPill(cached.title, cached.favicon, href);
			link.replaceWith(pill);
		} else {
			// Show hostname immediately, then upgrade when fetch completes
			const placeholder = createPill(
				new URL(href).hostname,
				`https://www.google.com/s2/favicons?domain=${new URL(href).hostname}&sz=32`,
				href
			);
			link.replaceWith(placeholder);

			fetchLinkMetadata(href).then((meta) => {
				const pill = createPill(meta.title, meta.favicon, href);
				placeholder.replaceWith(pill);
			});
		}
	}
}
