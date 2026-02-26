/**
 * Standalone CLI script to test the title extraction fallback chain
 * against real pages.
 *
 * Usage: npx tsx src/test-titles.ts github.com reddit.com stackoverflow.com
 */

import { JSDOM, VirtualConsole } from "jsdom";

const virtualConsole = new VirtualConsole();

function extractDocTitle(doc: Document): string | undefined {
  const raw = doc.querySelector("title")?.textContent?.trim();
  if (!raw) return undefined;
  const segment = raw.split(/\s*[·|—–\-]\s*/)[0].trim();
  return segment || undefined;
}

function extractOgSiteName(doc: Document): string | undefined {
  return (
    doc
      .querySelector('meta[property="og:site_name"]')
      ?.getAttribute("content")
      ?.trim() || undefined
  );
}

function extractOgTitle(doc: Document): string | undefined {
  return (
    doc
      .querySelector('meta[property="og:title"]')
      ?.getAttribute("content")
      ?.trim() || undefined
  );
}

async function testUrl(raw: string): Promise<void> {
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  let doc: Document;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const html = await res.text();
    const dom = new JSDOM(html.slice(0, 51200), { virtualConsole });
    doc = dom.window.document;
  } catch (err) {
    console.log(`${raw}`);
    console.log(`  ERROR: ${err}`);
    console.log();
    return;
  }

  const docTitle = extractDocTitle(doc);
  const ogSiteName = extractOgSiteName(doc);
  const ogTitle = extractOgTitle(doc);

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = raw;
  }

  const winner = docTitle ?? ogSiteName ?? ogTitle ?? hostname;

  console.log(raw);
  console.log(`  docTitle:    ${docTitle ?? "(none)"}`);
  console.log(`  ogSiteName:  ${ogSiteName ?? "(none)"}`);
  console.log(`  ogTitle:     ${ogTitle ?? "(none)"}`);
  console.log(`  hostname:    ${hostname}`);
  console.log(`  → winner:    ${winner}`);
  console.log();
}

async function main() {
  const urls = process.argv.slice(2);
  if (urls.length === 0) {
    console.error("Usage: npx tsx src/test-titles.ts <url> [url...]");
    process.exit(1);
  }

  for (const url of urls) {
    await testUrl(url);
  }
}

main();
