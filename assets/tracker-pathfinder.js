// ============================================================
//  Pathfinder (leaders area): the Pathfinder unit's own planner
//  and tracker. Pathfinders earn no badges — their year is six
//  stepping stones, planned meeting by meeting the way the Unit
//  Leader Guide's meeting planner lays a meeting out, plus their
//  necklace beads (blue attendance, red memory-verse hearts,
//  white service stars, a logo bead per stepping stone) and the
//  Fanny Crosby and Joining Awards. All data lives in the
//  tracker on the Pi; the guide's wording comes from there too.
// ============================================================
(function () {
  "use strict";
  const { init, api, esc, toast, fmtDate, fmtTime, $, matches, searchBox, byText } = window.Tracker;
  const root = () => $("pg-pathfinder");

  const VIEWS = [
    { key: "year", label: "Year plan" },
    { key: "meetings", label: "Meetings" },
    { key: "verses", label: "Memory verses" },
    { key: "tracker", label: "Beads & awards" },
    { key: "settings", label: "Settings" },
  ];
  const SLOTS = [
    { key: "intro", label: "Introduction" },
    { key: "activity", label: "Activity" },
    { key: "optional", label: "Optional activity" },
    { key: "closing", label: "Closing" },
  ];
  const slotLabel = (k) => (SLOTS.find((s) => s.key === k) || {}).label || k;
  const KIND_LABEL = { attendance: "attendance bead", verse: "memory-verse heart", service: "service star", stone: "stepping-stone bead" };

  let prog = null; // GET /pathfinder — stones, awards, settings
  let me = null;
  let view = "year";
  let dirty = false;

  const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  // program year: September 1 – August 31
  const yearStart = (offset) => { const n = new Date(); const y = (n.getMonth() >= 8 ? n.getFullYear() : n.getFullYear() - 1) + offset; return [new Date(y, 8, 1), new Date(y + 1, 7, 31)]; };
  let yearOffset = 0;
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const girlName = (g) => `${g.nickname || g.firstName} ${g.lastName}`;
  const stone = (n) => (prog ? prog.stones.find((s) => s.number === Number(n)) : null);
  const stoneLabel = (n) => { const s = stone(n); return s ? `Stepping Stone ${s.number} — ${s.name}` : `Stepping Stone ${n}`; };

  // ---------- bead icons (screen and print) ----------
  // red heart: memory verse · blue dot: attendance · white star, dark
  // outline: service · the round AHG logo: a stepping-stone bead
  const ICON = {
    verse: '<svg class="pf-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.9 4.5 6.6 4.5c2.2 0 3.6 1.2 4.4 2.5.8-1.3 2.2-2.5 4.4-2.5 3.7 0 5.7 3.9 4.2 7.3C19.5 16.4 12 21 12 21z" fill="#d42a3c" stroke="#8e1424" stroke-width="1"/></svg>',
    attendance: '<svg class="pf-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="#1d5fc4" stroke="#0b3a80" stroke-width="1.2"/><circle cx="9" cy="9" r="2.2" fill="#fff" opacity=".45"/></svg>',
    service: '<svg class="pf-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" fill="#fff" stroke="#1f2733" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    stone: '<img class="pf-ico pf-ico-logo" src="assets/img/favicon/favicon-96x96.png" alt="" aria-hidden="true">',
  };
  const iconCount = (kind, n, title) => `<span class="pf-count" title="${esc(title || KIND_LABEL[kind])}">${ICON[kind]}<strong>${n}</strong></span>`;

  const leaveOk = () => !dirty || window.confirm("You have unsaved changes to this Pathfinder plan. Leave without saving?");
  window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

  function shell(active) {
    root().innerHTML = `
      <div class="trk-chips">${VIEWS.map((v) => `<button class="trk-chip ${active === v.key ? "active" : ""}" data-view="${v.key}">${v.label}</button>`).join("")}</div>
      ${prog && !prog.fannyCrosby.badgeId ? `<div class="placeholder-note">The Fanny Crosby and Joining Awards aren't in the tracker yet. On the tracker: <code>npm run build:badges</code>, copy <code>data/badges/</code> to the Pi, then Admin → Re-import.</div>` : ""}
      <div id="pf-body"></div>`;
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
      else if (v === "meetings") await (arg ? meetingView(arg.eventId) : meetingsList());
      else if (v === "verses") await versesView();
      else if (v === "tracker") await trackerView();
      else await settingsView();
    } catch (e) { toast(e.message, true); }
  }

  // ------------------------------------------------ shared plan text ----
  const reqLabel = (r) => (r ? `${r.badgeName === "Fanny Crosby Level Award" ? "Fanny Crosby" : r.badgeName === "AHG Joining Award" ? "Joining Award" : esc(r.badgeName)} ${r.number}${esc(r.letter || "")} — ${esc(r.title || "")}` : "");
  const planStones = (plan) => [...new Set(plan.parts.map((p) => p.stone).filter(Boolean).concat(plan.finishesStones))].sort();
  function planSummaryHtml(plan) {
    const tags = [];
    if (plan.kind === "service") tags.push(`${ICON.service} Service project${plan.serviceProject ? ": " + esc(plan.serviceProject) : ""}`);
    for (const n of plan.finishesStones) tags.push(`${ICON.stone} finishes ${esc(stoneLabel(n))}`);
    for (const v of plan.verses || []) tags.push(`${ICON.verse} ${esc(v.verse)}${v.stone ? ` (SS ${v.stone})` : ""}`);
    return `${tags.length ? `<div class="pf-tags">${tags.map((t) => `<span class="pf-tag">${t}</span>`).join("")}</div>` : ""}
      ${plan.parts.map((p) => `<div class="pf-part-line"><span class="trk-muted">${esc(slotLabel(p.slot))}${p.stone ? " · SS" + p.stone : ""}:</span>
        ${p.what ? esc(p.what) : '<span class="trk-muted">—</span>'}${p.requirement ? ` <span class="trk-pill mut">${reqLabel(p.requirement)}</span>` : ""}</div>`).join("")}
      ${plan.notes ? `<div class="trk-text trk-muted">${esc(plan.notes)}</div>` : ""}`;
  }

  // ------------------------------------------------ year plan -----------
  async function yearView() {
    const [f, t] = yearStart(yearOffset);
    const rows = await api(`/pathfinder/plans?from=${isoDay(f)}&to=${isoDay(t)}`);
    const nowIso = new Date().toISOString();
    const nextIdx = rows.findIndex((r) => (r.event.endAt || r.event.startAt) > nowIso);
    const covered = new Set(rows.flatMap((r) => planStones(r.plan)));
    const finished = new Set(rows.flatMap((r) => r.plan.finishesStones));
    $("pf-body").innerHTML = `
      <div class="trk-row-tools">
        <button class="btn btn-outline btn-sm" id="pf-yr-prev">&larr; Earlier year</button>
        <strong>${f.getFullYear()}–${t.getFullYear()} program year</strong>
        <button class="btn btn-outline btn-sm" id="pf-yr-next">Later year &rarr;</button>
        <button class="btn btn-outline btn-sm" id="pf-yr-print" title="Print the whole year's Pathfinder plan (or save it as a PDF)">Print the year</button>
      </div>
      <div class="trk-panel"><h3>Stepping stones this year</h3>
        <div class="pf-stones">${prog.stones.map((s) => `<div class="pf-stone ${finished.has(s.number) ? "done" : covered.has(s.number) ? "planned" : ""}">
          <div class="pf-stone-n">${ICON.stone} ${s.number}</div><div><strong>${esc(s.name)}</strong>
          <div class="trk-muted">${finished.has(s.number) ? "finish planned" : covered.has(s.number) ? "under way" : "not planned yet"} · ${esc(s.verse)}</div></div></div>`).join("")}</div></div>
      <p class="trk-muted">Every meeting with a Pathfinder plan, in order. Click a date to change its plan.</p>
      ${rows.length ? `<div class="trk-wrap"><table class="trk-table">
        <thead><tr><th>When</th><th>Stepping stone</th><th>Plan</th></tr></thead>
        <tbody>${rows.map((r, i) => {
          const past = (r.event.endAt || r.event.startAt) <= nowIso;
          return `<tr${past ? ' class="trk-muted"' : ""}>
          <td style="white-space:nowrap"><a href="#" data-ev="${r.event.id}">${fmtDate(r.event.startAt)}</a><div class="trk-muted">${esc(r.event.title)}</div>
            ${i === nextIdx ? '<span class="trk-pill warn">next up</span>' : past ? '<span class="trk-pill mut">held</span>' : ""}
            <div><button class="btn-link" data-print-ev="${r.event.id}" title="Print this meeting's plan (or save it as a PDF)">Print</button></div></td>
          <td>${planStones(r.plan).map((n) => `<div>${esc(stoneLabel(n))}</div>`).join("") || '<span class="trk-muted">—</span>'}</td>
          <td>${planSummaryHtml(r.plan)}</td></tr>`;
        }).join("")}</tbody></table></div>` : '<p class="trk-muted">Nothing planned for this program year yet — pick a meeting under <strong>Meetings</strong>.</p>'}`;
    $("pf-yr-prev").addEventListener("click", () => { yearOffset -= 1; show("year"); });
    $("pf-yr-next").addEventListener("click", () => { yearOffset += 1; show("year"); });
    $("pf-yr-print").addEventListener("click", () => printYear(rows, f, t));
    $("pf-body").querySelectorAll("a[data-ev]").forEach((a) => a.addEventListener("click", (ev) => { ev.preventDefault(); show("meetings", { eventId: Number(a.dataset.ev) }); }));
    $("pf-body").querySelectorAll("[data-print-ev]").forEach((b) => b.addEventListener("click", () => printMeeting(Number(b.dataset.printEv))));
  }

  // ------------------------------------------------ printing ------------
  const PRINT_ICON = { service: ICON.service.replace('class="pf-ico"', 'style="width:11pt;height:11pt;vertical-align:-2pt"'), verse: ICON.verse.replace('class="pf-ico"', 'style="width:11pt;height:11pt;vertical-align:-2pt"'), stone: '<span style="display:inline-block;width:10pt;height:10pt;border-radius:50%;border:1pt solid #333;vertical-align:-1pt"></span>' };
  function stoneOutlineHtml(n) {
    const s = stone(n);
    if (!s) return "";
    return `<div class="section"><h3>${esc(stoneLabel(n))}</h3>
      ${s.goal ? `<p class="text"><strong>Goal:</strong> ${esc(s.goal)}</p>` : ""}
      ${s.objectives.length ? `<p class="text"><strong>Main objectives</strong></p><ul class="text">${s.objectives.map((o) => `<li>${esc(o)}</li>`).join("")}</ul>` : ""}
      <p class="text"><strong>Memory verse:</strong> ${esc(s.verse)}${s.verseText ? ` — “${esc(s.verseText)}”` : ""}</p></div>`;
  }
  function meetingPrintHtml(ev, plan, { outlines = true } = {}) {
    const stonesHere = planStones(plan);
    const head = [];
    if (stonesHere.length) head.push(stonesHere.map((n) => esc(stoneLabel(n))).join(", "));
    if (plan.kind === "service") head.push(`${PRINT_ICON.service} Service project${plan.serviceProject ? ": " + esc(plan.serviceProject) : ""} — every Pathfinder there earns a white star`);
    for (const n of plan.finishesStones) head.push(`${PRINT_ICON.stone} Finishes Stepping Stone ${n} — hand out the logo bead`);
    if ((plan.verses || []).length) head.push(`${PRINT_ICON.verse} Memory verse${plan.verses.length > 1 ? "s" : ""}: ${plan.verses.map((v) => esc(v.verse)).join("; ")} — every Pathfinder there earns the heart`);
    return `<div class="section">
      <h2>${fmtDate(ev.startAt)} — ${esc(ev.title)}</h2>
      <p class="meta">${fmtTime(ev.startAt)}${ev.endAt ? "–" + fmtTime(ev.endAt) : ""}${ev.location ? " · " + esc(ev.location) : ""}</p>
      ${head.map((h) => `<p class="meta">${h}</p>`).join("")}
      ${plan.parts.length ? `<table><thead><tr><th style="width:16%">Part</th><th>What &amp; how</th><th style="width:24%">Resources &amp; supplies</th><th style="width:14%">Who</th></tr></thead><tbody>
        ${plan.parts.map((p) => `<tr><td class="num">${esc(slotLabel(p.slot))}${p.stone ? `<div class="muted" style="font-weight:normal">SS ${p.stone}</div>` : ""}</td>
          <td>${p.what ? esc(p.what) : '<span class="muted">—</span>'}${p.requirement ? `<p class="text"><em>${reqLabel(p.requirement)}</em></p>` : ""}</td>
          <td>${esc(p.supplies || "")}</td><td>${esc(p.who || "")}</td></tr>`).join("")}</tbody></table>` : '<p class="muted">No parts planned.</p>'}
      ${plan.notes ? `<p class="text"><strong>Comments</strong></p><div class="notes">${esc(plan.notes)}</div>` : ""}
      ${outlines ? stonesHere.map(stoneOutlineHtml).join("") : ""}</div>`;
  }
  async function printMeeting(eventId) {
    try {
      const [ev, plan] = await Promise.all([api("/events/" + eventId), api(`/events/${eventId}/pathfinder-plan`)]);
      if (!plan) { toast("No Pathfinder plan saved for this meeting yet", true); return; }
      if (dirty) toast("Printing the SAVED plan — your unsaved changes are not included", true);
      window.Tracker.printPage(`${ev.title} — Pathfinder plan`, `<h1>Pathfinder meeting plan</h1>${meetingPrintHtml(ev, plan)}`);
    } catch (e) { toast(e.message, true); }
  }
  // The year: a year-at-a-glance table (like the guide's calendar), then
  // every meeting's full plan, then the stepping-stone outlines once each.
  function printYear(rows, f, t) {
    if (!rows.length) { toast("Nothing planned for this program year yet", true); return; }
    const glance = `<table><thead><tr><th style="width:13%">Date</th><th style="width:22%">Stepping stone</th><th>Activities</th><th style="width:22%">Notes</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td class="num">${fmtDate(r.event.startAt)}<div class="muted" style="font-weight:normal">${esc(r.event.title)}</div></td>
        <td>${planStones(r.plan).map((n) => `${n} — ${esc((stone(n) || {}).name || "")}`).join("<br>") || '<span class="muted">—</span>'}${r.plan.finishesStones.length ? `<div class="muted">finishes ${r.plan.finishesStones.join(", ")}</div>` : ""}${(r.plan.verses || []).map((v) => `<div>${PRINT_ICON.verse} ${esc(v.verse)}</div>`).join("")}</td>
        <td>${r.plan.kind === "service" ? `<div>${PRINT_ICON.service} <strong>Service project</strong>${r.plan.serviceProject ? ": " + esc(r.plan.serviceProject) : ""}</div>` : ""}
          ${r.plan.parts.filter((p) => p.what || p.requirement).map((p) => `<div>${esc(slotLabel(p.slot))}: ${esc(p.what || "")}${p.requirement ? ` <em>(${reqLabel(p.requirement)})</em>` : ""}</div>`).join("")}</td>
        <td>${esc(r.plan.notes || "")}</td></tr>`).join("")}</tbody></table>`;
    const used = [...new Set(rows.flatMap((r) => planStones(r.plan)))].sort();
    window.Tracker.printPage(`Pathfinder plan ${f.getFullYear()}–${t.getFullYear()}`, `<h1>Pathfinder plan</h1>
      <p class="meta">${f.getFullYear()}–${t.getFullYear()} program year · ${plural(rows.length, "meeting")}</p>
      <h2>Year at a glance</h2>${glance}
      ${rows.map((r) => meetingPrintHtml(r.event, r.plan, { outlines: false })).join("")}
      ${used.length ? `<h2>Stepping stones</h2>${used.map(stoneOutlineHtml).join("")}` : ""}`);
  }

  // ------------------------------------------------ meetings ------------
  let mtgQuery = "";
  let mtgRange = { from: addDays(new Date(), -14), to: addDays(new Date(), 90) };
  async function meetingsList() {
    const from = isoDay(mtgRange.from);
    const to = isoDay(mtgRange.to);
    const events = await api(`/events?from=${from}&to=${to}`);
    const spanDays = Math.round((mtgRange.to - mtgRange.from) / 864e5);
    $("pf-body").innerHTML = `
      <div class="trk-row-tools">
        <button class="btn btn-outline btn-sm" id="pf-ev-prev" title="Back ${spanDays + 1} days">&larr; Earlier</button>
        <strong>${fmtDate(from)} – ${fmtDate(to)}</strong>
        <button class="btn btn-outline btn-sm" id="pf-ev-next" title="Forward ${spanDays + 1} days">Later &rarr;</button>
        <span class="trk-muted">·</span>
        <input type="date" id="pf-ev-from" value="${from}" aria-label="From"><span class="trk-muted">to</span>
        <input type="date" id="pf-ev-to" value="${to}" aria-label="To">
        <button class="btn btn-outline btn-sm" id="pf-ev-apply">Apply</button>
        ${searchBox("pf-ev-q", mtgQuery, "Search meetings…")}
      </div>
      <p class="trk-muted">Pick a meeting to plan the Pathfinders' part of it: a piece of a stepping stone, an activity or two, or a whole-meeting service project.</p>
      <div id="pf-ev-results"></div>`;
    const render = () => {
      const shown = events.filter((e) => !e.removedFromFeed && matches(mtgQuery, e.title, e.location || "", fmtDate(e.startAt)));
      $("pf-ev-results").innerHTML = shown.length ? `<div class="trk-wrap"><table class="trk-table">
        <thead><tr><th>When</th><th>Meeting</th><th>Pathfinder plan</th></tr></thead>
        <tbody>${shown.map((e) => `<tr>
          <td style="white-space:nowrap">${fmtDate(e.startAt)}<div class="trk-muted">${fmtTime(e.startAt)}</div></td>
          <td><a href="#" data-ev="${e.id}"><strong>${esc(e.title)}</strong></a>${e.location ? `<div class="trk-muted">${esc(e.location)}</div>` : ""}</td>
          <td>${e.pathfinderPlan ? `<span class="trk-pill ok">planned</span> <button class="btn-link" data-print-ev="${e.id}" title="Print this meeting's plan (or save it as a PDF)">Print</button>` : '<span class="trk-muted">—</span>'}</td>
        </tr>`).join("")}</tbody></table></div>` : '<p class="trk-muted">No meetings in this range.</p>';
      $("pf-ev-results").querySelectorAll("a[data-ev]").forEach((a) => a.addEventListener("click", (ev) => { ev.preventDefault(); show("meetings", { eventId: Number(a.dataset.ev) }); }));
      $("pf-ev-results").querySelectorAll("[data-print-ev]").forEach((b) => b.addEventListener("click", () => printMeeting(Number(b.dataset.printEv))));
    };
    $("pf-ev-q").addEventListener("input", (e) => { mtgQuery = e.target.value; render(); });
    const shift = (dir) => {
      const step = (spanDays + 1) * dir;
      mtgRange = { from: addDays(mtgRange.from, step), to: addDays(mtgRange.to, step) };
      show("meetings");
    };
    $("pf-ev-prev").addEventListener("click", () => shift(-1));
    $("pf-ev-next").addEventListener("click", () => shift(1));
    $("pf-ev-apply").addEventListener("click", () => {
      const f = $("pf-ev-from").value; const t = $("pf-ev-to").value;
      if (!f || !t || f > t) { toast("Pick a start date before the end date"); return; }
      mtgRange = { from: new Date(f + "T12:00:00"), to: new Date(t + "T12:00:00") };
      show("meetings");
    });
    render();
  }

  const NEIGHBOUR_DAYS = 180;
  async function neighbours(ev) {
    const day = new Date(ev.startAt);
    const list = (await api(`/events?from=${isoDay(addDays(day, -NEIGHBOUR_DAYS))}&to=${isoDay(addDays(day, NEIGHBOUR_DAYS))}`))
      .filter((e) => e.id === ev.id || !e.removedFromFeed)
      .sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id - b.id);
    const i = list.findIndex((e) => e.id === ev.id);
    return i < 0 ? { prev: null, next: null } : { prev: list[i - 1] || null, next: list[i + 1] || null };
  }
  const navBtn = (e, dir) => (e
    ? `<button class="btn btn-outline btn-sm" id="pf-nav-${dir}" title="${esc(`${e.title} — ${fmtDate(e.startAt)}`)}">${dir === "prev" ? `&larr; ${fmtDate(e.startAt)}` : `${fmtDate(e.startAt)} &rarr;`}</button>`
    : `<button class="btn btn-outline btn-sm" disabled>${dir === "prev" ? "&larr; Previous" : "Next &rarr;"}</button>`);

  async function meetingView(eventId) {
    const [ev, plan] = await Promise.all([api("/events/" + eventId), api(`/events/${eventId}/pathfinder-plan`)]);
    const nb = await neighbours(ev).catch(() => ({ prev: null, next: null }));
    $("pf-body").innerHTML = `
      <div class="trk-row-tools trk-ev-nav">
        <span style="display:inline-flex;gap:0.5rem"><button class="btn btn-outline btn-sm" id="pf-back">All meetings</button>
          <button class="btn btn-outline btn-sm" id="pf-to-year">Year plan</button></span>
        <span class="trk-ev-nav-step">${navBtn(nb.prev, "prev")}${navBtn(nb.next, "next")}</span>
        <button class="btn btn-outline btn-sm" id="pf-print"${plan ? ' title="Print this plan (or save it as a PDF)"' : ' disabled title="Save a plan first"'}>Print</button>
      </div>
      <div class="trk-panel"><h3>${esc(ev.title)}</h3>
        <p class="trk-muted">${fmtDate(ev.startAt)}, ${fmtTime(ev.startAt)}${ev.location ? " · " + esc(ev.location) : ""}</p></div>
      <div id="pf-plan"></div>`;
    const go = (id) => { if (leaveOk()) { dirty = false; meetingView(id); window.scrollTo(0, 0); } };
    $("pf-back").addEventListener("click", () => { if (leaveOk()) { dirty = false; show("meetings"); } });
    $("pf-to-year").addEventListener("click", () => { if (leaveOk()) { dirty = false; show("year"); } });
    $("pf-print").addEventListener("click", () => printMeeting(ev.id));
    if (nb.prev) $("pf-nav-prev").addEventListener("click", () => go(nb.prev.id));
    if (nb.next) $("pf-nav-next").addEventListener("click", () => go(nb.next.id));
    planEditor(ev, plan);
  }

  // The meeting planner: the guide's layout — intro, activities, optional
  // activity, closing — each with what & how, resources & supplies, who;
  // any part may work on a stepping stone and/or a Fanny Crosby or Joining
  // Award requirement (its completion is proposed for the Pathfinders who
  // come, like a badge plan's finish item).
  function planEditor(ev, plan) {
    const st = {
      kind: plan ? plan.kind : "meeting",
      serviceProject: plan ? plan.serviceProject || "" : "",
      finishes: new Set(plan ? plan.finishesStones : []),
      verseStones: new Set(plan ? (plan.verses || []).filter((v) => v.stone).map((v) => v.stone) : []),
      bonusVerses: plan ? (plan.verses || []).filter((v) => !v.stone).map((v) => v.verse).join("; ") : "",
      notes: plan ? plan.notes || "" : "",
      parts: plan ? plan.parts.map((p) => ({ slot: p.slot, stone: p.stone, requirementId: p.requirementId, what: p.what || "", supplies: p.supplies || "", who: p.who || "" })) : [],
    };
    const reqs = [
      ...prog.fannyCrosby.requirements.map((r) => ({ id: r.id, label: `Fanny Crosby ${r.number} — ${r.title}` })),
      ...prog.joining.requirements.map((r) => ({ id: r.id, label: `Joining Award ${r.number} — ${r.title}` })),
    ];
    const lastStone = () => { const p = [...st.parts].reverse().find((x) => x.stone); return p ? p.stone : null; };
    const blank = (slot) => ({ slot, stone: slot === "activity" || slot === "intro" ? lastStone() : null, requirementId: null, what: "", supplies: "", who: "" });
    const mark = () => { dirty = true; const s = $("pf-save-state"); if (s) s.textContent = "Unsaved changes"; };

    function render() {
      const used = [...new Set(st.parts.map((p) => p.stone).filter(Boolean))].sort();
      $("pf-plan").innerHTML = `
        <div class="trk-panel">
          <div class="trk-row-tools">
            <label><input type="radio" name="pf-kind" value="meeting"${st.kind === "meeting" ? " checked" : ""}> Regular meeting</label>
            <label><input type="radio" name="pf-kind" value="service"${st.kind === "service" ? " checked" : ""}> ${ICON.service} The whole meeting is a service project</label>
            ${st.kind === "service" ? `<input type="text" id="pf-svc" value="${esc(st.serviceProject)}" placeholder="Project (e.g. food pantry)" style="min-width:16rem">` : ""}
          </div>
          <div class="trk-row-tools"><span>${ICON.stone} This meeting <strong>finishes</strong>:</span>
            ${prog.stones.map((s) => `<label title="${esc(s.name)}"><input type="checkbox" data-fin="${s.number}"${st.finishes.has(s.number) ? " checked" : ""}> SS ${s.number}</label>`).join("")}
            <span class="trk-muted">— the Pathfinders there earn that stone's logo bead</span></div>
          <div class="trk-row-tools"><span>${ICON.verse} <strong>Memory verse</strong> covered:</span>
            ${prog.stones.map((s) => `<label title="${esc(s.verse)}"><input type="checkbox" data-verse="${s.number}"${st.verseStones.has(s.number) ? " checked" : ""}> SS ${s.number}</label>`).join("")}
            <input type="text" id="pf-bonus" value="${esc(st.bonusVerses)}" placeholder="Bonus verse(s), e.g. Psalm 23:1; John 3:16" style="min-width:16rem"></div>
          <p class="trk-muted">Every Pathfinder checked in to this meeting earns the heart for each verse covered (once per verse) — you confirm it under Beads &amp; awards.</p>
        </div>
        ${st.parts.length ? "" : `<div class="trk-panel"><p>No parts yet. <button class="btn btn-outline btn-sm" id="pf-template">Start from the guide's layout</button>
          <span class="trk-muted">(introduction, two activities, an optional activity, closing)</span></p></div>`}
        <div id="pf-parts">${st.parts.map((p, i) => `
          <div class="trk-panel pf-part" data-i="${i}">
            <div class="trk-row-tools">
              <select data-f="slot">${SLOTS.map((s) => `<option value="${s.key}"${p.slot === s.key ? " selected" : ""}>${s.label}</option>`).join("")}</select>
              <select data-f="stone"><option value="">No stepping stone</option>${prog.stones.map((s) => `<option value="${s.number}"${p.stone === s.number ? " selected" : ""}>SS ${s.number} — ${esc(s.name)}</option>`).join("")}</select>
              <select data-f="requirementId" style="max-width:24rem"><option value="">No award requirement</option>${reqs.map((r) => `<option value="${esc(r.id)}"${p.requirementId === r.id ? " selected" : ""}>${esc(r.label)}</option>`).join("")}</select>
              <span style="margin-left:auto;display:inline-flex;gap:0.3rem">
                <button class="btn-link" data-mv="-1" title="Move up"${i === 0 ? " disabled" : ""}>&uarr;</button>
                <button class="btn-link" data-mv="1" title="Move down"${i === st.parts.length - 1 ? " disabled" : ""}>&darr;</button>
                <button class="btn-link" data-rm title="Remove this part">Remove</button></span>
            </div>
            <label class="pf-field">What &amp; how<textarea data-f="what" rows="2" placeholder="Game, song, craft, snack, discussion…">${esc(p.what)}</textarea></label>
            <div class="pf-field-row">
              <label class="pf-field">Resources &amp; supplies<input type="text" data-f="supplies" value="${esc(p.supplies)}"></label>
              <label class="pf-field">Who<input type="text" data-f="who" value="${esc(p.who)}"></label>
            </div>
          </div>`).join("")}</div>
        <div class="trk-row-tools">${SLOTS.map((s) => `<button class="btn btn-outline btn-sm" data-add="${s.key}">+ ${s.label}</button>`).join("")}</div>
        <div class="trk-panel"><label class="pf-field">Comments <span class="trk-muted">(what worked, what didn't — for next year)</span><textarea id="pf-notes" rows="3">${esc(st.notes)}</textarea></label></div>
        <div class="trk-row-tools"><button class="btn btn-blue" id="pf-save">Save plan</button>
          ${plan ? '<button class="btn btn-outline" id="pf-clear">Delete plan</button>' : ""}
          <span class="trk-muted" id="pf-save-state">${dirty ? "Unsaved changes" : ""}</span></div>
        ${used.length ? `<h3 style="margin-top:1.5rem">From the Unit Leader Guide</h3>${used.map(outlinePanel).join("")}` : ""}`;
      wire();
    }
    function outlinePanel(n) {
      const s = stone(n);
      if (!s) return "";
      return `<div class="trk-panel pf-outline"><h3>${ICON.stone} ${esc(stoneLabel(n))}</h3>
        ${s.goal ? `<p><strong>Goal:</strong> ${esc(s.goal)}</p>` : '<p class="trk-muted">The guide outline isn\'t loaded on the tracker (data/pathfinder/stones.json).</p>'}
        ${s.objectives.length ? `<p><strong>Main objectives</strong></p><ul>${s.objectives.map((o) => `<li>${esc(o)}</li>`).join("")}</ul>` : ""}
        ${s.supplemental.length ? `<p><strong>Supplemental objectives</strong></p><ul>${s.supplemental.map((o) => `<li>${esc(o)}</li>`).join("")}</ul>` : ""}
        <p>${ICON.verse} <strong>${esc(s.verse)}</strong>${s.verseText ? ` — “${esc(s.verseText)}”` : ""}</p>
        ${s.frontier ? `<p class="trk-muted">Frontier: ${esc(s.frontier)}${s.creedWords.length ? " · Creed words: " + s.creedWords.map(esc).join(", ") : ""}</p>` : ""}</div>`;
    }
    function wire() {
      const body = $("pf-plan");
      body.querySelectorAll('input[name="pf-kind"]').forEach((r) => r.addEventListener("change", () => { st.kind = r.value; mark(); render(); }));
      if ($("pf-svc")) $("pf-svc").addEventListener("input", (e) => { st.serviceProject = e.target.value; mark(); });
      body.querySelectorAll("[data-fin]").forEach((c) => c.addEventListener("change", () => {
        const n = Number(c.dataset.fin);
        if (c.checked) st.finishes.add(n); else st.finishes.delete(n);
        mark();
      }));
      body.querySelectorAll("[data-verse]").forEach((c) => c.addEventListener("change", () => {
        const n = Number(c.dataset.verse);
        if (c.checked) st.verseStones.add(n); else st.verseStones.delete(n);
        mark();
      }));
      $("pf-bonus").addEventListener("input", (e) => { st.bonusVerses = e.target.value; mark(); });
      if ($("pf-template")) $("pf-template").addEventListener("click", () => { st.parts = ["intro", "activity", "activity", "optional", "closing"].map(blank); mark(); render(); });
      body.querySelectorAll(".pf-part").forEach((el) => {
        const i = Number(el.dataset.i);
        el.querySelectorAll("[data-f]").forEach((inp) => inp.addEventListener(inp.tagName === "SELECT" ? "change" : "input", () => {
          const f = inp.dataset.f;
          const p = st.parts[i];
          if (f === "stone") p.stone = inp.value ? Number(inp.value) : null;
          else if (f === "requirementId") p.requirementId = inp.value || null;
          else p[f] = inp.value;
          mark();
          if (f === "stone") render(); // the guide outline below follows the stones in use
        }));
        el.querySelector("[data-rm]").addEventListener("click", () => { st.parts.splice(i, 1); mark(); render(); });
        el.querySelectorAll("[data-mv]").forEach((b) => b.addEventListener("click", () => {
          const j = i + Number(b.dataset.mv);
          if (j < 0 || j >= st.parts.length) return;
          [st.parts[i], st.parts[j]] = [st.parts[j], st.parts[i]];
          mark(); render();
        }));
      });
      body.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => { st.parts.push(blank(b.dataset.add)); mark(); render(); }));
      $("pf-notes").addEventListener("input", (e) => { st.notes = e.target.value; mark(); });
      $("pf-save").addEventListener("click", () => save(false));
      if ($("pf-clear")) $("pf-clear").addEventListener("click", () => { if (window.confirm("Delete this meeting's Pathfinder plan?")) save(true); });
    }
    async function save(clear) {
      const body = clear ? { parts: [] } : {
        kind: st.kind, serviceProject: st.serviceProject, finishesStones: [...st.finishes], notes: st.notes,
        verses: [...[...st.verseStones].sort().map((n) => ({ stone: n })), ...st.bonusVerses.split(/[;\n]/).map((v) => v.trim()).filter(Boolean).map((verse) => ({ verse }))],
        parts: st.parts.map((p) => ({ slot: p.slot, stone: p.stone, requirementId: p.requirementId, what: p.what, supplies: p.supplies, who: p.who })),
      };
      try {
        const r = await api(`/events/${ev.id}/pathfinder-plan`, { method: "PUT", body });
        dirty = false;
        const prop = r.proposals && !r.proposals.skipped ? " — beads for the girls who came are waiting under Beads & awards" : "";
        toast((r.deleted ? "Plan deleted" : "Plan saved") + prop);
        meetingView(ev.id);
      } catch (e) { toast(e.message, true); }
    }
    render();
  }

  // ------------------------------------------------ memory verses -------
  // One heart per stepping-stone verse, plus a heart for each bonus verse.
  // A verse planned on a meeting is proposed for everyone there; a leader
  // can also mark one here by hand.
  async function versesView() {
    const t = await api("/pathfinder/tracker");
    let date = prog.defaultVerseDate;
    let q = "";
    $("pf-body").innerHTML = `
      <div class="trk-row-tools">
        <label>Date learned <input type="date" id="pf-v-date" value="${esc(date)}"></label>
        <span class="trk-muted">defaults to the most recent meeting or event · change it before marking</span>
        ${searchBox("pf-v-q", q, "Search girls…")}
      </div>
      <div class="trk-panel"><h3>${ICON.verse} The verses</h3>
        <table class="trk-table"><tbody>${prog.stones.map((s) => `<tr><td class="num" style="white-space:nowrap">SS ${s.number}</td><td><strong>${esc(s.name)}</strong></td>
          <td><strong>${esc(s.verse)}</strong>${s.verseText ? `<div class="trk-text">“${esc(s.verseText)}”</div>` : ""}</td></tr>`).join("")}</tbody></table></div>
      <div id="pf-v-grid"></div>
      <div class="trk-panel"><h3>${ICON.verse} Bonus verse</h3>
        <div class="trk-row-tools">
          <select id="pf-b-girl"><option value="">Girl…</option>${t.girls.map((g) => `<option value="${g.id}">${esc(girlName(g))}</option>`).join("")}</select>
          <input type="text" id="pf-b-ref" placeholder="Reference (e.g. Psalm 23:1)">
          <button class="btn btn-outline btn-sm" id="pf-b-add">Mark memorized</button>
        </div><p class="trk-muted">Each extra verse a girl learns earns another heart.</p></div>`;
    const render = () => {
      const girls = t.girls.filter((g) => matches(q, girlName(g)));
      $("pf-v-grid").innerHTML = girls.length ? `<div class="trk-wrap"><table class="trk-table pf-vgrid">
        <thead><tr><th>Girl</th>${prog.stones.map((s) => `<th title="${esc(s.name)} — ${esc(s.verse)}">SS ${s.number}<div class="trk-muted" style="text-transform:none">${esc(s.verse)}</div></th>`).join("")}<th>Bonus</th></tr></thead>
        <tbody>${girls.map((g) => {
          const bonus = Object.entries(g.verses).filter(([, v]) => !v.stone);
          return `<tr><td><strong>${esc(girlName(g))}</strong><div>${iconCount("verse", g.counts.verse, "hearts")}</div></td>
          ${prog.stones.map((s) => {
            const v = g.verses[s.verse];
            return v ? `<td class="pf-done">${ICON.verse}<div class="trk-muted">${fmtDate(v.earnedOn)}</div><button class="btn-link" data-unmark="${v.beadId}" title="Remove this heart">undo</button></td>`
              : `<td><button class="btn btn-outline btn-sm" data-mark="${g.id}" data-stone="${s.number}">Mark memorized</button></td>`;
          }).join("")}
          <td>${bonus.map(([ref, v]) => `<div>${ICON.verse} ${esc(ref)} <span class="trk-muted">${fmtDate(v.earnedOn)}</span> <button class="btn-link" data-unmark="${v.beadId}">undo</button></div>`).join("") || '<span class="trk-muted">—</span>'}</td></tr>`;
        }).join("")}</tbody></table></div>` : `<p class="trk-muted">${t.girls.length ? "No girl matches." : "No active Pathfinders on the roster."}</p>`;
      $("pf-v-grid").querySelectorAll("[data-mark]").forEach((b) => b.addEventListener("click", () => add({ girlId: Number(b.dataset.mark), kind: "verse", stone: Number(b.dataset.stone), earnedOn: date })));
      $("pf-v-grid").querySelectorAll("[data-unmark]").forEach((b) => b.addEventListener("click", () => removeBead(Number(b.dataset.unmark), () => show("verses"))));
    };
    const add = async (body) => {
      if (!body.earnedOn) { toast("Pick the date first", true); return; }
      try { await api("/pathfinder/beads", { body }); toast("Heart recorded"); show("verses"); } catch (e) { toast(e.message, true); }
    };
    $("pf-v-date").addEventListener("change", (e) => { date = e.target.value; });
    $("pf-v-q").addEventListener("input", (e) => { q = e.target.value; render(); });
    $("pf-b-add").addEventListener("click", () => {
      const girlId = Number($("pf-b-girl").value);
      const ref = $("pf-b-ref").value.trim();
      if (!girlId || !ref) { toast("Pick a girl and type the verse reference", true); return; }
      add({ girlId, kind: "verse", verse: ref, earnedOn: date });
    });
    render();
  }

  async function removeBead(id, after) {
    if (!window.confirm("Remove this bead?")) return;
    try {
      await api(`/pathfinder/beads/${id}`, { method: "DELETE" });
    } catch (e) {
      if (e.status !== 409) { toast(e.message, true); return; }
      if (!window.confirm(`${e.message}.\n\nHave you already corrected the note on AHGFamily? OK removes the bead here.`)) return;
      try { await api(`/pathfinder/beads/${id}?alreadyFixed=1`, { method: "DELETE" }); } catch (e2) { toast(e2.message, true); return; }
    }
    toast("Bead removed");
    after();
  }

  // ------------------------------------------------ beads & awards ------
  let trkQuery = "";
  async function trackerView() {
    const [t, pend] = await Promise.all([api("/pathfinder/tracker"), api("/pathfinder/pending")]);
    $("pf-body").innerHTML = `
      ${pend.total ? `<div class="trk-panel"><h3>Waiting on you <span class="trk-pill warn">${pend.total}</span></h3>
        <p class="trk-muted">From check-in: beads for the Pathfinders who came, and award requirements planned at those meetings. Untick anything that isn't right, then confirm.</p>
        <div class="trk-wrap"><table class="trk-table"><thead><tr><th><input type="checkbox" id="pf-p-all" checked aria-label="Select all"></th><th>Girl</th><th>What</th><th>When</th></tr></thead><tbody>
        ${pend.beads.map((b) => `<tr><td><input type="checkbox" data-bead="${b.id}" checked></td><td>${esc(girlName(b))}</td>
          <td>${ICON[b.kind]} ${esc(KIND_LABEL[b.kind])}${b.kind === "stone" ? ` — SS ${b.stone} ${esc(b.stoneName || "")}` : ""}${b.kind === "service" && b.label ? ` — ${esc(b.label)}` : ""}</td>
          <td style="white-space:nowrap">${fmtDate(b.earnedOn)}<div class="trk-muted">${esc(b.eventTitle || "")}</div></td></tr>`).join("")}
        ${pend.completions.map((c) => `<tr><td><input type="checkbox" data-comp="${c.completionId}" checked></td><td>${esc(girlName(c))}</td>
          <td>${esc(c.badgeName)} ${c.number}${esc(c.letter || "")} — ${esc(c.title || "")}${c.notes ? `<div class="trk-muted">${esc(c.notes)}</div>` : ""}</td>
          <td style="white-space:nowrap">${fmtDate(c.completedOn)}<div class="trk-muted">${esc(c.eventTitle || "")}</div></td></tr>`).join("")}
        </tbody></table></div>
        <div class="trk-row-tools"><button class="btn btn-blue btn-sm" id="pf-p-ok">Confirm selected</button>
          <button class="btn btn-outline btn-sm" id="pf-p-no">Reject selected</button></div></div>` : ""}
      <div class="trk-row-tools">${searchBox("pf-t-q", trkQuery, "Search girls…")}
        <span class="trk-muted">${ICON.verse} memory verse ·${ICON.attendance} attendance · ${ICON.service} service · ${ICON.stone} stepping stones</span></div>
      <div id="pf-t-list"></div>
      <div class="trk-panel"><h3>Add a bead by hand</h3>
        <div class="trk-row-tools">
          <select id="pf-a-girl"><option value="">Girl…</option>${t.girls.map((g) => `<option value="${g.id}">${esc(girlName(g))}</option>`).join("")}</select>
          <select id="pf-a-kind"><option value="service">${KIND_LABEL.service} (a project outside a meeting)</option><option value="stone">${KIND_LABEL.stone} (finished at home / missed the meeting)</option></select>
          <select id="pf-a-stone" hidden>${prog.stones.map((s) => `<option value="${s.number}">SS ${s.number} — ${esc(s.name)}</option>`).join("")}</select>
          <input type="text" id="pf-a-label" placeholder="Service project">
          <input type="date" id="pf-a-date" value="${esc(prog.defaultVerseDate)}">
          <button class="btn btn-outline btn-sm" id="pf-a-add">Add</button>
        </div><p class="trk-muted">Memory-verse hearts come from verses planned on a meeting, or are marked on the Memory verses tab; attendance beads come from check-in.</p></div>`;

    const render = () => {
      const girls = t.girls.filter((g) => matches(trkQuery, girlName(g)));
      $("pf-t-list").innerHTML = girls.length ? `<div class="trk-wrap"><table class="trk-table pf-tracker">
        <thead><tr><th>Girl</th><th title="memory-verse hearts">${ICON.verse}</th><th title="attendance beads">${ICON.attendance}</th><th title="service stars">${ICON.service}</th><th title="stepping-stone beads">${ICON.stone}</th><th>Stepping stones</th><th>Fanny Crosby</th><th>Joining</th></tr></thead>
        <tbody>${girls.map((g) => `<tr>
          <td><a href="#" data-girl="${g.id}"><strong>${esc(girlName(g))}</strong></a>${g.mapped ? "" : '<div class="trk-muted" title="Not matched to AHGFamily yet — nothing can be pushed for her">not on AHGFamily yet</div>'}</td>
          ${["verse", "attendance", "service", "stone"].map((k) => `<td class="pf-n">${iconCount(k, g.counts[k])}${g.pending[k] ? `<div class="trk-pill warn" title="waiting on you">+${g.pending[k]}</div>` : ""}</td>`).join("")}
          <td>${prog.stones.map((s) => `<span class="pf-ss ${g.stones[s.number] ? "done" : ""}" title="${esc(s.name)}${g.stones[s.number] ? " — " + fmtDate(g.stones[s.number]) : ""}">${s.number}</span>`).join("")}</td>
          <td>${awardCell(g.fannyCrosby)}</td><td>${awardCell(g.joining)}</td></tr>
          <tr class="pf-detail" data-detail="${g.id}" hidden><td colspan="8">${girlDetail(g)}</td></tr>`).join("")}</tbody></table></div>`
        : `<p class="trk-muted">${t.girls.length ? "No girl matches." : "No active Pathfinders on the roster."}</p>`;
      $("pf-t-list").querySelectorAll("a[data-girl]").forEach((a) => a.addEventListener("click", (e) => {
        e.preventDefault();
        const row = $("pf-t-list").querySelector(`[data-detail="${a.dataset.girl}"]`);
        row.hidden = !row.hidden;
      }));
      $("pf-t-list").querySelectorAll("[data-rm-bead]").forEach((b) => b.addEventListener("click", () => removeBead(Number(b.dataset.rmBead), () => show("tracker"))));
    };
    $("pf-t-q").addEventListener("input", (e) => { trkQuery = e.target.value; render(); });
    render();

    if (pend.total) {
      $("pf-p-all").addEventListener("change", (e) => $("pf-body").querySelectorAll("[data-bead],[data-comp]").forEach((c) => { c.checked = e.target.checked; }));
      const decide = async (decision) => {
        const beads = [...$("pf-body").querySelectorAll("[data-bead]:checked")].map((c) => ({ beadId: Number(c.dataset.bead), decision }));
        const completions = [...$("pf-body").querySelectorAll("[data-comp]:checked")].map((c) => ({ completionId: Number(c.dataset.comp), decision }));
        if (!beads.length && !completions.length) { toast("Nothing selected"); return; }
        try { await api("/pathfinder/decide", { body: { beads, completions } }); toast(`${beads.length + completions.length} ${decision === "confirm" ? "confirmed" : "rejected"}`); show("tracker"); } catch (e) { toast(e.message, true); }
      };
      $("pf-p-ok").addEventListener("click", () => decide("confirm"));
      $("pf-p-no").addEventListener("click", () => decide("reject"));
    }
    $("pf-a-kind").addEventListener("change", (e) => { $("pf-a-stone").hidden = e.target.value !== "stone"; $("pf-a-label").hidden = e.target.value === "stone"; });
    $("pf-a-add").addEventListener("click", async () => {
      const kind = $("pf-a-kind").value;
      const body = { girlId: Number($("pf-a-girl").value), kind, earnedOn: $("pf-a-date").value };
      if (!body.girlId || !body.earnedOn) { toast("Pick a girl and a date", true); return; }
      if (kind === "stone") body.stone = Number($("pf-a-stone").value); else body.label = $("pf-a-label").value;
      try { await api("/pathfinder/beads", { body }); toast("Bead recorded"); show("tracker"); } catch (e) { toast(e.message, true); }
    });
  }
  const awardCell = (a) => (!a.total ? '<span class="trk-muted">—</span>'
    : a.complete ? '<span class="trk-pill ok">earned</span>' : `<span class="trk-muted">${a.done}/${a.total}</span>`);
  const PUSH = { sent: ["ok", "on AHGFamily"], queued: ["warn", "to push"], held: ["err", "held — check AHGFamily"], failed: ["err", "push failed"], skipped: ["mut", "not pushed"] };
  function girlDetail(g) {
    const byKind = (k) => g.beads.filter((b) => b.kind === k && b.status === "confirmed");
    const beadRow = (b) => `<li>${fmtDate(b.earnedOn)}${b.kind === "stone" ? ` — SS ${b.stone} ${esc((stone(b.stone) || {}).name || "")}` : b.kind === "verse" ? ` — ${esc(b.verse || "")}` : b.label ? ` — ${esc(b.label)}` : ""}
      ${b.push ? `<span class="trk-pill ${PUSH[b.push.status] ? PUSH[b.push.status][0] : "mut"}" title="${esc(b.push.error || "")}">${PUSH[b.push.status] ? PUSH[b.push.status][1] : esc(b.push.status)}</span>` : ""}
      <button class="btn-link" data-rm-bead="${b.id}">remove</button></li>`;
    const award = (name, a) => `<div><strong>${esc(name)}</strong> ${a.items.map((i) => `<div class="trk-muted">${i.status === "confirmed" ? "✓" : i.status === "proposed" ? "…" : "○"} ${i.number} — ${esc(i.title || "")}${i.completedOn && i.status === "confirmed" ? " (" + fmtDate(i.completedOn) + ")" : ""}</div>`).join("")}</div>`;
    return `<div class="pf-detail-grid">
      ${["verse", "attendance", "service", "stone"].map((k) => `<div><strong>${ICON[k]} ${esc(KIND_LABEL[k])}s</strong><ul>${byKind(k).map(beadRow).join("") || '<li class="trk-muted">none yet</li>'}</ul></div>`).join("")}
      ${award("Fanny Crosby Level Award", g.fannyCrosby)}${award("Joining Award", g.joining)}</div>`;
  }

  // ------------------------------------------------ settings ------------
  async function settingsView() {
    const isAdmin = me && me.role === "admin";
    $("pf-body").innerHTML = `
      <div class="trk-panel"><h3>${ICON.attendance} Which check-ins earn an attendance bead</h3>
        <label><input type="radio" name="pf-att" value="all"${prog.attendanceSource === "all" ? " checked" : ""}${isAdmin ? "" : " disabled"}> Every event she's checked in to — meetings, service days, outings (the AHG rule)</label><br>
        <label><input type="radio" name="pf-att" value="planned"${prog.attendanceSource === "planned" ? " checked" : ""}${isAdmin ? "" : " disabled"}> Pathfinder meetings only (meetings with a Pathfinder plan)</label>
        <p class="trk-muted">${isAdmin ? "Changing this re-checks the program year: beads still waiting on you follow the new rule; confirmed beads are never removed." : "Only an admin can change this."}</p>
        ${isAdmin ? '<button class="btn btn-blue btn-sm" id="pf-att-save">Save</button>' : ""}</div>
      <div class="trk-panel"><h3>Re-check attendance</h3>
        <p class="trk-muted">Proposes any beads and award requirements the program year's check-ins support but that aren't on the list yet (for example after a plan was fixed). Nothing is confirmed without you.</p>
        <button class="btn btn-outline btn-sm" id="pf-rescan">Re-check this program year</button></div>
      <div class="trk-panel"><h3>AHGFamily</h3>
        <p class="trk-muted">AHGFamily keeps one record of each bead. Every bead you confirm adds one line to that record's comment — her count to date and the bead's own date — and never changes what's already written there. Pushing is switched on by an admin on the Admin page.</p></div>`;
    if (isAdmin) $("pf-att-save").addEventListener("click", async () => {
      const v = (document.querySelector('input[name="pf-att"]:checked') || {}).value;
      try {
        const r = await api("/admin/pathfinder/settings", { body: { attendanceSource: v } });
        prog.attendanceSource = r.attendanceSource;
        toast(`Saved — ${plural(r.rescan.beads, "new bead")} waiting, ${r.rescan.withdrawn} withdrawn`);
      } catch (e) { toast(e.message, true); }
    });
    $("pf-rescan").addEventListener("click", async () => {
      try { const r = await api("/pathfinder/rescan", { body: {} }); toast(`${plural(r.events, "event")} checked — ${plural(r.beads + r.completions, "new item")} waiting`); } catch (e) { toast(e.message, true); }
    });
  }

  init(async () => {
    [prog, me] = await Promise.all([api("/pathfinder"), api("/me").catch(() => null)]);
    prog.stones.sort((a, b) => byText(a.number, b.number));
    await show("year");
  });
})();
