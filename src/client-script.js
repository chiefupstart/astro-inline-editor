// Injected into editable pages in dev. Floating bar is always visible; Astro dev
// toolbar app stays in sync via shared window events.

const EVENT = "astro-inline-editor";

export function clientScript({ file, hash, fieldCount }) {
  if (fieldCount === 0) return "";

  return `
<style>
  #__ie_bar { position: fixed; bottom: 18px; right: 18px; z-index: 999999;
    font: 13px -apple-system, Segoe UI, Arial, sans-serif; background: #262130;
    color: #fff; border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.28);
    padding: 10px 12px; display: flex; gap: 8px; align-items: center; }
  #__ie_bar button { font: inherit; border: none; border-radius: 6px; padding: 7px 12px;
    cursor: pointer; font-weight: 600; }
  #__ie_bar .primary { background: #6B4C8A; color: #fff; }
  #__ie_bar .ghost { background: transparent; color: #cfc6db; }
  #__ie_bar .ghost:hover { color: #fff; }
  #__ie_status { color: #b9abcb; font-size: 12px; padding: 0 4px; max-width: 14rem; }
  [data-edit-id].__ie_on { outline: 1.5px dashed #B08BD1; outline-offset: 3px;
    border-radius: 2px; cursor: text; }
  [data-edit-id].__ie_on:hover { outline-color: #6B4C8A; background: rgba(107,76,138,0.06); }
  [data-edit-id].__ie_on:focus { outline: 1.5px solid #6B4C8A; background: rgba(107,76,138,0.10); }
  [data-edit-id].__ie_dirty { outline-style: solid; }
</style>
<div id="__ie_bar">
  <span id="__ie_status"></span>
  <button id="__ie_toggle" class="primary">Edit content</button>
  <button id="__ie_save" class="primary" style="display:none">Save</button>
  <button id="__ie_cancel" class="ghost" style="display:none">Cancel</button>
</div>
<script>
(function () {
  var FILE = ${JSON.stringify(file)};
  var BASE_HASH = ${JSON.stringify(hash)};
  var FIELD_COUNT = ${fieldCount};
  var EVENT = ${JSON.stringify(EVENT)};
  var editing = false;
  var originals = new Map();
  var dirty = new Map();

  var bar = document.getElementById('__ie_bar');
  var statusEl = document.getElementById('__ie_status');
  var toggleBtn = document.getElementById('__ie_toggle');
  var saveBtn = document.getElementById('__ie_save');
  var cancelBtn = document.getElementById('__ie_cancel');

  function publishState() {
    window.__astro_inline_editor = {
      file: FILE,
      fieldCount: FIELD_COUNT,
      hash: BASE_HASH,
      editing: editing,
      dirty: dirty.size,
    };
    window.__astro_inline_editor_editing = editing;
    window.__astro_inline_editor_dirty = dirty.size > 0;
  }

  function emit(type, detail) {
    window.dispatchEvent(new CustomEvent(EVENT + ':' + type, { detail: detail || {} }));
  }

  function nodes() { return document.querySelectorAll('[data-edit-id]'); }

  function stripFormattingPaste(e) {
    e.preventDefault();
    var text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  }

  function currentValue(el) {
    return el.hasAttribute('data-edit-html') ? el.innerHTML : el.textContent;
  }

  function statusMessage() {
    if (!editing) return '';
    if (dirty.size) return dirty.size + ' unsaved change' + (dirty.size === 1 ? '' : 's');
    return 'Click any dashed field to edit';
  }

  function syncBar() {
    publishState();
    statusEl.textContent = statusMessage();
    toggleBtn.style.display = editing ? 'none' : '';
    saveBtn.style.display = editing ? '' : 'none';
    cancelBtn.style.display = editing ? '' : 'none';
    emit('status', { message: statusMessage() || (FIELD_COUNT + ' editable fields'), editing: editing, dirty: dirty.size, file: FILE });
  }

  function onInput(e) {
    var el = e.currentTarget;
    var id = el.getAttribute('data-edit-id');
    var now = currentValue(el);
    if (now !== originals.get(id)) {
      dirty.set(id, now);
      el.classList.add('__ie_dirty');
    } else {
      dirty.delete(id);
      el.classList.remove('__ie_dirty');
    }
    syncBar();
  }

  function enterEdit() {
    if (!FIELD_COUNT || editing) return;
    editing = true;
    dirty.clear();
    nodes().forEach(function (el) {
      var id = el.getAttribute('data-edit-id');
      originals.set(id, currentValue(el));
      el.setAttribute('contenteditable', 'true');
      el.classList.add('__ie_on');
      el.addEventListener('paste', stripFormattingPaste);
      el.addEventListener('input', onInput);
    });
    syncBar();
  }

  function exitEdit(reload) {
    editing = false;
    nodes().forEach(function (el) {
      el.removeAttribute('contenteditable');
      el.classList.remove('__ie_on', '__ie_dirty');
      el.removeEventListener('paste', stripFormattingPaste);
      el.removeEventListener('input', onInput);
    });
    if (reload) location.reload();
    else syncBar();
  }

  function commitSaved(newHash) {
    if (newHash) BASE_HASH = newHash;
    nodes().forEach(function (el) {
      originals.set(el.getAttribute('data-edit-id'), currentValue(el));
    });
    dirty.clear();
    exitEdit(false);
    statusEl.textContent = 'Saved ✓';
    emit('status', { message: 'Saved ✓', editing: false, dirty: 0, file: FILE });
  }

  function saveEdits() {
    if (!dirty.size) { exitEdit(false); return; }
    statusEl.textContent = 'Saving…';
    saveBtn.disabled = true;
    var edits = [];
    dirty.forEach(function (text, id) {
      var el = document.querySelector('[data-edit-id="' + CSS.escape(id) + '"]');
      edits.push({ id: id, text: text, path: el ? el.getAttribute('data-edit-path') : undefined });
    });
    fetch('/__editor/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: FILE, baseHash: BASE_HASH, edits: edits })
    })
      .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
      .then(function (res) {
        saveBtn.disabled = false;
        if (!res.ok) {
          alert('Save failed: ' + (res.body && res.body.message ? res.body.message : 'unknown error'));
          syncBar();
          return;
        }
        if (res.body.reload) {
          statusEl.textContent = 'Saved — reloading…';
          setTimeout(function () { location.reload(); }, 200);
          return;
        }
        commitSaved(res.body.hash);
      })
      .catch(function (err) {
        saveBtn.disabled = false;
        alert('Save failed: ' + err.message);
        syncBar();
      });
  }

  toggleBtn.addEventListener('click', enterEdit);
  saveBtn.addEventListener('click', saveEdits);
  cancelBtn.addEventListener('click', function () { exitEdit(true); });

  window.addEventListener(EVENT + ':enter', enterEdit);
  window.addEventListener(EVENT + ':save', saveEdits);
  window.addEventListener(EVENT + ':exit', function () { exitEdit(false); });
  window.addEventListener(EVENT + ':cancel', function () { exitEdit(true); });

  publishState();
  emit('ready', { file: FILE, fieldCount: FIELD_COUNT });
  syncBar();
})();
</` + `script>
`;
}

export { EVENT };
