// Shared logic for static HTML under public/: tag editable text leaves,
// splice byte ranges back into the source file on save.

import * as parse5 from "parse5";
import crypto from "node:crypto";

const VOID_OR_SKIP = new Set([
  "script", "style", "head", "title", "meta", "link", "br", "hr",
  "img", "input", "svg", "path", "html", "body",
]);

const INLINE_TAGS = new Set([
  "strong", "em", "b", "i", "a", "span", "u", "small", "sub", "sup", "mark", "code",
]);

function isElement(node) {
  return !!node.tagName;
}

function isWhitespaceOnly(text) {
  return /^\s*$/.test(text);
}

function nodeHasMeaningfulText(node) {
  if (node.nodeName === "#text") return !isWhitespaceOnly(node.value);
  if (!isElement(node)) return false;
  if (!node.childNodes?.length) return false;
  return node.childNodes.some(nodeHasMeaningfulText);
}

function isAllowedHtmlChild(node) {
  if (node.nodeName === "#text") return true;
  if (!isElement(node)) return false;
  if (!INLINE_TAGS.has(node.tagName)) return false;
  if (!node.childNodes?.length) return true;
  return node.childNodes.every(isAllowedHtmlChild);
}

/** Plain text only — no nested tags. */
function isEditableLeaf(node) {
  if (!isElement(node)) return false;
  if (VOID_OR_SKIP.has(node.tagName)) return false;
  if (!node.childNodes?.length) return false;
  let hasText = false;
  for (const child of node.childNodes) {
    if (child.nodeName !== "#text") return false;
    if (!isWhitespaceOnly(child.value)) hasText = true;
  }
  return hasText;
}

/** Text plus inline formatting (e.g. <strong>, <em>, <a>) — edit as HTML. */
function isHtmlEditableLeaf(node) {
  if (!isElement(node)) return false;
  if (VOID_OR_SKIP.has(node.tagName)) return false;
  if (INLINE_TAGS.has(node.tagName)) return false;
  if (!node.childNodes?.length) return false;
  if (!node.childNodes.every(isAllowedHtmlChild)) return false;
  return nodeHasMeaningfulText(node);
}

function findBody(document) {
  const html = document.childNodes.find((n) => n.tagName === "html");
  if (!html) return null;
  return html.childNodes.find((n) => n.tagName === "body") || null;
}

function collectEditableNodes(document) {
  const body = findBody(document);
  if (!body) return [];
  const out = [];
  (function walk(node) {
    if (isEditableLeaf(node)) {
      out.push({ node, html: false });
      return;
    }
    if (isHtmlEditableLeaf(node)) {
      out.push({ node, html: true });
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

function innerHtmlOf(node) {
  return node.childNodes.map((n) => parse5.serialize(n)).join("");
}

function escapeHtmlText(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function hashOf(raw) {
  return crypto.createHash("sha256").update(raw, "utf-8").digest("hex").slice(0, 16);
}

export function injectIds(raw) {
  const document = parse5.parse(raw);
  const nodes = collectEditableNodes(document);
  const manifest = [];
  nodes.forEach(({ node, html }, i) => {
    const id = `e${i}`;
    node.attrs = node.attrs.filter((a) => a.name !== "data-edit-id" && a.name !== "data-edit-html");
    node.attrs.push({ name: "data-edit-id", value: id });
    if (html) node.attrs.push({ name: "data-edit-html", value: "true" });
    manifest.push({
      id,
      tag: node.tagName,
      html,
      text: html ? innerHtmlOf(node) : textContentOf(node),
    });
  });
  return { html: parse5.serialize(document), manifest, hash: hashOf(raw) };
}

export function locateEdits(raw, edits) {
  const document = parse5.parse(raw, { sourceCodeLocationInfo: true });
  const nodes = collectEditableNodes(document);
  const byId = new Map(nodes.map(({ node, html }, i) => [`e${i}`, { node, html }]));

  const splices = [];
  const notFound = [];
  for (const { id, text } of edits) {
    const entry = byId.get(id);
    if (!entry) {
      notFound.push(id);
      continue;
    }
    const { node, html } = entry;
    const loc = node.sourceCodeLocation;
    if (!loc?.startTag || !loc?.endTag) {
      notFound.push(id);
      continue;
    }
    splices.push({
      start: loc.startTag.endOffset,
      end: loc.endTag.startOffset,
      text: html ? text : escapeHtmlText(text),
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
