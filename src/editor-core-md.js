import yaml from "yaml";
import { hashOf } from "./editor-core.js";

export { hashOf };

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const TITLE_RE = /^# (.+)(?:\r?\n|$)/;

function getMdTitle(body) {
  const match = body.match(TITLE_RE);
  return match ? match[1] : undefined;
}

function setMdTitle(body, title, newline = "\n") {
  if (TITLE_RE.test(body)) {
    return body.replace(TITLE_RE, `# ${title}${newline}`);
  }
  return `# ${title}${newline}${newline}${body}`;
}

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

/** Split a .md file into YAML frontmatter and markdown body. */
export function parseMdDocument(raw, { requireFrontmatter = true } = {}) {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    if (!requireFrontmatter) {
      const newline = raw.includes("\r\n") ? "\r\n" : "\n";
      return { frontmatter: {}, body: raw, newline, hasFrontmatter: false };
    }
    throw Object.assign(new Error("markdown file missing YAML frontmatter"), { status: 400 });
  }
  const newline = raw.includes("\r\n") ? "\r\n" : "\n";
  const frontmatter = yaml.parse(match[1]);
  if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
    throw Object.assign(new Error("frontmatter must be a YAML mapping"), { status: 400 });
  }
  return { frontmatter, body: match[2], newline, hasFrontmatter: true };
}

export function serializeMdDocument({ frontmatter, body, newline = "\n", hasFrontmatter = true }) {
  if (!hasFrontmatter) {
    return body.endsWith("\n") || !body ? body : body + newline;
  }
  const yamlStr = yaml.stringify(frontmatter).trimEnd();
  return `---${newline}${yamlStr}${newline}---${newline}${body}`;
}

/** Split markdown body on `##` headings into editable sections. */
export function parseBodySections(body) {
  const trimmed = body.replace(/^\s+/, "").replace(/\s+$/, "");
  if (!trimmed) return [];

  return trimmed.split(/\n(?=## )/).map((chunk) => {
    const lines = chunk.split("\n");
    let heading = "";
    let rest = chunk;
    if (lines[0]?.startsWith("## ")) {
      heading = lines[0].slice(3).trim();
      rest = lines.slice(1).join("\n").trim();
    }
    const paragraphs = rest
      ? rest.split(/\n\n+/).map((p) => p.trim()).filter(Boolean)
      : [];
    return { heading, paragraphs };
  });
}

export function serializeBodySections(sections, newline = "\n") {
  if (!sections.length) return "";
  return (
    sections
      .map((section) => {
        const parts = [];
        if (section.heading) parts.push(`## ${section.heading}`);
        if (section.paragraphs?.length) {
          parts.push(section.paragraphs.join(`${newline}${newline}`));
        }
        return parts.join(`${newline}${newline}`);
      })
      .join(`${newline}${newline}`) + newline
  );
}

export function applyMdEdits(raw, edits) {
  const doc = parseMdDocument(raw, { requireFrontmatter: FRONTMATTER_RE.test(raw) });
  const sections = parseBodySections(doc.body);

  for (const { path, text } of edits) {
    if (!path) throw Object.assign(new Error("missing path for markdown edit"), { status: 400 });

    if (path === "title") {
      if (getMdTitle(doc.body) === undefined) {
        throw Object.assign(new Error("markdown file has no # title line"), { status: 400 });
      }
      doc.body = setMdTitle(doc.body, text, doc.newline);
      continue;
    }

    if (path.startsWith("body.")) {
      const subPath = path.slice(5);
      if (getAt(sections, subPath) === undefined) {
        throw Object.assign(new Error(`path not found in body: ${path}`), { status: 400 });
      }
      setAt(sections, subPath, text);
      continue;
    }

    if (getAt(doc.frontmatter, path) === undefined) {
      throw Object.assign(new Error(`path not found in frontmatter: ${path}`), { status: 400 });
    }
    setAt(doc.frontmatter, path, text);
  }

  doc.body = serializeBodySections(sections, doc.newline);
  return serializeMdDocument(doc);
}
