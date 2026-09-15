// ============================================================
//  Badge catalog browser (leaders area). Everything — names,
//  requirement text, faith connection — comes from the
//  authenticated tracker API at runtime; nothing is in this repo.
// ============================================================
(function () {
  "use strict";
  const { init, api, esc, $, matches, getPref, setPref, searchBox, sortSelect, byText } = window.Tracker;
  const root = () => $("pg-badges");

  let badges = [];
  let filter = "";
  let frontierFilter = "";
  let query = ""; // kept while the page is open (back from a badge keeps it)

  // "level" is the catalog's own order (level group, then name); the sort
  // choice is remembered in this browser
  const SORTS = [["level", "Level, then badge name"], ["name", "Badge name, then level"]];
  let sort = getPref("badges-sort", "level");
  if (!SORTS.some(([k]) => k === sort)) sort = "level";
  const SORTERS = {
    level: (a, b) => byText(a.levelGroup, b.levelGroup) || byText(a.name, b.name),
    name: (a, b) => byText(a.name, b.name) || byText(a.levelGroup, b.levelGroup),
  };

  function listView() {
    const groups = [...new Set(badges.map((b) => b.levelGroup))].sort();
    const frontiers = [...new Set(badges.map((b) => b.frontier).filter(Boolean))].sort();
    root().innerHTML = `
      <div class="trk-chips">
        <button class="trk-chip ${!filter ? "active" : ""}" data-lg="">All levels</button>
        ${groups.map((g) => `<button class="trk-chip ${filter === g ? "active" : ""}" data-lg="${esc(g)}">${esc(g)}</button>`).join("")}
      </div>
      ${frontiers.length ? `<div class="trk-chips">
        <button class="trk-chip ${!frontierFilter ? "active" : ""}" data-fr="">All frontiers</button>
        ${frontiers.map((f) => `<button class="trk-chip ${frontierFilter === f ? "active" : ""}" data-fr="${esc(f)}">${esc(f)}</button>`).join("")}
      </div>` : ""}
      ${badges.length ? `<div class="trk-row-tools">
        ${searchBox("trk-badge-q", query, "Search badges — name, level, frontier…")}
        ${sortSelect("trk-badge-sort", SORTS, sort)}
        <span class="trk-muted" id="trk-badge-count"></span>
      </div>` : ""}
      <div id="trk-badge-results"></div>
    `;
    root().querySelectorAll(".trk-chip").forEach((c) => c.addEventListener("click", () => {
      if (c.dataset.fr !== undefined) frontierFilter = c.dataset.fr; else filter = c.dataset.lg;
      listView();
    }));
    if (badges.length) {
      $("trk-badge-q").addEventListener("input", (e) => { query = e.target.value; renderResults(); });
      $("trk-badge-sort").addEventListener("change", (e) => { sort = e.target.value; setPref("badges-sort", sort); renderResults(); });
    }
    renderResults();
  }

  function renderResults() {
    const host = $("trk-badge-results");
    if (!badges.length) {
      host.innerHTML = `<p class="trk-muted">No badges in the catalog yet. Only annotated badges appear here — the pilot set to start.</p>`;
      return;
    }
    const inFilters = badges.filter((b) => (!filter || b.levelGroup === filter) && (!frontierFilter || b.frontier === frontierFilter));
    const shown = inFilters.filter((b) => matches(query, b.name, b.levelGroup, b.frontier || "")).sort(SORTERS[sort]);
    const q = query.trim();
    $("trk-badge-count").textContent = q ? `${shown.length} of ${inFilters.length}` : "";
    host.innerHTML = shown.length ? `<div class="trk-cards">
        ${shown.map((b) => `
          <button class="trk-card" data-id="${esc(b.id)}">
            <h3>${esc(b.name)}</h3>
            <div class="trk-meta">${esc(b.levelGroup)}${b.frontier ? " · " + esc(b.frontier) : ""} · ${b.requirementCount} requirements${b.pages && b.pages.length ? ` · handbook p. ${b.pages.join("–")}` : ""}</div>
          </button>`).join("")}
      </div>`
      : `<p class="trk-muted">No badges match${q ? ` “${esc(q)}”` : ""}${filter || frontierFilter ? " with these filters" : ""}.</p>`;
    host.querySelectorAll(".trk-card").forEach((c) => c.addEventListener("click", () => detailView(c.dataset.id)));
  }

  const rulePill = (rule) => !rule ? ""
    : rule.type === "n_of" ? `<span class="trk-pill warn">complete ${rule.n}</span>`
      : `<span class="trk-pill ok">complete all</span>`;

  async function detailView(id) {
    const b = await api("/badges/" + encodeURIComponent(id));
    const pages = (b.handbook && b.handbook.pages) || [];
    const faith = b.faithConnection || null;
    root().innerHTML = `
      <p><button class="btn btn-outline btn-sm" id="trk-back">&larr; All badges</button></p>
      <div class="trk-panel">
        <h3>${esc(b.name)} <span class="trk-pill mut">${esc(b.levelGroup)}</span>${b.classic ? ' <span class="trk-pill mut">Classic</span>' : ""}</h3>
        ${pages.length ? `<p class="trk-muted">Girl Handbook p. ${pages.join("–")}</p>` : ""}
        ${b.intro ? `<p style="white-space:pre-wrap">${esc(b.intro)}</p>` : ""}
      </div>
      ${(b.groups || []).map((g) => `
        <div class="trk-panel">
          <h3>${esc(g.label || "Requirements")} ${rulePill(g.rule)}</h3>
          ${(g.requirements || []).map((r) => `
            <div class="trk-req">
              <span class="trk-num">${r.number}${esc(r.letter || "")}</span><strong>${esc(r.title || "")}</strong>
              ${r.text ? `<p class="trk-text">${esc(r.text)}</p>` : ""}
              ${r.subItems && r.subItems.length ? `<ul>${r.subItems.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
            </div>`).join("")}
        </div>`).join("")}
      ${faith && faith.text ? `<div class="trk-panel"><h3>Faith Connection${faith.reference ? ` — ${esc(faith.reference)}` : ""}</h3><p style="white-space:pre-wrap">${esc(faith.text)}</p></div>` : ""}
      ${b.ahgHistory ? `<div class="trk-panel"><h3>AHG History</h3><p style="white-space:pre-wrap">${esc(b.ahgHistory)}</p></div>` : ""}
      <p class="trk-muted">Handbook text is shown to signed-in leaders only — it never leaves the troop's tracker.</p>
    `;
    $("trk-back").addEventListener("click", listView);
    window.scrollTo(0, 0);
  }

  init(async () => {
    badges = await api("/badges");
    listView();
  });
})();
