/**
 * Standalone CLI script to test the title extraction fallback chain
 * against real pages.
 *
 * Usage: npx tsx src/test-titles.ts github.com reddit.com stackoverflow.com
 */

import * as https from 'https';
import * as http from 'http';
import type { IncomingMessage } from 'http';
// @ts-expect-error — jsdom has no bundled types and @types/jsdom conflicts with peer deps
import { JSDOM, VirtualConsole } from 'jsdom';

const virtualConsole = new VirtualConsole();

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Fetch URL using http/https modules (Node's fetch silently strips User-Agent). */
function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res: IncomingMessage) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(httpGet(res.headers.location));
        return;
      }
      let data = '';
      res.on('data', (chunk: Buffer) => {
        data += chunk.toString();
        if (data.length > 51200) {
          res.destroy();
          resolve(data);
        }
      });
      res.on('end', () => resolve(data));
      res.on('close', () => resolve(data));
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

const OEMBED_ENDPOINTS: { pattern: RegExp; endpoint: string }[] = [
  {
    pattern: /^https?:\/\/(www\.)?youtube\.com\/watch/,
    endpoint: 'https://www.youtube.com/oembed?format=json&url=',
  },
  {
    pattern: /^https?:\/\/youtu\.be\//,
    endpoint: 'https://www.youtube.com/oembed?format=json&url=',
  },
  {
    pattern: /^https?:\/\/(www\.)?vimeo\.com\/\d+/,
    endpoint: 'https://vimeo.com/api/oembed.json?url=',
  },
];

async function fetchOembedTitle(url: string): Promise<string | undefined> {
  for (const { pattern, endpoint } of OEMBED_ENDPOINTS) {
    if (pattern.test(url)) {
      try {
        const json = await httpGet(`${endpoint}${encodeURIComponent(url)}`);
        const title = JSON.parse(json).title?.trim();
        return title || undefined;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function extractDocTitle(doc: Document): string | undefined {
  const raw = doc.querySelector('title')?.textContent?.trim();
  if (!raw) {
    return undefined;
  }
  const segment = raw.split(/\s*[·|—–]\s*/)[0].trim();
  return segment || undefined;
}

function extractOgSiteName(doc: Document): string | undefined {
  return (
    doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim() || undefined
  );
}

function extractOgTitle(doc: Document): string | undefined {
  return (
    doc.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() || undefined
  );
}

async function testUrl(raw: string): Promise<void> {
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  let doc: Document;
  try {
    const html = await httpGet(url);
    const dom = new JSDOM(html.slice(0, 51200), { virtualConsole });
    doc = dom.window.document;
  } catch (err) {
    console.log(`${raw}`);
    console.log(`  ERROR: ${err}`);
    console.log();
    return;
  }

  const oembedTitle = await fetchOembedTitle(url);
  const docTitle = extractDocTitle(doc);
  const ogSiteName = extractOgSiteName(doc);
  const ogTitle = extractOgTitle(doc);

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = raw;
  }

  const winner = oembedTitle ?? docTitle ?? ogSiteName ?? ogTitle ?? hostname;

  console.log(raw);
  console.log(`  oEmbed:      ${oembedTitle ?? '(none)'}`);
  console.log(`  docTitle:    ${docTitle ?? '(none)'}`);
  console.log(`  ogSiteName:  ${ogSiteName ?? '(none)'}`);
  console.log(`  ogTitle:     ${ogTitle ?? '(none)'}`);
  console.log(`  hostname:    ${hostname}`);
  console.log(`  → winner:    ${winner}`);
  console.log();
}

async function main() {
  const urls = process.argv.slice(2);
  if (urls.length === 0) {
    console.error('Usage: npx tsx src/test-titles.ts <url> [url...]');
    process.exit(1);
  }

  for (const url of urls) {
    await testUrl(url);
  }
}

main();
