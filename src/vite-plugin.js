/**
 * Dev-only, localhost-only inline content editor for Astro.
 *
 * Attaches when a page has opt-in editable fields (data-edit-file/path) or
 * is a static HTML file under public/. Saves back to JSON or HTML on disk.
 */
import fs from "node:fs";
import path from "node:path";
import { injectIds, locateEdits, applySplices, hashOf } from "./editor-core.js";
import { applyJsonEdits, injectJsonEditIds } from "./editor-core-json.js";
import { applyMdEdits } from "./editor-core-md.js";
import { clientScript } from "./client-script.js";

function isAssetPath(pathname) {
  if (pathname.startsWith("/@")) return true;
  if (pathname.startsWith("/node_modules/")) return true;
  if (pathname.startsWith("/__vite")) return true;
  if (pathname.startsWith("/_astro/")) return true;
  const base = pathname.split("/").pop() || "";
  if (base.includes(".") && !base.endsWith(".html")) return true;
  return false;
}

/** Only hook full page HTML navigations — never Vite/Astro asset requests. */
function isPageNavigation(req, pathname, isExcluded) {
  if (req.method !== "GET") return false;
  if (isExcluded(pathname)) return false;
  if (isAssetPath(pathname)) return false;
  if (pathname.startsWith("/src/") && !pathname.endsWith(".html")) return false;
  if (pathname.startsWith("/__editor/")) return false;

  const dest = req.headers["sec-fetch-dest"];
  if (dest && dest !== "document" && dest !== "iframe") return false;

  const accept = req.headers.accept || "";
  return accept.includes("text/html") || pathname.endsWith(".html");
}

function resolvePageSource(root, pathname) {
  const pagesDir = path.join(root, "src", "pages");
  let p = pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  if (p === "") p = "index";
  if (p.includes("[")) return null;
  const candidates = [
    path.join(pagesDir, p + ".html"),
    path.join(pagesDir, p, "index.html"),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) return file;
  }
  return null;
}

/** Resolve public/foo/index.html for directory URLs like /demos/tpn-maudes/ */
function resolvePublicHtmlFile(publicDir, pathname) {
  let rel = pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!rel) rel = "index.html";
  else if (!rel.endsWith(".html")) rel = path.join(rel, "index.html");
  const file = path.join(publicDir, rel);
  return fs.existsSync(file) ? file : null;
}

function readAstroVersion(root) {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, "node_modules/astro/package.json"), "utf-8")
    );
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}

/** Static HTML under public/ is not Astro-rendered — inject dev toolbar scripts manually. */
function injectDevToolbar(html, root) {
  if (html.includes("dev-toolbar/entrypoint")) return html;
  const version = readAstroVersion(root);
  const config = JSON.stringify({
    root,
    version,
    debugInfo: `Astro                    v${version}\nStatic HTML (public/) · astro-inline-editor`,
  });
  const snippet =
    `<script type="module" src="/@vite/client"></script>` +
    `<script type="module" src="/@id/astro/runtime/client/dev-toolbar/entrypoint.js"></script>` +
    `<script>window.__astro_dev_toolbar__ = ${config}</script>`;
  return html.includes("</head>") ? html.replace("</head>", snippet + "</head>") : snippet + html;
}

function sendBuffered(origWriteHead, origEnd, res, status, body) {
  res.removeHeader("transfer-encoding");
  if (body.length > 0) {
    res.setHeader("Content-Length", body.length);
  } else {
    res.removeHeader("content-length");
  }
  origWriteHead(status);
  return origEnd(body);
}

function countEditIds(html) {
  return (html.match(/data-edit-id="/g) || []).length;
}

function injectClient(html, file, hash, fieldCount) {
  const script = clientScript({ file, hash, fieldCount });
  return html.includes("</body>") ? html.replace("</body>", script + "</body>") : html + script;
}

/**
 * Register save endpoints and HTML injection on the Astro dev server.
 * Prefer calling from the integration's `astro:server:setup` hook.
 */
export function setupInlineEditorMiddleware(server, options = {}, logger = server.config.logger) {
  const excludeRoots = options.excludeRoots || [];
  const dataDir = options.dataDir || "src/data";
  const contentDir = options.contentDir || "src/content";
  const contentExtraDirs = options.contentExtraDirs || [];
  const root = server.config.root;
  const publicDir = path.join(root, "public");
  const dataDirAbs = path.join(root, dataDir) + path.sep;
  const contentDirAbs = path.join(root, contentDir) + path.sep;
  const contentDirAbsList = [
    contentDirAbs,
    ...contentExtraDirs.map((dir) => path.join(root, dir) + path.sep),
  ];

  function isExcluded(pathname) {
    return excludeRoots.some((prefix) => pathname.startsWith(prefix));
  }

  if (!fs.existsSync(path.join(root, ".git"))) {
    logger.warn("[astro-inline-editor] no .git at project root — saves may not be version-controlled.");
  }

  function resolveEditableFile(file) {
    const isJson = file.endsWith(".json");
    const isMd = file.endsWith(".md");
    const isSrcHtml = file.startsWith("src/pages/") && file.endsWith(".html");
    const isPublicHtml = !isJson && !isMd && !isSrcHtml && file.endsWith(".html");

    if (isJson) {
      const resolved = path.resolve(path.join(root, file));
      if (!resolved.startsWith(dataDirAbs)) {
        throw Object.assign(new Error(`path escapes ${dataDir}`), { status: 400 });
      }
      return resolved;
    }
    if (isMd) {
      const resolved = path.resolve(path.join(root, file));
      if (!contentDirAbsList.some((dir) => resolved.startsWith(dir))) {
        throw Object.assign(new Error(`path escapes allowed markdown dirs`), { status: 400 });
      }
      return resolved;
    }
    if (isSrcHtml) {
      const resolved = path.resolve(path.join(root, file));
      if (!resolved.startsWith(path.join(root, "src", "pages") + path.sep)) {
        throw Object.assign(new Error("path escapes src/pages"), { status: 400 });
      }
      return resolved;
    }
    if (isPublicHtml) {
      const resolved = path.resolve(path.join(publicDir, file.replace(/^\/+/, "")));
      if (!resolved.startsWith(publicDir + path.sep)) {
        throw Object.assign(new Error("path escapes public dir"), { status: 400 });
      }
      return resolved;
    }
    throw Object.assign(new Error("unrecognized file type"), { status: 400 });
  }

  // --- Hash endpoint (refresh base hash after JSON save without reload) ---
  server.middlewares.use((req, res, next) => {
    const url = req.url || "";
    if (req.method !== "GET" || !url.startsWith("/__editor/hash?")) return next();

    const host = req.headers.host || "";
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: "editor endpoint is localhost-only" }));
      return;
    }

    try {
      const file = new URL(url, "http://localhost").searchParams.get("file");
      if (!file) throw Object.assign(new Error("missing file"), { status: 400 });
      const resolved = resolveEditableFile(file);
      if (!fs.existsSync(resolved)) throw Object.assign(new Error("file not found"), { status: 404 });
      const raw = fs.readFileSync(resolved, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, hash: hashOf(raw) }));
    } catch (e) {
      res.writeHead(e.status || 500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: e.message }));
    }
  });

  // --- Save endpoint ---------------------------------------------------
  server.middlewares.use((req, res, next) => {
    if (req.method !== "POST" || req.url !== "/__editor/save") return next();

    const host = req.headers.host || "";
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: "editor endpoint is localhost-only" }));
      return;
    }

    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { file, baseHash, edits } = JSON.parse(body);
        if (typeof file !== "string") {
          throw Object.assign(new Error("missing file"), { status: 400 });
        }

        const isJson = file.endsWith(".json");
        const isMd = file.endsWith(".md");
        const resolved = resolveEditableFile(file);

        if (!fs.existsSync(resolved)) {
          throw Object.assign(new Error("file not found"), { status: 404 });
        }

        const raw = fs.readFileSync(resolved, "utf-8");
        if (hashOf(raw) !== baseHash) {
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            ok: false,
            message: "file changed on disk since you loaded this page — reload and try again",
          }));
          return;
        }

        let patched;
        if (isJson) {
          patched = applyJsonEdits(raw, edits);
        } else if (isMd) {
          patched = applyMdEdits(raw, edits);
        } else {
          const { splices, notFound } = locateEdits(raw, edits);
          if (notFound.length) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              ok: false,
              message: "couldn't find element(s): " + notFound.join(", ") + " — reload and try again",
            }));
            return;
          }
          patched = applySplices(raw, splices);
        }

        fs.writeFileSync(resolved, patched, "utf-8");
        logger.info(`[astro-inline-editor] saved ${edits.length} edit(s) to ${file}`);

        const newHash = hashOf(patched);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          hash: newHash,
          reload: false,
        }));
      } catch (e) {
        res.writeHead(e.status || 500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, message: e.message }));
      }
    });
  });

  // --- Response injection ----------------------------------------------
  server.middlewares.use((req, res, next) => {
    const pathname = (req.url || "").split("?")[0];
    if (!isPageNavigation(req, pathname, isExcluded)) return next();

    const publicHtmlFile = resolvePublicHtmlFile(publicDir, pathname);
    const isStaticHtml = publicHtmlFile !== null;
    const srcHtmlFile = !isStaticHtml ? resolvePageSource(root, pathname) : null;

    const chunks = [];
    let capturedStatus = 200;
    const origWriteHead = res.writeHead.bind(res);
    const origWrite = res.write.bind(res);
    const origEnd = res.end.bind(res);

    res.writeHead = (statusCode, arg2, arg3) => {
      capturedStatus = statusCode;
      const headers = typeof arg2 === "string" ? arg3 : arg2;
      if (headers) {
        for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
      }
      return res;
    };
    res.write = (chunk, ...args) => {
      if (chunk && typeof chunk !== "function") {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const cb = args.find((a) => typeof a === "function");
      if (cb) cb();
      return true;
    };
    res.end = (chunk, ...args) => {
      if (chunk && typeof chunk !== "function") {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      res.writeHead = origWriteHead;
      res.write = origWrite;
      res.end = origEnd;

      const body = Buffer.concat(chunks);
      const contentType = res.getHeader("content-type") || "";
      if (capturedStatus !== 200 || !String(contentType).includes("html")) {
        return sendBuffered(origWriteHead, origEnd, res, capturedStatus, body);
      }

      const renderedRaw = body.toString("utf-8");

      // Static HTML under public/
      if (isStaticHtml) {
        try {
          const sourceRaw = fs.readFileSync(publicHtmlFile, "utf-8");
          const { html } = injectIds(renderedRaw);
          const relFile = path.relative(publicDir, publicHtmlFile);
          let out = injectClient(html, relFile, hashOf(sourceRaw), countEditIds(html));
          out = injectDevToolbar(out, root);
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          return sendBuffered(origWriteHead, origEnd, res, 200, Buffer.from(out));
        } catch (e) {
          logger.error("[astro-inline-editor] inject failed: " + e.stack);
          return sendBuffered(origWriteHead, origEnd, res, capturedStatus, body);
        }
      }

      // src/pages/*.html
      if (srcHtmlFile) {
        try {
          const sourceRaw = fs.readFileSync(srcHtmlFile, "utf-8");
          const relSource = path.relative(root, srcHtmlFile);
          const { html } = injectIds(renderedRaw);
          let out = injectClient(html, relSource, hashOf(sourceRaw), countEditIds(html));
          out = injectDevToolbar(out, root);
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          return sendBuffered(origWriteHead, origEnd, res, 200, Buffer.from(out));
        } catch (e) {
          logger.error("[astro-inline-editor] inject failed: " + e.stack);
          return sendBuffered(origWriteHead, origEnd, res, capturedStatus, body);
        }
      }

      // Astro-rendered pages: only when developer tagged fields
      if (!renderedRaw.includes("data-edit-file") || !renderedRaw.includes("data-edit-path")) {
        return sendBuffered(origWriteHead, origEnd, res, capturedStatus, body);
      }

      try {
        const { html, storyFile, count } = injectJsonEditIds(renderedRaw);
        if (!storyFile || count === 0) {
          return sendBuffered(origWriteHead, origEnd, res, capturedStatus, body);
        }
        const sourcePath = path.resolve(root, storyFile);
        const sourceRaw = fs.readFileSync(sourcePath, "utf-8");
        const out = injectClient(html, storyFile, hashOf(sourceRaw), count);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return sendBuffered(origWriteHead, origEnd, res, 200, Buffer.from(out));
      } catch (e) {
        logger.error("[astro-inline-editor] inject failed: " + e.stack);
        return sendBuffered(origWriteHead, origEnd, res, capturedStatus, body);
      }
    };

    next();
  });
}

/** Vite plugin — registers middleware early so HTML responses can be intercepted. */
export function inlineEditorVitePlugin(options = {}) {
  const dataDir = options.dataDir || "src/data";
  const contentDir = options.contentDir || "src/content";
  const contentExtraDirs = options.contentExtraDirs || [];

  return {
    name: "astro-inline-editor",
    enforce: "pre",
    /** Saving content files must not HMR-refresh the page — that strips edit mode mid-session. */
    handleHotUpdate({ file, server }) {
      const root = server.config.root;
      const publicDirAbs = path.resolve(path.join(root, "public")) + path.sep;
      const pagesDirAbs = path.resolve(path.join(root, "src", "pages")) + path.sep;
      const dataDirAbs = path.resolve(path.join(root, dataDir)) + path.sep;
      const mdRoots = [
        path.resolve(path.join(root, contentDir)) + path.sep,
        ...contentExtraDirs.map((dir) => path.resolve(path.join(root, dir)) + path.sep),
      ];
      if (file.startsWith(dataDirAbs) && file.endsWith(".json")) return [];
      if (file.endsWith(".md") && mdRoots.some((dir) => file.startsWith(dir))) return [];
      if (file.endsWith(".html") && (file.startsWith(publicDirAbs) || file.startsWith(pagesDirAbs))) {
        return [];
      }
    },
    configureServer(server) {
      setupInlineEditorMiddleware(server, options, server.config.logger);
    },
  };
}
