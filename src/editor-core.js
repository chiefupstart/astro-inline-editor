// Shared logic for static HTML under public/: tag editable text leaves,
// splice byte ranges back into the source file on save.

import * as parse5 from "parse5";
import crypto from "node:crypto";

const VOID_OR_SKIP = new Set([
  "script", "style", "head", "title", "meta", "link", "br", "hr",
  "img", "input", "svg", "path", "html", "body",
]);

function isElement(node) {
  return !!node.tagName;
}

function isWhitespaceOnly(text) {
  return /^\s*$/.test(text);
}

function isEditableLeaf(node) {
  if (!isElement(node)) return false;
  if (VOID_OR_SKIP.has(node.tagName)) return false;
  if (!node.childNodes || node.childNodes.length === 0) return false;
  let hasText = false;
  for (const child of node.childNodes) {
    if (child.nodeName !== "#text") return false;
    if (!isWhitespaceOnly(child.value)) hasText = true;
  }
  return hasText;
}

function findBody(document) {
  const html = document.childNodes.find((n) => n.tagName === "html");
  if (!html) return null;
  return html.childNodes.find((n) => n.tagName === "body") || null;
}

function collectEditableLeaves(document) {
  const body = findBody(document);
  if (!body) return [];
  const out = [];
  (function walk(node) {
    if (isEditableLeaf(node)) {
      out.push(node);
      return;
    }
    if (node.childNodes) {
      for (const child of node.childNodes) walk(child);
    }
  })(body);
  return out;
}

function textContentOf(node) {
  return node.childNodes
    .filter((n) => n.nodeName === "#text")
    .map((n) => n.value)
    .join("");
}

function escapeHtmlText(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function hashOf(raw) {
  return crypto.createHash("sha256").update(raw, "utf-8").digest("hex").slice(0, 16);
}

export function injectIds(raw) {
  const document = parse5.parse(raw);
  const leaves = collectEditableLeaves(document);
  const manifest = [];
  leaves.forEach((node, i) => {
    const id = `e${i}`;
    node.attrs = node.attrs.filter((a) => a.name !== "data-edit-id");
    node.attrs.push({ name: "data-edit-id", value: id });
    manifest.push({ id, tag: node.tagName, text: textContentOf(node) });
  });
  return { html: parse5.serialize(document), manifest, hash: hashOf(raw) };
}

export function locateEdits(raw, edits) {
  const document = parse5.parse(raw, { sourceCodeLocationInfo: true });
  const leaves = collectEditableLeaves(document);
  const byId = new Map(leaves.map((node, i) => [`e${i}`, node]));

  const splices = [];
  const notFound = [];
  for (const { id, text } of edits) {
    const node = byId.get(id);
    if (!node) {
      notFound.push(id);
      continue;
    }
    const loc = node.sourceCodeLocation;
    if (!loc || !loc.startTag || !loc.endTag) {
      notFound.push(id);
      continue;
    }
    splices.push({
      start: loc.startTag.endOffset,
      end: loc.endTag.startOffset,
      text: escapeHtmlText(text),
    });
  }
  return { splices, notFound };
}

export function applySplices(raw, splices) {
  const ordered = [...splices].sort((a, b) => b.start - a.start);
  let out = raw;
  for (const { start, end, text } of ordered) {
    out = out.slice(0, start) + text + out.slice(end);
  }
  return out;
}
