# Astro Inline Editor — Agent Guide

Use when creating or editing pages that support the dev inline editor.

## Model

- Copy → JSON under `src/data/`
- Layout → `.astro` (icons, images, structure)
- Editable → opt-in via `contentEdit(file, path)` from `@heyupstart/astro-inline-editor`
- No route registry; tagged fields activate the editor automatically in dev

## New editable page

1. Add JSON content file
2. Refactor `.astro` to import JSON + render layout
3. Tag every editable field with `contentEdit`
4. Use HTML mode (`true`) for fields containing links or markup
5. Store section headings in JSON; sync QuickNav from headings

## Do not

- Infer/edit `.astro` source for copy
- Hardcode editable route lists
- Put non-content structure in JSON

See `rules/inline-editor.mdc` for full Cursor rule (copy to `.cursor/rules/`).
