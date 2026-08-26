import { defineToolbarApp } from "astro/toolbar";

const EVENT = "astro-inline-editor";

export default defineToolbarApp({
  init(canvas, app) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;flex-direction:column;gap:10px;min-width:220px;padding:4px 0;";

    const status = document.createElement("p");
    status.style.cssText = "margin:0;font-size:13px;color:var(--text-secondary,#888);line-height:1.4;";
    status.textContent = "Open a page with editable content.";

    const fileEl = document.createElement("p");
    fileEl.style.cssText = "margin:0;font-size:12px;color:var(--text-tertiary,#666);word-break:break-all;";
    fileEl.hidden = true;

    const row = document.createElement("div");
    row.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;";

    function makeBtn(label, style) {
      const btn = document.createElement("astro-dev-toolbar-button");
      btn.textContent = label;
      btn.buttonStyle = style;
      btn.size = "medium";
      return btn;
    }

    const saveBtn = makeBtn("Save", "green");
    const cancelBtn = makeBtn("Cancel", "ghost");
    saveBtn.hidden = true;
    cancelBtn.hidden = true;

    let pageReady = false;
    let appOpen = false;
    let editing = false;

    function setEditing(on) {
      editing = on;
      saveBtn.hidden = !on;
      cancelBtn.hidden = !on;
    }

    function syncFromPage() {
      const state = window.__astro_inline_editor;
      const fields = document.querySelectorAll("[data-edit-id]");
      const count = state?.fieldCount ?? fields.length;

      if (count > 0) {
        pageReady = true;
        fileEl.hidden = false;
        fileEl.textContent = state?.file || fields[0]?.getAttribute("data-edit-file") || "";
        status.textContent = count + " editable field" + (count === 1 ? "" : "s");
        return true;
      }

      pageReady = false;
      fileEl.hidden = true;
      status.textContent = "No editable fields on this page.";
      return false;
    }

    function tryEnterEdit() {
      if (!appOpen || !pageReady || editing) return;
      window.dispatchEvent(new CustomEvent(EVENT + ":enter"));
      setEditing(true);
    }

    function onAppOpen() {
      appOpen = true;
      syncFromPage();
      tryEnterEdit();
    }

    function onAppClose() {
      appOpen = false;
      if (editing) {
        window.dispatchEvent(new CustomEvent(EVENT + ":exit"));
        setEditing(false);
      }
    }

    saveBtn.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent(EVENT + ":save"));
    });
    cancelBtn.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent(EVENT + ":cancel"));
      setEditing(false);
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
      if (e.detail?.file) fileEl.textContent = e.detail.file;
      tryEnterEdit();
    });

    window.addEventListener(EVENT + ":absent", () => {
      pageReady = false;
      setEditing(false);
      syncFromPage();
    });

    window.addEventListener(EVENT + ":status", (e) => {
      const d = e.detail || {};
      if (d.message) status.textContent = d.message;
      if (d.file) {
        fileEl.hidden = false;
        fileEl.textContent = d.file;
      }
      if (typeof d.editing === "boolean") setEditing(d.editing);
    });

    window.addEventListener("astro:before-preparation", () => {
      pageReady = false;
      setEditing(false);
      status.textContent = "Loading…";
    });

    window.addEventListener("astro:page-load", () => {
      syncFromPage();
      if (appOpen) tryEnterEdit();
    });

    row.append(saveBtn, cancelBtn);
    wrap.append(status, fileEl, row);
    canvas.appendChild(wrap);

    // Toolbar app init often runs after the page script emitted :ready — probe now.
    syncFromPage();
  },

  beforeTogglingOff() {
    if (window.__astro_inline_editor_editing && window.__astro_inline_editor_dirty) {
      return window.confirm("Discard unsaved inline edits?");
    }
    return true;
  },
});
