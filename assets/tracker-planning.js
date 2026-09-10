// ============================================================
//  Planning (leaders area): pick an event, build each unit's
//  plan (requirements with session/start/continue/finish
//  roles), and confirm or reject proposed completions after
//  the meeting. All data lives in the tracker on the Pi.
// ============================================================
(function () {
  "use strict";
  const { init, api, esc, toast, fmtDate, fmtTime, combo, $ } = window.Tracker;
  const root = () => $("pg-planning");

  const UNITS = ["Tenderheart", "Explorer", "Pioneer/Patriot"];
  const ROLES = ["session", "start", "continue", "finish"];
  const ROLE_HELP = {
    session: "done tonight (single-session)",
    start: "first of several sessions",
    continue: "middle session",
    finish: "last session — proposes completion",
  };

  let badgeList = [];
  const badgeCache = {}; // id → full badge

  const badgeFits = (badgeLevelGroup, unit) => badgeLevelGroup === "All" || badgeLevelGroup === unit
    || (unit === "Pioneer/Patriot" && (badgeLevelGroup === "Pioneer" || badgeLevelGroup === "Patriot"));

  // local-calendar YYYY-MM-DD (toISOString would shift across midnight UTC)
  const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const dayDiff = (a, b) => Math.round((b - a) / 864e5);

  // ------------------------------------------------ events list ----------
  // Date-range state: default two weeks back – sixty days ahead; quick
  // presets, a custom range, and paging by the current window's own size.
  const PRESETS = [
    { key: "default", label: "2 wk back – 60 d ahead", calc: () => [addDays(new Date(), -14), addDays(new Date(), 60)] },
    { key: "month", label: "This month", calc: () => { const n = new Date(); return [new Date(n.getFullYear(), n.getMonth(), 1), new Date(n.getFullYear(), n.getMonth() + 1, 0)]; } },
    { key: "next90", label: "Next 90 days", calc: () => [new Date(), addDays(new Date(), 90)] },
    { key: "past90", label: "Past 90 days", calc: () => [addDays(new Date(), -90), new Date()] },
    { key: "year", label: "Program year", calc: () => { const n = new Date(); const y = n.getMonth() >= 8 ? n.getFullYear() : n.getFullYear() - 1; return [new Date(y, 8, 1), new Date(y + 1, 7, 31)]; } },
  ];
  const range = { preset: "default", from: addDays(new Date(), -14), to: addDays(new Date(), 60) };

  async function listView() {
    const from = isoDay(range.from);
    const to = isoDay(range.to);
    const events = await api(`/events?from=${from}&to=${to}`);
    const spanDays = dayDiff(range.from, range.to);
    root().innerHTML = `
      <div class="trk-chips">
        ${PRESETS.map((pr) => `<button class="trk-chip ${range.preset === pr.key ? "active" : ""}" data-preset="${pr.key}">${pr.label}</button>`).join("")}
      </div>
      <div class="trk-row-tools">
        <button class="btn btn-outline btn-sm" id="trk-ev-prev" title="Back ${spanDays + 1} days">&larr; Earlier</button>
        <strong>${fmtDate(from)} – ${fmtDate(to)}</strong>
        <button class="btn btn-outline btn-sm" id="trk-ev-next" title="Forward ${spanDays + 1} days">Later &rarr;</button>
        <span class="trk-muted">·</span>
        <input type="date" id="trk-ev-from" value="${from}" aria-label="From">
        <span class="trk-muted">to</span>
        <input type="date" id="trk-ev-to" value="${to}" aria-label="To">
        <button class="btn btn-outline btn-sm" id="trk-ev-apply">Apply</button>
      </div>
      <p class="trk-muted">${events.length} event${events.length === 1 ? "" : "s"} in this range. Pick one to plan badgework or review the meeting afterward. History goes back to the tracker's install; the mirror looks about a year ahead.</p>`;
    root().insertAdjacentHTML("beforeend", listTable(events));
    root().querySelectorAll("[data-preset]").forEach((c) => c.addEventListener("click", () => {
      const pr = PRESETS.find((x) => x.key === c.dataset.preset);
      const [f, t] = pr.calc();
      range.preset = pr.key; range.from = f; range.to = t;
      listView();
    }));
    const shift = (dir) => {
      const step = (spanDays + 1) * dir;
      range.preset = "custom"; range.from = addDays(range.from, step); range.to = addDays(range.to, step);
      listView();
    };
    $("trk-ev-prev").addEventListener("click", () => shift(-1));
    $("trk-ev-next").addEventListener("click", () => shift(1));
    $("trk-ev-apply").addEventListener("click", () => {
      const f = $("trk-ev-from").value; const t = $("trk-ev-to").value;
      if (!f || !t) { toast("Pick both dates"); return; }
      if (f > t) { toast("The start date is after the end date"); return; }
      range.preset = "custom"; range.from = new Date(f + "T12:00:00"); range.to = new Date(t + "T12:00:00");
      listView();
    });
    root().querySelectorAll("a[data-ev]").forEach((a) => a.addEventListener("click", (ev) => { ev.preventDefault(); eventView(Number(a.dataset.ev)); }));
  }

  function listTable(events) {
    return `
      ${events.length ? `<div class="trk-wrap"><table class="trk-table">
        <thead><tr><th>When</th><th>Event</th><th>Plans</th><th>Attendance</th></tr></thead>
        <tbody>${events.map((e) => `
          <tr>
            <td style="white-space:nowrap">${fmtDate(e.startAt)}<div class="trk-muted">${fmtTime(e.startAt)}</div></td>
            <td><a href="#" data-ev="${e.id}"><strong>${esc(e.title)}</strong></a>${e.removedFromFeed ? ' <span class="trk-pill err" title="The check-in app no longer lists this event (renamed or deleted on the calendar). Open it to move its plans to the current entry.">no longer on the calendar</span>' : ""}${e.location ? `<div class="trk-muted">${esc(e.location)}</div>` : ""}</td>
            <td>${(e.planLevelGroups || []).map((g) => `<span class="trk-pill ok">${esc(g)}</span>`).join(" ") || '<span class="trk-muted">—</span>'}</td>
            <td>${e.attendance ? `${e.attendance.total} signed in${e.attendance.open ? ` <span class="trk-pill warn">${e.attendance.open} still open</span>` : ""}` : '<span class="trk-muted">—</span>'}</td>
          </tr>`).join("")}</tbody>
      </table></div>` : `<p class="trk-muted">No events in this range. Events appear once the check-in app knows them (iCal feed or manual entry) and the tracker has synced.</p>`}
    `;
  }

  // ------------------------------------------------ event detail ---------
  let cur = null; // { ev, plans: Map(levelGroup → plan|null), tab }

  async function eventView(id, tab) {
    const [ev, plans] = await Promise.all([api("/events/" + id), api(`/events/${id}/plans`)]);
    cur = { ev, plans: new Map(plans.map((p) => [p.levelGroup, p])), tab: tab || (plans[0] ? plans[0].levelGroup : UNITS[2]) };
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    const { ev, tab } = cur;
    root().innerHTML = `
      <p><button class="btn btn-outline btn-sm" id="trk-back">&larr; All events</button></p>
      <div class="trk-panel">
        <h3>${esc(ev.title)}</h3>
        <p class="trk-muted">${fmtDate(ev.startAt)}, ${fmtTime(ev.startAt)}${ev.endAt ? "–" + fmtTime(ev.endAt) : ""}${ev.location ? " · " + esc(ev.location) : ""}
        ${ev.attendance && ev.attendance.length ? ` · ${ev.attendance.length} girls signed in` : ""}</p>
        ${ev.removedFromFeed ? `<div id="trk-move"><p class="trk-muted"><span class="trk-pill err">no longer on the calendar</span> The check-in app no longer lists this event — it was renamed or deleted on the AHGFamily calendar. Its plans are still here; move them to the current entry.</p></div>` : ""}
      </div>
      <div class="trk-chips">
        ${UNITS.map((u) => `<button class="trk-chip ${tab === u ? "active" : ""}" data-tab="${esc(u)}">${esc(u)}${cur.plans.get(u) ? " ●" : ""}</button>`).join("")}
        <button class="trk-chip ${tab === "after" ? "active" : ""}" data-tab="after">After the meeting</button>
      </div>
      <div id="trk-tabbody"></div>
    `;
    $("trk-back").addEventListener("click", listView);
    root().querySelectorAll(".trk-chip").forEach((c) => c.addEventListener("click", () => { cur.tab = c.dataset.tab; render(); }));
    if (tab === "after") proposalsTab();
    else planTab(tab);
    if (ev.removedFromFeed) movePanel();
  }

  // A removed event's plans can be moved to another event on the same day
  // (the sync does this automatically when exactly one same-time event
  // exists; this is the manual path for everything else).
  async function movePanel() {
    const { ev } = cur;
    const day = ev.startAt.slice(0, 10);
    let candidates = [];
    try {
      candidates = (await api(`/events?from=${day}&to=${day}`)).filter((e) => e.id !== ev.id && !e.removedFromFeed);
    } catch (e) { toast(e.message, true); return; }
    const host = $("trk-move");
    if (!host) return;
    if (!candidates.length) {
      host.insertAdjacentHTML("beforeend", '<p class="trk-muted">No other event is on the calendar that day yet. Once the check-in app syncs the new entry (nightly, or Admin → Sync check-in now), come back here to move the plans.</p>');
      return;
    }
    host.insertAdjacentHTML("beforeend", `<div class="trk-row-tools">
      <label>Move all plans to
        <select id="trk-move-to">${candidates.map((c) => `<option value="${c.id}">${esc(c.title)} — ${fmtTime(c.startAt)}${(c.planLevelGroups || []).length ? ` (already has ${c.planLevelGroups.map(esc).join(", ")} plans)` : ""}</option>`).join("")}</select>
      </label>
      <button class="btn btn-blue btn-sm" id="trk-move-go">Move plans</button>
    </div>`);
    $("trk-move-go").addEventListener("click", async () => {
      const toEventId = Number($("trk-move-to").value);
      try {
        const r = await api(`/events/${ev.id}/plans/move`, { body: { toEventId } });
        toast(`Moved ${r.moved.length} plan(s)${r.skipped.length ? `; ${r.skipped.join(", ")} left here because the target already has that plan` : ""}`);
        eventView(r.skipped.length ? ev.id : toEventId);
      } catch (e) { toast(e.message, true); }
    });
  }

  // ------------------------------------------------ plan editor ----------
  function planTab(unit) {
    const plan = cur.plans.get(unit);
    // working copy of items for this render
    const items = (plan ? plan.items : []).map((i) => ({ ...i }));
    const body = $("trk-tabbody");

    const draw = () => {
      body.innerHTML = `
        <div class="trk-panel">
          <h3>${esc(unit)} plan</h3>
          ${items.length ? `<div class="trk-wrap"><table class="trk-table">
            <thead><tr><th>Requirement</th><th>Role</th><th></th></tr></thead>
            <tbody>${items.map((it, idx) => `
              <tr>
                <td><strong>${esc(it.badgeName)}</strong> ${it.number}${esc(it.letter || "")}${it.title ? " — " + esc(it.title) : ""}
                  ${it.text ? `<p class="trk-text trk-muted" style="margin:0.3rem 0 0">${esc(it.text)}</p>` : ""}
                  ${it.subItems && it.subItems.length ? `<ul class="trk-muted" style="margin:0.2rem 0 0 1.2rem">${it.subItems.map((si) => `<li>${esc(si)}</li>`).join("")}</ul>` : ""}</td>
                <td><select data-role="${idx}">${ROLES.map((r) => `<option value="${r}" ${it.role === r ? "selected" : ""}>${r}</option>`).join("")}</select>
                  <div class="trk-muted" data-rolehelp="${idx}">${ROLE_HELP[it.role]}</div></td>
                <td><button class="btn-link trk-danger" data-del="${idx}">remove</button></td>
              </tr>`).join("")}</tbody>
          </table></div>` : `<p class="trk-muted">Nothing planned for ${esc(unit)} yet.</p>`}

          <div class="trk-row-tools">
            <div id="trk-add-badge"></div>
            <select id="trk-add-req" hidden></select>
            <button class="btn btn-blue btn-sm" id="trk-add-btn" hidden>Add</button>
          </div>
          <div class="trk-row-tools">
            <textarea id="trk-plan-notes" class="trk-notes" rows="1" placeholder="Plan notes (optional)" style="flex:1;min-width:200px">${esc(plan ? plan.notes || "" : "")}</textarea>
            <button class="btn btn-blue btn-sm" id="trk-plan-save">Save plan</button>
            ${plan ? `<button class="btn btn-outline btn-sm trk-danger" id="trk-plan-clear">Delete plan</button>` : ""}
          </div>
          <p class="trk-muted">Roles: <em>session</em> and <em>finish</em> propose completions for girls who attended (signed out); <em>start</em>/<em>continue</em> record participation only.</p>
        </div>`;

      body.querySelectorAll("[data-role]").forEach((s) => s.addEventListener("change", () => {
        items[Number(s.dataset.role)].role = s.value;
        body.querySelector(`[data-rolehelp="${s.dataset.role}"]`).textContent = ROLE_HELP[s.value];
      }));
      body.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => { items.splice(Number(b.dataset.del), 1); draw(); }));

      const reqSel = $("trk-add-req");
      const addBtn = $("trk-add-btn");
      let pickedBadge = null;
      combo($("trk-add-badge"), {
        items: badgeList.filter((b) => badgeFits(b.levelGroup, unit)).map((b) => ({ value: b.id, label: b.name, sub: b.levelGroup })),
        placeholder: "Add from badge — type to search…",
        onChange: async (v) => {
        pickedBadge = v;
        if (!v) { reqSel.hidden = addBtn.hidden = true; return; }
        const b = badgeCache[v] || (badgeCache[v] = await api("/badges/" + encodeURIComponent(v)));
        const taken = new Set(items.map((i) => i.requirementId));
        reqSel.innerHTML = b.groups.flatMap((g) => g.requirements).filter((r) => !taken.has(r.trackerId))
          .map((r) => `<option value="${esc(r.trackerId)}">${r.number}${esc(r.letter || "")} — ${esc(r.title || "")}</option>`).join("");
        reqSel.hidden = addBtn.hidden = !reqSel.options.length;
        if (!reqSel.options.length) toast("Every requirement of that badge is already on the plan");
        reqSel.dispatchEvent(new Event("reqs-loaded"));
        },
      });
      addBtn.addEventListener("click", () => {
        const b = badgeCache[pickedBadge];
        const r = b.groups.flatMap((g) => g.requirements).find((x) => x.trackerId === reqSel.value);
        if (!r) return;
        items.push({ requirementId: r.trackerId, badgeName: b.name, number: r.number, letter: r.letter || "", title: r.title, text: r.text, subItems: r.subItems || [], role: "session" });
        draw();
      });
      // full handbook text of the highlighted requirement, before it's added
      const preview = document.createElement("p");
      preview.className = "trk-text trk-muted";
      preview.style.margin = "0.4rem 0 0";
      reqSel.parentNode.insertBefore(preview, reqSel.parentNode.querySelector(".trk-row-tools:last-of-type"));
      const showPreview = () => {
        const bb = badgeCache[pickedBadge];
        const rr = bb && bb.groups.flatMap((g) => g.requirements).find((x) => x.trackerId === reqSel.value);
        preview.textContent = rr && rr.text ? rr.text : "";
      };
      reqSel.addEventListener("change", showPreview);
      reqSel.addEventListener("reqs-loaded", showPreview);

      // the notes box grows with its content instead of scrolling one line
      const notesEl = $("trk-plan-notes");
      const growNotes = () => { notesEl.style.height = "auto"; notesEl.style.height = notesEl.scrollHeight + 2 + "px"; };
      notesEl.addEventListener("input", growNotes);
      growNotes();

      $("trk-plan-save").addEventListener("click", async () => {
        try {
          await api(`/events/${cur.ev.id}/plans/${encodeURIComponent(unit)}`, {
            method: "PUT",
            body: { notes: $("trk-plan-notes").value, items: items.map((i) => ({ requirementId: i.requirementId, role: i.role, notes: i.notes || undefined })) },
          });
          toast("Plan saved");
          eventView(cur.ev.id, unit);
        } catch (e) { toast(e.message, true); }
      });
      const clearBtn = $("trk-plan-clear");
      if (clearBtn) clearBtn.addEventListener("click", async () => {
        if (!window.confirm(`Delete the ${unit} plan for this event?`)) return;
        try {
          await api(`/events/${cur.ev.id}/plans/${encodeURIComponent(unit)}`, { method: "PUT", body: { items: [] } });
          toast("Plan deleted");
          eventView(cur.ev.id, unit);
        } catch (e) { toast(e.message, true); }
      });
    };
    draw();
  }

  // ------------------------------------------------ proposals ------------
  async function proposalsTab() {
    const body = $("trk-tabbody");
    const p = await api(`/events/${cur.ev.id}/proposals`);
    if (!p.girls.length) {
      body.innerHTML = `<div class="trk-panel"><p class="trk-muted">Nothing waiting to decide for this event. Proposals appear after girls sign out (the tracker re-checks 30 minutes after the meeting ends and on every sign-out).</p></div>`;
      return;
    }
    body.innerHTML = `
      ${p.girls.map((g) => `
        <div class="trk-panel">
          <h3>${esc(g.firstName)} ${esc(g.lastName)} <span class="trk-pill mut">${esc(g.ahgLevel || "")}</span></h3>
          <div class="trk-wrap"><table class="trk-table"><tbody>
            ${g.items.map((it) => `
              <tr>
                <td><strong>${esc(it.badgeName)}</strong> ${it.number}${esc(it.letter || "")}${it.title ? " — " + esc(it.title) : ""}
                  ${it.needsReview ? `<div class="trk-pill err">needs review</div><div class="trk-muted">${esc(it.reviewReason || "")}</div>` : ""}
                  ${it.participation ? `<div class="trk-muted">present for ${it.participation.count} of ${it.participation.planned} planned session${it.participation.planned === 1 ? "" : "s"}</div>` : ""}</td>
                <td style="white-space:nowrap">
                  <label><input type="radio" name="d${it.completionId}" value="confirm"> confirm</label><br>
                  <label><input type="radio" name="d${it.completionId}" value="reject"> reject</label>
                </td>
                <td><input type="date" data-date="${it.completionId}" value="${esc(it.completedOn || "")}"></td>
              </tr>`).join("")}
          </tbody></table></div>
        </div>`).join("")}
      <div class="trk-row-tools">
        <button class="btn btn-blue" id="trk-decide">Save decisions</button>
        <span class="trk-muted">Only rows with confirm or reject selected are saved; the rest stay proposed.</span>
      </div>
    `;
    $("trk-decide").addEventListener("click", async () => {
      const decisions = [];
      body.querySelectorAll("input[type=radio]:checked").forEach((r) => {
        const completionId = Number(r.name.slice(1));
        const d = { completionId, decision: r.value };
        const dateEl = body.querySelector(`[data-date="${completionId}"]`);
        if (r.value === "confirm" && dateEl && dateEl.value) d.completedOn = dateEl.value;
        decisions.push(d);
      });
      if (!decisions.length) { toast("Nothing selected"); return; }
      try {
        await api(`/events/${cur.ev.id}/proposals/decide`, { body: decisions });
        toast(`Saved ${decisions.length} decision${decisions.length === 1 ? "" : "s"}`);
        proposalsTab();
      } catch (e) { toast(e.message, true); }
    });
  }

  init(async () => {
    badgeList = await api("/badges");
    // deep link from the Review page: leaders-planning.html#event=<id>
    const m = /^#event=(\d+)$/.exec(window.location.hash || "");
    if (m) { history.replaceState(null, "", window.location.pathname); await eventView(Number(m[1]), "after"); return; }
    await listView();
  });
})();
