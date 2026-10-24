// ============================================================
//  Faith (leaders area): the troop's faith plan, kept apart from
//  the badge planner — each unit's Bible studies, faith badges
//  and Faith Award studies, meeting by meeting, so anyone can
//  pick up where the unit left off; and each girl's Faith Award
//  (one per level, a different pin each). All data lives in the
//  tracker on the Pi.
// ============================================================
(function () {
  "use strict";
  const { init, api, esc, toast, fmtDate, fmtTime, combo, $, matches, searchBox } = window.Tracker;
  const root = () => $("pg-faith");

  const UNITS = ["Tenderheart", "Explorer", "Pioneer/Patriot"];
  const UNIT_LEVELS = { Tenderheart: ["Tenderheart"], Explorer: ["Explorer"], "Pioneer/Patriot": ["Pioneer", "Patriot"] };
  const ROLES = ["session", "start", "continue", "finish"];
  const ROLE_HELP = {
    session: "done at this meeting",
    start: "first of several sessions",
    continue: "middle session",
    finish: "last session — proposes completion",
  };
  const VIEWS = [
    { key: "year", label: "Year plan" },
    { key: "meetings", label: "Meetings" },
    { key: "award", label: "Faith Award" },
    { key: "studies", label: "Bible studies" },
    { key: "counts", label: "What counts" },
  ];

  let cat = null; // GET /faith — awards per level, faith badges, studies
  const badgeCache = {};
  let view = "year";
  let dirty = false; // unsaved meeting-plan edits

  const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  // program year: September 1 – August 31
  const yearStart = (offset) => { const n = new Date(); const y = (n.getMonth() >= 8 ? n.getFullYear() : n.getFullYear() - 1) + offset; return [new Date(y, 8, 1), new Date(y + 1, 7, 31)]; };
  let yearOffset = 0;
  let yearUnit = "all";

  const badgeFits = (badgeLevelGroup, unit) => badgeLevelGroup === "All" || badgeLevelGroup === unit
    || (unit === "Pioneer/Patriot" && (badgeLevelGroup === "Pioneer" || badgeLevelGroup === "Patriot"));
  const levelsLabel = (levels) => levels.join(" + ");
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

  const leaveOk = () => !dirty || window.confirm("You have unsaved changes to this faith plan. Leave without saving?");
  window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

  function shell(active) {
    root().innerHTML = `
      <div class="trk-chips">${VIEWS.map((v) => `<button class="trk-chip ${active === v.key ? "active" : ""}" data-view="${v.key}">${v.label}</button>`).join("")}</div>
      ${cat && cat.missing.length === 4 ? `<div class="placeholder-note">The Faith Award isn't in the tracker yet. On the tracker: <code>npm run build:badges</code>, copy <code>data/badges/</code> to the Pi, then Admin → Re-import.</div>` : ""}
      <div id="fa-body"></div>`;
    root().querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.view === view || !leaveOk()) return;
      dirty = false;
      show(b.dataset.view);
    }));
  }

  async function show(v, arg) {
    view = v;
    shell(v);
    try {
      if (v === "year") await yearView();
      else if (v === "meetings") await (arg ? meetingView(arg.eventId, arg.unit) : meetingsList());
      else if (v === "award") await awardView();
      else if (v === "studies") await studiesView();
      else await countsView();
    } catch (e) { toast(e.message, true); }
  }

  // ------------------------------------------------ shared labels -------
  const itemLabel = (it) => it.faith === "award" || it.badgeFaith === "award"
    ? `Faith Award — ${esc(it.title)}`
    : `<strong>${esc(it.badgeName)}</strong> ${it.number}${esc(it.letter || "")}${it.title ? " — " + esc(it.title) : ""}`;

  // Faith Award items for the same study at Pioneer and Patriot travel as
  // one row in the Pioneer/Patriot plan (each level has its own award).
  function groupAwardItems(items) {
    const out = [];
    const byTitle = new Map();
    for (const it of items) {
      const isAward = it.faith === "award" || it.badgeFaith === "award";
      if (!isAward) { out.push({ ...it, ids: [it.requirementId] }); continue; }
      const g = byTitle.get(it.title);
      if (g) { g.ids.push(it.requirementId); g.levels.push(it.badgeLevelGroup); continue; }
      const row = { ...it, ids: [it.requirementId], levels: [it.badgeLevelGroup].filter(Boolean) };
      byTitle.set(it.title, row);
      out.push(row);
    }
    return out;
  }

  // ------------------------------------------------ year plan -----------
  async function yearView() {
    const [f, t] = yearStart(yearOffset);
    const y = await api(`/faith/year?from=${isoDay(f)}&to=${isoDay(t)}`);
    const units = y.units.filter((u) => yearUnit === "all" || u.unit === yearUnit);
    const nowIso = new Date().toISOString();
    $("fa-body").innerHTML = `
      <div class="trk-row-tools">
        <button class="btn btn-outline btn-sm" id="fa-yr-prev">&larr; Earlier year</button>
        <strong>${f.getFullYear()}–${t.getFullYear()} program year</strong>
        <button class="btn btn-outline btn-sm" id="fa-yr-next">Later year &rarr;</button>
        <span class="trk-muted">·</span>
        <label class="trk-sort">Unit <select id="fa-yr-unit">
          <option value="all">All units</option>${UNITS.map((u) => `<option${u === yearUnit ? " selected" : ""}>${esc(u)}</option>`).join("")}
        </select></label>
        <button class="btn btn-outline btn-sm" id="fa-yr-print" title="Print this year's faith plan (or save it as a PDF)">Print</button>
      </div>
      <p class="trk-muted">Every meeting with faith work planned, in order — what's done, and what comes next. Click a meeting to change its plan.</p>
      ${studyStatus(y)}
      ${units.map((u) => unitYear(u, nowIso)).join("")}
      ${coveragePanel(y, units.map((u) => u.unit))}`;
    $("fa-yr-prev").addEventListener("click", () => { yearOffset -= 1; show("year"); });
    $("fa-yr-next").addEventListener("click", () => { yearOffset += 1; show("year"); });
    $("fa-yr-unit").addEventListener("change", (e) => { yearUnit = e.target.value; show("year"); });
    $("fa-yr-print").addEventListener("click", () => printYear(y, units, f, t));
    $("fa-body").querySelectorAll("a[data-ev]").forEach((a) => a.addEventListener("click", (ev) => {
      ev.preventDefault();
      show("meetings", { eventId: Number(a.dataset.ev), unit: a.dataset.unit });
    }));
  }

  function unitYear(u, nowIso) {
    const nextIdx = u.meetings.findIndex((m) => !m.past);
    return `<div class="trk-panel"><h3>${esc(u.unit)}</h3>
      ${u.meetings.length ? `<div class="trk-wrap"><table class="trk-table">
        <thead><tr><th>When</th><th>Planned</th></tr></thead>
        <tbody>${u.meetings.map((m, i) => `
          <tr${m.past ? ' class="trk-muted"' : ""}>
            <td style="white-space:nowrap"><a href="#" data-ev="${m.eventId}" data-unit="${esc(u.unit)}">${fmtDate(m.startAt)}</a>
              <div class="trk-muted">${esc(m.title)}</div>
              ${i === nextIdx ? '<span class="trk-pill warn">next up</span>' : m.past ? '<span class="trk-pill mut">held</span>' : ""}</td>
            <td>${m.notes ? `<div class="trk-text">${esc(m.notes)}</div>` : ""}
              ${m.studies.map((s) => `<div>📖 <strong>${esc(s.title)}</strong>${s.lesson ? " — " + esc(s.lesson) : ""}${s.notes ? ` <span class="trk-muted">(${esc(s.notes)})</span>` : ""}</div>`).join("")}
              ${groupAwardItems(m.items).map((it) => `<div>${itemLabel(it)} <span class="trk-pill mut">${esc(it.role)}</span>${it.notes ? ` <span class="trk-muted">— ${esc(it.notes)}</span>` : ""}</div>`).join("")}</td>
          </tr>`).join("")}</tbody></table></div>`
        : `<p class="trk-muted">No faith work planned for ${esc(u.unit)} this year yet. Pick a meeting under <em>Meetings</em> to start.</p>`}
    </div>`;
  }

  // Where each standalone study stands, per unit — the substitute's answer
  // to "where did they leave off?"
  function studyStatus(y) {
    const rows = [];
    for (const s of y.studies) {
      for (const [unit, st] of Object.entries(s.byUnit)) {
        if (yearUnit !== "all" && unit !== yearUnit) continue;
        rows.push(`<tr><td><strong>${esc(s.title)}</strong></td><td>${esc(unit)}</td>
          <td>${st.lastHeld ? `${esc(st.lastHeld.lesson || "(no lesson noted)")} <span class="trk-muted">${fmtDate(st.lastHeld.startAt)}</span>` : '<span class="trk-muted">not started</span>'}</td>
          <td>${st.next ? `${esc(st.next.lesson || "(no lesson noted)")} <span class="trk-muted">${fmtDate(st.next.startAt)}</span>` : '<span class="trk-muted">nothing planned yet</span>'}</td></tr>`);
      }
    }
    if (!rows.length) return "";
    return `<div class="trk-panel"><h3>Bible studies — where each unit is</h3><div class="trk-wrap"><table class="trk-table">
      <thead><tr><th>Study</th><th>Unit</th><th>Last held</th><th>Next</th></tr></thead><tbody>${rows.join("")}</tbody></table></div></div>`;
  }

  function coveragePanel(y, unitsShown) {
    const units = y.coverage.filter((u) => unitsShown.includes(u.unit) && u.badges.length);
    if (!units.length) return "";
    return `<div class="trk-panel"><h3>Faith badges &amp; award studies this year</h3>
      <p class="trk-muted">How much of each is on the calendar (light) and already held (dark). A Faith Award study needs only one — the badge bars count requirements.</p>
      ${units.map((u) => `<h4 class="trk-yr-h4">${esc(u.unit)}</h4>${u.badges.map((b) => {
        const plan = b.needed ? Math.round((b.planned / b.needed) * 100) : 0;
        const done = b.needed ? Math.round((b.done / b.needed) * 100) : 0;
        return `<div class="trk-yr-row"><div><strong>${esc(b.name)}</strong>${b.name.includes(b.levelGroup) ? "" : ` <span class="trk-muted">${esc(b.levelGroup)}</span>`}</div>
          <div class="trk-bar" title="${b.planned} of ${b.needed} scheduled; ${b.done} already held"><span class="plan" style="width:${plan}%"></span><span class="done" style="width:${done}%"></span></div>
          <div class="trk-yr-nums">${b.done}/${b.planned}/${b.needed}${b.startedOnly ? ` · ${b.startedOnly} started` : ""}</div></div>`;
      }).join("")}`).join("")}</div>`;
  }

  function printYear(y, units, f, t) {
    const body = units.map((u) => `<div class="section"><h2>${esc(u.unit)}</h2>
      ${u.meetings.length ? `<table><thead><tr><th style="width:22%">Meeting</th><th>Planned</th></tr></thead><tbody>${u.meetings.map((m) => `<tr>
        <td><strong>${fmtDate(m.startAt)}</strong><div class="muted">${esc(m.title)}</div>${m.past ? '<div class="muted">held</div>' : ""}</td>
        <td>${m.notes ? `<div class="notes">${esc(m.notes)}</div>` : ""}
          ${m.studies.map((s) => `<div><strong>${esc(s.title)}</strong>${s.lesson ? " — " + esc(s.lesson) : ""}${s.notes ? ` <span class="muted">(${esc(s.notes)})</span>` : ""}</div>`).join("")}
          ${groupAwardItems(m.items).map((it) => `<div>${itemLabel(it)} <span class="role">${esc(it.role)}</span>${it.notes ? ` <span class="muted">— ${esc(it.notes)}</span>` : ""}</div>`).join("")}</td></tr>`).join("")}</tbody></table>`
        : '<p class="muted">Nothing planned.</p>'}</div>`).join("");
    window.Tracker.printPage(`Faith plan ${f.getFullYear()}–${t.getFullYear()}`, `<h1>Faith plan</h1>
      <p class="meta">${f.getFullYear()}–${t.getFullYear()} program year · ${units.map((u) => esc(u.unit)).join(", ")}</p>${body}`);
  }

  // ------------------------------------------------ meetings ------------
  let mtgQuery = "";
  let mtgRange = { from: addDays(new Date(), -14), to: addDays(new Date(), 90) };
  async function meetingsList() {
    const from = isoDay(mtgRange.from);
    const to = isoDay(mtgRange.to);
    const events = await api(`/events?from=${from}&to=${to}`);
    $("fa-body").innerHTML = `
      <div class="trk-row-tools">
        <input type="date" id="fa-ev-from" value="${from}" aria-label="From"><span class="trk-muted">to</span>
        <input type="date" id="fa-ev-to" value="${to}" aria-label="To">
        <button class="btn btn-outline btn-sm" id="fa-ev-apply">Apply</button>
        ${searchBox("fa-ev-q", mtgQuery, "Search meetings…")}
      </div>
      <p class="trk-muted">Pick a meeting to plan each unit's faith work. Badge work for the same meeting stays on the Planning page.</p>
      <div id="fa-ev-results"></div>`;
    const render = () => {
      const shown = events.filter((e) => !e.removedFromFeed && matches(mtgQuery, e.title, e.location || "", (e.faithLevelGroups || []).join(" "), fmtDate(e.startAt)));
      $("fa-ev-results").innerHTML = shown.length ? `<div class="trk-wrap"><table class="trk-table">
        <thead><tr><th>When</th><th>Meeting</th><th>Faith plans</th></tr></thead>
        <tbody>${shown.map((e) => `<tr>
          <td style="white-space:nowrap">${fmtDate(e.startAt)}<div class="trk-muted">${fmtTime(e.startAt)}</div></td>
          <td><a href="#" data-ev="${e.id}"><strong>${esc(e.title)}</strong></a>${e.location ? `<div class="trk-muted">${esc(e.location)}</div>` : ""}</td>
          <td>${(e.faithLevelGroups || []).map((g) => `<span class="trk-pill ok">${esc(g)}</span>`).join(" ") || '<span class="trk-muted">—</span>'}</td>
        </tr>`).join("")}</tbody></table></div>` : '<p class="trk-muted">No meetings in this range.</p>';
      $("fa-ev-results").querySelectorAll("a[data-ev]").forEach((a) => a.addEventListener("click", (ev) => { ev.preventDefault(); show("meetings", { eventId: Number(a.dataset.ev) }); }));
    };
    $("fa-ev-q").addEventListener("input", (e) => { mtgQuery = e.target.value; render(); });
    $("fa-ev-apply").addEventListener("click", () => {
      const f = $("fa-ev-from").value; const t = $("fa-ev-to").value;
      if (!f || !t || f > t) { toast("Pick a start date before the end date"); return; }
      mtgRange = { from: new Date(f + "T12:00:00"), to: new Date(t + "T12:00:00") };
      show("meetings");
    });
    render();
  }

  async function meetingView(eventId, unitArg) {
    const [ev, plans] = await Promise.all([api("/events/" + eventId), api(`/events/${eventId}/faith-plans`)]);
    const byUnit = new Map(plans.map((p) => [p.levelGroup, p]));
    const unit = unitArg || (plans[0] ? plans[0].levelGroup : UNITS[0]);
    $("fa-body").innerHTML = `
      <div class="trk-row-tools"><button class="btn btn-outline btn-sm" id="fa-back">All meetings</button>
        <button class="btn btn-outline btn-sm" id="fa-to-year">Year plan</button></div>
      <div class="trk-panel"><h3>${esc(ev.title)}</h3>
        <p class="trk-muted">${fmtDate(ev.startAt)}, ${fmtTime(ev.startAt)}${ev.location ? " · " + esc(ev.location) : ""}</p></div>
      <div class="trk-chips">${UNITS.map((u) => `<button class="trk-chip ${u === unit ? "active" : ""}" data-unit="${esc(u)}">${esc(u)}${byUnit.get(u) ? " ●" : ""}</button>`).join("")}</div>
      <div id="fa-plan"></div>`;
    $("fa-back").addEventListener("click", () => { if (leaveOk()) { dirty = false; show("meetings"); } });
    $("fa-to-year").addEventListener("click", () => { if (leaveOk()) { dirty = false; show("year"); } });
    $("fa-body").querySelectorAll("[data-unit]").forEach((c) => c.addEventListener("click", () => {
      if (c.dataset.unit === unit || !leaveOk()) return;
      dirty = false;
      meetingView(eventId, c.dataset.unit);
    }));
    planEditor(ev, unit, byUnit.get(unit) || null);
  }

  function planEditor(ev, unit, plan) {
    const levels = UNIT_LEVELS[unit];
    // working rows: { kind: award|badge|study, ids?, studyId?, role?, lesson?, notes?, ... }
    const rows = [];
    if (plan) {
      const merged = [
        ...groupAwardItems(plan.items).map((it) => ({ ...it, kind: it.badgeFaith === "award" ? "award" : "badge" })),
        ...plan.studies.map((s) => ({ ...s, kind: "study" })),
      ].sort((a, b) => a.position - b.position);
      rows.push(...merged);
    }
    // award studies for this unit's levels, merged by title; linked
    // (badge) studies and retired ones are not planned here
    const awardStudies = new Map();
    for (const a of cat.awards.filter((x) => levels.includes(x.level))) {
      for (const it of a.items) {
        if (it.retired || it.linkedBadges.length) continue;
        const s = awardStudies.get(it.title) || awardStudies.set(it.title, { title: it.title, ids: [], levels: [] }).get(it.title);
        s.ids.push(it.requirementId); s.levels.push(a.level);
      }
    }
    const studies = cat.studies.filter((s) => s.active && (!s.units.length || s.units.includes(unit)));
    const body = $("fa-plan");

    const rowHtml = (r, idx) => {
      if (r.kind === "study") {
        return `<tr><td>📖 <strong>${esc(r.title)}</strong> <span class="trk-pill mut">Bible study</span>
            <div class="trk-row-tools" style="margin:0.3rem 0 0"><input type="text" data-lesson="${idx}" value="${esc(r.lesson || "")}" placeholder="Lesson / where you are (e.g. Lesson 3 — Ruth)" style="flex:1;min-width:14rem"></div></td>
          <td class="trk-muted">plan only</td>
          <td><button class="btn-link trk-danger" data-del="${idx}">remove</button></td></tr>`;
      }
      const lv = r.kind === "award" && r.levels && r.levels.length ? ` <span class="trk-pill mut">${esc(levelsLabel(r.levels))}</span>` : "";
      return `<tr><td>${itemLabel(r)}${lv}
          ${r.kind === "badge" && r.text && r.text !== r.title ? `<p class="trk-text trk-muted" style="margin:0.3rem 0 0">${esc(r.text)}</p>` : ""}</td>
        <td><select data-role="${idx}">${ROLES.map((x) => `<option value="${x}" ${r.role === x ? "selected" : ""}>${x}</option>`).join("")}</select>
          <div class="trk-muted" data-rolehelp="${idx}">${ROLE_HELP[r.role]}</div></td>
        <td><button class="btn-link trk-danger" data-del="${idx}">remove</button></td></tr>`;
    };

    const draw = () => {
      const taken = new Set(rows.flatMap((r) => r.ids || []));
      const takenStudies = new Set(rows.filter((r) => r.kind === "study").map((r) => r.studyId));
      const openAward = [...awardStudies.values()].filter((s) => !s.ids.some((id) => taken.has(id)));
      const openStudies = studies.filter((s) => !takenStudies.has(s.id));
      body.innerHTML = `<div class="trk-panel">
        <h3>${esc(unit)} faith plan</h3>
        ${rows.length ? `<div class="trk-wrap"><table class="trk-table"><thead><tr><th>Planned</th><th>Role</th><th></th></tr></thead>
          <tbody>${rows.map(rowHtml).join("")}</tbody></table></div>` : `<p class="trk-muted">Nothing planned for ${esc(unit)} at this meeting yet.</p>`}

        <h4 class="trk-yr-h4">Add a Bible study</h4>
        <div class="trk-row-tools">
          ${openStudies.length ? `<select id="fa-add-study">${openStudies.map((s) => `<option value="${s.id}">${esc(s.title)}</option>`).join("")}</select>
            <button class="btn btn-blue btn-sm" id="fa-add-study-btn">Add</button>` : `<span class="trk-muted">${studies.length ? "Every study is on this plan." : "No studies yet."}</span>`}
          <button class="btn-link" id="fa-new-study">New study…</button>
        </div>

        <h4 class="trk-yr-h4">Add a step from a Faith Award study or faith badge</h4>
        <div class="trk-row-tools"><div id="fa-add-badge"></div><select id="fa-add-req" hidden></select>
          <button class="btn btn-blue btn-sm" id="fa-add-req-btn" hidden>Add</button></div>
        <p class="trk-text trk-muted" id="fa-req-preview" style="margin:0.2rem 0 0"></p>
        <p class="trk-muted" style="margin-top:0">Finishing any one study (or faith badge) earns the Faith Award for her level.</p>

        ${openAward.length ? `<h4 class="trk-yr-h4">Add a whole Faith Award study</h4>
        <div class="trk-row-tools">
          <select id="fa-add-award">${openAward.map((s, i) => `<option value="${i}">${esc(s.title)}${levels.length > 1 ? ` (${esc(levelsLabel(s.levels))})` : ""}</option>`).join("")}</select>
          <button class="btn btn-blue btn-sm" id="fa-add-award-btn">Add</button>
        </div>
        <p class="trk-muted" style="margin-top:0">Studies the tracker has no steps for — planned as one item on the Faith Award.</p>` : ""}

        <div class="trk-row-tools" style="margin-top:1rem">
          <textarea id="fa-notes" class="trk-notes" rows="1" placeholder="Notes for whoever leads this (optional)" style="flex:1;min-width:200px">${esc(plan ? plan.notes || "" : "")}</textarea>
          <button class="btn btn-blue btn-sm" id="fa-save">Save faith plan</button>
          ${plan ? '<button class="btn btn-outline btn-sm trk-danger" id="fa-clear">Delete faith plan</button>' : ""}
        </div>
        <p class="trk-muted"><em>session</em> and <em>finish</em> propose completions for the girls who attended (confirm them on Review); <em>start</em>/<em>continue</em> record participation. Bible studies are plan-only.</p>
      </div>`;

      body.querySelectorAll("[data-role]").forEach((s) => s.addEventListener("change", () => {
        rows[Number(s.dataset.role)].role = s.value; dirty = true;
        body.querySelector(`[data-rolehelp="${s.dataset.role}"]`).textContent = ROLE_HELP[s.value];
      }));
      body.querySelectorAll("[data-lesson]").forEach((i) => i.addEventListener("input", () => { rows[Number(i.dataset.lesson)].lesson = i.value; dirty = true; }));
      body.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => { rows.splice(Number(b.dataset.del), 1); dirty = true; draw(); }));
      if ($("fa-add-study-btn")) $("fa-add-study-btn").addEventListener("click", () => {
        const s = studies.find((x) => x.id === Number($("fa-add-study").value));
        rows.push({ kind: "study", studyId: s.id, title: s.title, lesson: "" }); dirty = true; draw();
      });
      $("fa-new-study").addEventListener("click", () => { if (leaveOk()) { dirty = false; show("studies"); } });
      if ($("fa-add-award-btn")) $("fa-add-award-btn").addEventListener("click", () => {
        const s = openAward[Number($("fa-add-award").value)];
        rows.push({ kind: "award", badgeFaith: "award", ids: s.ids, levels: s.levels, title: s.title, role: "start" }); dirty = true; draw();
      });

      const reqSel = $("fa-add-req"); const reqBtn = $("fa-add-req-btn");
      let picked = null;
      combo($("fa-add-badge"), {
        items: [
          ...cat.awardStudies.filter((s) => badgeFits(s.levelGroup, unit)).map((s) => ({ value: s.badgeId, label: s.name, sub: `study · ${s.levelGroup}` })),
          ...cat.badges.filter((b) => badgeFits(b.levelGroup, unit)).map((b) => ({ value: b.badgeId, label: b.name, sub: `badge · ${b.levelGroup}` })),
        ],
        placeholder: "Study or faith badge — type to search…",
        emptyText: "No faith studies or badges for this unit",
        onChange: async (v) => {
          picked = v;
          const b = badgeCache[v] || (badgeCache[v] = await api("/badges/" + encodeURIComponent(v)));
          // grouped as printed ("Choose 3 of 7"), so the leader sees the rule
          const open = b.groups.map((g) => ({ g, reqs: g.requirements.filter((r) => !taken.has(r.trackerId)) })).filter((x) => x.reqs.length);
          reqSel.innerHTML = open.map(({ g, reqs }) => `<optgroup label="${esc(g.label || "")}">${reqs.map((r) => `<option value="${esc(r.trackerId)}">${r.number}${esc(r.letter || "")} — ${esc(r.title || "")}${(r.flags || []).includes("placeholder") ? " (to be chosen)" : ""}</option>`).join("")}</optgroup>`).join("");
          reqSel.hidden = reqBtn.hidden = !open.length;
          if (!open.length) toast(`Every step of ${b.name} is already on this plan`);
          showPreview();
        },
      });
      const showPreview = () => {
        const b = badgeCache[picked];
        const r = b && b.groups.flatMap((g) => g.requirements).find((x) => x.trackerId === reqSel.value);
        $("fa-req-preview").textContent = r && r.text && r.text !== r.title ? r.text
          : b && b.textSource === "ahgfamily" ? "Handbook wording not entered yet — AHGFamily's short titles shown."
          : b && b.about ? b.about : "";
      };
      reqSel.addEventListener("change", showPreview);
      reqBtn.addEventListener("click", () => {
        const b = badgeCache[picked];
        const r = b.groups.flatMap((g) => g.requirements).find((x) => x.trackerId === reqSel.value);
        if (!r) return;
        rows.push({ kind: "badge", ids: [r.trackerId], badgeName: b.name, number: r.number, letter: r.letter || "", title: r.title, text: r.text, role: "session" });
        dirty = true; draw();
      });

      const notesEl = $("fa-notes");
      const grow = () => { notesEl.style.height = "auto"; notesEl.style.height = notesEl.scrollHeight + 2 + "px"; };
      notesEl.addEventListener("input", () => { grow(); dirty = true; });
      grow();

      $("fa-save").addEventListener("click", async () => {
        const items = rows.flatMap((r) => (r.kind === "study"
          ? [{ studyId: r.studyId, lesson: r.lesson || undefined, notes: r.notes || undefined }]
          : r.ids.map((id) => ({ requirementId: id, role: r.role, notes: r.notes || undefined }))));
        try {
          const res = await api(`/events/${ev.id}/faith-plans/${encodeURIComponent(unit)}`, { method: "PUT", body: { notes: notesEl.value, items } });
          dirty = false;
          const p = res && res.proposals;
          toast("Faith plan saved" + (p && p.proposed ? ` — ${plural(p.proposed, "completion")} now ready to review` : ""));
          meetingView(ev.id, unit);
        } catch (e) { toast(e.message, true); }
      });
      if ($("fa-clear")) $("fa-clear").addEventListener("click", async () => {
        if (!window.confirm(`Delete the ${unit} faith plan for this meeting? (Its badge plan, if any, stays.)`)) return;
        try {
          await api(`/events/${ev.id}/faith-plans/${encodeURIComponent(unit)}`, { method: "PUT", body: { items: [] } });
          dirty = false; toast("Faith plan deleted"); meetingView(ev.id, unit);
        } catch (e) { toast(e.message, true); }
      });
    };
    draw();
  }

  // ------------------------------------------------ Faith Award ---------
  const STATUS = {
    earned: ["ok", "earned"], pending: ["warn", "waiting on Review"], ready: ["warn", "ready to record"],
    in_progress: ["mut", "under way"], not_started: ["mut", "not started"],
  };
  let awQuery = "";
  async function awardView() {
    const st = await api("/faith/awards");
    const ready = st.girls.flatMap((g) => g.awards.flatMap((a) => a.ready.map((r) => ({ g, a, r }))));
    $("fa-body").innerHTML = `
      <p class="trk-muted">One Faith Award per level — a different pin each — earned by completing any one approved study at that level.
        A finished faith badge counts: it shows here as <em>ready to record</em> until a leader records it.</p>
      <div class="trk-row-tools">${searchBox("fa-aw-q", awQuery, "Search girls…")}
        ${ready.length ? `<button class="btn btn-blue btn-sm" id="fa-aw-all">Record all ${ready.length} ready</button>` : ""}</div>
      <div id="fa-aw-results"></div>`;
    const render = () => {
      $("fa-aw-results").innerHTML = UNITS.map((u) => {
        const girls = st.girls.filter((g) => g.unit === u && matches(awQuery, g.firstName, g.lastName, g.nickname || "", g.ahgLevel));
        if (!girls.length) return "";
        return `<div class="trk-panel"><h3>${esc(u)}</h3><div class="trk-wrap"><table class="trk-table">
          <thead><tr><th>Girl</th><th>This level's award</th><th>Earlier levels</th></tr></thead>
          <tbody>${girls.map((g) => {
            const cur = g.awards.find((a) => a.level === g.ahgLevel);
            const earlier = g.awards.filter((a) => a.level !== g.ahgLevel);
            return `<tr><td><strong>${esc(g.firstName)} ${esc(g.lastName)}</strong> <span class="trk-pill mut">${esc(g.ahgLevel)}</span></td>
              <td>${cur ? awardCell(g, cur) : '<span class="trk-muted">award not imported</span>'}</td>
              <td>${earlier.map((a) => `<span class="trk-pill ${a.status === "earned" ? "ok" : "mut"}" title="${esc(a.status === "earned" ? [...a.earned.map((x) => x.title), ...(a.offline || []).map((x) => x.viaBadgeName)].join(", ") : STATUS[a.status][1])}">${esc(a.level)} ${a.status === "earned" ? "✓" : "—"}</span>`).join(" ") || '<span class="trk-muted">—</span>'}</td></tr>`;
          }).join("")}</tbody></table></div></div>`;
      }).join("") || '<p class="trk-muted">No girls match.</p>';
      $("fa-aw-results").querySelectorAll("[data-record]").forEach((b) => b.addEventListener("click", () => record([JSON.parse(b.dataset.record)])));
    };
    function awardCell(g, a) {
      const [cls, label] = STATUS[a.status];
      const lines = [];
      for (const e of a.earned) lines.push(`${esc(e.title)} <span class="trk-muted">${fmtDate(e.completedOn)}${e.source === "ahgfamily" ? " · from AHGFamily" : ""}</span>`);
      for (const p of a.pending) lines.push(`${esc(p.title)} <span class="trk-muted">proposed — confirm on <a href="leaders-review.html">Review</a></span>`);
      for (const o of a.offline || []) lines.push(`${esc(o.viaBadgeName)} study finished ${fmtDate(o.completedOn)} <span class="trk-pill warn" title="AHGFamily doesn't list this study on its Faith Award yet">mark on AHGFamily by hand</span>`);
      for (const r of a.ready) lines.push(`${esc(r.viaBadgeName)} ${r.viaKind === "study" ? "study" : "badge"} finished ${fmtDate(r.completedOn)} <button class="btn btn-blue btn-sm" data-record='${esc(JSON.stringify({ girlId: g.girlId, requirementId: r.requirementId }))}'>Record</button>`);
      if (a.status === "in_progress") for (const u of a.underway) lines.push(`${esc(u.viaBadgeName)} ${u.viaKind === "study" ? "study" : "badge"} — ${plural(u.confirmedCount, u.viaKind === "study" ? "step" : "requirement")} done`);
      return `<span class="trk-pill ${cls}">${esc(label)}</span>${lines.map((l) => `<div>${l}</div>`).join("")}`;
    }
    async function record(rows) {
      try {
        const r = await api("/faith/awards/record", { body: rows });
        toast(`Recorded ${plural(r.recorded.length, "Faith Award")}`);
        show("award");
      } catch (e) { toast(e.message, true); }
    }
    $("fa-aw-q").addEventListener("input", (e) => { awQuery = e.target.value; render(); });
    if ($("fa-aw-all")) $("fa-aw-all").addEventListener("click", () => {
      if (!window.confirm(`Record the Faith Award for ${plural(ready.length, "girl")} whose faith badge is finished?`)) return;
      // one item per girl per level is enough — the award needs one study
      const seen = new Set();
      record(ready.filter(({ g, a }) => { const k = `${g.girlId}|${a.level}`; if (seen.has(k)) return false; seen.add(k); return true; })
        .map(({ g, r }) => ({ girlId: g.girlId, requirementId: r.requirementId })));
    });
    render();
  }

  // ------------------------------------------------ studies -------------
  async function studiesView() {
    const list = await api("/faith/studies?all=1");
    const unitBoxes = (prefix, chosen) => UNITS.map((u) => `<label style="margin-right:0.8rem"><input type="checkbox" data-${prefix}="${esc(u)}"${chosen.includes(u) ? " checked" : ""}> ${esc(u)}</label>`).join("");
    $("fa-body").innerHTML = `
      <div class="trk-panel"><h3>New Bible study</h3>
        <p class="trk-muted">A study the unit works through that isn't a badge or a Faith Award study. It's planned meeting by meeting with the lesson, so a substitute knows where to pick up.</p>
        <div class="trk-row-tools"><input type="text" id="fa-st-title" placeholder="Title (e.g. Psalms for Girls)" style="flex:1;min-width:14rem"></div>
        <div class="trk-row-tools"><textarea id="fa-st-desc" class="trk-notes" rows="2" placeholder="Book, leader guide, where the materials are… (optional)" style="flex:1"></textarea></div>
        <div class="trk-row-tools"><span class="trk-muted">Units:</span> ${unitBoxes("new", [])}<span class="trk-muted">(none ticked = every unit)</span></div>
        <button class="btn btn-blue btn-sm" id="fa-st-add">Add study</button>
      </div>
      <div class="trk-panel"><h3>Studies</h3>
        ${list.length ? list.map((s) => `<div class="trk-req" data-st="${s.id}">
          <div class="trk-row-tools" style="margin:0"><input type="text" data-f="title" value="${esc(s.title)}" style="flex:1;min-width:12rem">
            ${s.active ? "" : '<span class="trk-pill mut">retired</span>'}</div>
          <div class="trk-row-tools" style="margin:0.3rem 0"><textarea data-f="description" class="trk-notes" rows="1" style="flex:1" placeholder="Description">${esc(s.description || "")}</textarea></div>
          <div class="trk-row-tools" style="margin:0">${unitBoxes(`u${s.id}`, s.units)}
            <button class="btn btn-outline btn-sm" data-save="${s.id}">Save</button>
            <button class="btn-link${s.active ? " trk-danger" : ""}" data-active="${s.id}" data-to="${s.active ? "0" : "1"}">${s.active ? "Retire" : "Restore"}</button></div>
        </div>`).join("") : '<p class="trk-muted">No studies yet.</p>'}
      </div>`;
    const unitsOf = (prefix) => [...$("fa-body").querySelectorAll(`[data-${prefix}]`)].filter((c) => c.checked).map((c) => c.getAttribute(`data-${prefix}`));
    $("fa-st-add").addEventListener("click", async () => {
      try {
        await api("/faith/studies", { body: { title: $("fa-st-title").value, description: $("fa-st-desc").value, units: unitsOf("new") } });
        toast("Study added");
        cat = await api("/faith");
        show("studies");
      } catch (e) { toast(e.message, true); }
    });
    const patch = async (id, body, msg) => {
      try {
        await api("/faith/studies/" + id, { method: "PATCH", body });
        toast(msg);
        cat = await api("/faith");
        show("studies");
      } catch (e) { toast(e.message, true); }
    };
    $("fa-body").querySelectorAll("[data-save]").forEach((b) => b.addEventListener("click", () => {
      const row = b.closest("[data-st]");
      patch(b.dataset.save, { title: row.querySelector('[data-f="title"]').value, description: row.querySelector('[data-f="description"]').value, units: unitsOf(`u${b.dataset.save}`) }, "Study saved");
    }));
    $("fa-body").querySelectorAll("[data-active]").forEach((b) => b.addEventListener("click", () => {
      patch(b.dataset.active, { active: b.dataset.to === "1" }, b.dataset.to === "1" ? "Study restored" : "Study retired — it stays on the meetings that used it");
    }));
  }

  // ------------------------------------------------ what counts ---------
  let showRetired = false;
  const LEVEL_ORDER = ["All", "Tenderheart", "Explorer", "Pioneer/Patriot", "Pioneer", "Patriot"];
  /** name → that study's levels, youngest first */
  function studyGroups() {
    const m = new Map();
    for (const s of cat.awardStudies) (m.get(s.name) || m.set(s.name, []).get(s.name)).push(s);
    for (const list of m.values()) list.sort((a, z) => LEVEL_ORDER.indexOf(a.levelGroup) - LEVEL_ORDER.indexOf(z.levelGroup));
    return m;
  }
  async function countsView() {
    const body = $("fa-body");
    const byName = new Map();
    for (const b of cat.badges) (byName.get(b.name) || byName.set(b.name, []).get(b.name)).push(b);
    body.innerHTML = `
      <p class="trk-muted">The approved studies for each level's Faith Award, as AHGFamily lists them (the handbooks don't print them). Any one completes the award.
        <label class="trk-sort"><input type="checkbox" id="fa-ct-ret"${showRetired ? " checked" : ""}> Show retired studies</label></p>
      <div class="trk-cards">${cat.awards.map((a) => `<div class="trk-card" style="cursor:default">
        <h3>${esc(a.level)}</h3>
        <ol style="margin:0.3rem 0 0 1.1rem;padding:0">${a.items.filter((i) => showRetired || !i.retired).map((i) => `<li${i.retired ? ' class="trk-muted"' : ""}>${esc(i.title)}
          ${[...new Set(i.linkedBadges.map((l) => l.kind))].map((k) => `<span class="trk-pill ok" title="${k === "study" ? "Planned and tracked step by step on this page" : "Earning the badge completes this study"}">${k === "study" ? "steps" : "badge"}</span>`).join(" ")}</li>`).join("")}</ol>
        ${cat.awardStudies.filter((s) => !s.awardItem && (s.levelGroup === a.level || s.levelGroup === "All" || (s.levelGroup === "Pioneer/Patriot" && (a.level === "Pioneer" || a.level === "Patriot")))).map((s) => `<div class="trk-muted" style="margin-top:0.3rem">+ ${esc(s.name)} <span class="trk-pill warn" title="Approved in the 2026 Faith Award guide but not on AHGFamily's list yet — record the award there by hand">not on AHGFamily</span></div>`).join("")}
      </div>`).join("")}</div>
      ${cat.missing.length ? `<p class="trk-muted">Not imported yet: ${cat.missing.map(esc).join(", ")}.</p>` : ""}
      <div class="trk-panel" style="margin-top:1rem"><h3>Faith Award studies, step by step</h3>
        <p class="trk-muted">Each study broken into steps per level from AHG's Faith Award Program Guide, so a unit plans it like a badge. Steps marked <span class="trk-pill warn">to be chosen</span> are slots for activities the guide leaves to the leader (the choices are in the study's own materials) — rename them once chosen.</p>
        ${cat.awardStudies.length ? `<div class="trk-wrap"><table class="trk-table"><thead><tr><th>Study</th><th>Levels — steps</th></tr></thead>
          <tbody>${[...studyGroups()].map(([name, list]) => `<tr><td style="min-width:14rem"><strong>${esc(name)}</strong>
              <div class="trk-muted">${list[0].awardItem ? `On AHGFamily as “${esc(list[0].awardItem)}”` : '<span class="trk-pill warn">not on AHGFamily — record by hand</span>'}</div>
              ${list[0].about ? `<div class="trk-muted" style="margin-top:0.2rem">${esc(list[0].about)}</div>` : ""}</td>
            <td>${list.map((s) => `<div style="margin:0.15rem 0"><button class="btn-link" data-steps="${esc(s.badgeId)}">${esc(s.levelGroup)}</button>
              <span class="trk-muted">${plural(s.stepCount, "step")}</span>${s.placeholders ? ` <span class="trk-pill warn">${s.placeholders} to be chosen</span>` : ""}</div>`).join("")}</td></tr>
            ${list.map((s) => `<tr hidden data-steps-row="${esc(s.badgeId)}"><td colspan="2"><h4 class="trk-yr-h4">${esc(name)} — ${esc(s.levelGroup)}</h4></td></tr>`).join("")}`).join("")}</tbody></table></div>`
          : '<p class="trk-muted">No study steps loaded yet. An admin loads them from the tracker\'s <code>data/faith-studies/</code>.</p>'}
        <div class="trk-row-tools"><button class="btn btn-outline btn-sm" id="fa-load-studies" title="Admins: add any studies in data/faith-studies/ that aren't loaded yet (loaded ones are never changed)">Load study steps</button></div>
      </div>
      <div class="trk-panel" style="margin-top:1rem"><h3>Faith badges</h3>
        <p class="trk-muted">Handbook badges tagged as faith badges. The ones marked <span class="trk-pill ok">counts</span> are on the Faith Award list. <em>Short titles</em> means the handbook wording hasn't been entered yet — the tracker shows AHGFamily's short titles until it is.</p>
        <div class="trk-wrap"><table class="trk-table"><thead><tr><th>Badge</th><th>Levels</th><th>Faith Award</th><th>Text</th></tr></thead>
          <tbody>${[...byName].map(([name, list]) => {
            const counts = cat.awards.some((a) => a.items.some((i) => i.linkedBadges.some((l) => l.name === name)));
            const order = ["Tenderheart", "Explorer", "Pioneer/Patriot", "Pioneer", "Patriot", "All"];
            const lv = list.map((b) => b.levelGroup).sort((a, z) => order.indexOf(a) - order.indexOf(z));
            return `<tr><td><strong>${esc(name)}</strong></td><td>${lv.map(esc).join(", ")}</td>
              <td>${counts ? '<span class="trk-pill ok">counts</span>' : '<span class="trk-muted">—</span>'}</td>
              <td>${list.every((b) => b.textSource === "handbook") ? "handbook" : list.some((b) => b.textSource === "handbook") ? "some levels entered" : '<span class="trk-pill warn">short titles</span>'}</td></tr>`;
          }).join("")}</tbody></table></div></div>`;
    $("fa-ct-ret").addEventListener("change", (e) => { showRetired = e.target.checked; countsView(); });
    $("fa-load-studies").addEventListener("click", async () => {
      try {
        const r = await api("/admin/faith/studies/import", { body: {} });
        toast(`${plural(r.added.length, "study level")} added; ${r.kept.length} already loaded`);
        cat = await api("/faith");
        countsView();
      } catch (e) { toast(e.status === 403 ? "Only an admin can load study steps" : e.message, true); }
    });
    body.querySelectorAll("[data-steps]").forEach((btn) => btn.addEventListener("click", () => stepEditor(btn.dataset.steps)));
  }

  // Rename a study's steps — chiefly the "to be chosen" slots, once the unit
  // picks its activities. Study steps only; badge wording comes from the
  // handbook build.
  async function stepEditor(badgeId) {
    const row = document.querySelector(`[data-steps-row="${CSS.escape(badgeId)}"]`);
    if (!row.hidden) { row.hidden = true; return; }
    const b = await api("/badges/" + encodeURIComponent(badgeId));
    badgeCache[badgeId] = b;
    row.hidden = false;
    row.firstElementChild.innerHTML = `<h4 class="trk-yr-h4">${esc(b.name)} — ${esc(b.levelGroup)}</h4>` + b.groups.map((g) => `<div style="margin:0.3rem 0 0.6rem"><strong>${esc(g.label || "")}</strong>
      ${g.requirements.map((r) => `<div class="trk-row-tools" style="margin:0.2rem 0">
        <span class="trk-num">${r.number}</span>
        <input type="text" data-step="${esc(r.trackerId)}" value="${esc(r.title)}" style="flex:1;min-width:12rem">
        ${(r.flags || []).includes("placeholder") ? '<span class="trk-pill warn">to be chosen</span>' : ""}
        <button class="btn btn-outline btn-sm" data-step-save="${esc(r.trackerId)}">Save</button></div>`).join("")}</div>`).join("");
    row.querySelectorAll("[data-step-save]").forEach((s) => s.addEventListener("click", async () => {
      const id = s.dataset.stepSave;
      const title = row.querySelector(`[data-step="${CSS.escape(id)}"]`).value;
      try {
        await api("/faith/steps/" + encodeURIComponent(id), { method: "PATCH", body: { title } });
        toast("Step renamed");
        delete badgeCache[badgeId];
        cat = await api("/faith");
        const open = badgeId;
        await countsView();
        stepEditor(open);
      } catch (e) { toast(e.message, true); }
    }));
  }

  init(async () => {
    cat = await api("/faith");
    await show("year");
  });
})();
