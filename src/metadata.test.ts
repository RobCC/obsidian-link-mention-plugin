import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	arrayBufferToBase64,
	getContentType,
	extractFaviconUrl,
	getCachedMetadata,
	fetchLinkMetadata,
} from "./metadata";

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
	function makeDoc(html: string): Document {
		return new DOMParser().parseFromString(html, "text/html");
	}

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

		const meta = await fetchLinkMetadata("https://og-title.example");
		expect(meta.title).toBe("OG Title");
	});

	it("falls back to <title> when og:title is missing", async () => {
		mockRequestUrl.mockResolvedValue({
			text: "<html><head><title>Page Title</title></head></html>",
			headers: { "content-type": "text/html" },
			arrayBuffer: new ArrayBuffer(0),
			json: {},
			status: 200,
		});

		const meta = await fetchLinkMetadata("https://title-tag.example");
		expect(meta.title).toBe("Page Title");
	});

	it("falls back to hostname on network failure", async () => {
		mockRequestUrl.mockRejectedValue(new Error("Network error"));

		const meta = await fetchLinkMetadata("https://fail.example/page");
		expect(meta.title).toBe("fail.example");
	});

	it("deduplicates concurrent fetches for the same URL", async () => {
		mockRequestUrl.mockResolvedValue({
			text: "<html><head><title>Dedup</title></head></html>",
			headers: { "content-type": "text/html" },
			arrayBuffer: new ArrayBuffer(0),
			json: {},
			status: 200,
		});

		const url = "https://dedup.example";
		const [a, b] = await Promise.all([
			fetchLinkMetadata(url),
			fetchLinkMetadata(url),
		]);

		expect(a).toBe(b);
		// requestUrl called once for the page + favicon attempts, but only ONE
		// page fetch (the first call). Filter for calls with the target URL.
		const pageFetches = mockRequestUrl.mock.calls.filter(
			(args) => args[0]?.url === url
		);
		expect(pageFetches).toHaveLength(1);
	});

	it("returns cached value on subsequent calls", async () => {
		const url = "https://cached-return.example";
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
		// No additional network calls since it's cached
		const pageFetches = mockRequestUrl.mock.calls.filter(
			(args) => args[0]?.url === url
		);
		expect(pageFetches).toHaveLength(0);
	});
});
