// Glue between the draw.io embed iframe (postMessage "json" protocol) and the local file API.
"use strict";

const token = new URLSearchParams(location.search).get("t") ?? "";
const $ = (id) => document.getElementById(id);
const frame = $("editor");
const statusEl = $("status");
const actions = $("actions");

const EMBED_PARAMS = {
  embed: 1, proto: "json", spin: 1, offline: 1, pwa: 0, stealth: 1, splash: 0,
  saveAndExit: 0, noExitBtn: 1, noSaveBtn: 1, libraries: 1, dark: "auto",
};
frame.src = "/drawio/index.html?" + new URLSearchParams(EMBED_PARAMS);

let kind = "drawio";
let baseHash = "";      // hash of the file content we last read or wrote
let latestXml = null;   // newest xml reported by the editor
let dirty = false;
let saving = false;
let saveAgain = false;
let conflict = false;
let timer;

function setStatus(state, text) {
  statusEl.dataset.state = state;
  statusEl.textContent = text;
}
const clock = () => new Date().toLocaleTimeString();

async function api(path, init = {}) {
  const res = await fetch(path, { ...init, headers: { "x-drawio-token": token, ...(init.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}
const post = (msg) => frame.contentWindow.postMessage(JSON.stringify(msg), location.origin);

async function loadFromDisk() {
  const { res, body } = await api("/api/file");
  if (!res.ok) {
    setStatus("error", body.error ?? "failed to read file");
    return;
  }
  $("name").textContent = body.name;
  document.title = body.name + " – draw.io";
  kind = body.kind;
  baseHash = body.hash;
  latestXml = body.xml;
  dirty = false;
  conflict = false;
  actions.classList.remove("show");
  post({ action: "load", xml: body.xml, autosave: 1, title: body.name });
  setStatus("saved", "loaded " + clock());
}

function scheduleSave() {
  dirty = true;
  if (conflict) return;
  setStatus("dirty", "unsaved changes");
  clearTimeout(timer);
  timer = setTimeout(startSave, 400);
}

function startSave(force = false) {
  if (saving) { saveAgain = true; return; }
  if (!dirty && !force) return;
  saving = true;
  setStatus("saving", "saving…");
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
    conflict = true;
    actions.classList.add("show");
    setStatus("error", "file changed on disk");
  } else if (!res.ok) {
    setStatus("error", body.error ?? "save failed");
  } else {
    baseHash = body.hash;
    dirty = false;
    conflict = false;
    actions.classList.remove("show");
    setStatus("saved", "saved " + clock());
  }
  if (saveAgain) { saveAgain = false; if (dirty && !conflict) startSave(); }
}

window.addEventListener("message", (e) => {
  if (e.source !== frame.contentWindow || e.origin !== location.origin) return;
  let msg;
  try { msg = JSON.parse(e.data); } catch { return; }
  switch (msg.event) {
    case "init": loadFromDisk(); break;
    case "autosave": latestXml = msg.xml; scheduleSave(); break;
    case "save": latestXml = msg.xml ?? latestXml; dirty = true; startSave(true); break;
    case "export": writeFile(decodeDataUri(msg.data), false); break;
    case "configure": post({ action: "configure", config: {} }); break;
  }
});

$("reload").onclick = loadFromDisk;
$("overwrite").onclick = () => { conflict = false; actions.classList.remove("show"); startSave(true); };

// External edits (git checkout, another editor, an agent). Self-writes never echo: the server tracks them.
const events = new EventSource("/api/events?t=" + encodeURIComponent(token));
events.addEventListener("changed", () => {
  if (dirty || saving) {
    conflict = true;
    actions.classList.add("show");
    setStatus("error", "file changed on disk");
  } else {
    loadFromDisk();
  }
});

window.addEventListener("beforeunload", (e) => { if (dirty) e.preventDefault(); });
