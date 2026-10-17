// Headless export page. `dwio export` opens it in a browser it controls, then reads window.__dwioDone.
// Query: t=token, format=png|svg|xmlsvg, page=<1-based index, optional>, scale, border, background, transparent=1
"use strict";

const q = new URLSearchParams(location.search);
const token = q.get("t") ?? "";
const format = q.get("format") ?? "png";
const pageIndex = q.get("page") ? Number(q.get("page")) : null;
const num = (k) => (q.get(k) === null || q.get(k) === "" ? undefined : Number(q.get(k)));
const frame = document.getElementById("editor");

const EMBED = { embed: 1, proto: "json", offline: 1, pwa: 0, stealth: 1, splash: 0, noSaveBtn: 1, noExitBtn: 1, saveAndExit: 0, dark: 0, libraries: 0 };
frame.src = "/drawio/index.html?" + new URLSearchParams(EMBED);

/** Keeps one page of a multi-page file, so every export format renders the page that was asked for. */
function onlyPage(xml, index) {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const pages = [...doc.getElementsByTagName("diagram")];
  const keep = pages[index - 1];
  if (!keep) throw new Error(`page ${index} does not exist (the file has ${pages.length})`);
  return "<mxfile>" + new XMLSerializer().serializeToString(keep) + "</mxfile>";
}

window.__dwioDone = new Promise((resolve) => {
  const fail = (error) => resolve({ ok: false, error: String(error) });
  const post = (m) => frame.contentWindow.postMessage(JSON.stringify(m), location.origin);

  window.addEventListener("message", async (e) => {
    if (e.source !== frame.contentWindow) return;
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    try {
      if (msg.event === "init") {
        const res = await fetch("/api/file", { headers: { "x-drawio-token": token } });
        const body = await res.json();
        if (!res.ok) return fail(body.error ?? "cannot read file");
        post({ action: "load", xml: pageIndex ? onlyPage(body.xml, pageIndex) : body.xml, autosave: 0 });
      } else if (msg.event === "load") {
        const transparent = q.get("transparent") === "1";
        const exportMsg = { action: "export", format, scale: num("scale"), border: num("border"), background: transparent ? undefined : (q.get("background") || undefined), transparent };
        if (format !== "png") exportMsg.asText = true;
        post(exportMsg);
      } else if (msg.event === "export") {
        resolve({ ok: true, data: msg.data });
      } else if (msg.event === "error") {
        fail(msg.message ?? "editor error");
      }
    } catch (err) {
      fail(err);
    }
  });
});
