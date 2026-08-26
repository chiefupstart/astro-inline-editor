import { hashOf } from "./editor-core.js";
import * as parse5 from "parse5";

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

/** Tag elements that declare data-edit-file + data-edit-path for JSON-backed copy. */
export function injectJsonEditIds(raw) {
  const document = parse5.parse(raw);
  const html = document.childNodes.find((n) => n.tagName === "html");
  const body = html?.childNodes.find((n) => n.tagName === "body");
  let storyFile = null;
  let n = 0;

  (function walk(node) {
    if (!node.childNodes) return;
    for (const child of node.childNodes) {
      if (child.tagName) {
        const file = child.attrs?.find((a) => a.name === "data-edit-file")?.value;
        const path = child.attrs?.find((a) => a.name === "data-edit-path")?.value;
        if (file && path) {
          storyFile ??= file;
          child.attrs = child.attrs.filter((a) => a.name !== "data-edit-id");
          child.attrs.push({ name: "data-edit-id", value: `j${n++}` });
        }
      }
      walk(child);
    }
  })(body ?? document);

  return { html: parse5.serialize(document), storyFile, count: n };
}
