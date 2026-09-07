// ============================================================
//  Badge catalog browser (leaders area). Everything — names,
//  requirement text, faith connection — comes from the
//  authenticated tracker API at runtime; nothing is in this repo.
// ============================================================
(function () {
  "use strict";
  const { init, api, esc, $ } = window.Tracker;
  const root = () => $("pg-badges");

  let badges = [];
  let filter = "";

  function listView() {
    const groups = [...new Set(badges.map((b) => b.levelGroup))].sort();
    const shown = badges.filter((b) => !filter || b.levelGroup === filter);
    root().innerHTML = `
      <div class="trk-chips">
        <button class="trk-chip ${!filter ? "active" : ""}" data-lg="">All</button>
        ${groups.map((g) => `<button class="trk-chip ${filter === g ? "active" : ""}" data-lg="${esc(g)}">${esc(g)}</button>`).join("")}
      </div>
      ${shown.length ? `<div class="trk-cards">
        ${shown.map((b) => `
          <button class="trk-card" data-id="${esc(b.id)}">
            <h3>${esc(b.name)}</h3>
            <div class="trk-meta">${esc(b.levelGroup)} · ${b.requirementCount} requirements${b.pages && b.pages.length ? ` · handbook p. ${b.pages.join("–")}` : ""}</div>
          </button>`).join("")}
      </div>` : `<p class="trk-muted">No badges in the catalog yet${filter ? " for this level group" : ""}. Only annotated badges appear here — the pilot set to start.</p>`}
    `;
    root().querySelectorAll(".trk-chip").forEach((c) => c.addEventListener("click", () => { filter = c.dataset.lg; listView(); }));
    root().querySelectorAll(".trk-card").forEach((c) => c.addEventListener("click", () => detailView(c.dataset.id)));
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
