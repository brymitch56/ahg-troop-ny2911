// ============================================================
//  Progress (leaders area): per girl (every badge with
//  per-requirement state, mark home completions) and per badge
//  ("who is missing what" matrix). Badge complete is always
//  derived by the tracker from the group rules — never set here.
// ============================================================
(function () {
  "use strict";
  const { init, api, esc, toast, fmtDate, combo, $ } = window.Tracker;
  const root = () => $("pg-progress");

  let girls = [];
  let badges = [];
  let mode = "girl"; // girl | badge
  let selGirl = null;
  let selBadge = null;

  const STATUS_LABEL = { complete: "Complete", in_progress: "In progress", not_started: "Not started" };
  const statusPill = (s) => `<span class="trk-pill ${s}">${STATUS_LABEL[s] || s}</span>`;

  function shell() {
    root().innerHTML = `
      <div class="trk-chips">
        <button class="trk-chip ${mode === "girl" ? "active" : ""}" data-mode="girl">By girl</button>
        <button class="trk-chip ${mode === "badge" ? "active" : ""}" data-mode="badge">By badge</button>
      </div>
      <div class="trk-row-tools" id="trk-picker"></div>
      <div id="trk-body"></div>
    `;
    root().querySelectorAll("[data-mode]").forEach((c) => c.addEventListener("click", () => { mode = c.dataset.mode; shell(); }));
    const picker = $("trk-picker");
    picker.innerHTML = '<div id="trk-sel"></div>';
    if (mode === "girl") {
      combo($("trk-sel"), {
        items: girls.map((g) => ({ value: String(g.id), label: `${g.lastName}, ${g.firstName}`, sub: g.ahgLevel || "" })),
        value: selGirl ? String(selGirl) : null,
        placeholder: "Search girls…",
        onChange: (v) => { selGirl = Number(v) || null; girlView(); },
      });
      girlView();
    } else {
      combo($("trk-sel"), {
        items: badges.map((b) => ({ value: b.id, label: b.name, sub: b.levelGroup })),
        value: selBadge,
        placeholder: "Search badges…",
        onChange: (v) => { selBadge = v || null; badgeView(); },
      });
      badgeView();
    }
  }

  // ------------------------------------------------ by girl --------------
  async function girlView() {
    const body = $("trk-body");
    if (!selGirl) { body.innerHTML = `<p class="trk-muted">${girls.length ? "Pick a girl to see her badge progress." : "The roster is empty — run a check-in sync from the Admin page."}</p>`; return; }
    const p = await api(`/girls/${selGirl}/progress`);
    const active = p.badges.filter((b) => b.status !== "not_started");
    const untouched = p.badges.filter((b) => b.status === "not_started");
    const badgePanel = (b) => `
      <div class="trk-panel">
        <h3>${esc(b.name)} ${statusPill(b.status)} <span class="trk-pill mut">${esc(b.levelGroup)}</span></h3>
        ${b.groups.map((g) => `
          ${g.label ? `<p class="trk-muted" style="margin:0.4rem 0 0.2rem"><strong>${esc(g.label)}</strong>${g.ruleType === "n_of" ? ` — complete ${g.ruleN}` : ""}</p>` : ""}
          <div class="trk-wrap"><table class="trk-table"><tbody>
            ${g.requirements.map((r) => `
              <tr>
                <td style="width:60%"><span class="trk-num">${r.number}${esc(r.letter || "")}</span>${esc(r.title || "")}</td>
                <td>${r.state === "none" ? '<span class="trk-pill none">—</span>'
                  : `<span class="trk-pill ${r.state}">${r.state}</span>${r.needsReview ? ' <span class="trk-pill err">review</span>' : ""}`}</td>
                <td class="trk-muted">${r.completedOn ? fmtDate(r.completedOn) : ""}${r.source && r.state !== "none" ? ` · ${r.source === "ahgfamily" ? "AHGFamily" : r.source}` : ""}</td>
              </tr>`).join("")}
          </tbody></table></div>`).join("")}
        ${manualAdd(b)}
      </div>`;
    body.innerHTML = `
      ${active.length ? active.map(badgePanel).join("") : `<p class="trk-muted">No badge activity yet for ${esc(p.girl.firstName)}.</p>`}
      ${untouched.length ? `<details style="margin-top:0.6rem"><summary class="trk-muted">Badges not started (${untouched.length})</summary>${untouched.map(badgePanel).join("")}</details>` : ""}
    `;
    wireManualAdd(body);
  }

  function manualAdd(b) {
    const open = b.groups.flatMap((g) => g.requirements).filter((r) => r.state === "none");
    if (!open.length) return "";
    return `<div class="trk-row-tools">
      <select data-madd-req="${esc(b.badgeId)}">${open.map((r) => `<option value="${esc(r.requirementId)}">${r.number}${esc(r.letter || "")} — ${esc(r.title || "")}</option>`).join("")}</select>
      <input type="date" data-madd-date="${esc(b.badgeId)}" value="${new Date().toISOString().slice(0, 10)}">
      <button class="btn btn-outline btn-sm" data-madd="${esc(b.badgeId)}">Mark done at home</button>
    </div>`;
  }
  function wireManualAdd(body) {
    body.querySelectorAll("[data-madd]").forEach((btn) => btn.addEventListener("click", async () => {
      const id = btn.dataset.madd;
      try {
        await api("/completions", {
          body: {
            girlId: selGirl,
            requirementId: body.querySelector(`[data-madd-req="${CSS.escape(id)}"]`).value,
            completedOn: body.querySelector(`[data-madd-date="${CSS.escape(id)}"]`).value,
          },
        });
        toast("Recorded");
        girlView();
      } catch (e) { toast(e.message, true); }
    }));
  }

  // ------------------------------------------------ by badge -------------
  async function badgeView() {
    const body = $("trk-body");
    if (!selBadge) { body.innerHTML = `<p class="trk-muted">Pick a badge to see who is missing what.</p>`; return; }
    const p = await api(`/badges/${encodeURIComponent(selBadge)}/progress`);
    const shown = p.girls.filter((g) => !g.ahgLevel || badgeCovers(p.levelGroup, g.ahgLevel));
    body.innerHTML = `
      <div class="trk-panel">
        <h3>${esc(p.name)} <span class="trk-pill mut">${esc(p.levelGroup)}</span></h3>
        <div class="trk-wrap"><table class="trk-table trk-grid-x">
          <thead><tr><th>Girl</th><th>Status</th>${p.requirements.map((r) => `<th title="${esc(r.title || "")}">${r.number}${esc(r.letter || "")}</th>`).join("")}</tr></thead>
          <tbody>${shown.map((g) => `
            <tr>
              <td style="white-space:nowrap">${esc(g.lastName)}, ${esc(g.firstName)}<div class="trk-muted">${esc(g.ahgLevel || "")}</div></td>
              <td>${statusPill(g.status)}</td>
              ${p.requirements.map((r) => {
                const st = g.states[r.requirementId];
                return !st ? '<td class="blank">·</td>'
                  : st.state === "confirmed" ? `<td class="done" title="${esc(st.completedOn || "")}">✓</td>`
                    : `<td class="prop" title="proposed">○</td>`;
              }).join("")}
            </tr>`).join("")}</tbody>
        </table></div>
        <p class="trk-muted">✓ confirmed · ○ proposed (waiting on a leader) · rows are limited to girls at this badge's level.</p>
      </div>`;
  }
  const badgeCovers = (badgeLevelGroup, girlLevel) => badgeLevelGroup === "All" || badgeLevelGroup === girlLevel
    || (badgeLevelGroup === "Pioneer/Patriot" && (girlLevel === "Pioneer" || girlLevel === "Patriot"));

  init(async () => {
    [girls, badges] = await Promise.all([api("/girls"), api("/badges")]);
    shell();
  });
})();
