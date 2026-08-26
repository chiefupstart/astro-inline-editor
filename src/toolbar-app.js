import { defineToolbarApp } from "astro/toolbar";

const EVENT = "astro-inline-editor";

export default defineToolbarApp({
  init(canvas, app) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;flex-direction:column;gap:10px;min-width:220px;padding:4px 0;";

    const status = document.createElement("p");
    status.style.cssText = "margin:0;font-size:13px;color:var(--text-secondary,#888);line-height:1.4;min-height:1.4em;";
    status.textContent = "Open a page with editable content.";

    const row = document.createElement("div");
    row.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;";

    function makeBtn(label, style) {
      const btn = document.createElement("astro-dev-toolbar-button");
      btn.textContent = label;
      btn.buttonStyle = style;
      btn.size = "medium";
      return btn;
    }

    const cancelBtn = makeBtn("Discard", "ghost");
    cancelBtn.hidden = true;

    let pageReady = false;
    let appOpen = false;

    function syncEditUi() {
      cancelBtn.hidden = !window.__astro_inline_editor_editing;
    }

    function syncFromPage() {
      const state = window.__astro_inline_editor;
      const fields = document.querySelectorAll("[data-edit-id]");
      const count = state?.fieldCount ?? fields.length;

      if (count > 0) {
        pageReady = true;
        if (!window.__astro_inline_editor_editing) {
          status.textContent = count + " editable field" + (count === 1 ? "" : "s");
        }
        return true;
      }

      pageReady = false;
      status.textContent = "No editable fields on this page.";
      return false;
    }

    function startEditMode() {
      if (!pageReady || window.__astro_inline_editor_editing) return;
      window.dispatchEvent(new CustomEvent(EVENT + ":enter"));
      syncEditUi();
    }

    function onAppOpen() {
      appOpen = true;
      syncFromPage();
      if (!window.__astro_inline_editor_editing) startEditMode();
      else syncEditUi();
    }

    function onAppClose() {
      appOpen = false;
      if (window.__astro_inline_editor_editing) {
        window.dispatchEvent(new CustomEvent(EVENT + ":done"));
      }
    }

    cancelBtn.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent(EVENT + ":cancel"));
    });

    if (typeof app.onToggled === "function") {
      app.onToggled(({ state }) => (state ? onAppOpen() : onAppClose()));
    } else {
      app.addEventListener("app-toggled", (event) => {
        const state = event.detail?.state;
        if (state) onAppOpen();
        else onAppClose();
      });
    }

    window.addEventListener(EVENT + ":ready", (e) => {
      syncFromPage();
      if (appOpen && !window.__astro_inline_editor_editing) startEditMode();
      syncEditUi();
    });

    window.addEventListener(EVENT + ":absent", () => {
      pageReady = false;
      syncFromPage();
      syncEditUi();
    });

    window.addEventListener(EVENT + ":status", (e) => {
      const d = e.detail || {};
      if (d.message !== undefined) status.textContent = d.message;
      syncEditUi();
    });

    window.addEventListener("astro:before-preparation", () => {
      pageReady = false;
      status.textContent = "Loading…";
    });

    window.addEventListener("astro:page-load", () => {
      syncFromPage();
      syncEditUi();
    });

    row.append(cancelBtn);
    wrap.append(status, row);
    canvas.appendChild(wrap);

    syncFromPage();
    syncEditUi();
  },
});
