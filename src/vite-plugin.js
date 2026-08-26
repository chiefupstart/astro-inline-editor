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
import { clientScript } from "./client-script.js";

export function inlineEditorVitePlugin(options = {}) {
  const excludeRoots = options.excludeRoots || [];
  const dataDir = options.dataDir || "src/data";

  function isExcluded(pathname) {
    return excludeRoots.some((root) => pathname.startsWith(root));
  }

  /** Only hook full page HTML navigations — not Vite/Astro asset requests. */
  function isPageNavigation(req, pathname) {
    if (req.method !== "GET") return false;
    if (isExcluded(pathname)) return false;
    if (/^\/(@|node_modules|__vite|_astro)\b/.test(pathname)) return false;
    if (pathname.startsWith("/src/") && !pathname.endsWith(".html")) return false;
    const accept = req.headers.accept || "";
    if (accept.includes("text/html")) return true;
    if (pathname.endsWith(".html")) return true;
    return false;
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

  return {
    name: "astro-inline-editor",
    enforce: "pre",
    configureServer(server) {
      const root = server.config.root;
      const publicDir = path.join(root, "public");
      const dataDirAbs = path.join(root, dataDir) + path.sep;

      if (!fs.existsSync(path.join(root, ".git"))) {
        server.config.logger.warn(
          "[astro-inline-editor] no .git at project root — saves may not be version-controlled."
        );
      }

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
            const isSrcHtml = file.startsWith("src/pages/") && file.endsWith(".html");
            const isPublicHtml = !isJson && !isSrcHtml && file.endsWith(".html");

            let resolved;
            if (isJson) {
              resolved = path.resolve(path.join(root, file));
              if (!resolved.startsWith(dataDirAbs)) {
                throw Object.assign(new Error(`path escapes ${dataDir}`), { status: 400 });
              }
            } else if (isSrcHtml) {
              resolved = path.resolve(path.join(root, file));
              if (!resolved.startsWith(path.join(root, "src", "pages") + path.sep)) {
                throw Object.assign(new Error("path escapes src/pages"), { status: 400 });
              }
            } else if (isPublicHtml) {
              resolved = path.resolve(path.join(publicDir, file.replace(/^\/+/, "")));
              if (!resolved.startsWith(publicDir + path.sep)) {
                throw Object.assign(new Error("path escapes public dir"), { status: 400 });
              }
            } else {
              throw Object.assign(new Error("unrecognized file type"), { status: 400 });
            }

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
            server.config.logger.info(`[astro-inline-editor] saved ${edits.length} edit(s) to ${file}`);
            // One clean reload from Vite (avoids racing client reload + JSON HMR).
            if (server.ws) server.ws.send({ type: "full-reload" });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.writeHead(e.status || 500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, message: e.message }));
          }
        });
      });

      // --- Response injection ----------------------------------------------
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url || "").split("?")[0];
        if (!isPageNavigation(req, pathname)) return next();

        const publicFile = path.join(publicDir, pathname.replace(/^\/+/, ""));
        const isStaticHtml = pathname.endsWith(".html") && fs.existsSync(publicFile);
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

          const contentType = res.getHeader("content-type") || "";
          if (capturedStatus !== 200 || !String(contentType).includes("html")) {
            res.statusCode = capturedStatus;
            return origEnd(Buffer.concat(chunks));
          }

          const renderedRaw = Buffer.concat(chunks).toString("utf-8");

          // Static HTML under public/
          if (isStaticHtml) {
            try {
              const sourceRaw = fs.readFileSync(publicFile, "utf-8");
              const { html } = injectIds(renderedRaw);
              const relFile = path.relative(publicDir, publicFile);
              const out = injectClient(html, relFile, hashOf(sourceRaw), countEditIds(html));
              res.statusCode = 200;
              res.setHeader("Content-Type", "text/html; charset=utf-8");
              res.setHeader("Content-Length", Buffer.byteLength(out));
              return origEnd(out);
            } catch (e) {
              server.config.logger.error("[astro-inline-editor] inject failed: " + e.stack);
              res.statusCode = capturedStatus;
              return origEnd(Buffer.concat(chunks));
            }
          }

          // src/pages/*.html
          if (srcHtmlFile) {
            try {
              const sourceRaw = fs.readFileSync(srcHtmlFile, "utf-8");
              const relSource = path.relative(root, srcHtmlFile);
              const { html } = injectIds(renderedRaw);
              const out = injectClient(html, relSource, hashOf(sourceRaw), countEditIds(html));
              res.statusCode = 200;
              res.setHeader("Content-Type", "text/html; charset=utf-8");
              res.setHeader("Content-Length", Buffer.byteLength(out));
              return origEnd(out);
            } catch (e) {
              server.config.logger.error("[astro-inline-editor] inject failed: " + e.stack);
              res.statusCode = capturedStatus;
              return origEnd(Buffer.concat(chunks));
            }
          }

          // Astro-rendered pages: only when developer tagged fields
          if (!renderedRaw.includes("data-edit-file") || !renderedRaw.includes("data-edit-path")) {
            res.statusCode = capturedStatus;
            return origEnd(Buffer.concat(chunks));
          }

          try {
            const { html, storyFile, count } = injectJsonEditIds(renderedRaw);
            if (!storyFile || count === 0) {
              res.statusCode = capturedStatus;
              return origEnd(Buffer.concat(chunks));
            }
            const jsonPath = path.join(root, storyFile);
            const jsonRaw = fs.readFileSync(jsonPath, "utf-8");
            const out = injectClient(html, storyFile, hashOf(jsonRaw), count);
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.setHeader("Content-Length", Buffer.byteLength(out));
            return origEnd(out);
          } catch (e) {
            server.config.logger.error("[astro-inline-editor] inject failed: " + e.stack);
            res.statusCode = capturedStatus;
            return origEnd(Buffer.concat(chunks));
          }
        };

        next();
      });

      function countEditIds(html) {
        return (html.match(/data-edit-id="/g) || []).length;
      }

      function injectClient(html, file, hash, fieldCount) {
        const script = clientScript({ file, hash, fieldCount });
        return html.includes("</body>") ? html.replace("</body>", script + "</body>") : html + script;
      }
    },
  };
}
