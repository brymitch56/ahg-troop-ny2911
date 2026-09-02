// ============================================================
//  AHG Troop NY2911 — Leaders area
//  Signs leaders in with their Microsoft account (MSAL) and
//  browses the troop SharePoint site through Microsoft Graph.
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
    status: $("ldr-status"),
    table: $("ldr-files"),
    rows: $("ldr-rows"),
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
  const SCOPES = ["User.Read", "Sites.Read.All"];
  const GRAPH = "https://graph.microsoft.com/v1.0";
  const pageUrl = window.location.origin + window.location.pathname;

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
  };

  // ---------- Helpers ----------
  function showGateError(msg) {
    el.error.textContent = msg;
    el.error.style.display = msg ? "block" : "none";
  }
  function setStatus(msg, kind) {
    el.status.hidden = !msg;
    el.status.textContent = msg || "";
    el.status.className = "ldr-status" + (kind ? " " + kind : "");
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

  async function graph(path) {
    const token = await getToken();
    if (!token) return new Promise(() => {}); // redirecting; never resolves
    const url = path.startsWith("https://") ? path : GRAPH + path;
    const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if (!res.ok) {
      let msg = "Request failed (" + res.status + ")";
      try { const body = await res.json(); if (body.error && body.error.message) msg = body.error.message; } catch (_) {}
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return res.json();
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
    const lookup = sitePath && sitePath !== ""
      ? "/sites/" + u.hostname + ":" + sitePath
      : "/sites/" + u.hostname;
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

  const ITEM_FIELDS = "$select=id,name,size,lastModifiedDateTime,lastModifiedBy,webUrl,folder,file,package,parentReference";

  async function listFolder() {
    const base = "/drives/" + state.drive.id;
    const folder = state.path.length ? "/items/" + state.path[state.path.length - 1].id : "/root";
    return graphAll(base + folder + "/children?" + ITEM_FIELDS + "&$orderby=name%20asc&$top=200");
  }

  async function searchLibrary(q) {
    const safe = q.replace(/'/g, "''");
    return graphAll("/drives/" + state.drive.id + "/root/search(q='" + encodeURIComponent(safe) + "')?" + ITEM_FIELDS + "&$top=100");
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
  }

  function renderItems(items, { showLocation } = {}) {
    el.rows.innerHTML = "";
    if (!items.length) {
      el.table.hidden = true;
      setStatus(state.query ? "No files match that search." : "This folder is empty.");
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
