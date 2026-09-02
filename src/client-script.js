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
  [data-edit-id][data-edit-html].__ie_on * { cursor: text; }
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
  var EDIT_FLAG = "astro-inline-editor-active";

  function markEditingActive(active) {
    try {
      if (active) sessionStorage.setItem(EDIT_FLAG, "1");
      else sessionStorage.removeItem(EDIT_FLAG);
    } catch (e) {}
  }

  function shouldRestoreEditMode() {
    try { return sessionStorage.getItem(EDIT_FLAG) === "1"; } catch (e) { return false; }
  }

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
    if (el.hasAttribute('data-edit-html')) return el.innerHTML;
    if (el.hasAttribute('data-edit-raw')) return el.textContent;
    return el.textContent;
  }

  function displayMarkdownLinks(text) {
    var t = (text || '').trim();
    if (t.charAt(0) === '*' && t.charAt(t.length - 1) === '*' && t.charAt(1) !== '*') {
      t = t.slice(1, -1);
    }
    return t.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  function restoreMarkdownDisplay(el) {
    if (!el.hasAttribute('data-edit-raw')) return;
    var raw = el.getAttribute('data-edit-raw') || el.textContent || '';
    el.innerHTML = displayMarkdownLinks(raw);
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

  function focusHtmlField(el, e) {
    if (e.target === el) return;
    e.preventDefault();
    el.focus();
    var sel = window.getSelection();
    if (!sel) return;
    var range = null;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(e.clientX, e.clientY);
    } else if (document.caretPositionFromPoint) {
      var pos = document.caretPositionFromPoint(e.clientX, e.clientY);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
      }
    }
    if (range) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  function enterEdit() {
    if (!FIELD_COUNT || editing) return;
    editing = true;
    markEditingActive(true);
    dirty.clear();
    nodes().forEach(function (el) {
      var id = el.getAttribute('data-edit-id');
      if (el.hasAttribute('data-edit-raw')) {
        el.textContent = el.getAttribute('data-edit-raw') || el.textContent || '';
      }
      originals.set(id, currentValue(el));
      el.setAttribute('contenteditable', 'true');
      el.classList.add('__ie_on');
      el.addEventListener('paste', stripFormattingPaste);
      el.addEventListener('input', onInput);
      el.addEventListener('blur', onBlur);
      if (el.hasAttribute('data-edit-html')) {
        el.__ie_htmlDown = function (e) { focusHtmlField(el, e); };
        el.addEventListener('mousedown', el.__ie_htmlDown);
      }
      guardInteractiveParents(el);
    });
    syncState();
  }

  function exitEdit(reload) {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    editing = false;
    markEditingActive(false);
    unguardInteractiveParents();
    nodes().forEach(function (el) {
      el.removeAttribute('contenteditable');
      el.classList.remove('__ie_on', '__ie_dirty');
      el.removeEventListener('paste', stripFormattingPaste);
      el.removeEventListener('input', onInput);
      el.removeEventListener('blur', onBlur);
      if (el.__ie_htmlDown) {
        el.removeEventListener('mousedown', el.__ie_htmlDown);
        delete el.__ie_htmlDown;
      }
      if (el.hasAttribute('data-edit-raw')) restoreMarkdownDisplay(el);
    });
    if (reload) location.reload();
    else syncState();
  }

  function applySaved(newHash) {
    if (newHash) BASE_HASH = newHash;
    nodes().forEach(function (el) {
      originals.set(el.getAttribute('data-edit-id'), currentValue(el));
      el.classList.remove('__ie_dirty');
      if (el.hasAttribute('data-edit-raw')) {
        el.setAttribute('data-edit-raw', currentValue(el));
        restoreMarkdownDisplay(el);
      }
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
          markEditingActive(true);
          setTimeout(function () { location.reload(); }, 200);
          return;
        }
        applySaved(res.body.hash);
        emit('status', { message: 'Saved ✓', editing: editing, dirty: 0, file: FILE });

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
  window.addEventListener(EVENT + ':exit', function () { saveEdits({ exitAfter: true }); });
  window.addEventListener(EVENT + ':cancel', function () { exitEdit(true); });

  window.addEventListener('astro:page-load', function () {
    if (shouldRestoreEditMode() && !editing) enterEdit();
  });

  publishState();
  emit('ready', { file: FILE, fieldCount: FIELD_COUNT });
  syncState();

  if (shouldRestoreEditMode()) {
    requestAnimationFrame(function () {
      if (!editing) enterEdit();
    });
  }
})();
</` + `script>
`;
}

export { EVENT };
