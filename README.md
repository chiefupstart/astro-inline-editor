# astro-inline-editor

You (or your AI assistant) built a nice Astro site. Now you need to change one headline — and you're burning tokens explaining which file to open, or hunting through folders for ten minutes.

**astro-inline-editor** lets you click text on the page, edit it in place, and save — straight back to the source file. No database. No admin panel. Dev-only, localhost-only, auto-save when you click away.

## What is Astro?

[Astro](https://astro.build) is a modern way to build fast websites. You write pages in simple files; Astro turns them into plain HTML that loads instantly.

It is **not** a drag-and-drop site builder like Squarespace, and it is **not** WordPress. Think of it as a clean workshop: your AI (or developer) assembles the site once; you tweak the words without reopening the whole toolbox.

## Why not WordPress or Squarespace?

**WordPress** powers a huge chunk of the web — but for a small marketing site it is often overkill. You need PHP, a database, plugin updates, and an admin full of buttons you will never touch. Simple text edits can mean logging into wp-admin, finding the right page, and hoping you did not break a widget.

**Squarespace** (and similar builders) are great when you want templates and visual editing out of the box. The tradeoff is limits: custom layouts, odd integrations, and “why won't it let me do that?” moments.

**Astro** sits in a sweet spot: lightweight, fast, version-controlled files (great for AI coding tools), and no runtime database. The catch? Changing copy usually means editing a file — unless you add a polish layer for day-to-day tweaks.

That polish layer is what this package is for.

## Perfect for AI-built sites

More and more sites start as a conversation: “Build me a landing page for my nonprofit.” Cursor, Claude Code, or Copilot scaffold Astro pages, JSON data, or Markdown — and you are 95% done.

The last 5% is human: fix a typo, soften a headline, update a stat. You should not need another AI session for that. With astro-inline-editor:

1. Run your site locally (`npm run dev`)
2. Open the **Inline Editor** in the Astro dev toolbar (hover the bottom edge of the page if the toolbar is hidden)
3. Click any tagged line of text, edit, click away — **saved**

Production builds stay lean: the editor never ships to visitors. Only static HTML goes live.

## Try it on this page

You are looking at the package README rendered as a live demo.

- Turn on **Inline Editor** in the Astro dev toolbar
- Click any paragraph or heading below to edit
- Changes write back to `README.md` in the repo

**More examples:** [JSON impact story](/riverdale/) · [Markdown + frontmatter](/riverdale-year-two/)

## Install

```bash
npm install astro-inline-editor
```

## Setup

```js
// astro.config.mjs
import { defineConfig } from "astro/config";
import inlineEditor from "astro-inline-editor";

export default defineConfig({
  integrations: [
    inlineEditor({
      excludeRoots: ["/admin"], // optional URL blocklist
      dataDir: "src/data",      // JSON content root
      contentDir: "src/content", // Markdown content root
    }),
  ],
});
```

## Usage

1. Put copy in JSON (`src/data/`) or Markdown (`src/content/`)
2. Tag editable fields in your `.astro` templates with `contentEdit()`
3. Run `astro dev`
4. Toggle **Inline Editor** in the Astro dev toolbar and click text to edit

Edits auto-save on blur. Stay in edit mode until you toggle the toolbar app off. Use **Discard** in the toolbar panel to reload from disk.

### Tagging fields (JSON)

```astro
---
import content from "../data/pages/about.json";
import { contentEdit } from "astro-inline-editor";

const FILE = "src/data/pages/about.json";
const edit = (path, html = false) => contentEdit(FILE, path, html);
---

<h1 {...edit("hero.title")}>{content.hero.title}</h1>
<p {...edit("hero.intro")}>{content.hero.intro}</p>
```

### Tagging fields (Markdown)

Use YAML frontmatter for structured fields (hero, stats, CTAs) and `##` headings in the body for prose sections. Tag paths like `body.0.heading` and `body.0.paragraphs.1`. See the [Markdown example](/riverdale-year-two/) for a full page.

### Static HTML

Any `.html` file under `public/` gets editable text automatically in dev — no tagging required.

## AI assistant skills & rules

This package ships rules so your coding agent wires up editing correctly the first time:

```bash
mkdir -p .cursor/rules
cp node_modules/astro-inline-editor/rules/inline-editor.mdc .cursor/rules/
```

For Claude Code and other agents, see `rules/AGENTS.md` in the package. **Skills** (step-by-step setup and migration guides for Cursor and Claude) are on the roadmap — the rules file is the starting point today.

When you ask an AI to “make this headline editable,” point it at those rules so it uses `contentEdit()` instead of hard-coding copy in the template.

## How it works

| Source | When editor attaches | Saves to |
|--------|---------------------|----------|
| JSON-backed Astro pages | Rendered HTML has `data-edit-file` + `data-edit-path` | JSON file |
| Markdown-backed pages | Same tags; paths into frontmatter or body sections | `.md` file |
| Static HTML in `public/` | Always (dev only) | Same HTML file |

No route allowlist. New pages work when you wire `contentEdit()` — not when you update config.

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `excludeRoots` | `[]` | URL prefixes to skip |
| `dataDir` | `src/data` | Allowed directory for JSON saves |
| `contentDir` | `src/content` | Allowed directory for Markdown saves |

## Security

- Dev-only (integration skips production builds)
- Save endpoint rejects non-localhost hosts
- JSON and Markdown saves restricted to configured directories
- HTML saves restricted to `public/` or `src/pages/`

## License

MIT
