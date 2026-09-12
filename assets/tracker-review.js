// ============================================================
//  Review (leaders area): everything waiting on a leader from
//  meetings that have already ended — proposed requirement
//  completions across all events (filter by unit; select and
//  confirm/reject in bulk) and service-star proposals. The
//  per-event "After the meeting" tab on Planning still works;
//  this is the catch-up view.
// ============================================================
(function () {
  "use strict";
  const { init, api, esc, toast, fmtDate, $ } = window.Tracker;
  const root = () => $("pg-review");

  const UNITS = ["Tenderheart", "Explorer", "Pioneer/Patriot"];
  const KEY = "trk-review-unit";
  let unit = "";
  try { unit = localStorage.getItem(KEY) || ""; } catch (_) { /* storage blocked */ }
  if (unit && !UNITS.includes(unit)) unit = "";
  let undo = []; // rejected this session: [{ completionId, label }]

  async function view() {
    root().innerHTML = '<p class="trk-muted">Loading…</p>';
    let q; let stars;
    try {
      [q, stars] = await Promise.all([api(`/review${unit ? `?levelGroup=${encodeURIComponent(unit)}` : ""}`), api("/stars/proposals")]);
    } catch (e) { toast(e.message, true); return; }
    const all = q.levelGroups || {};
    const totalAll = Object.values(all).reduce((a, b) => a + b, 0);
    root().innerHTML = `
      <div class="trk-chips">
        <button class="trk-chip ${unit === "" ? "active" : ""}" data-unit="">All units${totalAll ? ` (${totalAll})` : ""}</button>
        ${UNITS.map((u) => `<button class="trk-chip ${unit === u ? "active" : ""}" data-unit="${esc(u)}">${esc(u)}${all[u] ? ` (${all[u]})` : ""}</button>`).join("")}
      </div>
      <p class="trk-muted">Items proposed by attendance at meetings that have ended, oldest first. The unit filter follows the plan the item came from and is remembered on this device. Confirming stamps the girl's current level; rejecting keeps the item from being proposed again for that meeting.</p>
      <div id="trk-rv-body"></div>
      <div id="trk-rv-stars"></div>
    `;
    root().querySelectorAll("[data-unit]").forEach((c) => c.addEventListener("click", () => {
      unit = c.dataset.unit;
      try { localStorage.setItem(KEY, unit); } catch (_) { /* storage blocked */ }
      view();
    }));
    renderQueue(q);
    renderStars(stars);
  }

  // A requirement planned over several meetings: list every planned date
  // with whether she was there. Missed dates get a warning and a box the
  // leader must tick to confirm — "she completed the full requirement" —
  // which is recorded and written into the AHGFamily note.
  function sessionsBlock(it) {
    const p = it.participation;
    const list = (p.sessions || []).map((s) => `<span class="trk-pill ${s.attended ? "ok" : "err"}" title="${esc(s.title)} (${esc(s.role)})">${s.attended ? "✓" : "✗"} ${fmtDate(s.date)}</span>`).join(" ");
    const missed = p.missed || [];
    return `<div class="trk-muted">Planned meetings: ${list || "—"}</div>
      ${missed.length ? `<div class="trk-rv-warn"><span class="trk-pill warn">missed ${missed.length} planned session${missed.length === 1 ? "" : "s"}</span>
        <label><input type="checkbox" class="trk-rv-verify" data-id="${it.completionId}"> I verified she completed the <b>full</b> requirement</label>
        <input type="text" class="trk-rv-note" data-id="${it.completionId}" placeholder="how it was completed (optional; goes into the AHGFamily note)" maxlength="200"></div>` : ""}`;
  }

  function renderQueue(q) {
    const body = $("trk-rv-body");
    if (!q.events.length) {
      body.innerHTML = `<div class="trk-panel"><p class="trk-muted">Nothing waiting${unit ? ` for ${esc(unit)}` : ""}. Proposals appear after girls sign out of a planned meeting (the tracker re-checks 30 minutes after it ends and on every sign-out).</p>${undoBlock()}</div>`;
      wireUndo(body);
      return;
    }
    body.innerHTML = `
      <div class="trk-row-tools trk-rv-bar">
        <label><input type="checkbox" id="trk-rv-all" checked> Select all (${q.total})</label>
        <button class="btn btn-blue btn-sm" id="trk-rv-confirm">Confirm selected</button>
        <button class="btn btn-outline btn-sm" id="trk-rv-reject">Reject selected</button>
        <span class="trk-muted" id="trk-rv-count"></span>
      </div>
      ${q.events.map((ev) => `
        <div class="trk-panel" data-ev="${ev.eventId}">
          <h3><label><input type="checkbox" class="trk-rv-ev" data-ev="${ev.eventId}" checked> ${fmtDate(ev.startAt)} · ${esc(ev.title)}</label> <span class="trk-pill proposed">${ev.count}</span>
            <a class="btn-link" href="leaders-planning.html#event=${ev.eventId}" title="Open this meeting on the Planning page">open meeting</a></h3>
          ${ev.girls.map((g) => `
            <div class="trk-rv-girl">
              <div class="trk-rv-girlhead"><label><input type="checkbox" class="trk-rv-girl-all" data-ev="${ev.eventId}" data-girl="${g.girlId}" checked> <strong>${esc(g.lastName)}, ${esc(g.firstName)}</strong></label> <span class="trk-pill mut">${esc(g.ahgLevel || "")}</span></div>
              <div class="trk-wrap"><table class="trk-table"><tbody>
                ${g.items.map((it) => `
                  <tr>
                    <td style="width:2rem"><input type="checkbox" class="trk-rv" data-id="${it.completionId}" data-ev="${ev.eventId}" data-girl="${g.girlId}" checked></td>
                    <td><strong>${esc(it.badgeName)}</strong> ${it.number}${esc(it.letter || "")}${it.title ? " — " + esc(it.title) : ""}
                      ${it.levelGroup ? ` <span class="trk-pill mut">${esc(it.levelGroup)}</span>` : ""}
                      ${it.needsReview ? `<div><span class="trk-pill err">needs review</span> <span class="trk-muted">${esc(it.reviewReason || "")}</span></div>` : ""}
                      ${it.participation ? sessionsBlock(it) : ""}</td>
                    <td style="white-space:nowrap"><input type="date" data-date="${it.completionId}" value="${esc(it.completedOn || "")}" title="Completion date (defaults to the meeting date)"></td>
                  </tr>`).join("")}
              </tbody></table></div>
            </div>`).join("")}
        </div>`).join("")}
      ${undoBlock()}
    `;
    const boxes = () => [...body.querySelectorAll(".trk-rv")];
    const count = () => { $("trk-rv-count").textContent = `${boxes().filter((b) => b.checked).length} of ${boxes().length} selected`; };
    const setAll = (sel, on) => { body.querySelectorAll(sel).forEach((b) => { b.checked = on; }); count(); };
    $("trk-rv-all").addEventListener("change", (e) => setAll(".trk-rv, .trk-rv-ev, .trk-rv-girl-all", e.target.checked));
    body.querySelectorAll(".trk-rv-ev").forEach((b) => b.addEventListener("change", () => setAll(`.trk-rv[data-ev="${b.dataset.ev}"], .trk-rv-girl-all[data-ev="${b.dataset.ev}"]`, b.checked)));
    body.querySelectorAll(".trk-rv-girl-all").forEach((b) => b.addEventListener("change", () => setAll(`.trk-rv[data-ev="${b.dataset.ev}"][data-girl="${b.dataset.girl}"]`, b.checked)));
    boxes().forEach((b) => b.addEventListener("change", count));
    count();
    const decide = (decision) => async () => {
      const chosen = boxes().filter((b) => b.checked);
      if (!chosen.length) { toast("Nothing selected", true); return; }
      if (decision === "reject" && !window.confirm(`Reject ${chosen.length} item(s)? They won't be proposed again for those meetings.`)) return;
      const decisions = chosen.map((b) => {
        const completionId = Number(b.dataset.id);
        const d = { completionId, decision };
        const dateEl = body.querySelector(`[data-date="${completionId}"]`);
        if (decision === "confirm" && dateEl && dateEl.value) d.completedOn = dateEl.value;
        const verifyEl = body.querySelector(`.trk-rv-verify[data-id="${completionId}"]`);
        if (decision === "confirm" && verifyEl) {
          d.verified = verifyEl.checked;
          const noteEl = body.querySelector(`.trk-rv-note[data-id="${completionId}"]`);
          if (noteEl && noteEl.value.trim()) d.note = noteEl.value.trim();
        }
        return d;
      });
      if (decision === "confirm") {
        const unverified = decisions.filter((d) => d.verified === false);
        if (unverified.length) {
          toast(`${unverified.length} selected item${unverified.length === 1 ? " has" : "s have"} missed sessions — tick "I verified…" on each, or uncheck them`, true);
          return;
        }
      }
      try {
        await api("/review/decide", { body: decisions });
        if (decision === "reject") undo = undo.concat(chosen.map((b) => ({ completionId: Number(b.dataset.id), label: b.closest("tr").querySelector("td:nth-child(2)").textContent.trim().slice(0, 60) })));
        toast(`${decisions.length} item${decisions.length === 1 ? "" : "s"} ${decision === "confirm" ? "confirmed" : "rejected"}`);
        view();
        window.Tracker.refreshBanner && window.Tracker.refreshBanner();
      } catch (e) { toast(e.message, true); }
    };
    $("trk-rv-confirm").addEventListener("click", decide("confirm"));
    $("trk-rv-reject").addEventListener("click", decide("reject"));
    wireUndo(body);
  }

  // Rejected rows stay in the database; a leader can put one back to
  // "proposed" through the regular manual path if needed — here we only
  // list what was rejected this session so a slip is visible.
  function undoBlock() {
    if (!undo.length) return "";
    return `<details class="trk-muted" style="margin-top:0.6rem"><summary>Rejected this session (${undo.length})</summary><ul>${undo.map((u) => `<li>${esc(u.label)}</li>`).join("")}</ul><p>Rejected items are kept in the tracker's history. If one was a slip, mark it done at home from the girl's Progress page.</p></details>`;
  }
  function wireUndo() { /* no interactive undo yet — see undoBlock */ }

  function renderStars(props) {
    const host = $("trk-rv-stars");
    if (!props.length) { host.innerHTML = ""; return; }
    host.innerHTML = `
      <div class="trk-panel">
        <h3>Service stars ready to confirm <span class="trk-pill proposed">${props.length}</span></h3>
        <p class="trk-muted">Approved hours on AHGFamily cover these stars. Confirming records the star here (dated today) and lines it up for AHGFamily. Full detail is on Progress → Service stars.</p>
        <div class="trk-wrap"><table class="trk-table">
          <thead><tr><th><input type="checkbox" id="trk-rs-all" checked aria-label="Select all"></th><th>Girl</th><th>Star</th><th>Hours at level</th></tr></thead>
          <tbody>${props.map((p) => `<tr>
            <td><input type="checkbox" class="trk-rs" data-id="${p.id}" checked></td>
            <td>${esc(p.lastName)}, ${esc(p.firstName)} <span class="trk-muted">${esc(p.ahgLevel || "")}</span></td>
            <td><strong>${esc(p.level)}</strong> star #${p.ordinal}</td>
            <td class="trk-muted">${esc(p.hoursDisplay)} h of ${p.rate}</td>
          </tr>`).join("")}</tbody>
        </table></div>
        <div class="trk-row-tools">
          <button class="btn btn-blue btn-sm" id="trk-rs-confirm">Confirm selected stars</button>
          <button class="btn btn-outline btn-sm" id="trk-rs-reject">Reject selected</button>
        </div>
      </div>`;
    const boxes = () => [...host.querySelectorAll(".trk-rs")];
    $("trk-rs-all").addEventListener("change", (e) => boxes().forEach((b) => { b.checked = e.target.checked; }));
    const decide = (decision) => async () => {
      const ids = boxes().filter((b) => b.checked).map((b) => Number(b.dataset.id));
      if (!ids.length) { toast("Nothing selected", true); return; }
      if (decision === "reject" && !window.confirm(`Reject ${ids.length} proposed star(s)?`)) return;
      try {
        await api("/stars/proposals/decide", { body: ids.map((id) => ({ id, decision })) });
        toast(`${ids.length} star(s) ${decision === "confirm" ? "confirmed" : "rejected"}`);
        view();
        window.Tracker.refreshBanner && window.Tracker.refreshBanner();
      } catch (e) { toast(e.message, true); }
    };
    $("trk-rs-confirm").addEventListener("click", decide("confirm"));
    $("trk-rs-reject").addEventListener("click", decide("reject"));
  }

  init(view);
})();
