// ============================================================
//  Progress (leaders area): program year (plan-based bars per
//  badge), per girl (every badge with per-requirement state,
//  mark home completions), per badge ("who is missing what"
//  matrix), and service stars. Badge complete is always derived
//  by the tracker from the group rules — never set here.
// ============================================================
(function () {
  "use strict";
  const { init, api, esc, toast, fmtDate, combo, $, matches, getPref, setPref, searchBox, sortSelect, byText } = window.Tracker;
  const root = () => $("pg-progress");

  let girls = [];
  let badges = [];
  let mode = "year"; // year | girl | badge | stars
  let selGirl = null;
  let selBadge = null;

  const STATUS_LABEL = { complete: "Complete", in_progress: "In progress", not_started: "Not started" };
  const statusPill = (s) => `<span class="trk-pill ${s}">${STATUS_LABEL[s] || s}</span>`;

  // Searches last while the page is open; sort choices (and the program
  // year's "My order") are remembered in this browser.
  const choice = (list, v, def) => (list.some(([k]) => k === v) ? v : def);
  const YR_SORTS = [["first", "First planned date"], ["name", "Badge name"], ["level", "Level"], ["custom", "My order"]];
  const GIRL_SORTS = [["name", "Badge name"], ["level", "Level, then badge name"], ["status", "Status, then badge name"]];
  const BADGE_SORTS = [["last", "Last name"], ["first", "First name"], ["level", "Level, then name"], ["status", "Status, then name"]];
  let yrSort = choice(YR_SORTS, getPref("progress-year-sort", "first"), "first");
  let girlSort = choice(GIRL_SORTS, getPref("progress-girl-sort", "name"), "name");
  let badgeSort = choice(BADGE_SORTS, getPref("progress-badge-sort", "last"), "last");
  let yrQuery = "";
  let girlQuery = "";
  let badgeQuery = "";

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
    if (mode === "girl") {
      picker.innerHTML = `<div id="trk-sel"></div>
        ${searchBox("trk-girl-q", girlQuery, "Search her badges — name, level, status…")}
        ${sortSelect("trk-girl-sort", GIRL_SORTS, girlSort)}`;
      combo($("trk-sel"), {
        items: girls.map((g) => ({ value: String(g.id), label: `${g.lastName}, ${g.firstName}`, sub: g.ahgLevel || "" })),
        value: selGirl ? String(selGirl) : null,
        placeholder: "Search girls…",
        onChange: (v) => { selGirl = Number(v) || null; girlView(); },
      });
      $("trk-girl-q").addEventListener("input", (e) => { girlQuery = e.target.value; renderGirl(); });
      $("trk-girl-sort").addEventListener("change", (e) => { girlSort = e.target.value; setPref("progress-girl-sort", girlSort); renderGirl(); });
      girlView();
    } else {
      picker.innerHTML = `<div id="trk-sel"></div>
        ${searchBox("trk-bdg-q", badgeQuery, "Search girls — name, level, status…")}
        ${sortSelect("trk-bdg-sort", BADGE_SORTS, badgeSort)}`;
      combo($("trk-sel"), {
        items: badges.map((b) => ({ value: b.id, label: b.name, sub: b.levelGroup })),
        value: selBadge,
        placeholder: "Search badges…",
        onChange: (v) => { selBadge = v || null; badgeView(); },
      });
      $("trk-bdg-q").addEventListener("input", (e) => { badgeQuery = e.target.value; renderBadge(); });
      $("trk-bdg-sort").addEventListener("change", (e) => { badgeSort = e.target.value; setPref("progress-badge-sort", badgeSort); renderBadge(); });
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

  // Sorting within each unit. "My order" is a saved list of badge ids per
  // unit; badges planned after it was saved follow the arranged ones, by
  // first planned date.
  const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const firstKey = (b) => b.firstPlannedAt || "9999";
  const YR_SORTERS = {
    first: (a, b) => cmpStr(firstKey(a), firstKey(b)) || byText(a.name, b.name),
    name: (a, b) => byText(a.name, b.name) || byText(a.levelGroup, b.levelGroup),
    level: (a, b) => byText(a.levelGroup, b.levelGroup) || byText(a.name, b.name),
  };
  const ORDER_KEY = "progress-year-order"; // { [unit]: [badgeId, …] }
  const savedOrder = () => { const o = getPref(ORDER_KEY, {}); return o && typeof o === "object" ? o : {}; };
  function sortYear(u, key = yrSort) {
    const list = [...u.badges];
    if (key !== "custom") return list.sort(YR_SORTERS[key]);
    const pos = new Map((savedOrder()[u.unit] || []).map((id, i) => [id, i]));
    return list.sort((a, b) => {
      const pa = pos.has(a.badgeId) ? pos.get(a.badgeId) : Infinity;
      const pb = pos.has(b.badgeId) ? pos.get(b.badgeId) : Infinity;
      return pa !== pb ? (pa < pb ? -1 : 1) : YR_SORTERS.first(a, b);
    });
  }

  let yr = null; // { data, py } — the loaded program year
  let arranging = false;
  // Off by default: the view is the current program year. On (remembered in
  // this browser): also badges planned in earlier years whose planned
  // sessions aren't all held yet, so they can be continued.
  let yrUnfinished = getPref("progress-year-unfinished", false) === true;

  async function yearView() {
    const body = $("trk-body");
    const py = programYear();
    const data = await api(`/progress/year?from=${py.from}&to=${py.to}${yrUnfinished ? "&includeUnfinished=1" : ""}`);
    yr = { data, py };
    body.innerHTML = `
      <p class="trk-muted">Program year ${py.label} (${fmtDate(py.from)} – ${fmtDate(py.to)}). Bars follow the plan:
        <span class="trk-pill mut">light = requirements scheduled</span> <span class="trk-pill ok">solid = sessions already held</span>.
        Actual per-girl confirmations live under By girl / By badge.${yrUnfinished ? ` Also showing badges started in an earlier year that aren't finished (<span class="trk-pill warn">earlier year</span>); their bars count every plan since they started.` : ""}</p>
      <div class="trk-row-tools">
        ${searchBox("trk-yr-q", yrQuery, "Search badges — name, frontier, level…")}
        ${sortSelect("trk-yr-sort", YR_SORTS, yrSort)}
        <label class="trk-sort"><input type="checkbox" id="trk-yr-unfinished"${yrUnfinished ? " checked" : ""}> Include unfinished badges from earlier years</label>
        <button class="btn btn-outline btn-sm" id="trk-yr-arrange" hidden>Arrange</button>
        <button class="btn-link trk-muted" id="trk-yr-reset" hidden>Reset my order</button>
      </div>
      <p class="trk-muted" id="trk-yr-help" hidden>Drag a badge, or use ▲ ▼, to put each unit's badges in the order you want to see them. Every move is saved in this browser. Press <b>Done</b> when you're finished.</p>
      <div id="trk-yr-results"></div>
    `;
    $("trk-yr-q").addEventListener("input", (e) => { yrQuery = e.target.value; renderYear(); });
    $("trk-yr-unfinished").addEventListener("change", (e) => {
      yrUnfinished = e.target.checked;
      setPref("progress-year-unfinished", yrUnfinished);
      arranging = false;
      yearView(); // a different set of badges — fetch again
    });
    $("trk-yr-sort").addEventListener("change", (e) => {
      const prev = yrSort;
      yrSort = e.target.value;
      setPref("progress-year-sort", yrSort);
      arranging = false;
      if (yrSort === "custom") {
        // first time for a unit: start "My order" from what was on screen
        // and open the arranger
        const saved = savedOrder();
        const fresh = data.units.filter((u) => !saved[u.unit]);
        fresh.forEach((u) => { saved[u.unit] = sortYear(u, prev === "custom" ? "first" : prev).map((b) => b.badgeId); });
        if (fresh.length) { setPref(ORDER_KEY, saved); arranging = true; }
      }
      renderYear();
    });
    $("trk-yr-arrange").addEventListener("click", () => {
      arranging = !arranging;
      if (arranging) yrQuery = ""; // arrange the whole list, not a search result
      renderYear();
    });
    $("trk-yr-reset").addEventListener("click", () => {
      if (!window.confirm("Forget your saved badge order in this browser? Badges go back to first planned date until you arrange them again.")) return;
      setPref(ORDER_KEY, {});
      renderYear();
    });
    renderYear();
  }

  const yearRowInner = (b) => {
    const plannedPct = b.needed ? Math.round((b.planned / b.needed) * 100) : 0;
    const donePct = b.needed ? Math.round((b.done / b.needed) * 100) : 0;
    return `
      <div class="trk-yr-name"><strong>${esc(b.name)}</strong>${b.frontier ? ` <span class="trk-muted">· ${esc(b.frontier)}</span>` : ""}${b.carriedOver ? ' <span class="trk-pill warn" title="Started in an earlier program year and not finished yet">earlier year</span>' : ""}</div>
      <div class="trk-bar" title="${b.planned} of ${b.needed} requirements scheduled; ${b.done} already held">
        <span class="plan" style="width:${plannedPct}%"></span>
        <span class="done" style="width:${donePct}%"></span>
      </div>
      <div class="trk-yr-nums trk-muted">held ${b.done} · planned ${b.planned} / ${b.needed}${b.startedOnly ? ` · ${b.startedOnly} started, no finish scheduled` : ""}${b.firstPlannedAt ? ` · first ${fmtDate(b.firstPlannedAt)}` : ""}</div>`;
  };

  function renderYear() {
    const { data, py } = yr;
    const custom = yrSort === "custom";
    const arrangeBtn = $("trk-yr-arrange");
    arrangeBtn.hidden = !custom;
    arrangeBtn.textContent = arranging ? "Done" : "Arrange";
    $("trk-yr-reset").hidden = !custom;
    $("trk-yr-help").hidden = !arranging;
    const qBox = $("trk-yr-q");
    qBox.disabled = arranging;
    if (arranging) qBox.value = "";
    const q = yrQuery.trim();
    const host = $("trk-yr-results");
    if (!data.units.length) {
      host.innerHTML = yrUnfinished
        ? `<p class="trk-muted">Nothing planned for the ${py.label} program year, and no unfinished badges from earlier years.</p>`
        : `<p class="trk-muted">Nothing planned yet for the ${py.label} program year. Build a plan on the Planning tab, or tick <b>Include unfinished badges from earlier years</b> to continue one started before.</p>`;
      return;
    }
    host.innerHTML = data.units.map((u) => {
      const list = sortYear(u).filter((b) => arranging || matches(yrQuery, b.name, b.frontier || "", b.levelGroup || ""));
      if (!list.length) return "";
      return `
        <div class="trk-panel">
          <h3>${esc(u.unit)}</h3>
          ${list.map((b, i) => (arranging
            ? `<div class="trk-yr-row arranging" draggable="true" data-arr-badge="${esc(b.badgeId)}" data-arr-unit="${esc(u.unit)}">
                <div class="trk-yr-move">
                  <button type="button" data-mv="-1" aria-label="Move ${esc(b.name)} up"${i === 0 ? " disabled" : ""}>▲</button>
                  <button type="button" data-mv="1" aria-label="Move ${esc(b.name)} down"${i === list.length - 1 ? " disabled" : ""}>▼</button>
                </div>${yearRowInner(b)}
              </div>`
            : `<div class="trk-yr-row trk-yr-click" role="button" tabindex="0" data-yr-badge="${esc(b.badgeId)}" data-yr-unit="${esc(u.unit)}" data-yr-from="${b.carriedOver && b.firstPlannedAt ? esc(b.firstPlannedAt.slice(0, 10)) : ""}" title="Show the full plan">${yearRowInner(b)}</div>`)).join("")}
        </div>`;
    }).join("") || `<p class="trk-muted">No badges in this program year match “${esc(q)}”.</p>`;

    if (arranging) { wireArrange(host); return; }
    host.querySelectorAll("[data-yr-badge]").forEach((row) => {
      // a badge carried over from an earlier year shows its plan from its
      // first planned meeting, not just this program year's part of it
      const open = () => badgeModal(row.dataset.yrBadge, row.dataset.yrUnit, row.dataset.yrFrom ? { ...py, from: row.dataset.yrFrom } : py);
      row.addEventListener("click", open);
      row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    });
  }

  function moveBadge(unit, badgeId, toIndex) {
    const u = yr.data.units.find((x) => x.unit === unit);
    if (!u) return;
    const ids = sortYear(u).map((b) => b.badgeId);
    const from = ids.indexOf(badgeId);
    if (from < 0 || toIndex < 0 || toIndex >= ids.length || from === toIndex) return;
    ids.splice(toIndex, 0, ids.splice(from, 1)[0]);
    const all = savedOrder();
    all[unit] = ids;
    setPref(ORDER_KEY, all);
    renderYear();
  }

  // ▲ ▼ for touch and keyboard; drag and drop for a mouse. Dropping on a
  // row puts the dragged badge in that row's place.
  function wireArrange(host) {
    let dragged = null;
    const rowsOf = (row) => [...row.parentNode.querySelectorAll("[data-arr-badge]")];
    const clearMarks = () => host.querySelectorAll(".drop-target").forEach((r) => r.classList.remove("drop-target", "drop-after"));
    host.querySelectorAll("[data-arr-badge]").forEach((row) => {
      const unit = row.dataset.arrUnit;
      const id = row.dataset.arrBadge;
      row.querySelectorAll("[data-mv]").forEach((btn) => btn.addEventListener("click", () => {
        moveBadge(unit, id, rowsOf(row).indexOf(row) + Number(btn.dataset.mv));
        // keep focus on the moved badge so repeated presses keep moving it
        const again = [...host.querySelectorAll("[data-arr-badge]")]
          .find((r) => r.dataset.arrBadge === id && r.dataset.arrUnit === unit);
        const same = again && again.querySelector(`[data-mv="${btn.dataset.mv}"]`);
        if (same && !same.disabled) same.focus();
      }));
      row.addEventListener("dragstart", (e) => {
        dragged = row;
        row.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", id); } catch (_) { /* some browsers refuse */ }
      });
      row.addEventListener("dragend", () => { row.classList.remove("dragging"); clearMarks(); dragged = null; });
      row.addEventListener("dragover", (e) => {
        if (!dragged || dragged === row || dragged.dataset.arrUnit !== unit) return;
        e.preventDefault();
        clearMarks();
        const list = rowsOf(row);
        row.classList.add("drop-target");
        if (list.indexOf(dragged) < list.indexOf(row)) row.classList.add("drop-after");
      });
      row.addEventListener("drop", (e) => {
        if (!dragged || dragged === row || dragged.dataset.arrUnit !== unit) return;
        e.preventDefault();
        moveBadge(unit, dragged.dataset.arrBadge, rowsOf(row).indexOf(row));
      });
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
  const GIRL_STATUS_ORDER = { in_progress: 0, complete: 1, not_started: 2 };
  const GIRL_SORTERS = {
    name: (a, b) => byText(a.name, b.name),
    level: (a, b) => byText(a.levelGroup, b.levelGroup) || byText(a.name, b.name),
    status: (a, b) => ((GIRL_STATUS_ORDER[a.status] ?? 9) - (GIRL_STATUS_ORDER[b.status] ?? 9)) || byText(a.name, b.name),
  };
  let girlData = null; // { id, p } — last loaded girl, so search/sort don't refetch

  async function girlView() {
    const body = $("trk-body");
    if (!selGirl) { girlData = null; body.innerHTML = `<p class="trk-muted">${girls.length ? "Pick a girl to see her badge progress." : "The roster is empty — run a check-in sync from the Admin page."}</p>`; return; }
    const id = selGirl;
    const p = await api(`/girls/${id}/progress`);
    if (id !== selGirl) return; // another girl was picked while this loaded
    girlData = { id, p };
    renderGirl();
  }

  function renderGirl() {
    if (!girlData || girlData.id !== selGirl) return;
    const body = $("trk-body");
    const p = girlData.p;
    const q = girlQuery.trim();
    const hit = (b) => matches(girlQuery, b.name, b.levelGroup, b.frontier || "", STATUS_LABEL[b.status] || b.status);
    const sorter = GIRL_SORTERS[girlSort];
    // Badges with activity always show (including ones from an earlier
    // level — earned or started before she moved up); "not started" is
    // limited to badges she can earn at her CURRENT level.
    const active = p.badges.filter((b) => b.status !== "not_started").filter(hit).sort(sorter);
    const untouched = p.badges.filter((b) => b.status === "not_started" && b.eligible !== false).filter(hit).sort(sorter);
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
                <td class="trk-muted">${r.completedOn ? fmtDate(r.completedOn) : ""}${r.source && r.state !== "none" ? ` · ${r.source === "ahgfamily" ? "AHGFamily" : r.source}` : ""}${r.notes ? ` · <span title="${esc(r.notes)}">note</span>` : ""}${r.pushed ? ' · <span class="trk-pill ok" title="marked on AHGFamily by the tracker">pushed</span>' : ""}
                  ${r.completionId && r.source === "manual" && !priorLevel(b) ? ` <button class="btn-link trk-muted" data-mdel="${r.completionId}" data-mdel-pushed="${r.pushed ? 1 : 0}" title="Remove this home completion">remove</button>` : ""}</td>
              </tr>`).join("")}
          </tbody></table></div>`).join("")}
        ${priorLevel(b) ? "" : manualAdd(b)}
      </div>`;
    let lead;
    if (active.length) lead = active.map(badgePanel).join("");
    else if (!q) lead = `<p class="trk-muted">No badge activity yet for ${esc(p.girl.firstName)}.</p>`;
    else lead = untouched.length ? "" : `<p class="trk-muted">None of ${esc(p.girl.firstName)}'s badges match “${esc(q)}”.</p>`;
    body.innerHTML = `
      ${lead}
      ${untouched.length ? `<details style="margin-top:0.6rem"${q ? " open" : ""}><summary class="trk-muted">Badges not started (${untouched.length})</summary>${untouched.map(badgePanel).join("")}</details>` : ""}
    `;
    wireManualAdd(body);
  }

  function manualAdd(b) {
    const open = b.groups.flatMap((g) => g.requirements).filter((r) => r.state === "none");
    if (!open.length) return "";
    return `<div class="trk-row-tools">
      <select data-madd-req="${esc(b.badgeId)}">${open.map((r) => `<option value="${esc(r.requirementId)}">${r.number}${esc(r.letter || "")} — ${esc(r.title || "")}</option>`).join("")}</select>
      <input type="date" data-madd-date="${esc(b.badgeId)}" value="${new Date().toISOString().slice(0, 10)}">
      <input type="text" data-madd-notes="${esc(b.badgeId)}" placeholder="Note (how it was done — goes to AHGFamily)" maxlength="300" style="flex:1 1 14rem;min-width:10rem">
      <button class="btn btn-outline btn-sm" data-madd="${esc(b.badgeId)}">Mark done at home</button>
    </div>`;
  }
  function wireManualAdd(body) {
    body.querySelectorAll("[data-madd]").forEach((btn) => btn.addEventListener("click", async () => {
      const id = btn.dataset.madd;
      try {
        const notes = body.querySelector(`[data-madd-notes="${CSS.escape(id)}"]`).value.trim();
        await api("/completions", {
          body: {
            girlId: selGirl,
            requirementId: body.querySelector(`[data-madd-req="${CSS.escape(id)}"]`).value,
            completedOn: body.querySelector(`[data-madd-date="${CSS.escape(id)}"]`).value,
            ...(notes ? { notes } : {}),
          },
        });
        toast("Recorded");
        girlView();
      } catch (e) { toast(e.message, true); }
    }));
    body.querySelectorAll("[data-mdel]").forEach((btn) => btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.mdel);
      const pushed = btn.dataset.mdelPushed === "1";
      const msg = pushed
        ? "This completion was already pushed to AHGFamily. The tracker never un-checks anything there — un-check it on AHGFamily yourself FIRST, then confirm here that you have. Remove it from the tracker now?"
        : "Remove this home completion from the tracker?";
      if (!window.confirm(msg)) return;
      try {
        await api(`/completions/${id}${pushed ? "?afterAhgRemoval=1" : ""}`, { method: "DELETE" });
        toast("Removed");
        girlView();
      } catch (e) { toast(e.message, true); }
    }));
  }

  // ------------------------------------------------ by badge -------------
  const LEVEL_ORDER = ["Pathfinder", "Tenderheart", "Explorer", "Pioneer", "Patriot"];
  const levelRank = (l) => { const i = LEVEL_ORDER.indexOf(l); return i < 0 ? LEVEL_ORDER.length : i; };
  const BADGE_STATUS_ORDER = { in_progress: 0, not_started: 1, complete: 2 };
  const lastFirst = (a, b) => byText(a.lastName, b.lastName) || byText(a.firstName, b.firstName);
  const BADGE_SORTERS = {
    last: lastFirst,
    first: (a, b) => byText(a.firstName, b.firstName) || byText(a.lastName, b.lastName),
    level: (a, b) => (levelRank(a.ahgLevel) - levelRank(b.ahgLevel)) || byText(a.ahgLevel, b.ahgLevel) || lastFirst(a, b),
    status: (a, b) => ((BADGE_STATUS_ORDER[a.status] ?? 9) - (BADGE_STATUS_ORDER[b.status] ?? 9)) || lastFirst(a, b),
  };
  let badgeData = null; // { id, p }

  async function badgeView() {
    const body = $("trk-body");
    if (!selBadge) { badgeData = null; body.innerHTML = `<p class="trk-muted">Pick a badge to see who is missing what.</p>`; return; }
    const id = selBadge;
    const p = await api(`/badges/${encodeURIComponent(id)}/progress`);
    if (id !== selBadge) return;
    badgeData = { id, p };
    renderBadge();
  }

  function renderBadge() {
    if (!badgeData || badgeData.id !== selBadge) return;
    const body = $("trk-body");
    const p = badgeData.p;
    const q = badgeQuery.trim();
    const atLevel = p.girls.filter((g) => !g.ahgLevel || badgeCovers(p.levelGroup, g.ahgLevel));
    const shown = atLevel
      .filter((g) => matches(badgeQuery, g.lastName, g.firstName, g.ahgLevel || "", STATUS_LABEL[g.status] || g.status))
      .sort(BADGE_SORTERS[badgeSort]);
    body.innerHTML = `
      <div class="trk-panel">
        <h3>${esc(p.name)} <span class="trk-pill mut">${esc(p.levelGroup)}</span></h3>
        <div class="trk-wrap"><table class="trk-table trk-grid-x">
          <thead><tr><th>Girl</th><th>Status</th>${p.requirements.map((r) => `<th title="${esc(r.title || "")}">${r.number}${esc(r.letter || "")}</th>`).join("")}</tr></thead>
          <tbody>${shown.length ? shown.map((g) => `
            <tr>
              <td style="white-space:nowrap">${esc(g.lastName)}, ${esc(g.firstName)}<div class="trk-muted">${esc(g.ahgLevel || "")}</div></td>
              <td>${statusPill(g.status)}</td>
              ${p.requirements.map((r) => {
                const st = g.states[r.requirementId];
                return !st ? '<td class="blank">·</td>'
                  : st.state === "confirmed" ? `<td class="done" title="${esc(st.completedOn || "")}">✓</td>`
                    : `<td class="prop" title="proposed">○</td>`;
              }).join("")}
            </tr>`).join("") : `<tr><td colspan="${p.requirements.length + 2}" class="trk-muted">${q ? `No girls match “${esc(q)}”.` : "No girls at this badge's level."}</td></tr>`}</tbody>
        </table></div>
        <p class="trk-muted">✓ confirmed · ○ proposed (waiting on a leader) · rows are limited to girls at this badge's level${q ? ` · showing ${shown.length} of ${atLevel.length}` : ""}.</p>
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
    let me = { role: "leader" };
    try {
      [data, props, me] = await Promise.all([api("/stars"), api("/stars/proposals"), api("/me").catch(() => ({ role: "leader" }))]);
    } catch (e) { toast(e.message, true); return; }
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
      if (l.legacyMode === "fresh") bits.push(`<span title="Stars on record from before this program year stand. Only hours logged since then count toward her next star; nothing carries in.">${h1(l.freshHours || 0)} h since ${fmtDate(l.freshFrom)}</span>`);
      else if (l.hours && l.carryIn) bits.push(`<span title="${h1(l.hours)} h at this level plus ${h1(l.carryIn)} h carried from the level below">${h1(l.available)} h (incl. ${h1(l.carryIn)} carried)</span>`);
      else if (l.hours) bits.push(`${h1(l.hours)} h`);
      else if (l.carryIn) bits.push(`<span title="no hours at this level yet">${h1(l.carryIn)} h carried in</span>`);
      if (l.pendingHours) bits.push(`<span title="submitted, not yet approved on AHGFamily">+${h1(l.pendingHours)} pending</span>`);
      if (l.pathfinderCredit) bits.push(`<span title="Stars already awarded on Pathfinder hours stand. The Pathfinder hours those stars needed stay counted, so every new counted hour goes toward her next star. No other Pathfinder hours count.">incl. ${h1(l.pathfinderCredit)} h Pathfinder credit</span>`);
      const extra = l.unexplainedExtras || 0;
      const plural = extra === 1 ? "" : "s";
      const legacyChoice = !extra ? ""
        : me.role === "admin"
          ? `<label class="trk-muted trk-legacy">${extra} extra star${plural} on record:
              <select data-legacy-girl="${g.id}" data-legacy-level="${esc(l.level)}">
                <option value="separate"${l.legacyMode === "fresh" ? "" : " selected"}>earned separately, added on top</option>
                <option value="fresh"${l.legacyMode === "fresh" ? " selected" : ""}>stands; only this program year's hours count toward the next</option>
              </select></label>`
          : `<div class="trk-muted trk-legacy">${extra} extra star${plural} on record · ${l.legacyMode === "fresh" ? `stands; hours since ${fmtDate(l.freshFrom)} count toward the next` : "earned separately"}</div>`;
      return `<td class="trk-stars-cell ${l.current ? "current" : ""}">
        <div class="trk-stars-top">${starIcons(l.onRecord) || '<span class="trk-muted">no stars</span>'}
          ${l.proposedPending ? `<span class="trk-pill proposed" title="waiting on a leader">+${l.proposedPending}</span>` : ""}
          ${l.conflict ? `<span class="trk-pill err" title="${esc(conflictText(l.conflict, l.level))}">conflict</span>` : ""}
          ${l.coveredStars ? `<span class="trk-pill mut" title="Awarded on Pathfinder hours before the troop stopped counting them. They stand; new stars need counted hours beyond them.">${l.coveredStars} on Pathfinder hours</span>` : ""}
        </div>
        <div class="trk-bar trk-stars-bar" title="${h1(l.carryOut)} of ${l.rate} h toward the next ${l.level} star"><span class="done" style="width:${pct}%"></span></div>
        <div class="trk-muted trk-stars-nums">${bits.join(" · ") || "&nbsp;"}</div>
        ${legacyChoice}
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
        <div class="trk-row-tools">${searchBox("trk-stars-filter", starFilter, "Search girls — name, level…")}</div>
        <div class="trk-wrap"><table class="trk-table trk-stars">
          <thead><tr><th>Girl</th>${LEVELS.map((l) => `<th>${l}</th>`).join("")}</tr></thead>
          <tbody id="trk-stars-rows"></tbody>
        </table></div>
        ${data.girls.length - mapped.length ? `<p class="trk-muted">${data.girls.length - mapped.length} girl(s) aren't mapped to AHGFamily yet, so their hours can't be read — see Admin → AHGFamily mapping.</p>` : ""}
      </div>`;

    const renderRows = () => {
      const rows = data.girls.filter((g) => matches(starFilter, g.lastName, g.firstName, g.nickname || "", g.ahgLevel || ""));
      $("trk-stars-rows").innerHTML = rows.length ? rows.map((g) => `<tr>
        <td style="white-space:nowrap"><strong>${esc(g.lastName)}, ${esc(g.firstName)}</strong><div class="trk-muted">${esc(g.ahgLevel || "")}${g.mapped ? "" : " · not mapped"}${g.mapped && g.totalApprovedHours ? ` · ${h1(g.totalApprovedHours)} h approved` : ""}</div>
          ${g.pathfinderHours ? `<div class="trk-pf-note" title="Pathfinders don't earn service stars; these entries are usually an attendance artefact. Review or revise them on AHGFamily (Troop Activities). The tracker leaves them out, except to cover stars already awarded on them."><span class="trk-pill warn">Pathfinder hours</span> ${h1(g.pathfinderHours.approved + g.pathfinderHours.pending)} h in ${g.pathfinderHours.entries} entr${g.pathfinderHours.entries === 1 ? "y" : "ies"} logged as a Pathfinder — review/revise in AHGFamily. Not counted, except to cover stars already awarded on them.</div>` : ""}</td>
        ${g.levels.map((l) => (g.mapped ? levelCell(g, l) : '<td class="trk-stars-na">—</td>')).join("")}
      </tr>`).join("") : `<tr><td colspan="5" class="trk-muted">No girls match.</td></tr>`;
    };
    renderRows();
    $("trk-stars-filter").addEventListener("input", (e) => { starFilter = e.target.value; renderRows(); });
    // admin: how a girl's extra stars at a level count (rows re-render on
    // search, so listen on the table body)
    $("trk-stars-rows").addEventListener("change", async (e) => {
      const sel = e.target.closest("[data-legacy-girl]");
      if (!sel) return;
      const mode = sel.value;
      const prev = mode === "fresh" ? "separate" : "fresh";
      const msg = mode === "fresh"
        ? "Let this girl's stars at this level stand, and count only hours from this program year on toward her next star?\n\nHours from before the program year, and anything carried in from the level below, stop counting at this level. A proposal those hours no longer support is withdrawn now."
        : "Treat this girl's extra stars at this level as earned separately?\n\nThey are then added on top of what her hours earn, which can propose new stars.";
      if (!window.confirm(msg)) { sel.value = prev; return; }
      try {
        const r = await api("/admin/stars/legacy-mode", { body: { girlId: Number(sel.dataset.legacyGirl), level: sel.dataset.legacyLevel, mode } });
        const bits = [];
        if (r.withdrawn) bits.push(`${r.withdrawn} proposal${r.withdrawn === 1 ? "" : "s"} withdrawn`);
        if (r.proposed) bits.push(`${r.proposed} new proposal${r.proposed === 1 ? "" : "s"}`);
        toast(`Saved${bits.length ? ` — ${bits.join(", ")}` : ""}`);
        starsView();
        if (window.Tracker.refreshBanner) window.Tracker.refreshBanner();
      } catch (err) { toast(err.message, true); sel.value = prev; }
    });

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
