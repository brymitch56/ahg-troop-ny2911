// ============================================================
//  SharePoint for the planner: upload a file into the badge's
//  folder, or pick files already on the troop site. Talks to
//  Microsoft Graph with the leader's own sign-in (Tracker.graph);
//  the tracker only ever stores the resulting link.
//
//  Where uploads go: config.js → tracker.resourceFolder
//    { library: "Documents", path: "Badge Resources" }
//  → <library>/<path>/<badge name>/<file>. Folders are created on
//  the first upload; the picker opens in the badge's folder when
//  it exists and can browse every library from there.
// ============================================================
(function () {
  "use strict";
  const { graph, graphReady, esc, fmtDate, $ } = window.Tracker;
  const cfg = (window.TROOP_CONFIG && window.TROOP_CONFIG.leaders) || {};
  const rf = ((window.TROOP_CONFIG && window.TROOP_CONFIG.tracker) || {}).resourceFolder || {};
  const LIBRARY = rf.library || "Documents";
  const BASE_PATH = String(rf.path == null ? "Badge Resources" : rf.path).replace(/^\/+|\/+$/g, "");

  const SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024; // Graph's cap for one-request uploads
  const CHUNK_SIZE = 10 * 1024 * 1024;         // a multiple of 320 KiB
  const ITEM_FIELDS = "$select=id,name,size,lastModifiedDateTime,webUrl,folder,file,parentReference";
  const isSystemLibrary = (name) => /^(Site Assets|Style Library|Form Templates|Site Pages|Teams Wiki Data)$/i.test(name);
  // characters SharePoint refuses in a folder name
  const safeName = (s) => String(s).replace(/["*:<>?/\\|#%]/g, "-").replace(/\s+/g, " ").trim().replace(/\.+$/, "") || "Badge";
  const encPath = (p) => p.split("/").filter(Boolean).map(encodeURIComponent).join("/");

  let siteId = null;
  let drives = null;
  async function site() {
    if (siteId) return siteId;
    const u = new URL(cfg.siteUrl);
    const p = u.pathname.replace(/\/+$/, "");
    siteId = (await graph((p ? "/sites/" + u.hostname + ":" + p : "/sites/" + u.hostname) + "?$select=id")).id;
    return siteId;
  }
  async function libraries() {
    if (drives) return drives;
    const id = await site();
    let out = [];
    let next = "/sites/" + id + "/drives?$select=id,name,webUrl,driveType";
    while (next) { const pg = await graph(next); out = out.concat(pg.value || []); next = pg["@odata.nextLink"] || null; }
    drives = out.filter((d) => d.driveType === "documentLibrary" && !isSystemLibrary(d.name)).sort((a, b) => a.name.localeCompare(b.name));
    return drives;
  }
  async function uploadLibrary() {
    const list = await libraries();
    const d = list.find((x) => x.name.toLowerCase() === LIBRARY.toLowerCase()) || list[0];
    if (!d) throw new Error("The troop SharePoint site has no document library you can use.");
    return d;
  }
  const badgePath = (badgeName) => [BASE_PATH, safeName(badgeName)].filter(Boolean).join("/");

  // the badge's folder (made on demand), as { driveId, id }
  async function ensureFolder(driveId, path) {
    let parent = "/drives/" + driveId + "/root";
    let cur = null;
    for (const part of path.split("/").filter(Boolean)) {
      try {
        cur = await graph(parent + ":/" + encodeURIComponent(part) + "?$select=id,folder");
      } catch (e) {
        if (e.status !== 404) throw e;
        cur = await graph(parent + "/children", {
          method: "POST",
          body: { name: part, folder: {}, "@microsoft.graph.conflictBehavior": "fail" },
        }).catch(async (err) => {
          if (err.status === 409) return graph(parent + ":/" + encodeURIComponent(part) + "?$select=id,folder"); // made meanwhile
          throw err;
        });
      }
      parent = "/drives/" + driveId + "/items/" + cur.id;
    }
    return { driveId, id: cur ? cur.id : null };
  }

  /**
   * Upload one file into the badge's folder. A file of the same name there
   * is kept: SharePoint adds a number to the new one. Resolves to the
   * driveItem ({ id, name, webUrl, parentReference }).
   */
  async function upload(file, badgeName, onProgress) {
    const lib = await uploadLibrary();
    const folder = await ensureFolder(lib.id, badgePath(badgeName));
    const ref = folder.id ? "/drives/" + lib.id + "/items/" + folder.id : "/drives/" + lib.id + "/root";
    const name = encodeURIComponent(file.name);
    if (file.size <= SIMPLE_UPLOAD_LIMIT) {
      const it = await graph(ref + ":/" + name + ":/content?@microsoft.graph.conflictBehavior=rename", {
        method: "PUT", body: file, raw: true, headers: { "Content-Type": file.type || "application/octet-stream" },
      });
      if (onProgress) onProgress(1);
      return it;
    }
    const session = await graph(ref + ":/" + name + ":/createUploadSession", {
      method: "POST", body: { item: { "@microsoft.graph.conflictBehavior": "rename", name: file.name } },
    });
    let offset = 0;
    let last = null;
    while (offset < file.size) {
      const end = Math.min(offset + CHUNK_SIZE, file.size);
      const res = await fetch(session.uploadUrl, {
        method: "PUT",
        headers: { "Content-Range": "bytes " + offset + "-" + (end - 1) + "/" + file.size },
        body: file.slice(offset, end),
      });
      if (!res.ok) {
        let msg = "Upload failed (" + res.status + ")";
        try { const err = await res.json(); if (err.error && err.error.message) msg = err.error.message; } catch (_) { /* non-JSON */ }
        throw new Error(msg);
      }
      last = res.status === 200 || res.status === 201 ? await res.json() : null;
      offset = end;
      if (onProgress) onProgress(offset / file.size);
    }
    return last;
  }

  // ---------- picker ----------
  function overlayEl() {
    let o = $("trk-sp-modal");
    if (!o) {
      o = document.createElement("div");
      o.id = "trk-sp-modal";
      o.className = "evt-overlay";
      document.body.appendChild(o);
    }
    return o;
  }

  const fmtSize = (n) => (n == null ? "" : n < 1024 ? n + " B" : n < 1048576 ? Math.round(n / 1024) + " KB" : (n / 1048576).toFixed(1) + " MB");

  /**
   * Browse the troop site and tick files. Resolves to the chosen driveItems
   * (possibly []); opens in the badge's folder when there is one.
   */
  function pick(badgeName) {
    return new Promise((resolve) => {
      const overlay = overlayEl();
      const chosen = new Map(); // id → item
      // where we are: library + folder trail [{ id, name }]
      const st = { drive: null, trail: [], items: [], query: "", loading: true, error: "" };

      const close = (result) => {
        overlay.classList.remove("open");
        document.removeEventListener("keydown", onKey);
        resolve(result);
      };
      const onKey = (e) => { if (e.key === "Escape") close([]); };
      document.addEventListener("keydown", onKey);
      overlay.onclick = (e) => { if (e.target === overlay) close([]); };

      const folderRef = () => (st.trail.length
        ? "/drives/" + st.drive.id + "/items/" + st.trail[st.trail.length - 1].id
        : "/drives/" + st.drive.id + "/root");

      async function load() {
        st.loading = true; st.error = ""; draw();
        try {
          let out = [];
          let next = st.query
            ? "/drives/" + st.drive.id + "/root/search(q='" + encodeURIComponent(st.query.replace(/'/g, "''")) + "')?" + ITEM_FIELDS + "&$top=100"
            : folderRef() + "/children?" + ITEM_FIELDS + "&$orderby=name%20asc&$top=200";
          while (next) { const pg = await graph(next); out = out.concat(pg.value || []); next = st.query ? null : pg["@odata.nextLink"] || null; }
          st.items = out.sort((a, b) => (!!b.folder - !!a.folder) || a.name.localeCompare(b.name));
        } catch (e) {
          st.items = []; st.error = e.message;
        }
        st.loading = false; draw();
      }

      function draw() {
        const libs = drives || [];
        overlay.innerHTML = `
          <div class="evt-modal trk-sp-modal" role="dialog" aria-modal="true" aria-labelledby="trk-sp-title">
            <h3 id="trk-sp-title">Choose files from SharePoint</h3>
            <p class="evt-meta">For <strong>${esc(badgeName)}</strong>. Tick one or more files, then <em>Add to plan</em>.</p>
            ${libs.length > 1 ? `<div class="trk-chips">${libs.map((d) => `<button class="trk-chip ${st.drive && d.id === st.drive.id ? "active" : ""}" data-sp-drive="${esc(d.id)}">${esc(d.name)}</button>`).join("")}</div>` : ""}
            <div class="trk-row-tools">
              <span class="trk-sp-crumbs">${st.drive ? `<a href="#" data-sp-crumb="-1">${esc(st.drive.name)}</a>${st.trail.map((f, i) => ` / <a href="#" data-sp-crumb="${i}">${esc(f.name)}</a>`).join("")}` : ""}</span>
              <input type="search" id="trk-sp-q" class="trk-search" placeholder="Search this library…" value="${esc(st.query)}" style="margin-left:auto;min-width:12rem">
            </div>
            <div class="trk-sp-list">
              ${st.loading ? '<p class="trk-muted">Loading…</p>'
                : st.error ? `<p class="error">${esc(st.error)}</p>`
                : !st.items.length ? `<p class="trk-muted">${st.query ? "Nothing in this library matches." : "This folder is empty."}</p>`
                : st.items.map((it) => it.folder
                  ? `<div class="trk-sp-row"><a href="#" data-sp-open="${esc(it.id)}">📁 ${esc(it.name)}</a><span class="trk-muted">${it.folder.childCount != null ? it.folder.childCount + " items" : ""}</span></div>`
                  : `<label class="trk-sp-row"><span><input type="checkbox" data-sp-pick="${esc(it.id)}" ${chosen.has(it.id) ? "checked" : ""}> ${esc(it.name)}</span><span class="trk-muted">${fmtSize(it.size)} · ${esc(fmtDate(it.lastModifiedDateTime))}</span></label>`).join("")}
            </div>
            <div class="ldr-dialog-btns">
              <span class="trk-muted" style="margin-right:auto">${chosen.size ? `${chosen.size} file${chosen.size === 1 ? "" : "s"} ticked` : ""}</span>
              <button type="button" class="btn btn-outline btn-sm" id="trk-sp-cancel">Cancel</button>
              <button type="button" class="btn btn-blue btn-sm" id="trk-sp-ok" ${chosen.size ? "" : "disabled"}>Add to plan</button>
            </div>
          </div>`;
        overlay.querySelectorAll("[data-sp-drive]").forEach((b) => b.addEventListener("click", () => {
          st.drive = libs.find((d) => d.id === b.dataset.spDrive); st.trail = []; st.query = ""; load();
        }));
        overlay.querySelectorAll("[data-sp-crumb]").forEach((a) => a.addEventListener("click", (e) => {
          e.preventDefault(); st.trail = st.trail.slice(0, Number(a.dataset.spCrumb) + 1); st.query = ""; load();
        }));
        overlay.querySelectorAll("[data-sp-open]").forEach((a) => a.addEventListener("click", (e) => {
          e.preventDefault();
          const it = st.items.find((x) => x.id === a.dataset.spOpen);
          // a search hit's folder: jump there with just its own name in the trail
          st.trail = st.query ? [{ id: it.id, name: it.name }] : st.trail.concat({ id: it.id, name: it.name });
          st.query = ""; load();
        }));
        overlay.querySelectorAll("[data-sp-pick]").forEach((c) => c.addEventListener("change", () => {
          const it = st.items.find((x) => x.id === c.dataset.spPick);
          if (c.checked) chosen.set(it.id, it); else chosen.delete(it.id);
          draw();
        }));
        const q = $("trk-sp-q");
        q.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); st.query = q.value.trim(); load(); } });
        q.addEventListener("search", () => { if (!q.value && st.query) { st.query = ""; load(); } });
        $("trk-sp-cancel").addEventListener("click", () => close([]));
        $("trk-sp-ok").addEventListener("click", () => close([...chosen.values()]));
      }

      overlay.classList.add("open");
      draw();
      (async () => {
        try {
          const lib = await uploadLibrary();
          st.drive = lib;
          // open in the badge's folder, else the resource folder, else the library root
          const tryPath = async (p) => {
            if (!p) return null;
            try { return await graph("/drives/" + lib.id + "/root:/" + encPath(p) + "?$select=id,name,folder"); } catch (e) { if (e.status === 404) return null; throw e; }
          };
          const parts = badgePath(badgeName).split("/");
          for (let n = parts.length; n > 0; n--) {
            const f = await tryPath(parts.slice(0, n).join("/"));
            if (f && f.folder) {
              // trail of every folder on the way, so the crumbs walk back up
              const trail = [];
              for (let k = 1; k < n; k++) { const up = await tryPath(parts.slice(0, k).join("/")); if (up) trail.push({ id: up.id, name: up.name }); }
              trail.push({ id: f.id, name: f.name });
              st.trail = trail;
              break;
            }
          }
        } catch (e) {
          st.loading = false; st.error = e.message; draw(); return;
        }
        load();
      })();
    });
  }

  // a driveItem as the link the tracker stores
  const asLink = (badgeId, it) => ({
    badgeId, url: it.webUrl, title: it.name, kind: "sharepoint",
    driveId: (it.parentReference && it.parentReference.driveId) || null, itemId: it.id,
  });

  window.TrackerSP = {
    available: graphReady,
    upload, pick, asLink,
    folderLabel: (badgeName) => `${LIBRARY}/${badgePath(badgeName)}`,
  };
})();
