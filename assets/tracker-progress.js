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
        <button class="trk-chip ${mode === "stars" ? "active" : ""}" data-mode="stars">Service stars</button>
      </div>
      <div class="trk-row-tools" id="trk-picker"></div>
      <div id="trk-body"></div>
    `;
    root().querySelectorAll("[data-mode]").forEach((c) => c.addEventListener("click", () => { mode = c.dataset.mode; shell(); }));
    const picker = $("trk-picker");
    if (mode === "year") { picker.innerHTML = ""; yearView(); return; }
    if (mode === "stars") { picker.innerHTML = ""; starsView(); return; }
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
    // Badges with activity always show (including ones from an earlier
    // level — earned or started before she moved up); "not started" is
    // limited to badges she can earn at her CURRENT level.
    const active = p.badges.filter((b) => b.status !== "not_started");
    const untouched = p.badges.filter((b) => b.status === "not_started" && b.eligible !== false);
    const priorLevel = (b) => b.eligible === false;
    const badgePanel = (b) => `
      <div class="trk-panel${priorLevel(b) ? " trk-prior" : ""}">
        <h3>${esc(b.name)} ${statusPill(b.status)} <span class="trk-pill mut">${esc(b.levelGroup)}</span>${priorLevel(b) ? ' <span class="trk-pill warn">earlier level</span>' : ""}</h3>
        ${priorLevel(b) ? `<p class="trk-muted trk-prior-note">${esc(b.levelGroup)} badge; ${esc(p.girl.firstName)} is a ${esc(p.girl.ahgLevel || "")} now. Shown for the record — any back-recording of requirements or completion for this badge is done directly in AHGFamily, not here.</p>` : ""}
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
        ${priorLevel(b) ? "" : manualAdd(b)}
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

  // ------------------------------------------------ service stars --------
  // Read side only: approved service hours mirrored weekly from AHGFamily,
  // stars earnable = floor(hours / rate) with unused hours carrying forward
  // to the next level (Pathfinder never counts). Proposals wait for a
  // leader; confirming queues the star for the (not yet enabled) push.
  const LEVELS = ["Tenderheart", "Explorer", "Pioneer", "Patriot"];
  const SHORT = { Tenderheart: "TH", Explorer: "EX", Pioneer: "PI", Patriot: "PA" };
  const h1 = (n) => (Math.round(n * 100) / 100).toFixed(2).replace(/\.?0+$/, "");
  const starIcons = (n) => (n > 0 ? `<span class="trk-star" title="${n} on record at AHGFamily">${"★".repeat(Math.min(n, 6))}${n > 6 ? `<sub>${n}</sub>` : ""}</span>` : "");
  let starFilter = "";

  async function starsView() {
    const body = $("trk-body");
    body.innerHTML = '<p class="trk-muted">Loading…</p>';
    let data; let props;
    try { [data, props] = await Promise.all([api("/stars"), api("/stars/proposals")]); } catch (e) { toast(e.message, true); return; }
    const mapped = data.girls.filter((g) => g.mapped);
    const pull = data.lastPull;
    const conflicted = data.girls.filter((g) => g.levels.some((l) => l.conflict)).length;

    const proposalsPanel = () => {
      if (!props.length) return "";
      const byGirl = new Map();
      for (const p of props) {
        const k = p.girlId;
        if (!byGirl.has(k)) byGirl.set(k, { name: `${p.lastName}, ${p.firstName}`, level: p.ahgLevel, rows: [] });
        byGirl.get(k).rows.push(p);
      }
      return `
        <div class="trk-panel">
          <h3>Stars ready to confirm <span class="trk-pill proposed">${props.length}</span></h3>
          <p class="trk-muted">Approved hours on AHGFamily now cover these stars. Confirming records the star here (dated today) and lines it up for AHGFamily; rejecting keeps it from being proposed again for that star.</p>
          <div class="trk-wrap"><table class="trk-table trk-stars-props">
            <thead><tr><th><input type="checkbox" id="trk-sp-all" checked aria-label="Select all"></th><th>Girl</th><th>Star</th><th>Hours at level</th><th>Note</th></tr></thead>
            <tbody>${[...byGirl.values()].map((g) => g.rows.map((p, i) => `<tr>
              <td><input type="checkbox" class="trk-sp" data-id="${p.id}" checked></td>
              <td>${i === 0 ? `${esc(g.name)} <span class="trk-muted">${esc(g.level || "")}</span>` : ""}</td>
              <td><strong>${esc(p.level)}</strong> star #${p.ordinal}</td>
              <td class="trk-muted">${esc(p.hoursDisplay)} h of ${p.rate} needed${p.carryIn ? ` <span title="hours carried in from the level below">(incl. ${h1(p.carryIn)} carried)</span>` : ""}</td>
              <td><input type="text" class="trk-sp-note" data-id="${p.id}" placeholder="optional" style="width:100%"></td>
            </tr>`).join("")).join("")}</tbody>
          </table></div>
          <div class="trk-row-tools">
            <button class="btn btn-blue btn-sm" id="trk-sp-confirm">Confirm selected</button>
            <button class="btn btn-outline btn-sm" id="trk-sp-reject">Reject selected</button>
            <span class="trk-muted" id="trk-sp-count"></span>
          </div>
        </div>`;
    };

    const levelCell = (g, l) => {
      if (!l.reachable) return '<td class="trk-stars-na" title="not at this level yet">·</td>';
      const pct = Math.max(0, Math.min(100, l.toNextPct));
      const bits = [];
      if (l.hours && l.carryIn) bits.push(`<span title="${h1(l.hours)} h at this level plus ${h1(l.carryIn)} h carried from the level below">${h1(l.available)} h (incl. ${h1(l.carryIn)} carried)</span>`);
      else if (l.hours) bits.push(`${h1(l.hours)} h`);
      else if (l.carryIn) bits.push(`<span title="no hours at this level yet">${h1(l.carryIn)} h carried in</span>`);
      if (l.pendingHours) bits.push(`<span title="submitted, not yet approved on AHGFamily">+${h1(l.pendingHours)} pending</span>`);
      return `<td class="trk-stars-cell ${l.current ? "current" : ""}">
        <div class="trk-stars-top">${starIcons(l.onRecord) || '<span class="trk-muted">no stars</span>'}
          ${l.proposedPending ? `<span class="trk-pill proposed" title="waiting on a leader">+${l.proposedPending}</span>` : ""}
          ${l.conflict ? `<span class="trk-pill err" title="${esc(conflictText(l.conflict, l.level))}">conflict</span>` : ""}
        </div>
        <div class="trk-bar trk-stars-bar" title="${h1(l.carryOut)} of ${l.rate} h toward the next ${l.level} star"><span class="done" style="width:${pct}%"></span></div>
        <div class="trk-muted trk-stars-nums">${bits.join(" · ") || "&nbsp;"}</div>
      </td>`;
    };

    body.innerHTML = `
      ${!pull ? `<p class="trk-muted">Service hours haven't been pulled from AHGFamily yet — an admin can run "Pull service hours" on the Admin page (it also runs weekly).</p>` : ""}
      ${proposalsPanel()}
      <div class="trk-panel">
        <h3>Service stars by girl</h3>
        <p class="trk-muted">Rates: ${LEVELS.map((l) => `${SHORT[l]} ${data.rates[l]} h`).join(" · ")} per star. Unused hours carry forward to the next level; Pathfinder hours never count.
          ★ = on record at AHGFamily · bar = progress toward the next star · <span class="trk-pill proposed">+n</span> waiting to confirm${conflicted ? ` · <span class="trk-pill err">conflict</span> needs a look on the Admin page` : ""}.
          ${pull ? `Last pull ${fmtDate(pull.startedAt)}${pull.ok ? "" : " (failed)"}.` : ""}</p>
        <div class="trk-row-tools"><input type="search" id="trk-stars-filter" placeholder="Filter girls…" value="${esc(starFilter)}" style="max-width:240px"></div>
        <div class="trk-wrap"><table class="trk-table trk-stars">
          <thead><tr><th>Girl</th>${LEVELS.map((l) => `<th>${l}</th>`).join("")}</tr></thead>
          <tbody id="trk-stars-rows"></tbody>
        </table></div>
        ${data.girls.length - mapped.length ? `<p class="trk-muted">${data.girls.length - mapped.length} girl(s) aren't mapped to AHGFamily yet, so their hours can't be read — see Admin → AHGFamily mapping.</p>` : ""}
      </div>`;

    const renderRows = () => {
      const q = starFilter.trim().toLowerCase();
      const rows = data.girls.filter((g) => !q || `${g.lastName}, ${g.firstName} ${g.nickname || ""} ${g.ahgLevel || ""}`.toLowerCase().includes(q));
      $("trk-stars-rows").innerHTML = rows.length ? rows.map((g) => `<tr>
        <td style="white-space:nowrap"><strong>${esc(g.lastName)}, ${esc(g.firstName)}</strong><div class="trk-muted">${esc(g.ahgLevel || "")}${g.mapped ? "" : " · not mapped"}${g.mapped && g.totalApprovedHours ? ` · ${h1(g.totalApprovedHours)} h approved` : ""}</div>
          ${g.pathfinderHours ? `<div class="trk-pf-note" title="Pathfinders don't earn service stars; these entries are usually an attendance artefact. Review or revise them on AHGFamily (Troop Activities). The tracker already leaves them out of every total above."><span class="trk-pill warn">Pathfinder hours</span> ${h1(g.pathfinderHours.approved + g.pathfinderHours.pending)} h in ${g.pathfinderHours.entries} entr${g.pathfinderHours.entries === 1 ? "y" : "ies"} logged as a Pathfinder — review/revise in AHGFamily; excluded here.</div>` : ""}</td>
        ${g.levels.map((l) => (g.mapped ? levelCell(g, l) : '<td class="trk-stars-na">—</td>')).join("")}
      </tr>`).join("") : `<tr><td colspan="5" class="trk-muted">No girls match.</td></tr>`;
    };
    renderRows();
    $("trk-stars-filter").addEventListener("input", (e) => { starFilter = e.target.value; renderRows(); });

    if (props.length) {
      const boxes = () => [...body.querySelectorAll(".trk-sp")];
      const count = () => { $("trk-sp-count").textContent = `${boxes().filter((b) => b.checked).length} of ${props.length} selected`; };
      $("trk-sp-all").addEventListener("change", (e) => { boxes().forEach((b) => { b.checked = e.target.checked; }); count(); });
      boxes().forEach((b) => b.addEventListener("change", count));
      count();
      const decide = (decision) => async () => {
        const ids = boxes().filter((b) => b.checked).map((b) => Number(b.dataset.id));
        if (!ids.length) { toast("Nothing selected", true); return; }
        if (decision === "reject" && !window.confirm(`Reject ${ids.length} proposed star(s)? They won't be proposed again.`)) return;
        const decisions = ids.map((id) => ({ id, decision, note: (body.querySelector(`.trk-sp-note[data-id="${id}"]`) || {}).value || undefined }));
        try {
          await api("/stars/proposals/decide", { body: decisions });
          toast(`${ids.length} star(s) ${decision === "confirm" ? "confirmed" : "rejected"}`);
          starsView();
        } catch (e) { toast(e.message, true); }
      };
      $("trk-sp-confirm").addEventListener("click", decide("confirm"));
      $("trk-sp-reject").addEventListener("click", decide("reject"));
    }
  }
  function conflictText(c, level) {
    if (!c) return "";
    if (c.kind === "more_on_record") return `${c.unexplained} ${level} star(s) on AHGFamily that approved hours don't explain`;
    if (c.kind === "instance_removed") return `a ${level} star was removed on AHGFamily (had ${c.baselineOnRecord}, now ${c.onRecord})`;
    return c.kind;
  }

  init(async () => {
    [girls, badges] = await Promise.all([api("/girls"), api("/badges")]);
    shell();
  });
})();
