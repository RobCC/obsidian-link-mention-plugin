import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	arrayBufferToBase64,
	getContentType,
	fetchOembedTitle,
	normalizeUrl,
	getCachedMetadata,
	fetchLinkMetadata,
} from "./metadata";
import {
	extractFaviconUrl,
	extractOgTitle,
	extractOgSiteName,
	extractAuthor,
	extractDocTitle,
	extractGithubTitle,
} from "./parsers/html";

import { requestUrl } from "obsidian";
const mockRequestUrl = vi.mocked(requestUrl);

describe("arrayBufferToBase64", () => {
	it("encodes an ArrayBuffer to base64 and roundtrips correctly", () => {
		const text = "Hello, world!";
		const encoder = new TextEncoder();
		const buffer = encoder.encode(text).buffer;
		const base64 = arrayBufferToBase64(buffer);
		expect(atob(base64)).toBe(text);
	});

	it("handles an empty buffer", () => {
		const buffer = new ArrayBuffer(0);
		expect(arrayBufferToBase64(buffer)).toBe("");
	});
});

describe("getContentType", () => {
	it("returns content-type from lowercase header", () => {
		expect(getContentType({ "content-type": "image/png" })).toBe("image/png");
	});

	it("returns content-type from mixed-case header", () => {
		expect(getContentType({ "Content-Type": "image/jpeg" })).toBe(
			"image/jpeg"
		);
	});

	it("strips charset parameter", () => {
		expect(
			getContentType({ "Content-Type": "text/html; charset=utf-8" })
		).toBe("text/html");
	});

	it("defaults to image/png when header is missing", () => {
		expect(getContentType({})).toBe("image/png");
	});
});

describe("extractFaviconUrl", () => {
	it('extracts href from <link rel="icon">', () => {
		const doc = makeDoc(
			'<html><head><link rel="icon" href="/favicon.ico"></head></html>'
		);
		expect(extractFaviconUrl(doc, "https://example.com/page")).toBe(
			"https://example.com/favicon.ico"
		);
	});

	it("resolves a relative href against the page URL", () => {
		const doc = makeDoc(
			'<html><head><link rel="icon" href="img/icon.png"></head></html>'
		);
		expect(extractFaviconUrl(doc, "https://example.com/a/b")).toBe(
			"https://example.com/a/img/icon.png"
		);
	});

	it('matches <link rel="shortcut icon">', () => {
		const doc = makeDoc(
			'<html><head><link rel="shortcut icon" href="/si.ico"></head></html>'
		);
		expect(extractFaviconUrl(doc, "https://example.com")).toBe(
			"https://example.com/si.ico"
		);
	});

	it('matches <link rel="apple-touch-icon">', () => {
		const doc = makeDoc(
			'<html><head><link rel="apple-touch-icon" href="/apple.png"></head></html>'
		);
		expect(extractFaviconUrl(doc, "https://example.com")).toBe(
			"https://example.com/apple.png"
		);
	});

	it("returns null when no favicon link is present", () => {
		const doc = makeDoc("<html><head></head></html>");
		expect(extractFaviconUrl(doc, "https://example.com")).toBeNull();
	});
});

function makeDoc(html: string): Document {
	return new DOMParser().parseFromString(html, "text/html");
}

describe("extractOgTitle", () => {
	it("extracts og:title content", () => {
		const doc = makeDoc(
			'<html><head><meta property="og:title" content="OG Title"></head></html>'
		);
		expect(extractOgTitle(doc)).toBe("OG Title");
	});

	it("returns undefined when og:title is missing", () => {
		const doc = makeDoc("<html><head></head></html>");
		expect(extractOgTitle(doc)).toBeUndefined();
	});

	it("returns undefined for empty content", () => {
		const doc = makeDoc(
			'<html><head><meta property="og:title" content=""></head></html>'
		);
		expect(extractOgTitle(doc)).toBeUndefined();
	});
});

describe("extractOgSiteName", () => {
	it("extracts og:site_name content", () => {
		const doc = makeDoc(
			'<html><head><meta property="og:site_name" content="GitHub"></head></html>'
		);
		expect(extractOgSiteName(doc)).toBe("GitHub");
	});

	it("returns undefined when og:site_name is missing", () => {
		const doc = makeDoc("<html><head></head></html>");
		expect(extractOgSiteName(doc)).toBeUndefined();
	});
});

describe("extractAuthor", () => {
	it("extracts author content", () => {
		const doc = makeDoc(
			'<html><head><meta name="author" content="John Doe"></head></html>'
		);
		expect(extractAuthor(doc)).toBe("John Doe");
	});

	it("returns undefined when author is missing", () => {
		const doc = makeDoc("<html><head></head></html>");
		expect(extractAuthor(doc)).toBeUndefined();
	});

	it("returns undefined for empty content", () => {
		const doc = makeDoc(
			'<html><head><meta name="author" content=""></head></html>'
		);
		expect(extractAuthor(doc)).toBeUndefined();
	});
});

describe("extractDocTitle", () => {
	it("returns the full title when no separator is present", () => {
		const doc = makeDoc("<html><head><title>No separator</title></head></html>");
		expect(extractDocTitle(doc)).toBe("No separator");
	});

	it("splits on · and returns the first segment", () => {
		const doc = makeDoc(
			"<html><head><title>GitHub · Change is constant. GitHub keeps you ahead. · GitHub</title></head></html>"
		);
		expect(extractDocTitle(doc)).toBe("GitHub");
	});

	it("splits on | and returns the first segment", () => {
		const doc = makeDoc(
			"<html><head><title>Title | Site</title></head></html>"
		);
		expect(extractDocTitle(doc)).toBe("Title");
	});

	it("splits on — (em dash) and returns the first segment", () => {
		const doc = makeDoc(
			"<html><head><title>Article — Blog</title></head></html>"
		);
		expect(extractDocTitle(doc)).toBe("Article");
	});

	it("does not split on hyphen (too common in real content)", () => {
		const doc = makeDoc(
			"<html><head><title>GitHub - charmbracelet/crush: Description</title></head></html>"
		);
		expect(extractDocTitle(doc)).toBe("GitHub - charmbracelet/crush: Description");
	});

	it("returns undefined when title element is missing", () => {
		const doc = makeDoc("<html><head></head></html>");
		expect(extractDocTitle(doc)).toBeUndefined();
	});

	it("returns undefined when title is empty", () => {
		const doc = makeDoc("<html><head><title></title></head></html>");
		expect(extractDocTitle(doc)).toBeUndefined();
	});
});

describe("extractGithubTitle", () => {
	it("returns og:title without description suffix", () => {
		const doc = makeDoc(
			'<html><head><meta property="og:title" content="obsidianmd/obsidian-api: The Obsidian API"><title>GitHub - obsidianmd/obsidian-api: The Obsidian API</title></head></html>'
		);
		expect(extractGithubTitle(doc)).toBe("obsidianmd/obsidian-api");
	});

	it("returns og:title as-is when no colon is present", () => {
		const doc = makeDoc(
			'<html><head><meta property="og:title" content="obsidianmd/obsidian-api"></head></html>'
		);
		expect(extractGithubTitle(doc)).toBe("obsidianmd/obsidian-api");
	});

	it("falls back to doc title when og:title is missing", () => {
		const doc = makeDoc(
			"<html><head><title>GitHub - owner/repo: Some description</title></head></html>"
		);
		expect(extractGithubTitle(doc)).toBe("GitHub - owner/repo");
	});

	it("returns undefined when both og:title and doc title are missing", () => {
		const doc = makeDoc("<html><head></head></html>");
		expect(extractGithubTitle(doc)).toBeUndefined();
	});
});

describe("fetchOembedTitle", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("returns title for a YouTube watch URL", async () => {
		mockRequestUrl.mockResolvedValue({
			json: { title: "My Video Title" },
			text: "",
			headers: {},
			arrayBuffer: new ArrayBuffer(0),
			status: 200,
		});

		const title = await fetchOembedTitle(
			"https://www.youtube.com/watch?v=abc123"
		);
		expect(title).toBe("My Video Title");
		expect(mockRequestUrl).toHaveBeenCalledWith(
			expect.objectContaining({
				url: expect.stringContaining("youtube.com/oembed"),
			})
		);
	});

	it("returns title for a youtu.be short URL", async () => {
		mockRequestUrl.mockResolvedValue({
			json: { title: "Short URL Video" },
			text: "",
			headers: {},
			arrayBuffer: new ArrayBuffer(0),
			status: 200,
		});

		const title = await fetchOembedTitle("https://youtu.be/abc123");
		expect(title).toBe("Short URL Video");
	});

	it("returns title for a Vimeo URL", async () => {
		mockRequestUrl.mockResolvedValue({
			json: { title: "Vimeo Video" },
			text: "",
			headers: {},
			arrayBuffer: new ArrayBuffer(0),
			status: 200,
		});

		const title = await fetchOembedTitle("https://vimeo.com/123456");
		expect(title).toBe("Vimeo Video");
	});

	it("returns undefined for non-oEmbed URLs", async () => {
		const title = await fetchOembedTitle("https://github.com");
		expect(title).toBeUndefined();
		expect(mockRequestUrl).not.toHaveBeenCalled();
	});

	it("returns undefined when oEmbed request fails", async () => {
		mockRequestUrl.mockRejectedValue(new Error("Network error"));

		const title = await fetchOembedTitle(
			"https://www.youtube.com/watch?v=abc123"
		);
		expect(title).toBeUndefined();
	});
});

describe("normalizeUrl", () => {
	it("adds www. for bare 2-segment domains", () => {
		expect(normalizeUrl("https://example.com")).toBe(
			"https://www.example.com/"
		);
	});

	it("does not add www. when a subdomain already exists", () => {
		expect(normalizeUrl("https://docs.google.com")).toBe(
			"https://docs.google.com/"
		);
	});

	it("does not add www. when www. is already present", () => {
		expect(normalizeUrl("https://www.google.com")).toBe(
			"https://www.google.com/"
		);
	});

	it("preserves http:// protocol", () => {
		expect(normalizeUrl("http://example.com")).toBe(
			"http://www.example.com/"
		);
	});

	it("preserves path, query, and fragment", () => {
		expect(normalizeUrl("https://example.com/path?q=1#frag")).toBe(
			"https://www.example.com/path?q=1#frag"
		);
	});

	it("returns the input as-is for unparseable strings", () => {
		expect(normalizeUrl("not a url")).toBe("not a url");
	});
});

describe("getCachedMetadata", () => {
	it("returns undefined for an uncached URL", () => {
		expect(getCachedMetadata("https://never-fetched.example")).toBeUndefined();
	});
});

describe("fetchLinkMetadata", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("extracts title from og:title", async () => {
		mockRequestUrl.mockResolvedValue({
			text: '<html><head><meta property="og:title" content="OG Title"></head></html>',
			headers: { "content-type": "text/html" },
			arrayBuffer: new ArrayBuffer(0),
			json: {},
			status: 200,
		});

		const meta = await fetchLinkMetadata("https://www.og-title.example");
		expect(meta.title).toBe("OG Title");
	});

	it("extracts author from meta author tag", async () => {
		mockRequestUrl.mockResolvedValue({
			text: '<html><head><meta name="author" content="Jane"><title>Post</title></head></html>',
			headers: { "content-type": "text/html" },
			arrayBuffer: new ArrayBuffer(0),
			json: {},
			status: 200,
		});

		const meta = await fetchLinkMetadata("https://www.author-tag.example");
		expect(meta.author).toBe("Jane");
		expect(meta.title).toBe("Post");
	});

	it("ignores og:site_name for author", async () => {
		mockRequestUrl.mockResolvedValue({
			text: '<html><head><meta property="og:site_name" content="GitHub"><title>Repo</title></head></html>',
			headers: { "content-type": "text/html" },
			arrayBuffer: new ArrayBuffer(0),
			json: {},
			status: 200,
		});

		const meta = await fetchLinkMetadata("https://www.site-name.example");
		expect(meta.author).toBe("");
		expect(meta.title).toBe("Repo");
	});

	it("returns empty author when meta author is missing", async () => {
		mockRequestUrl.mockResolvedValue({
			text: "<html><head><title>No Author</title></head></html>",
			headers: { "content-type": "text/html" },
			arrayBuffer: new ArrayBuffer(0),
			json: {},
			status: 200,
		});

		const meta = await fetchLinkMetadata("https://www.no-author.example");
		expect(meta.author).toBe("");
	});

	it("falls back to <title> when og:title is missing", async () => {
		mockRequestUrl.mockResolvedValue({
			text: "<html><head><title>Page Title</title></head></html>",
			headers: { "content-type": "text/html" },
			arrayBuffer: new ArrayBuffer(0),
			json: {},
			status: 200,
		});

		const meta = await fetchLinkMetadata("https://www.title-tag.example");
		expect(meta.title).toBe("Page Title");
	});

	it("falls back to hostname for non-HTML content-type", async () => {
		mockRequestUrl.mockResolvedValue({
			text: '{"key": "value"}',
			headers: { "content-type": "application/json" },
			arrayBuffer: new ArrayBuffer(0),
			json: {},
			status: 200,
		});

		const meta = await fetchLinkMetadata("https://www.api.example/data");
		expect(meta.title).toBe("www.api.example");
	});

	it("falls back to hostname on network failure without caching", async () => {
		mockRequestUrl.mockRejectedValue(new Error("Network error"));

		const meta = await fetchLinkMetadata("https://www.fail.example/page");
		expect(meta.title).toBe("www.fail.example");

		// Should NOT be cached — next call should retry
		expect(getCachedMetadata("https://www.fail.example/page")).toBeUndefined();
	});

	it("deduplicates concurrent fetches for the same URL", async () => {
		mockRequestUrl.mockResolvedValue({
			text: "<html><head><title>Dedup</title></head></html>",
			headers: { "content-type": "text/html" },
			arrayBuffer: new ArrayBuffer(0),
			json: {},
			status: 200,
		});

		const url = "https://www.dedup.example/";
		const [a, b] = await Promise.all([
			fetchLinkMetadata(url),
			fetchLinkMetadata(url),
		]);

		expect(a).toBe(b);
		const pageFetches = mockRequestUrl.mock.calls.filter(
			(args) => args[0]?.url === url
		);
		expect(pageFetches).toHaveLength(1);
	});

	it("returns cached value on subsequent calls", async () => {
		const url = "https://www.cached-return.example/";
		mockRequestUrl.mockResolvedValue({
			text: "<html><head><title>Cached</title></head></html>",
			headers: { "content-type": "text/html" },
			arrayBuffer: new ArrayBuffer(0),
			json: {},
			status: 200,
		});

		await fetchLinkMetadata(url);
		mockRequestUrl.mockClear();

		const cached = getCachedMetadata(url);
		expect(cached).toBeDefined();
		expect(cached!.title).toBe("Cached");

		const meta = await fetchLinkMetadata(url);
		expect(meta.title).toBe("Cached");
		const pageFetches = mockRequestUrl.mock.calls.filter(
			(args) => args[0]?.url === url
		);
		expect(pageFetches).toHaveLength(0);
	});

	it("strips description from GitHub repo titles", async () => {
		mockRequestUrl.mockResolvedValue({
			text: '<html><head><meta property="og:title" content="obsidianmd/obsidian-api: The Obsidian API"><title>GitHub - obsidianmd/obsidian-api: The Obsidian API</title></head></html>',
			headers: { "content-type": "text/html" },
			arrayBuffer: new ArrayBuffer(0),
			json: {},
			status: 200,
		});

		const meta = await fetchLinkMetadata("https://github.com/obsidianmd/obsidian-api");
		expect(meta.title).toBe("obsidianmd/obsidian-api");
	});

	it("normalizes bare domain before fetching", async () => {
		mockRequestUrl.mockResolvedValue({
			text: "<html><head><title>Normalized</title></head></html>",
			headers: { "content-type": "text/html" },
			arrayBuffer: new ArrayBuffer(0),
			json: {},
			status: 200,
		});

		const meta = await fetchLinkMetadata("https://example.com");
		expect(meta.title).toBe("Normalized");

		const pageFetch = mockRequestUrl.mock.calls.find(
			(args) => args[0]?.url === "https://www.example.com/"
		);
		expect(pageFetch).toBeDefined();
	});
});
