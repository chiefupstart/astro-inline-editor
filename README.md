# astro-inline-editor

Dev-only inline content editor for Astro — edit tagged copy in the browser, save straight to JSON or static HTML. Opt-in via `contentEdit()`, localhost-only.

On editable pages you'll see a **purple floating bar** (bottom-right) — that's the editor. The Astro dev toolbar pencil icon is optional; hover the **bottom edge** of the page if you don't see the Astro bar.

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
    }),
  ],
});
```

## Usage

1. Put copy in JSON under `src/data/`
2. Tag editable fields in your `.astro` templates
3. Run `astro dev`
4. On editable pages, click **Edit content** in the **floating bar** (bottom-right). Optionally, the Astro dev toolbar also has an Inline Editor app (hover the bottom of the page to reveal the Astro bar).

### Tagging fields

```astro
---
import content from "../data/pages/about.json";
import { contentEdit } from "astro-inline-editor";

const FILE = "src/data/pages/about.json";
const edit = (path, html = false) => contentEdit(FILE, path, html);
---

<h1 {...edit("hero.title")}>{content.hero.title}</h1>
<p {...edit("hero.intro")}>{content.hero.intro}</p>
<p {...edit("footer.html", true)} set:html={content.footer.html} />
```

### Static HTML

Any `.html` file served from `public/` gets editable text leaves automatically in dev.

## AI assistant rules

Copy the Cursor rule into your project:

```bash
mkdir -p .cursor/rules
cp node_modules/astro-inline-editor/rules/inline-editor.mdc .cursor/rules/
```

See also `rules/AGENTS.md` for Claude Code / generic agents.

## How it works

| Source | When editor attaches | Saves to |
|--------|---------------------|----------|
| JSON-backed Astro pages | Rendered HTML has `data-edit-file` + `data-edit-path` | JSON file |
| Static HTML in `public/` | Always (dev only) | Same HTML file |

No route allowlist. New pages work when you wire `contentEdit()` — not when you update config.

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `excludeRoots` | `[]` | URL prefixes to skip |
| `dataDir` | `src/data` | Allowed directory for JSON saves |

## Security

- Dev-only (integration skips production builds)
- Save endpoint rejects non-localhost hosts
- JSON saves restricted to `dataDir`
- HTML saves restricted to `public/` or `src/pages/`

## License

MIT
