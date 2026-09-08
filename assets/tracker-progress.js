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
  let mode = "year"; // year | girl | badge
  let selGirl = null;
  let selBadge = null;

  const STATUS_LABEL = { complete: "Complete", in_progress: "In progress", not_started: "Not started" };
  const statusPill = (s) => `<span class="trk-pill ${s}">${STATUS_LABEL[s] || s}</span>`;

  function shell() {
    root().innerHTML = `
      <div class="trk-chips">
        <button class="trk-chip ${mode === "year" ? "active" : ""}" data-mode="year">Program year</button>
        <button class="trk-chip ${mode === "girl" ? "active" : ""}" data-mode="girl">By girl</button>
        <button class="trk-chip ${mode === "badge" ? "active" : ""}" data-mode="badge">By badge</button>
      </div>
      <div class="trk-row-tools" id="trk-picker"></div>
      <div id="trk-body"></div>
    `;
    root().querySelectorAll("[data-mode]").forEach((c) => c.addEventListener("click", () => { mode = c.dataset.mode; shell(); }));
    const picker = $("trk-picker");
    if (mode === "year") { picker.innerHTML = ""; yearView(); return; }
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

  // ------------------------------------------------ program year ---------
  // Plan-based bars (decision: this tracks the SCHEDULE, not confirmations):
  // the light bar fills as completing sessions (roles session/finish) are
  // planned; the solid bar fills as those planned sessions' dates pass.
  const localISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  function programYear() {
    const n = new Date();
    const y = n.getMonth() >= 8 ? n.getFullYear() : n.getFullYear() - 1;
    return { from: localISO(new Date(y, 8, 1)), to: localISO(new Date(y + 1, 7, 31)), label: `${y}–${y + 1}` };
  }
  async function yearView() {
    const body = $("trk-body");
    const py = programYear();
    const data = await api(`/progress/year?from=${py.from}&to=${py.to}`);
    if (!data.units.length) {
      body.innerHTML = `<p class="trk-muted">Nothing planned yet for the ${py.label} program year. Build a plan on the Planning tab and it appears here.</p>`;
      return;
    }
    body.innerHTML = `
      <p class="trk-muted">Program year ${py.label} (${fmtDate(py.from)} – ${fmtDate(py.to)}). Bars follow the plan:
        <span class="trk-pill mut">light = requirements scheduled</span> <span class="trk-pill ok">solid = sessions already held</span>.
        Actual per-girl confirmations live under By girl / By badge.</p>
      ${data.units.map((u) => `
        <div class="trk-panel">
          <h3>${esc(u.unit)}</h3>
          ${u.badges.map((b) => {
            const plannedPct = b.needed ? Math.round((b.planned / b.needed) * 100) : 0;
            const donePct = b.needed ? Math.round((b.done / b.needed) * 100) : 0;
            return `
            <div class="trk-yr-row trk-yr-click" role="button" tabindex="0" data-yr-badge="${esc(b.badgeId)}" data-yr-unit="${esc(u.unit)}" title="Show the full plan">
              <div class="trk-yr-name"><strong>${esc(b.name)}</strong>${b.frontier ? ` <span class="trk-muted">· ${esc(b.frontier)}</span>` : ""}</div>
              <div class="trk-bar" title="${b.planned} of ${b.needed} requirements scheduled; ${b.done} already held">
                <span class="plan" style="width:${plannedPct}%"></span>
                <span class="done" style="width:${donePct}%"></span>
              </div>
              <div class="trk-yr-nums trk-muted">held ${b.done} · planned ${b.planned} / ${b.needed}${b.startedOnly ? ` · ${b.startedOnly} started, no finish scheduled` : ""}</div>
            </div>`;
          }).join("")}
        </div>`).join("")}
    `;
    body.querySelectorAll("[data-yr-badge]").forEach((row) => {
      const open = () => badgeModal(row.dataset.yrBadge, row.dataset.yrUnit, py);
      row.addEventListener("click", open);
      row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    });
  }

  // The drill-down modal: the badge's full plan for the year (dates and
  // requirements), then what still needs planning — required gaps first,
  // then optional groups only while their threshold isn't met.
  async function badgeModal(badgeId, unit, py) {
    let d;
    try {
      d = await api(`/progress/year/badge?badgeId=${encodeURIComponent(badgeId)}&unit=${encodeURIComponent(unit)}&from=${py.from}&to=${py.to}`);
    } catch (e) { toast(e.message, true); return; }

    // chronological plan: event → its items for this badge
    const byEvent = new Map();
    for (const g of d.groups) for (const r of g.requirements) for (const ses of r.sessions) {
      const key = ses.eventId;
      if (!byEvent.has(key)) byEvent.set(key, { title: ses.title, startAt: ses.startAt, past: ses.past, items: [] });
      byEvent.get(key).items.push({ number: r.number, letter: r.letter || "", title: r.title, role: ses.role });
    }
    const events = [...byEvent.values()].sort((a, b) => a.startAt.localeCompare(b.startAt));

    const requiredGaps = [];
    const optionalGaps = [];
    for (const g of d.groups) {
      const unplanned = g.requirements.filter((r) => !r.planned);
      if (g.ruleType === "n_of") {
        if (g.remaining > 0) optionalGaps.push({ label: g.label, need: g.need, remaining: g.remaining, reqs: unplanned });
      } else {
        requiredGaps.push(...unplanned.map((r) => ({ ...r, groupLabel: g.label })));
      }
    }
    const complete = !requiredGaps.length && !optionalGaps.length;
    const reqLine = (r) => `<span class="trk-num">${r.number}${esc(r.letter || "")}</span>${esc(r.title || "")}${r.startedOnly ? ' <span class="trk-pill warn">started — no finish scheduled</span>' : ""}`;

    let overlay = $("trk-yr-modal");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "trk-yr-modal";
      overlay.className = "evt-overlay";
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
      <div class="evt-modal trk-yr-modal" role="dialog" aria-modal="true" aria-labelledby="trk-yr-modal-title">
        <h3 id="trk-yr-modal-title">${esc(d.name)}</h3>
        <p class="evt-meta">${esc(unit)}${d.frontier ? " · " + esc(d.frontier) : ""} · program year plan</p>
        ${events.length ? `
          <h4 class="trk-yr-h4">On the calendar</h4>
          ${events.map((ev) => `
            <div class="trk-yr-ev ${ev.past ? "past" : ""}">
              <div class="trk-yr-ev-head"><strong>${fmtDate(ev.startAt)}</strong> · ${esc(ev.title)}${ev.past ? ' <span class="trk-pill ok">held</span>' : ""}</div>
              <ul>${ev.items.map((it) => `<li><span class="trk-num">${it.number}${esc(it.letter)}</span>${esc(it.title || "")} <span class="trk-pill ${it.role === "session" || it.role === "finish" ? "ok" : "mut"}">${it.role}</span></li>`).join("")}</ul>
            </div>`).join("")}` : '<p class="trk-muted">Nothing on the calendar for this badge yet.</p>'}
        ${complete ? '<p><span class="trk-pill complete">This plan completes the badge</span></p>' : `
          <h4 class="trk-yr-h4">Still needs planning</h4>
          ${requiredGaps.length ? `
            <p class="trk-muted" style="margin:0.2rem 0">Required:</p>
            <ul class="trk-yr-gaps">${requiredGaps.map((r) => `<li>${reqLine(r)}</li>`).join("")}</ul>` : ""}
          ${optionalGaps.map((g) => `
            <p class="trk-muted" style="margin:0.6rem 0 0.2rem">${esc(g.label || "Options")} — plan <strong>${g.remaining}</strong> more of these:</p>
            <ul class="trk-yr-gaps">${g.reqs.map((r) => `<li>${reqLine(r)}</li>`).join("")}</ul>`).join("")}`}
        <div class="ldr-dialog-btns"><button type="button" class="btn btn-blue btn-sm" id="trk-yr-modal-close">Close</button></div>
      </div>`;
    overlay.classList.add("open");
    const close = () => { overlay.classList.remove("open"); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    $("trk-yr-modal-close").addEventListener("click", close);
    document.addEventListener("keydown", onKey);
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
