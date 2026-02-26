import { describe, it, expect } from "vitest";
import { createPill, isEmptyTextLink } from "./reading-view";

describe("createPill", () => {
	it("creates an anchor with correct class, href, and target", () => {
		const pill = createPill("Example", "", "https://example.com");
		expect(pill.tagName).toBe("A");
		expect(pill.className).toBe("link-mention external-link");
		expect((pill as HTMLAnchorElement).href).toBe("https://example.com/");
		expect(pill.getAttribute("target")).toBe("_blank");
		expect(pill.getAttribute("rel")).toBe("noopener");
	});

	it("includes a favicon img when favicon is provided", () => {
		const pill = createPill("Ex", "data:image/png;base64,abc", "https://ex.com");
		const img = pill.querySelector("img.link-mention-favicon") as HTMLImageElement;
		expect(img).not.toBeNull();
		expect(img.src).toBe("data:image/png;base64,abc");
		expect(img.alt).toBe("");
	});

	it("omits favicon img when favicon is empty", () => {
		const pill = createPill("Ex", "", "https://ex.com");
		const img = pill.querySelector("img");
		expect(img).toBeNull();
	});

	it("includes a title span with correct text", () => {
		const pill = createPill("My Title", "", "https://ex.com");
		const span = pill.querySelector("span.link-mention-title");
		expect(span).not.toBeNull();
		expect(span!.textContent).toBe("My Title");
	});
});

describe("isEmptyTextLink", () => {
	function makeLink(href: string, text: string): HTMLAnchorElement {
		const a = document.createElement("a");
		a.setAttribute("href", href);
		a.textContent = text;
		return a;
	}

	it("returns true when text is empty", () => {
		expect(isEmptyTextLink(makeLink("https://ex.com", ""))).toBe(true);
	});

	it("returns true when text matches href", () => {
		expect(
			isEmptyTextLink(makeLink("https://ex.com", "https://ex.com"))
		).toBe(true);
	});

	it("returns false when text differs from href", () => {
		expect(
			isEmptyTextLink(makeLink("https://ex.com", "Click here"))
		).toBe(false);
	});
});
