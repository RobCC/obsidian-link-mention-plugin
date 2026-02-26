# Link Mention — Obsidian Plugin

Render empty markdown links (`[](url)`) as rich inline pills showing the website's favicon and page title — similar to Notion's link mentions.

Your markdown source is never modified; the pill is purely visual.

![Example: [](https://github.com) renders as a pill with the GitHub favicon and "GitHub" title](https://img.shields.io/badge/example-%F0%9F%8C%90%20GitHub-blue?style=flat-square)

## How It Works

1. Write `[](https://github.com)` in a note
2. The plugin fetches the page title ("GitHub") and resolves the favicon
3. In both **Live Preview** and **Reading View**, the raw markdown is replaced visually with a compact inline pill showing the favicon and title
4. In Live Preview, moving your cursor into the pill reveals the raw markdown for editing
5. Normal links with custom text (`[My text](https://github.com)`) are left untouched

## Installation

### From source

```bash
git clone https://github.com/your-repo/obsidian-link-mention.git
cd obsidian-link-mention
npm install
npm run build
```

### Adding to your vault

Copy the following three files into your vault's plugin directory:

```
<your-vault>/.obsidian/plugins/link-mention/
├── main.js
├── manifest.json
└── styles.css
```

Then open **Obsidian Settings → Community Plugins**, enable "Link Mention", and reload.

## Usage

Write an empty-text markdown link in any note:

```markdown
Check out [](https://github.com) for code hosting.

Here's a doc page: [](https://developer.mozilla.org/en-US/docs/Web)
```

Each `[](url)` is rendered as an inline pill with the site's favicon and page title. The pill is clickable and opens the URL in your browser.

To use a normal link with your own text, write it as usual — the plugin won't touch it:

```markdown
[My custom text](https://github.com)
```

## Development

```bash
# Install dependencies
npm install

# Build for production (type-checks then bundles)
npm run build

# Watch mode (rebuilds on file changes)
npm run dev
```

The build produces a single `main.js` file in the project root via esbuild.

## Architecture

```
src/
├── main.ts           # Plugin entry point — registers extensions
├── metadata.ts       # Fetches page title + favicon, with in-memory cache
├── live-preview.ts   # CodeMirror 6 ViewPlugin for Live Preview decorations
└── reading-view.ts   # MarkdownPostProcessor for Reading View
```

| Component | Approach | Why |
|-----------|----------|-----|
| Favicon | Google Favicons API | Reliable, fast, no CORS issues |
| Page fetch | Obsidian `requestUrl` | Bypasses CORS, works on desktop and mobile |
| Live Preview | CM6 `ViewPlugin` + `WidgetType` | Viewport-scoped, performant inline decorations |
| Caching | In-memory `Map` | Simple, clears on plugin reload, no stale data |

## License

MIT
