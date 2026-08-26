// Injected into editable pages in dev. Edit mode is controlled via the Astro dev toolbar.
// Changes auto-save when the user leaves an editable field.

const EVENT = "astro-inline-editor";

export function clientScript({ file, hash, fieldCount }) {
  if (fieldCount === 0) return "";

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
  var saving = false;
  var pendingSave = false;
  var pendingExit = false;
  var saveTimer = null;
  var originals = new Map();
  var dirty = new Map();
  var guardedParents = [];

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
    if (saving) return 'Saving…';
    if (dirty.size) return dirty.size + ' unsaved change' + (dirty.size === 1 ? '' : 's');
    return '';
  }

  function syncState() {
    publishState();
    var msg = statusMessage();
    emit('status', { message: msg, editing: editing, dirty: dirty.size, file: FILE });
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
    syncState();
  }

  function onBlur() {
    if (!dirty.size) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      saveEdits();
    }, 300);
  }

  function blockParentActivation(e) {
    if (!editing) return;
    var inField = e.target.closest('[data-edit-id][contenteditable="true"]');
    // Let mousedown reach editable labels so they can receive focus.
    if (e.type === 'mousedown' && inField) return;
    e.preventDefault();
  }

  function guardInteractiveParents(el) {
    var parent = el.closest('a, button');
    if (!parent || parent.__ie_guarded) return;
    parent.__ie_guarded = true;
    parent.addEventListener('click', blockParentActivation, true);
    parent.addEventListener('mousedown', blockParentActivation, true);
    guardedParents.push(parent);
  }

  function unguardInteractiveParents() {
    guardedParents.forEach(function (parent) {
      parent.removeEventListener('click', blockParentActivation, true);
      parent.removeEventListener('mousedown', blockParentActivation, true);
      delete parent.__ie_guarded;
    });
    guardedParents = [];
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
      el.addEventListener('blur', onBlur);
      guardInteractiveParents(el);
    });
    syncState();
  }

  function exitEdit(reload) {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    editing = false;
    unguardInteractiveParents();
    nodes().forEach(function (el) {
      el.removeAttribute('contenteditable');
      el.classList.remove('__ie_on', '__ie_dirty');
      el.removeEventListener('paste', stripFormattingPaste);
      el.removeEventListener('input', onInput);
      el.removeEventListener('blur', onBlur);
    });
    if (reload) location.reload();
    else syncState();
  }

  function applySaved(newHash) {
    if (newHash) BASE_HASH = newHash;
    nodes().forEach(function (el) {
      originals.set(el.getAttribute('data-edit-id'), currentValue(el));
      el.classList.remove('__ie_dirty');
    });
    dirty.clear();
    syncState();
  }

  function saveEdits(opts) {
    opts = opts || {};
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }

    if (!dirty.size) {
      if (opts.exitAfter) exitEdit(false);
      return;
    }
    if (saving) {
      pendingSave = true;
      if (opts.exitAfter) pendingExit = true;
      return;
    }

    saving = true;
    syncState();
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
        saving = false;
        if (!res.ok) {
          alert('Save failed: ' + (res.body && res.body.message ? res.body.message : 'unknown error'));
          syncState();
          return;
        }
        if (res.body.reload) {
          setTimeout(function () { location.reload(); }, 200);
          return;
        }
        applySaved(res.body.hash);

        if (pendingSave) {
          pendingSave = false;
          var exit = pendingExit;
          pendingExit = false;
          saveEdits({ exitAfter: exit });
          return;
        }
        if (opts.exitAfter || pendingExit) {
          pendingExit = false;
          exitEdit(false);
        }
      })
      .catch(function (err) {
        saving = false;
        pendingSave = false;
        pendingExit = false;
        alert('Save failed: ' + err.message);
        syncState();
      });
  }

  window.addEventListener(EVENT + ':enter', enterEdit);
  window.addEventListener(EVENT + ':save', function () { saveEdits(); });
  window.addEventListener(EVENT + ':done', function () { saveEdits({ exitAfter: true }); });
  window.addEventListener(EVENT + ':cancel', function () { exitEdit(true); });

  publishState();
  emit('ready', { file: FILE, fieldCount: FIELD_COUNT });
  syncState();
})();
</` + `script>
`;
}

export { EVENT };
