import { defineConfig } from "astro/config";
import inlineEditor from "astro-inline-editor";

export default defineConfig({
  integrations: [inlineEditor()],
});
