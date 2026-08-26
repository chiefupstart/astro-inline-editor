// Injected into editable pages in dev. Controls live in the Astro dev toolbar;
// this script handles contenteditable state and save requests.

const EVENT = "astro-inline-editor";

export function clientScript({ file, hash, fieldCount }) {
  return `
<style>
  [data-edit-id].__ie_on { outline: 1.5px dashed #B08BD1; outline-offset: 3px;
    border-radius: 2px; cursor: text; }
  [data-edit-id].__ie_on:hover { outline-color: #6B4C8A; background: rgba(107,76,138,0.06); }
  [data-edit-id].__ie_on:focus { outline: 1.5px solid #6B4C8A; background: rgba(107,76,138,0.10); }
  [data-edit-id].__ie_dirty { outline-style: solid; }
</style>
<script>
(function () {
  var FILE = ${JSON.stringify(file)};
  var BASE_HASH = ${JSON.stringify(hash)};
  var FIELD_COUNT = ${fieldCount};
  var EVENT = ${JSON.stringify(EVENT)};
  var editing = false;
  var originals = new Map();
  var dirty = new Map();

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
    if (!editing) return FIELD_COUNT + ' editable field' + (FIELD_COUNT === 1 ? '' : 's');
    if (dirty.size) return dirty.size + ' unsaved change' + (dirty.size === 1 ? '' : 's');
    return 'Edit mode — click any dashed element';
  }

  function syncStatus() {
    emit('status', { message: statusMessage(), editing: editing, dirty: dirty.size, file: FILE });
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
    syncStatus();
  }

  function enterEdit() {
    if (!FIELD_COUNT) return;
    editing = true;
    window.__astro_inline_editor_editing = true;
    dirty.clear();
    nodes().forEach(function (el) {
      var id = el.getAttribute('data-edit-id');
      originals.set(id, currentValue(el));
      el.setAttribute('contenteditable', 'true');
      el.classList.add('__ie_on');
      el.addEventListener('paste', stripFormattingPaste);
      el.addEventListener('input', onInput);
    });
    syncStatus();
  }

  function exitEdit(reload) {
    editing = false;
    window.__astro_inline_editor_editing = false;
    nodes().forEach(function (el) {
      el.removeAttribute('contenteditable');
      el.classList.remove('__ie_on', '__ie_dirty');
      el.removeEventListener('paste', stripFormattingPaste);
      el.removeEventListener('input', onInput);
    });
    if (reload) location.reload();
    else syncStatus();
  }

  function saveEdits() {
    if (!dirty.size) { exitEdit(false); return; }
    emit('status', { message: 'Saving…', editing: true, dirty: dirty.size, file: FILE });
    var edits = [];
    dirty.forEach(function (text, id) {
      var el = document.querySelector('[data-edit-id="' + CSS.escape(id) + '"]');
      edits.push({
        id: id,
        text: text,
        path: el ? el.getAttribute('data-edit-path') : undefined,
      });
    });
    fetch('/__editor/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: FILE, baseHash: BASE_HASH, edits: edits })
    })
      .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
      .then(function (res) {
        if (!res.ok) {
          emit('status', { message: 'Save failed', editing: true, dirty: dirty.size, file: FILE, error: res.body && res.body.message });
          alert('Save failed: ' + (res.body && res.body.message ? res.body.message : 'unknown error'));
          return;
        }
        emit('status', { message: 'Saved — reloading…', editing: false, dirty: 0, file: FILE });
        setTimeout(function () { location.reload(); }, 400);
      })
      .catch(function (err) {
        emit('status', { message: 'Save failed', editing: true, dirty: dirty.size, file: FILE, error: err.message });
        alert('Save failed: ' + err.message);
      });
  }

  window.addEventListener(EVENT + ':enter', enterEdit);
  window.addEventListener(EVENT + ':save', saveEdits);
  window.addEventListener(EVENT + ':cancel', function () { exitEdit(true); });

  if (FIELD_COUNT > 0) {
    emit('ready', { file: FILE, fieldCount: FIELD_COUNT });
    syncStatus();
  } else {
    emit('absent', {});
  }
})();
</` + `script>
`;
}

export { EVENT };
