import { inlineEditorVitePlugin } from "./vite-plugin.js";

/** @typedef {import('astro').AstroIntegration} AstroIntegration */

/**
 * @param {object} [options]
 * @param {string[]} [options.excludeRoots] URL prefixes to skip (e.g. `/admin`)
 * @param {string} [options.dataDir] Root for JSON content files (default: `src/data`)
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
          icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
          entrypoint: new URL("./toolbar-app.js", import.meta.url),
        });

        updateConfig({
          vite: {
            plugins: [inlineEditorVitePlugin(options)],
          },
        });

        logger.info("[astro-inline-editor] dev inline editor enabled");
      },
    },
  };
}

export { contentEdit } from "./content-edit.js";
export { inlineEditorVitePlugin } from "./vite-plugin.js";
