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

let name = "";
let kind = "drawio";
let baseHash = "";      // hash of the file content we last read or wrote
let latestXml = null;   // newest xml reported by the editor
let dirty = false;      // edits not on disk yet
let saving = false;
let saveAgain = false;
let externalPending = false;
let timer;

// Read-only view of the state for the browser test (scripts/e2e.mjs). `holdSaves` pauses autosave.
window.__dwio = { get dirty() { return dirty; }, get saving() { return saving; }, last: "", holdSaves: false };

const clock = () => new Date().toLocaleTimeString();
const post = (msg) => frame.contentWindow.postMessage(JSON.stringify(msg), location.origin);

// ---- status in draw.io's menu bar -------------------------------------------------------------
function setStatus(text, last) {
  window.__dwio.last = last ?? text;
  document.title = (dirty ? "● " : "") + (name || "draw.io");
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
async function loadFromDisk(reason) {
  const { res, body } = await api("/api/file");
  if (!res.ok) {
    toast({ id: "read", kind: "error", sticky: true, text: body.error ?? "Cannot read the file.", actions: [{ label: "Try again", run: () => loadFromDisk(reason) }] });
    return;
  }
  name = body.name;
  kind = body.kind;
  baseHash = body.hash;
  latestXml = body.xml;
  dirty = false;
  post({ action: "load", xml: body.xml, autosave: 1, title: body.name });
  setStatus(`${reason} ${clock()}`, reason === "loaded" ? "loaded" : "reloaded");
}

const mergeWaiters = [];
async function mergeFromDisk() {
  const { res, body } = await api("/api/file");
  if (!res.ok) {
    toast({ id: "read", kind: "error", sticky: true, text: body.error ?? "Cannot read the changed file." });
    return;
  }
  if (body.hash === baseHash) return; // nothing new
  baseHash = body.hash; // later saves compare against this version
  const done = new Promise((resolve) => mergeWaiters.push(resolve));
  post({ action: "merge", xml: body.xml });
  const result = await Promise.race([done, new Promise((r) => setTimeout(() => r({ error: "timed out" }), 10000))]);
  if (result.error) {
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
  if (kind === "svg") post({ action: "export", format: "xmlsvg", xml: latestXml, spin: "Saving" });
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
events.addEventListener("open", () => {
  if (!wasDown) return;
  wasDown = false;
  toasts.get("server")?.();
  toast({ text: "Reconnected to dwio." });
  onExternalChange(); // the file may have changed while we were disconnected
});
events.addEventListener("error", () => {
  if (wasDown) return;
  wasDown = true;
  setStatus("disconnected", "disconnected");
  toast({ id: "server", kind: "error", sticky: true, text: "Lost connection to dwio. Changes are not being saved. Keep this tab open and use File > Export as to keep your work, then start dwio again." });
});

window.addEventListener("beforeunload", (e) => { if (dirty || saving) e.preventDefault(); });
