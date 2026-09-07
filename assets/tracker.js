// ============================================================
//  AHG Troop NY2911 — Badge tracker runtime (leaders area)
//  Shared by leaders-badges / -planning / -progress / -admin:
//  Microsoft sign-in (same account as the Documents page) and a
//  fetch wrapper for the badge tracker API on the Pi.
//  Configuration: assets/config.js → tracker: { baseUrl, scope }
//  No troop data lives in this repo — everything renders from
//  the authenticated API at runtime.
// ============================================================
(function () {
  "use strict";

  const cfg = (window.TROOP_CONFIG && window.TROOP_CONFIG.leaders) || {};
  const trk = (window.TROOP_CONFIG && window.TROOP_CONFIG.tracker) || {};
  const $ = (id) => document.getElementById(id);
  const isPlaceholder = (v) => !v || String(v).startsWith("REPLACE");
  // Dev mode: a tracker running locally with AUTH_DISABLED=true. Never a
  // deployed configuration — the tracker refuses that flag in production.
  const DEV = trk.authMode === "disabled";

  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  function toast(msg, isError) {
    let t = $("trk-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "trk-toast";
      t.className = "ldr-toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.background = isError ? "var(--ahg-red)" : "";
    t.hidden = false;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { t.hidden = true; }, isError ? 6000 : 3000);
  }

  const fmtDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
    return isNaN(d) ? iso : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };
  const fmtTime = (iso) => {
    const d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  };

  // ---------- MSAL (shared cache with the Documents page → silent SSO) ----
  let msalApp = null;
  let account = null;
  const pageUrl = window.location.origin + window.location.pathname;

  async function getToken() {
    if (DEV) return null;
    try {
      const r = await msalApp.acquireTokenSilent({ scopes: [trk.scope], account });
      return r.accessToken;
    } catch (e) {
      if (e instanceof msal.InteractionRequiredAuthError) {
        await msalApp.acquireTokenRedirect({ scopes: [trk.scope], account });
        return new Promise(() => {}); // navigating away
      }
      throw e;
    }
  }

  // ---------- API ----------
  async function api(path, opts) {
    const o = opts || {};
    const headers = { ...(o.body !== undefined ? { "Content-Type": "application/json" } : {}) };
    const token = await getToken();
    if (token) headers.Authorization = "Bearer " + token;
    let res;
    try {
      res = await fetch(trk.baseUrl.replace(/\/$/, "") + "/api/v1" + path, {
        method: o.method || (o.body !== undefined ? "POST" : "GET"),
        headers,
        body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
      });
    } catch (e) {
      throw new Error("The badge tracker isn't reachable (" + e.message + ").");
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON error body */ }
    if (!res.ok) {
      const msg = (data && (data.detail || data.error)) || ("HTTP " + res.status);
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // ---------- Boot: gate → sign-in → run the page ----------
  // Every tracker page carries: #trk-unconfigured, #trk-gate, #trk-signin,
  // #trk-error, #trk-app, #trk-account, #trk-user, #trk-signout.
  function showGateError(msg) {
    const e = $("trk-error");
    if (e) e.textContent = msg;
  }

  async function init(runPage) {
    if (isPlaceholder(trk.baseUrl) || (!DEV && isPlaceholder(trk.scope))) {
      $("trk-unconfigured").hidden = false;
      return;
    }
    if (DEV) {
      const note = document.createElement("div");
      note.className = "placeholder-note";
      note.textContent = "Development mode — talking to " + trk.baseUrl + " without sign-in. Never deploy this configuration.";
      document.querySelector("main").prepend(note);
      $("trk-app").hidden = false;
      runPage().catch((e) => toast(e.message, true));
      return;
    }
    if (isPlaceholder(cfg.clientId) || isPlaceholder(cfg.tenantId)) {
      $("trk-unconfigured").hidden = false;
      return;
    }
    if (!window.msal) {
      $("trk-gate").hidden = false;
      showGateError("The Microsoft sign-in library failed to load. Check your connection and reload.");
      return;
    }
    msalApp = new msal.PublicClientApplication({
      auth: {
        clientId: cfg.clientId,
        authority: "https://login.microsoftonline.com/" + cfg.tenantId,
        redirectUri: pageUrl,
        postLogoutRedirectUri: pageUrl,
      },
      cache: { cacheLocation: "localStorage" },
    });
    await msalApp.initialize();
    $("trk-signin").addEventListener("click", () => {
      msalApp.loginRedirect({ scopes: [trk.scope] }).catch((e) => showGateError(e.message));
    });
    $("trk-signout").addEventListener("click", () => {
      msalApp.logoutRedirect({ account }).catch(() => {});
    });
    try {
      const result = await msalApp.handleRedirectPromise();
      account = (result && result.account) || msalApp.getAllAccounts()[0] || null;
    } catch (e) {
      $("trk-gate").hidden = false;
      showGateError(e.message);
      return;
    }
    if (!account) {
      $("trk-gate").hidden = false;
      return;
    }
    $("trk-account").hidden = false;
    $("trk-user").textContent = account.username;
    $("trk-app").hidden = false;
    try {
      await runPage();
    } catch (e) {
      if (e.status === 403) {
        $("trk-app").hidden = true;
        $("trk-gate").hidden = false;
        showGateError("You're signed in, but this account isn't on the leader list for the badge tracker.");
      } else {
        toast(e.message, true);
      }
    }
  }

  window.Tracker = { init, api, esc, toast, fmtDate, fmtTime, $ };
})();
