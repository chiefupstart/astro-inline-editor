import { defineConfig } from "astro/config";
import inlineEditor from "@heyupstart/astro-inline-editor";
import path from "node:path";
import { fileURLToPath } from "node:url";

const exampleRoot = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(exampleRoot, "../..");
const packageReadmePath = path.resolve(packageRoot, "README.md");

export default defineConfig({
  integrations: [
    inlineEditor({
      contentDir: "src/content",
      contentExtraDirs: ["../.."],
    }),
  ],
  vite: {
    define: {
      __PACKAGE_README_PATH__: JSON.stringify(packageReadmePath),
    },
    server: {
      fs: {
        allow: [packageRoot],
      },
    },
  },
});
