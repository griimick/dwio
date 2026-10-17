// Glue between the draw.io embed iframe (postMessage "json" protocol) and the local file API.
//
// The page is only the editor. File name and sync state are shown in draw.io's own menu bar (the `title`
// of the load message and the `status` action). Rare problems appear as small toasts in a corner.
//
// Sync rules when the file changes on disk behind the editor's back:
//   clean tab (everything is already saved) -> `load`: show exactly what is on disk.
//   dirty tab (unsaved edits or a save in flight) -> `merge`: keep local edits and apply the outside changes.
// `merge` is not used for clean tabs because draw.io compares against an old snapshot, which would keep
// edits that an outside reset (git checkout) has undone.
"use strict";

const token = new URLSearchParams(location.search).get("t") ?? "";
const frame = document.getElementById("editor");

const EMBED_PARAMS = {
  embed: 1, proto: "json", spin: 1, offline: 1, pwa: 0, stealth: 1, splash: 0,
  saveAndExit: 0, noExitBtn: 1, noSaveBtn: 1, libraries: 1, dark: "auto",
};
frame.src = "/drawio/index.html?" + new URLSearchParams(EMBED_PARAMS);

// ---- keeping the view when the file is loaded again --------------------------------------------
// When another program changes the file, the editor loads it again, and that resets the zoom and the scroll position.
// The page and the editor share an origin, so the page can reach the editor object: it wraps one method that the editor
// calls all the time, and keeps the object it is called on. If this ever fails, nothing breaks: the view is just not restored.
let editorUi = null;
(function hookEditor() {
  const started = Date.now();
  const timer = setInterval(() => {
    if (Date.now() - started > 60000) return clearInterval(timer);
    try {
      const proto = frame.contentWindow?.EditorUi?.prototype;
      if (!proto) return; // the editor script has not run yet
      clearInterval(timer);
      if (proto.__dwioHooked) return;
      proto.__dwioHooked = true;
      const original = proto.getCurrentFile;
      proto.getCurrentFile = function () { editorUi = this; return original.apply(this, arguments); };
    } catch { /* not reachable: keep trying until the time is up */ }
  }, 5);
})();

/** Which part of the diagram is on screen: the zoom, and the diagram point at the top-left corner. */
function currentView() {
  try {
    const g = editorUi.editor.graph, scale = g.view.scale, t = g.view.translate;
    return { scale, x: g.container.scrollLeft / scale - t.x, y: g.container.scrollTop / scale - t.y };
  } catch { return null; }
}

function applyView(v) {
  try {
    const g = editorUi.editor.graph;
    g.view.setScale(v.scale);
    const t = g.view.translate;
    // The scroll area changes size after the new scale; set the scroll position when it has.
    const set = () => { g.container.scrollLeft = (v.x + t.x) * v.scale; g.container.scrollTop = (v.y + t.y) * v.scale; };
    set();
    requestAnimationFrame(() => { set(); requestAnimationFrame(set); });
  } catch { /* leave the view as the editor made it */ }
}

let name = "";
let kind = "drawio";
let baseHash = "";      // hash of the file content we last read or wrote
let latestXml = null;   // newest xml reported by the editor
let dirty = false;      // edits not on disk yet
let saving = false;
let saveAgain = false;
let externalPending = false;
let timer;

// ---- a copy of unsaved edits ----------------------------------------------------------------------
// If dwio is stopped (or the token or port changes) while edits are unsaved, the tab cannot save them. The editor's
// xml is kept in localStorage until it is on disk, and offered back on the next load of this address. It can fail
// (private window, blocked storage); then there is simply no copy.
const DRAFT_KEY = "dwio-draft";
const draft = {
  save() { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ xml: latestXml, at: Date.now() })); } catch { /* no copy */ } },
  clear() { try { localStorage.removeItem(DRAFT_KEY); } catch { /* nothing to clear */ } },
  read() { try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null"); return d && typeof d.xml === "string" ? d : null; } catch { return null; } },
};

// Read-only view of the state for the browser test (scripts/e2e.mjs). `holdSaves` pauses autosave.
window.__dwio = { get dirty() { return dirty; }, get saving() { return saving; }, last: "", holdSaves: false, dot: "" };

const clock = () => new Date().toLocaleTimeString();
const post = (msg) => frame.contentWindow.postMessage(JSON.stringify(msg), location.origin);

// ---- a dot on the tab icon ----------------------------------------------------------------------
// A dot on the favicon shows the state even when the tab is pinned and the title is hidden.
// Blue: unsaved edits or a save in progress. Red: a problem (save failed, or the connection to dwio is lost).
const DOT_COLORS = { blue: "#1a73e8", red: "#d93025" };
const DOT_FOR_STATE = { dirty: "blue", saving: "blue", error: "red", disconnected: "red" };
const iconLinks = [...document.querySelectorAll('link[rel="icon"]')].map((link) => ({ link, original: link.href, size: Number(link.sizes.value.split("x")[0]) }));
const iconImages = new Map(); // size -> loaded Image of the original icon

function loadIcon({ original, size }) {
  if (!iconImages.has(size)) {
    iconImages.set(size, new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null); // no icon, no dot: never break the page for this
      img.src = original;
    }));
  }
  return iconImages.get(size);
}

async function setFaviconDot(color) {
  if (color === window.__dwio.dot) return;
  window.__dwio.dot = color;
  for (const icon of iconLinks) {
    if (!color) { icon.link.href = icon.original; continue; }
    const img = await loadIcon(icon);
    if (!img || window.__dwio.dot !== color) continue; // the state changed while the icon loaded
    const c = document.createElement("canvas");
    c.width = c.height = icon.size;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const s = icon.size, cx = s * 0.72, cy = s * 0.72;
    ctx.beginPath(); ctx.arc(cx, cy, s * 0.26, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,255,255,0.96)"; ctx.fill(); // ring: shows on light and dark tab bars
    ctx.beginPath(); ctx.arc(cx, cy, s * 0.2, 0, Math.PI * 2); ctx.fillStyle = DOT_COLORS[color]; ctx.fill();
    icon.link.href = c.toDataURL("image/png");
  }
  if (!color) for (const icon of iconLinks) icon.link.href = icon.original; // restore wins over a late draw
}

// ---- status in draw.io's menu bar -------------------------------------------------------------
function setStatus(text, last) {
  window.__dwio.last = last ?? text;
  document.title = name ? `${name} | dwio` : "dwio"; // the state is shown by the dot on the tab icon, not here
  void setFaviconDot(DOT_FOR_STATE[window.__dwio.last] ?? "");
  if (frame.contentWindow) post({ action: "status", message: `${name} · ${text}` });
}

// ---- toasts -------------------------------------------------------------------------------------
const toastBox = document.getElementById("toasts");
const toasts = new Map();
function toast({ id, text, kind = "info", sticky = false, actions = [] }) {
  if (id && toasts.has(id)) toasts.get(id)();
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.textContent = text;
  const remove = () => { el.remove(); if (id) toasts.delete(id); };
  if (actions.length) {
    const row = document.createElement("div");
    row.className = "row";
    for (const a of actions) {
      const b = document.createElement("button");
      b.textContent = a.label;
      b.onclick = () => { remove(); a.run(); };
      row.append(b);
    }
    el.append(row);
  }
  toastBox.append(el);
  if (id) toasts.set(id, remove);
  if (!sticky) setTimeout(remove, 5000);
  return remove;
}

async function api(path, init = {}) {
  const res = await fetch(path, { ...init, headers: { "x-drawio-token": token, ...(init.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

// ---- loading and syncing from disk --------------------------------------------------------------
let viewToRestore = null;
async function loadFromDisk(reason) {
  const { res, body } = await api("/api/file");
  if (!res.ok) {
    setStatus("cannot read the file", "error");
    toast({ id: "read", kind: "error", sticky: true, text: body.error ?? "Cannot read the file.", actions: [{ label: "Try again", run: () => loadFromDisk(reason) }] });
    return;
  }
  name = body.name;
  kind = body.kind;
  baseHash = body.hash;
  latestXml = body.xml;
  dirty = false;
  viewToRestore = reason === "loaded" ? null : currentView(); // the first load keeps the editor's own view
  post({ action: "load", xml: body.xml, autosave: 1, title: body.name });
  setStatus(`${reason} ${clock()}`, reason === "loaded" ? "loaded" : "reloaded");
  if (reason === "loaded") offerDraft(body.xml);
}

// A copy left by an earlier tab that could not save: ask before using it, because the file on disk may have moved on.
function offerDraft(diskXml) {
  const d = draft.read();
  if (!d) return;
  if (d.xml === diskXml) return draft.clear();
  toast({ id: "draft", sticky: true, text: `Found unsaved edits from ${new Date(d.at).toLocaleString()} that never reached the file. Restoring replaces what is on disk now.`,
    actions: [
      { label: "Restore my edits", run: () => { latestXml = d.xml; post({ action: "load", xml: d.xml, autosave: 1, title: name }); scheduleSave(); } },
      { label: "Discard", run: draft.clear },
    ] });
}

const mergeWaiters = [];
async function mergeFromDisk() {
  const { res, body } = await api("/api/file");
  if (!res.ok) {
    setStatus("cannot read the file", "error");
    toast({ id: "read", kind: "error", sticky: true, text: body.error ?? "Cannot read the changed file." });
    return;
  }
  if (body.hash === baseHash) return; // nothing new
  baseHash = body.hash; // later saves compare against this version
  const done = new Promise((resolve) => mergeWaiters.push(resolve));
  post({ action: "merge", xml: body.xml });
  const result = await Promise.race([done, new Promise((r) => setTimeout(() => r({ error: "timed out" }), 10000))]);
  if (result.error) {
    setStatus("could not merge", "error");
    toast({ id: "merge", kind: "error", sticky: true, text: `Could not merge the changes from disk (${result.error}).`,
      actions: [{ label: "Load disk version (drop my edits)", run: () => loadFromDisk("reloaded") }, { label: "Keep mine", run: () => { baseHash = ""; scheduleSave(); } }] });
    return;
  }
  toast({ id: "merge", text: "Merged changes from disk into your open diagram. If both changed the same shape, the disk version won." });
  scheduleSave(); // write the merged result
}

// External change notification. See the rules in the header comment.
async function onExternalChange() {
  if (saving) { externalPending = true; return; }
  if (!dirty && !timer) await loadFromDisk("reloaded");
  else await mergeFromDisk();
}

// ---- saving -------------------------------------------------------------------------------------
function scheduleSave() {
  dirty = true;
  if (latestXml) draft.save();
  setStatus("unsaved changes", "dirty");
  clearTimeout(timer);
  timer = setTimeout(() => { timer = undefined; startSave(); }, 400);
}

function startSave(force = false) {
  if (window.__dwio.holdSaves) { timer = setTimeout(() => { timer = undefined; startSave(force); }, 100); return; }
  if (saving) { saveAgain = true; return; }
  if (!dirty && !force) return;
  saving = true;
  setStatus("saving…", "saving");
  // Export what the editor holds now. Do not send "xml" here: the editor would load it again, which resets the
  // view and the undo history on every save. Do not send "spin" either: it covers the editor while you type.
  if (kind === "svg") post({ action: "export", format: "xmlsvg" });
  else writeFile(latestXml, force);
}

function decodeDataUri(uri) {
  const b64 = uri.slice(uri.indexOf(",") + 1);
  return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
}

async function writeFile(text, force) {
  const headers = force ? {} : { "x-base-hash": baseHash };
  const { res, body } = await api("/api/file", { method: "PUT", headers, body: text });
  saving = false;
  if (res.status === 409) {
    // The file changed since we last read it: combine instead of asking the user to choose.
    externalPending = false;
    await mergeFromDisk();
    if (dirty && !timer) scheduleSave(); // never leave unsaved edits without a pending save
  } else if (!res.ok) {
    setStatus("save failed", "error");
    toast({ id: "save", kind: "error", sticky: true, text: `Could not save: ${body.error ?? res.status}`, actions: [{ label: "Try again", run: () => startSave(true) }] });
  } else {
    baseHash = body.hash;
    dirty = !!timer; // edits made while the save ran are still pending
    if (!dirty && !saveAgain) draft.clear();
    toasts.get("save")?.();
    setStatus(`saved ${clock()}`, "saved");
    if (externalPending) { externalPending = false; await onExternalChange(); }
  }
  if (saveAgain) { saveAgain = false; if (dirty) startSave(); }
}

// ---- messages from the editor -------------------------------------------------------------------
window.addEventListener("message", (e) => {
  if (e.source !== frame.contentWindow || e.origin !== location.origin) return;
  let msg;
  try { msg = JSON.parse(e.data); } catch { return; }
  switch (msg.event) {
    case "init": loadFromDisk("loaded"); break;
    case "load": if (viewToRestore) { applyView(viewToRestore); viewToRestore = null; } break; // the editor finished loading
    case "autosave": latestXml = msg.xml; scheduleSave(); break;
    case "save": latestXml = msg.xml ?? latestXml; dirty = true; startSave(true); break;
    case "export": if (msg.format !== "xml") writeFile(decodeDataUri(msg.data), false); break;
    case "merge": mergeWaiters.splice(0).forEach((resolve) => resolve({ error: msg.error })); break;
    case "configure": post({ action: "configure", config: {} }); break;
  }
});

// ---- connection to the server -------------------------------------------------------------------
let wasDown = false;
const events = new EventSource("/api/events?t=" + encodeURIComponent(token));
events.addEventListener("changed", onExternalChange);
events.addEventListener("open", async () => {
  if (!wasDown) return;
  wasDown = false;
  toasts.get("server")?.();
  toast({ text: "Reconnected to dwio." });
  await onExternalChange(); // the file may have changed while we were disconnected
  if (dirty && !timer && !saving) scheduleSave(); // unsaved edits: save again, and leave the red "disconnected" state
});
events.addEventListener("error", () => {
  if (wasDown) return;
  wasDown = true;
  setStatus("disconnected", "disconnected");
  toast({ id: "server", kind: "error", sticky: true, text: "Lost connection to dwio. Changes are not being saved. Keep this tab open and use File > Export as to keep your work, then start dwio again." });
});

window.addEventListener("beforeunload", (e) => { if (dirty || saving) e.preventDefault(); });
