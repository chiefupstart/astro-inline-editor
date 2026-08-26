import { defineToolbarApp } from "astro/toolbar";

const EVENT = "astro-inline-editor";

export default defineToolbarApp({
  init(canvas) {
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

    const editBtn = makeBtn("Edit content", "purple");
    const saveBtn = makeBtn("Save", "green");
    const cancelBtn = makeBtn("Cancel", "ghost");
    saveBtn.hidden = true;
    cancelBtn.hidden = true;
    editBtn.disabled = true;

    let pageReady = false;
    let editing = false;

    function setEditing(on) {
      editing = on;
      editBtn.hidden = on;
      saveBtn.hidden = !on;
      cancelBtn.hidden = !on;
    }

    editBtn.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent(EVENT + ":enter"));
      setEditing(true);
    });
    saveBtn.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent(EVENT + ":save"));
    });
    cancelBtn.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent(EVENT + ":cancel"));
      setEditing(false);
    });

    window.addEventListener(EVENT + ":ready", (e) => {
      pageReady = true;
      editBtn.disabled = false;
      fileEl.hidden = false;
      fileEl.textContent = e.detail.file;
      status.textContent = e.detail.fieldCount + " editable field" + (e.detail.fieldCount === 1 ? "" : "s");
    });

    window.addEventListener(EVENT + ":absent", () => {
      pageReady = false;
      editing = false;
      editBtn.disabled = true;
      setEditing(false);
      fileEl.hidden = true;
      status.textContent = "No editable fields on this page.";
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

    // Reset when navigating via View Transitions or full reload starts
    window.addEventListener("astro:before-preparation", () => {
      pageReady = false;
      editBtn.disabled = true;
      setEditing(false);
      fileEl.hidden = true;
      status.textContent = "Loading…";
    });

    row.append(editBtn, saveBtn, cancelBtn);
    wrap.append(status, fileEl, row);
    canvas.appendChild(wrap);
  },

  beforeTogglingOff() {
    if (window.__astro_inline_editor_editing) {
      return window.confirm("Discard unsaved inline edits?");
    }
    return true;
  },
});
