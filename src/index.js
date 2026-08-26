import { inlineEditorVitePlugin } from "./vite-plugin.js";

/** @typedef {import('astro').AstroIntegration} AstroIntegration */

/**
 * @param {object} [options]
 * @param {string[]} [options.excludeRoots] URL prefixes to skip (e.g. `/admin`)
 * @param {string} [options.dataDir] Root for JSON content files (default: `src/data`)
 * @param {string} [options.contentDir] Root for Markdown content files (default: `src/content`)
 * @param {string[]} [options.contentExtraDirs] Additional relative dirs allowed for Markdown saves
 * @returns {AstroIntegration}
 */
export default function inlineEditor(options = {}) {
  return {
    name: "astro-inline-editor",
    hooks: {
      "astro:config:setup": ({ addDevToolbarApp, updateConfig, command, logger }) => {
        if (command !== "dev") return;

        addDevToolbarApp({
          id: "astro-inline-editor",
          name: "Inline Editor",
          icon: "file-search",
          entrypoint: new URL("./toolbar-app.js", import.meta.url),
        });

        updateConfig({
          vite: {
            plugins: [inlineEditorVitePlugin(options)],
            optimizeDeps: {
              include: ["astro/toolbar"],
            },
          },
        });

        logger.info("[astro-inline-editor] dev inline editor enabled");
      },
    },
  };
}

export { contentEdit } from "./content-edit.js";
export { parseMdDocument, serializeMdDocument, parseBodySections, serializeBodySections, applyMdEdits, hashOf as mdHashOf } from "./editor-core-md.js";
export { inlineEditorVitePlugin, setupInlineEditorMiddleware } from "./vite-plugin.js";
