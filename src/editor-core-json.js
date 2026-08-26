import { hashOf } from "./editor-core.js";

export { hashOf };

function parsePath(path) {
  return path.split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

function getAt(root, path) {
  let cur = root;
  for (const key of parsePath(path)) {
    if (cur == null) return undefined;
    cur = cur[key];
  }
  return cur;
}

function setAt(root, path, value) {
  const keys = parsePath(path);
  let cur = root;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (cur[key] == null) cur[key] = typeof keys[i + 1] === "number" ? [] : {};
    cur = cur[key];
  }
  cur[keys[keys.length - 1]] = value;
}

export function applyJsonEdits(raw, edits) {
  const data = JSON.parse(raw);
  for (const { path, text } of edits) {
    if (!path) throw Object.assign(new Error("missing path for json edit"), { status: 400 });
    if (getAt(data, path) === undefined) {
      throw Object.assign(new Error(`path not found: ${path}`), { status: 400 });
    }
    setAt(data, path, text);
  }
  return JSON.stringify(data, null, 2) + "\n";
}

/**
 * Add data-edit-id to tagged elements without re-serializing the document.
 * Re-serializing via parse5 can disturb Astro dev-toolbar scripts.
 */
export function injectJsonEditIds(raw) {
  let storyFile = null;
  let n = 0;

  const html = raw.replace(/<([a-zA-Z][\w:-]*)(\s[^>]*?)>/g, (full, tagName, attrs) => {
    if (!/data-edit-file="[^"]+"/.test(attrs) || !/data-edit-path="[^"]+"/.test(attrs)) {
      return full;
    }
    if (/data-edit-id=/.test(attrs)) return full;

    const fileMatch = attrs.match(/data-edit-file="([^"]+)"/);
    if (fileMatch) storyFile ??= fileMatch[1];

    const id = `j${n++}`;
    return `<${tagName}${attrs} data-edit-id="${id}">`;
  });

  return { html, storyFile, count: n };
}
