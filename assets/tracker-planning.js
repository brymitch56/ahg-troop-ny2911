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

  const isoDay = (d) => d.toISOString().slice(0, 10);

  // ------------------------------------------------ events list ----------
  async function listView() {
    const from = isoDay(new Date(Date.now() - 14 * 864e5));
    const to = isoDay(new Date(Date.now() + 60 * 864e5));
    const events = await api(`/events?from=${from}&to=${to}`);
    root().innerHTML = `
      <p class="trk-muted">Events mirror the check-in app (two weeks back, sixty days ahead). Pick one to plan badgework or review the meeting afterward.</p>
      ${events.length ? `<div class="trk-wrap"><table class="trk-table">
        <thead><tr><th>When</th><th>Event</th><th>Plans</th><th>Attendance</th></tr></thead>
        <tbody>${events.map((e) => `
          <tr>
            <td style="white-space:nowrap">${fmtDate(e.startAt)}<div class="trk-muted">${fmtTime(e.startAt)}</div></td>
            <td><a href="#" data-ev="${e.id}"><strong>${esc(e.title)}</strong></a>${e.location ? `<div class="trk-muted">${esc(e.location)}</div>` : ""}</td>
            <td>${(e.planLevelGroups || []).map((g) => `<span class="trk-pill ok">${esc(g)}</span>`).join(" ") || '<span class="trk-muted">—</span>'}</td>
            <td>${e.attendance ? `${e.attendance.total} signed in${e.attendance.open ? ` <span class="trk-pill warn">${e.attendance.open} still open</span>` : ""}` : '<span class="trk-muted">—</span>'}</td>
          </tr>`).join("")}</tbody>
      </table></div>` : `<p class="trk-muted">No events in the window. Check the sync status on the Admin page.</p>`}
    `;
    root().querySelectorAll("a[data-ev]").forEach((a) => a.addEventListener("click", (ev) => { ev.preventDefault(); eventView(Number(a.dataset.ev)); }));
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
                <td><strong>${esc(it.badgeName)}</strong> ${it.number}${esc(it.letter || "")}${it.title ? " — " + esc(it.title) : ""}</td>
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
            <input type="text" id="trk-plan-notes" placeholder="Plan notes (optional)" value="${esc(plan ? plan.notes || "" : "")}" style="flex:1;min-width:200px">
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
        },
      });
      addBtn.addEventListener("click", () => {
        const b = badgeCache[pickedBadge];
        const r = b.groups.flatMap((g) => g.requirements).find((x) => x.trackerId === reqSel.value);
        if (!r) return;
        items.push({ requirementId: r.trackerId, badgeName: b.name, number: r.number, letter: r.letter || "", title: r.title, role: "session" });
        draw();
      });

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
    await listView();
  });
})();
