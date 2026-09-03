// ============================================================
//  AHG Troop NY2911 — Leaders area
//  Signs leaders in with their Microsoft account (MSAL) and
//  browses/manages the troop SharePoint site through Microsoft
//  Graph: browse, search, upload, new folder, rename, move,
//  delete, download.
//  Configuration lives in assets/config.js → leaders: { ... }
// ============================================================
(function () {
  "use strict";

  const cfg = (window.TROOP_CONFIG && window.TROOP_CONFIG.leaders) || {};
  const $ = (id) => document.getElementById(id);
  const isPlaceholder = (v) => !v || String(v).startsWith("REPLACE");

  const el = {
    unconfigured: $("ldr-unconfigured"),
    gate: $("ldr-gate"),
    app: $("ldr-app"),
    account: $("ldr-account"),
    user: $("ldr-user"),
    signin: $("ldr-signin"),
    signout: $("ldr-signout"),
    error: $("ldr-error"),
    tabs: $("ldr-tabs"),
    search: $("ldr-search"),
    openSp: $("ldr-open-sp"),
    crumbs: $("ldr-crumbs"),
    folderActions: $("ldr-folder-actions"),
    uploadBtn: $("ldr-upload-btn"),
    newFolderBtn: $("ldr-newfolder-btn"),
    fileInput: $("ldr-file-input"),
    uploads: $("ldr-uploads"),
    dropzone: $("ldr-dropzone"),
    status: $("ldr-status"),
    table: $("ldr-files"),
    rows: $("ldr-rows"),
    dialog: $("ldr-dialog"),
    dialogTitle: $("ldr-dialog-title"),
    dialogBody: $("ldr-dialog-body"),
    dialogOk: $("ldr-dialog-ok"),
    dialogCancel: $("ldr-dialog-cancel"),
    toast: $("ldr-toast"),
  };

  // ---------- Guard: not configured / library missing ----------
  if (isPlaceholder(cfg.clientId) || isPlaceholder(cfg.tenantId) || isPlaceholder(cfg.siteUrl)) {
    el.unconfigured.hidden = false;
    return;
  }
  if (!window.msal) {
    el.gate.hidden = false;
    showGateError("The Microsoft sign-in library failed to load. Check your connection and reload.");
    return;
  }

  // ---------- MSAL setup ----------
  const SCOPES = ["User.Read", "Sites.ReadWrite.All"];
  const GRAPH = "https://graph.microsoft.com/v1.0";
  const pageUrl = window.location.origin + window.location.pathname;
  const SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024;     // Graph's cap for single-request uploads
  const CHUNK_SIZE = 10 * 1024 * 1024;             // must be a multiple of 320 KiB

  const msalApp = new msal.PublicClientApplication({
    auth: {
      clientId: cfg.clientId,
      authority: "https://login.microsoftonline.com/" + cfg.tenantId,
      redirectUri: pageUrl,
      postLogoutRedirectUri: pageUrl,
    },
    cache: { cacheLocation: "localStorage" },
  });

  // ---------- State ----------
  const state = {
    siteId: null,
    drives: [],
    drive: null,          // current library
    path: [],             // [{ id, name }] folders below the library root
    query: "",
    rootIds: {},          // driveId -> root item id (needed for "move to root")
  };

  // ---------- Small UI helpers ----------
  function showGateError(msg) {
    el.error.textContent = msg;
    el.error.style.display = msg ? "block" : "none";
  }
  function setStatus(msg, kind) {
    el.status.hidden = !msg;
    el.status.textContent = msg || "";
    el.status.className = "ldr-status" + (kind ? " " + kind : "");
  }
  let toastTimer = null;
  function toast(msg, kind) {
    el.toast.textContent = msg;
    el.toast.className = "ldr-toast" + (kind ? " " + kind : "");
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, kind === "error" ? 8000 : 4000);
  }
  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const now = new Date();
    const opts = d.getFullYear() === now.getFullYear()
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" };
    return d.toLocaleDateString(undefined, opts);
  }
  function fmtSize(n) {
    if (n == null) return "";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
    if (n < 1024 * 1024 * 1024) return (n / 1048576).toFixed(1) + " MB";
    return (n / 1073741824).toFixed(2) + " GB";
  }
  function kindOf(item) {
    if (item.folder) return { label: "Folder", cls: "folder" };
    if (item.package && item.package.type === "oneNote") return { label: "OneNote", cls: "one" };
    const ext = (item.name || "").split(".").pop().toLowerCase();
    if (["doc", "docx", "dot", "dotx"].includes(ext)) return { label: "Word", cls: "doc" };
    if (["xls", "xlsx", "xlsm", "csv"].includes(ext)) return { label: "Excel", cls: "xls" };
    if (["ppt", "pptx"].includes(ext)) return { label: "PowerPoint", cls: "ppt" };
    if (ext === "pdf") return { label: "PDF", cls: "pdf" };
    if (["jpg", "jpeg", "png", "gif", "heic", "webp"].includes(ext)) return { label: "Image", cls: "img" };
    if (ext === "url") return { label: "Link", cls: "lnk" };
    return { label: ext ? ext.toUpperCase() : "File", cls: "file" };
  }
  function isSystemLibrary(name) {
    return /^(Site Assets|Style Library|Form Templates|Site Pages|Teams Wiki Data)$/i.test(name);
  }
  function friendlyOpError(e, verb) {
    if (e.status === 403) return "You don't have permission to " + verb + " here. Ask the SharePoint admin for edit access to this library.";
    if (e.status === 409 || /nameAlreadyExists/i.test(e.code || "")) return "Something with that name already exists here.";
    if (e.status === 423 || /locked/i.test(e.message)) return "That file is locked — someone may have it open for editing.";
    if (/invalidRequest|invalid.*name/i.test((e.code || "") + e.message)) return "That name isn't allowed. Avoid characters like \" * : < > ? / \\ |.";
    return "Couldn't " + verb + ": " + e.message;
  }
  function currentFolderRef() {
    // Graph path prefix for the folder the user is looking at
    return state.path.length
      ? "/drives/" + state.drive.id + "/items/" + state.path[state.path.length - 1].id
      : "/drives/" + state.drive.id + "/root";
  }

  // ---------- Dialog ----------
  // showDialog({ title, body (Node), okLabel, danger, validate }) -> Promise<true|false>
  let dialogResolve = null;
  function showDialog(opts) {
    el.dialogTitle.textContent = opts.title;
    el.dialogBody.innerHTML = "";
    el.dialogBody.appendChild(opts.body);
    el.dialogOk.textContent = opts.okLabel || "OK";
    el.dialogOk.className = "btn btn-sm " + (opts.danger ? "btn-red" : "btn-blue");
    el.dialogOk.disabled = !!opts.startDisabled;
    el.dialog.classList.add("open");
    const focusable = el.dialogBody.querySelector("input, button");
    if (focusable) setTimeout(() => { focusable.focus(); if (focusable.select) focusable.select(); }, 0);
    return new Promise((resolve) => { dialogResolve = resolve; });
  }
  function closeDialog(result) {
    el.dialog.classList.remove("open");
    if (dialogResolve) { dialogResolve(result); dialogResolve = null; }
  }
  el.dialogOk.addEventListener("click", () => closeDialog(true));
  el.dialogCancel.addEventListener("click", () => closeDialog(false));
  el.dialog.addEventListener("click", (ev) => { if (ev.target === el.dialog) closeDialog(false); });
  document.addEventListener("keydown", (ev) => {
    if (!el.dialog.classList.contains("open")) return;
    if (ev.key === "Escape") closeDialog(false);
    if (ev.key === "Enter" && ev.target.tagName === "INPUT" && !el.dialogOk.disabled) { ev.preventDefault(); closeDialog(true); }
  });

  function textPrompt({ title, label, value, okLabel }) {
    const wrap = document.createElement("div");
    const lbl = document.createElement("label");
    lbl.textContent = label;
    lbl.className = "ldr-dialog-label";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "ldr-dialog-input";
    input.value = value || "";
    input.maxLength = 255;
    wrap.appendChild(lbl);
    wrap.appendChild(input);
    const check = () => { el.dialogOk.disabled = !input.value.trim() || /[\\/:*?"<>|#%]/.test(input.value); };
    input.addEventListener("input", check);
    return showDialog({ title, body: wrap, okLabel, startDisabled: !(value || "").trim() }).then((ok) => (ok ? input.value.trim() : null));
  }

  // ---------- Graph ----------
  async function getToken() {
    const account = msalApp.getActiveAccount();
    try {
      const r = await msalApp.acquireTokenSilent({ scopes: SCOPES, account });
      return r.accessToken;
    } catch (e) {
      if (e instanceof msal.InteractionRequiredAuthError) {
        await msalApp.acquireTokenRedirect({ scopes: SCOPES, account });
        return null; // page will redirect
      }
      throw e;
    }
  }

  // graph(path, { method, body, headers, raw }) — JSON in/out by default
  async function graph(path, opts = {}) {
    const token = await getToken();
    if (!token) return new Promise(() => {}); // redirecting; never resolves
    const url = path.startsWith("https://") ? path : GRAPH + path;
    const headers = Object.assign({ Authorization: "Bearer " + token }, opts.headers || {});
    let body = opts.body;
    if (body !== undefined && !opts.raw) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(body);
    }
    const res = await fetch(url, { method: opts.method || "GET", headers, body });
    if (!res.ok) {
      let msg = "Request failed (" + res.status + ")";
      let code = "";
      try {
        const err = await res.json();
        if (err.error) { msg = err.error.message || msg; code = err.error.code || ""; }
      } catch (_) {}
      const e = new Error(msg);
      e.status = res.status;
      e.code = code;
      throw e;
    }
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  // Follows @odata.nextLink so long libraries list completely.
  async function graphAll(path) {
    let out = [];
    let next = path;
    while (next) {
      const page = await graph(next);
      out = out.concat(page.value || []);
      next = page["@odata.nextLink"] || null;
    }
    return out;
  }

  async function resolveSiteId() {
    const key = "ny2911-site-id:" + cfg.siteUrl;
    const cached = sessionStorage.getItem(key);
    if (cached) return cached;
    const u = new URL(cfg.siteUrl);
    const sitePath = u.pathname.replace(/\/+$/, "");
    const lookup = sitePath ? "/sites/" + u.hostname + ":" + sitePath : "/sites/" + u.hostname;
    const site = await graph(lookup + "?$select=id,displayName,webUrl");
    sessionStorage.setItem(key, site.id);
    return site.id;
  }

  async function loadDrives() {
    let drives = await graphAll("/sites/" + state.siteId + "/drives?$select=id,name,webUrl,driveType");
    drives = drives.filter((d) => d.driveType === "documentLibrary");
    const wanted = Array.isArray(cfg.libraries) ? cfg.libraries.filter(Boolean) : [];
    if (wanted.length) {
      const byName = new Map(drives.map((d) => [d.name.toLowerCase(), d]));
      drives = wanted.map((n) => byName.get(String(n).toLowerCase())).filter(Boolean);
    } else {
      drives = drives.filter((d) => !isSystemLibrary(d.name));
      drives.sort((a, b) => a.name.localeCompare(b.name));
    }
    return drives;
  }

  async function rootId(driveId) {
    if (!state.rootIds[driveId]) {
      const r = await graph("/drives/" + driveId + "/root?$select=id");
      state.rootIds[driveId] = r.id;
    }
    return state.rootIds[driveId];
  }

  const ITEM_FIELDS = "$select=id,name,size,lastModifiedDateTime,lastModifiedBy,webUrl,folder,file,package,parentReference";

  async function listFolder() {
    return graphAll(currentFolderRef() + "/children?" + ITEM_FIELDS + "&$orderby=name%20asc&$top=200");
  }

  async function listSubfolders(driveId, itemId) {
    const base = itemId ? "/drives/" + driveId + "/items/" + itemId : "/drives/" + driveId + "/root";
    const items = await graphAll(base + "/children?$select=id,name,folder&$orderby=name%20asc&$top=200");
    return items.filter((i) => i.folder);
  }

  async function searchLibrary(q) {
    const safe = q.replace(/'/g, "''");
    return graphAll("/drives/" + state.drive.id + "/root/search(q='" + encodeURIComponent(safe) + "')?" + ITEM_FIELDS + "&$top=100");
  }

  // ---------- File operations ----------
  async function createFolder() {
    const name = await textPrompt({ title: "New folder", label: "Folder name", okLabel: "Create" });
    if (!name) return;
    try {
      await graph(currentFolderRef() + "/children", {
        method: "POST",
        body: { name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" },
      });
      toast("Folder “" + name + "” created.");
      refresh();
    } catch (e) {
      toast(friendlyOpError(e, "create the folder"), "error");
    }
  }

  async function renameItem(item) {
    const name = await textPrompt({ title: "Rename", label: "New name", value: item.name, okLabel: "Rename" });
    if (!name || name === item.name) return;
    try {
      await graph("/drives/" + state.drive.id + "/items/" + item.id, { method: "PATCH", body: { name } });
      toast("Renamed to “" + name + "”.");
      refresh();
    } catch (e) {
      toast(friendlyOpError(e, "rename"), "error");
    }
  }

  async function deleteItem(item) {
    const body = document.createElement("div");
    const p = document.createElement("p");
    p.appendChild(document.createTextNode("Delete "));
    const b = document.createElement("strong");
    b.textContent = item.name;
    p.appendChild(b);
    p.appendChild(document.createTextNode(item.folder ? " and everything in it?" : "?"));
    const note = document.createElement("p");
    note.className = "ldr-dialog-note";
    note.textContent = "It goes to the SharePoint site's recycle bin, where an admin can restore it for 93 days.";
    body.appendChild(p);
    body.appendChild(note);
    const ok = await showDialog({ title: "Delete", body, okLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      await graph("/drives/" + state.drive.id + "/items/" + item.id, { method: "DELETE" });
      toast("Deleted “" + item.name + "”.");
      refresh();
    } catch (e) {
      toast(friendlyOpError(e, "delete"), "error");
    }
  }

  async function downloadItem(item) {
    try {
      const r = await graph("/drives/" + state.drive.id + "/items/" + item.id + "?$select=id,name,@microsoft.graph.downloadUrl");
      const url = r["@microsoft.graph.downloadUrl"];
      if (!url) throw new Error("No download link was returned.");
      const a = document.createElement("a");
      a.href = url;
      a.download = item.name;
      a.target = "_blank";   // downloadUrl serves as an attachment; a new tab keeps this page put
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      toast(friendlyOpError(e, "download"), "error");
    }
  }

  // Folder picker for "Move to…" — browses folders within the current library.
  async function moveItem(item) {
    const driveId = state.drive.id;
    let pickerPath = [];            // [{id,name}] below root
    const body = document.createElement("div");
    const crumbs = document.createElement("div");
    crumbs.className = "ldr-picker-crumbs";
    const list = document.createElement("div");
    list.className = "ldr-picker-list";
    body.appendChild(crumbs);
    body.appendChild(list);

    async function render() {
      crumbs.innerHTML = "";
      const parts = [{ id: null, name: state.drive.name }].concat(pickerPath);
      parts.forEach((p, i) => {
        if (i > 0) crumbs.appendChild(document.createTextNode(" › "));
        if (i === parts.length - 1) {
          const s = document.createElement("strong"); s.textContent = p.name; crumbs.appendChild(s);
        } else {
          const a = document.createElement("a"); a.href = "#"; a.textContent = p.name;
          a.addEventListener("click", (ev) => { ev.preventDefault(); pickerPath = pickerPath.slice(0, i); render(); });
          crumbs.appendChild(a);
        }
      });
      list.innerHTML = "<div class='ldr-picker-empty'>Loading…</div>";
      const cur = pickerPath.length ? pickerPath[pickerPath.length - 1].id : null;
      try {
        const folders = (await listSubfolders(driveId, cur)).filter((f) => f.id !== item.id);
        list.innerHTML = "";
        if (!folders.length) {
          const e = document.createElement("div"); e.className = "ldr-picker-empty"; e.textContent = "No subfolders here."; list.appendChild(e);
        }
        folders.forEach((f) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "ldr-picker-item";
          b.textContent = "▸ " + f.name;
          b.addEventListener("click", () => { pickerPath.push({ id: f.id, name: f.name }); render(); });
          list.appendChild(b);
        });
      } catch (e) {
        list.innerHTML = "";
        const er = document.createElement("div"); er.className = "ldr-picker-empty"; er.textContent = "Couldn't load folders: " + e.message; list.appendChild(er);
      }
      // Can't move into the folder it's already in
      const currentParent = state.path.length ? state.path[state.path.length - 1].id : null;
      el.dialogOk.disabled = cur === currentParent && !state.query;
      el.dialogOk.textContent = "Move here";
    }
    const ok = showDialog({ title: "Move “" + item.name + "” to…", body, okLabel: "Move here", startDisabled: true });
    render();
    if (!(await ok)) return;
    try {
      const targetId = pickerPath.length ? pickerPath[pickerPath.length - 1].id : await rootId(driveId);
      await graph("/drives/" + driveId + "/items/" + item.id, { method: "PATCH", body: { parentReference: { id: targetId } } });
      toast("Moved “" + item.name + "” to " + (pickerPath.length ? pickerPath[pickerPath.length - 1].name : state.drive.name) + ".");
      refresh();
    } catch (e) {
      toast(friendlyOpError(e, "move"), "error");
    }
  }

  // ---------- Uploads ----------
  const uploadJobs = [];
  function renderUploads() {
    el.uploads.innerHTML = "";
    const active = uploadJobs.filter((j) => !j.dismissed);
    el.uploads.hidden = !active.length;
    active.forEach((j) => {
      const row = document.createElement("div");
      row.className = "ldr-upload " + j.state;
      const name = document.createElement("span");
      name.className = "ldr-upload-name";
      name.textContent = j.file.name;
      const bar = document.createElement("span");
      bar.className = "ldr-upload-bar";
      const fill = document.createElement("span");
      fill.style.width = Math.round(j.progress * 100) + "%";
      bar.appendChild(fill);
      const txt = document.createElement("span");
      txt.className = "ldr-upload-txt";
      txt.textContent = j.state === "done" ? "Done" : j.state === "error" ? j.error : Math.round(j.progress * 100) + "%";
      row.appendChild(name);
      row.appendChild(bar);
      row.appendChild(txt);
      el.uploads.appendChild(row);
    });
  }

  async function uploadFile(file, folderRef, driveId) {
    const job = { file, progress: 0, state: "uploading", error: "", dismissed: false };
    uploadJobs.push(job);
    renderUploads();
    const encName = encodeURIComponent(file.name);
    try {
      if (file.size <= SIMPLE_UPLOAD_LIMIT) {
        await graph(folderRef + ":/" + encName + ":/content?@microsoft.graph.conflictBehavior=replace", {
          method: "PUT", body: file, raw: true, headers: { "Content-Type": file.type || "application/octet-stream" },
        });
        job.progress = 1;
      } else {
        const session = await graph(folderRef + ":/" + encName + ":/createUploadSession", {
          method: "POST",
          body: { item: { "@microsoft.graph.conflictBehavior": "replace", name: file.name } },
        });
        let offset = 0;
        while (offset < file.size) {
          const end = Math.min(offset + CHUNK_SIZE, file.size);
          const chunk = file.slice(offset, end);
          const res = await fetch(session.uploadUrl, {
            method: "PUT",
            headers: {
              "Content-Range": "bytes " + offset + "-" + (end - 1) + "/" + file.size,
            },
            body: chunk,
          });
          if (!res.ok) {
            let msg = "Upload failed (" + res.status + ")";
            try { const err = await res.json(); if (err.error && err.error.message) msg = err.error.message; } catch (_) {}
            const e = new Error(msg); e.status = res.status; throw e;
          }
          offset = end;
          job.progress = offset / file.size;
          renderUploads();
        }
      }
      job.state = "done";
      renderUploads();
      setTimeout(() => { job.dismissed = true; renderUploads(); }, 4000);
      return true;
    } catch (e) {
      job.state = "error";
      job.error = friendlyOpError(e, "upload");
      renderUploads();
      setTimeout(() => { job.dismissed = true; renderUploads(); }, 12000);
      return false;
    }
  }

  async function uploadFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => f && f.size !== undefined);
    if (!files.length || !state.drive) return;
    if (state.query) { toast("Clear the search first so the upload has a folder to go into.", "error"); return; }
    const folderRef = currentFolderRef();
    const driveId = state.drive.id;
    let okCount = 0;
    // Sequential keeps the UI honest and avoids hammering Graph from a phone.
    for (const f of files) { if (await uploadFile(f, folderRef, driveId)) okCount++; }
    if (okCount) toast(okCount === 1 ? "Uploaded " + files[0].name + "." : "Uploaded " + okCount + " of " + files.length + " files.");
    // Only refresh if the user is still looking at the folder we uploaded into.
    if (currentFolderRef() === folderRef) refresh();
  }

  el.uploadBtn.addEventListener("click", () => el.fileInput.click());
  el.fileInput.addEventListener("change", () => { uploadFiles(el.fileInput.files); el.fileInput.value = ""; });
  el.newFolderBtn.addEventListener("click", createFolder);

  let dragDepth = 0;
  el.dropzone.addEventListener("dragenter", (ev) => {
    if (!ev.dataTransfer || !Array.from(ev.dataTransfer.types).includes("Files")) return;
    ev.preventDefault();
    dragDepth++;
    el.dropzone.classList.add("dragging");
  });
  el.dropzone.addEventListener("dragover", (ev) => { if (el.dropzone.classList.contains("dragging")) ev.preventDefault(); });
  el.dropzone.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; el.dropzone.classList.remove("dragging"); } });
  el.dropzone.addEventListener("drop", (ev) => {
    ev.preventDefault();
    dragDepth = 0;
    el.dropzone.classList.remove("dragging");
    if (ev.dataTransfer && ev.dataTransfer.files.length) uploadFiles(ev.dataTransfer.files);
  });

  // ---------- Row action menu ----------
  let openMenu = null;
  function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; } }
  document.addEventListener("click", (ev) => { if (openMenu && !openMenu.contains(ev.target) && !ev.target.classList.contains("ldr-more")) closeMenu(); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeMenu(); });

  function buildMenu(item, anchor) {
    closeMenu();
    const menu = document.createElement("div");
    menu.className = "ldr-menu";
    menu.setAttribute("role", "menu");
    const add = (label, fn, danger) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ldr-menu-item" + (danger ? " danger" : "");
      b.textContent = label;
      b.setAttribute("role", "menuitem");
      b.addEventListener("click", () => { closeMenu(); fn(); });
      menu.appendChild(b);
    };
    if (item.folder) add("Open", () => openFolder(item));
    else {
      add("Open in SharePoint", () => window.open(item.webUrl, "_blank", "noopener"));
      add("Download", () => downloadItem(item));
    }
    add("Rename", () => renameItem(item));
    add("Move to…", () => moveItem(item));
    add("Delete", () => deleteItem(item), true);
    anchor.parentElement.appendChild(menu);
    openMenu = menu;
  }

  // ---------- Rendering ----------
  function renderTabs() {
    el.tabs.innerHTML = "";
    state.drives.forEach((d) => {
      const b = document.createElement("button");
      b.type = "button";
      b.role = "tab";
      b.className = "ldr-tab" + (state.drive && d.id === state.drive.id ? " active" : "");
      b.textContent = d.name;
      b.addEventListener("click", () => selectDrive(d));
      el.tabs.appendChild(b);
    });
  }

  function renderCrumbs() {
    el.crumbs.innerHTML = "";
    if (!state.drive) return;
    const parts = [{ id: null, name: state.drive.name }].concat(state.path);
    parts.forEach((p, i) => {
      if (i > 0) {
        const sep = document.createElement("span");
        sep.className = "sep";
        sep.textContent = "›";
        el.crumbs.appendChild(sep);
      }
      if (i === parts.length - 1 && !state.query) {
        const cur = document.createElement("span");
        cur.className = "current";
        cur.textContent = p.name;
        el.crumbs.appendChild(cur);
      } else {
        const a = document.createElement("a");
        a.href = "#";
        a.textContent = p.name;
        a.addEventListener("click", (ev) => { ev.preventDefault(); goTo(i); });
        el.crumbs.appendChild(a);
      }
    });
    if (state.query) {
      const sep = document.createElement("span");
      sep.className = "sep";
      sep.textContent = "›";
      el.crumbs.appendChild(sep);
      const cur = document.createElement("span");
      cur.className = "current";
      cur.textContent = "Search: “" + state.query + "”";
      el.crumbs.appendChild(cur);
    }
    // Upload / new folder only make sense inside a folder, not in search results
    el.folderActions.hidden = !!state.query;
  }

  function renderItems(items, { showLocation } = {}) {
    el.rows.innerHTML = "";
    closeMenu();
    if (!items.length) {
      el.table.hidden = true;
      setStatus(state.query ? "No files match that search." : "This folder is empty — drop files here or use Upload.");
      return;
    }
    setStatus("");
    el.table.hidden = false;
    // folders first
    items.sort((a, b) => (!!b.folder - !!a.folder) || a.name.localeCompare(b.name));
    items.forEach((item) => {
      const kind = kindOf(item);
      const tr = document.createElement("tr");

      const tdName = document.createElement("td");
      const link = document.createElement("a");
      link.className = "ldr-name";
      const icon = document.createElement("span");
      icon.className = "ldr-ico " + kind.cls;
      icon.title = kind.label;
      icon.textContent = kind.cls === "folder" ? "▸" : kind.label.charAt(0);
      link.appendChild(icon);
      link.appendChild(document.createTextNode(item.name));
      if (item.folder) {
        link.href = "#";
        link.addEventListener("click", (ev) => { ev.preventDefault(); openFolder(item); });
        const count = document.createElement("span");
        count.className = "ldr-count";
        count.textContent = item.folder.childCount != null ? item.folder.childCount + " item" + (item.folder.childCount === 1 ? "" : "s") : "";
        link.appendChild(count);
      } else {
        link.href = item.webUrl;
        link.target = "_blank";
        link.rel = "noopener";
      }
      tdName.appendChild(link);
      if (showLocation && item.parentReference && item.parentReference.path) {
        const loc = document.createElement("div");
        loc.className = "ldr-loc";
        // parentReference.path looks like "/drive/root:/Folder/Sub"
        const p = item.parentReference.path.split("root:")[1] || "/";
        loc.textContent = "in " + state.drive.name + (p === "/" || p === "" ? "" : decodeURIComponent(p));
        tdName.appendChild(loc);
      }
      tr.appendChild(tdName);

      const tdMod = document.createElement("td");
      tdMod.className = "ldr-col-mod";
      tdMod.textContent = fmtDate(item.lastModifiedDateTime);
      tdMod.title = item.lastModifiedDateTime ? new Date(item.lastModifiedDateTime).toLocaleString() : "";
      tr.appendChild(tdMod);

      const tdBy = document.createElement("td");
      tdBy.className = "ldr-col-by";
      tdBy.textContent = (item.lastModifiedBy && item.lastModifiedBy.user && item.lastModifiedBy.user.displayName) || "";
      tr.appendChild(tdBy);

      const tdSize = document.createElement("td");
      tdSize.className = "ldr-col-size";
      tdSize.textContent = item.folder ? "" : fmtSize(item.size);
      tr.appendChild(tdSize);

      const tdAct = document.createElement("td");
      tdAct.className = "ldr-col-act";
      const more = document.createElement("button");
      more.type = "button";
      more.className = "ldr-more";
      more.title = "More actions";
      more.setAttribute("aria-label", "Actions for " + item.name);
      more.textContent = "⋯";
      more.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (openMenu && openMenu.parentElement === tdAct) closeMenu(); else buildMenu(item, more);
      });
      tdAct.appendChild(more);
      tr.appendChild(tdAct);

      el.rows.appendChild(tr);
    });
  }

  // ---------- Navigation ----------
  let loadSeq = 0;
  async function refresh() {
    const seq = ++loadSeq;
    renderTabs();
    renderCrumbs();
    el.table.hidden = true;
    setStatus("Loading…", "loading");
    try {
      const items = state.query ? await searchLibrary(state.query) : await listFolder();
      if (seq !== loadSeq) return; // a newer navigation superseded this one
      renderItems(items, { showLocation: !!state.query });
    } catch (e) {
      if (seq !== loadSeq) return;
      setStatus("Couldn't load files: " + e.message, "error");
    }
  }

  function selectDrive(d) {
    state.drive = d;
    state.path = [];
    state.query = "";
    el.search.value = "";
    el.openSp.href = d.webUrl;
    try { history.replaceState(null, "", "#" + encodeURIComponent(d.name)); } catch (_) {}
    refresh();
  }
  function openFolder(item) {
    state.path.push({ id: item.id, name: item.name });
    state.query = "";
    el.search.value = "";
    refresh();
  }
  function goTo(depth) {
    state.path = state.path.slice(0, depth);
    state.query = "";
    el.search.value = "";
    refresh();
  }

  let searchTimer = null;
  el.search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const q = el.search.value.trim();
      if (q === state.query) return;
      state.query = q;
      refresh();
    }, 350);
  });
  el.search.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") { el.search.value = ""; state.query = ""; refresh(); }
  });

  // ---------- Sign in / out ----------
  el.signin.addEventListener("click", () => {
    showGateError("");
    msalApp.loginRedirect({ scopes: SCOPES }).catch((e) => showGateError(friendlyAuthError(e)));
  });
  el.signout.addEventListener("click", () => {
    const account = msalApp.getActiveAccount();
    msalApp.logoutRedirect({ account });
  });

  function friendlyAuthError(e) {
    const msg = (e && (e.errorMessage || e.message)) || String(e);
    if (/AADSTS65001|consent/i.test(msg)) return "This app hasn't been approved for your account yet. Ask the SharePoint admin to grant consent for the leaders app.";
    if (/AADSTS50020|AADSTS90072|user account .* does not exist/i.test(msg)) return "That Microsoft account isn't a member of the troop's organization. Sign in with your leader account, or ask the SharePoint admin to invite you.";
    if (/AADSTS50011|redirect/i.test(msg)) return "The sign-in redirect address isn't registered for this site (" + pageUrl + "). The SharePoint admin needs to add it to the app registration.";
    if (/user_cancelled|interaction_in_progress/i.test(msg)) return "";
    return "Sign-in problem: " + msg;
  }

  async function showApp(account) {
    el.gate.hidden = true;
    el.app.hidden = false;
    el.account.hidden = false;
    el.user.textContent = account.name || account.username;
    setStatus("Connecting to SharePoint…", "loading");
    try {
      state.siteId = await resolveSiteId();
      state.drives = await loadDrives();
      if (!state.drives.length) {
        setStatus("No document libraries were found on the SharePoint site (or you don't have access to any).", "error");
        return;
      }
      let initial = state.drives[0];
      const hash = decodeURIComponent((location.hash || "").slice(1)).toLowerCase();
      if (hash) initial = state.drives.find((d) => d.name.toLowerCase() === hash) || initial;
      selectDrive(initial);
    } catch (e) {
      if (e.status === 403) {
        setStatus("Signed in, but your account doesn't have access to the troop SharePoint site yet. Ask the SharePoint admin to add you.", "error");
      } else if (e.status === 404) {
        setStatus("The SharePoint site in config.js couldn't be found (" + cfg.siteUrl + "). Check the siteUrl setting.", "error");
      } else {
        setStatus("Couldn't connect to SharePoint: " + e.message, "error");
      }
    }
  }

  // ---------- Boot ----------
  (async function boot() {
    try {
      await msalApp.initialize();
      const result = await msalApp.handleRedirectPromise();
      let account = (result && result.account) || msalApp.getActiveAccount();
      if (!account) {
        const all = msalApp.getAllAccounts();
        if (all.length) account = all[0];
      }
      if (account) {
        msalApp.setActiveAccount(account);
        await showApp(account);
      } else {
        el.gate.hidden = false;
      }
    } catch (e) {
      el.gate.hidden = false;
      el.app.hidden = true;
      showGateError(friendlyAuthError(e));
    }
  })();
})();
