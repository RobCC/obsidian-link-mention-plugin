import { describe, it, expect } from "vitest";
import { extractUrlTitle } from "./url";

describe("extractUrlTitle", () => {
  it("extracts title from Amazon product URL", () => {
    expect(
      extractUrlTitle(
        "https://www.amazon.es/Motivational-Interviewing-Fourth-Helping-Applications/dp/146255279X/ref=asc_df_146255279X"
      )
    ).toBe("Motivational Interviewing Fourth Helping Applications");
  });

  it("extracts title from blog article slug", () => {
    expect(
      extractUrlTitle("https://example.com/news/2024/some-great-article-title")
    ).toBe("Some Great Article Title");
  });

  it("returns hostname when no meaningful slug exists", () => {
    expect(extractUrlTitle("https://www.amazon.es/dp/146255279X")).toBe(
      "www.amazon.es"
    );
  });

  it("returns hostname for query-only paths", () => {
    expect(
      extractUrlTitle("https://news.ycombinator.com/item?id=12345")
    ).toBe("news.ycombinator.com");
  });

  it("returns hostname for root URL", () => {
    expect(extractUrlTitle("https://example.com/")).toBe("example.com");
  });

  it("returns hostname for short path segments", () => {
    expect(extractUrlTitle("https://example.com/en/page")).toBe("example.com");
  });

  it("handles underscores as word separators", () => {
    expect(
      extractUrlTitle("https://example.com/docs/getting_started_with_obsidian")
    ).toBe("Getting Started With Obsidian");
  });

  it("picks the longest segment when multiple qualify", () => {
    expect(
      extractUrlTitle(
        "https://example.com/some-category/a-very-long-article-title-here/comments"
      )
    ).toBe("A Very Long Article Title Here");
  });

  it("handles percent-encoded characters", () => {
    expect(
      extractUrlTitle("https://example.com/my-great%20article-title")
    ).toBe("My Great Article Title");
  });

  it("returns the raw string for unparseable input", () => {
    expect(extractUrlTitle("not a url")).toBe("not a url");
  });
});
