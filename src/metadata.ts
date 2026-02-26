import { requestUrl } from "obsidian";

export interface LinkMetadata {
	title: string;
	favicon: string;
}

const cache = new Map<string, LinkMetadata>();
const inflight = new Map<string, Promise<LinkMetadata>>();

function faviconUrl(url: string): string {
	try {
		const host = new URL(url).hostname;
		return `https://www.google.com/s2/favicons?domain=${host}&sz=32`;
	} catch {
		return "";
	}
}

function fallbackMetadata(url: string): LinkMetadata {
	let host: string;
	try {
		host = new URL(url).hostname;
	} catch {
		host = url;
	}
	return { title: host, favicon: faviconUrl(url) };
}

async function doFetch(url: string): Promise<LinkMetadata> {
	try {
		const response = await requestUrl({ url, method: "GET" });
		const html = response.text;
		const doc = new DOMParser().parseFromString(html, "text/html");

		const ogTitle = doc.querySelector('meta[property="og:title"]');
		let title = ogTitle?.getAttribute("content")?.trim();

		if (!title) {
			const titleEl = doc.querySelector("title");
			title = titleEl?.textContent?.trim();
		}

		if (!title) {
			title = new URL(url).hostname;
		}

		return { title, favicon: faviconUrl(url) };
	} catch {
		return fallbackMetadata(url);
	}
}

export function getCachedMetadata(url: string): LinkMetadata | undefined {
	return cache.get(url);
}

export async function fetchLinkMetadata(url: string): Promise<LinkMetadata> {
	const cached = cache.get(url);
	if (cached) return cached;

	let pending = inflight.get(url);
	if (pending) return pending;

	pending = doFetch(url).then((meta) => {
		cache.set(url, meta);
		inflight.delete(url);
		return meta;
	});
	inflight.set(url, pending);
	return pending;
}
