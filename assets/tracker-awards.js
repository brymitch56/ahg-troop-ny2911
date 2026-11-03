// ============================================================
//  Awards (leaders area): each level's Level Award, the Joining
//  Award, the Catholic Faith Awards, and Stars & Stripes
//  readiness, Tenderheart through Patriot. Pathfinders keep
//  theirs on the Pathfinder page. All data lives in the tracker
//  on the Pi.
// ============================================================
(function () {
  "use strict";
  const { init, api, esc, toast, fmtDate, $, matches, searchBox, getPref, setPref } = window.Tracker;
  const root = () => $("pg-awards");

  const LEVELS = ["Tenderheart", "Explorer", "Pioneer", "Patriot"];
  const VIEWS = [
    { key: "level", label: "Level awards" },
    { key: "joining", label: "Joining Award" },
    { key: "catholic", label: "Catholic Faith Awards" },
    { key: "stars", label: "Stars & Stripes" },
  ];
  const PUSH = { sent: ["ok", "on AHGFamily"], queued: ["warn", "to push"], held: ["err", "held — check AHGFamily"], failed: ["err", "push failed"], skipped: ["mut", "not pushed"] };

  let cat = null; // GET /awards
  let status = null; // GET /awards/status
  let view = getPref("awards.view", "level");
  let level = getPref("awards.level", "Tenderheart");
  let catholicId = null;
  let movedUp = false;
  let query = "";
  const open = new Set(); // expanded girls

  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const girlName = (g) => `${g.nickname || g.firstName} ${g.lastName}`;
  const reqLabel = (r) => `${r.number}${r.letter ? r.letter : ""}`;
  const levelOf = (l) => cat.levels.find((x) => x.level === l);
  const pagesLabel = (a) => (a.pages && a.pages.length ? ` · handbook p. ${a.pages.join(", ")}` : "");

  // the award on screen and the girls it applies to
  function current() {
    if (view === "joining") return cat.joining;
    if (view === "catholic") {
      const list = levelOf(level).catholic;
      return list.find((a) => a.badgeId === catholicId) || list[0] || null;
    }
    return levelOf(level).levelAward;
  }
  function girlsFor() {
    return status.girls.filter((g) => {
      if (!matches(query, girlName(g))) return false;
      if (view === "joining") return level === "all" || g.ahgLevel === level;
      if (g.ahgLevel === level) return true;
      return movedUp && LEVELS.indexOf(g.ahgLevel) > LEVELS.indexOf(level);
    });
  }

  async function reload() {
    [cat, status] = await Promise.all([api("/awards"), api("/awards/status")]);
    render();
  }

  function render() {
    if (!VIEWS.some((v) => v.key === view)) view = "level";
    if (view !== "joining" && level === "all") level = "Tenderheart";
    if (view === "stars" && level !== "Pioneer" && level !== "Patriot") level = "Patriot";
    root().innerHTML = `
      <div class="trk-chips">${VIEWS.map((v) => `<button class="trk-chip ${view === v.key ? "active" : ""}" data-view="${v.key}">${v.label}</button>`).join("")}</div>
      ${cat.missing.length ? `<div class="placeholder-note">${cat.missing.length} of these awards aren't in the tracker yet. An admin can add them with Admin → Re-import.</div>` : ""}
      <div class="trk-row-tools">
        <select id="aw-level" aria-label="Level">${view === "joining" ? '<option value="all">All levels</option>' : ""}
          ${LEVELS.filter((l) => view !== "stars" || l === "Pioneer" || l === "Patriot").map((l) => `<option value="${l}"${l === level ? " selected" : ""}>${l}</option>`).join("")}</select>
        ${view === "catholic" ? `<select id="aw-catholic" aria-label="Award">${levelOf(level).catholic.map((a) => `<option value="${esc(a.badgeId)}"${current() && current().badgeId === a.badgeId ? " selected" : ""}>${esc(a.name)}</option>`).join("")}</select>` : ""}
        ${searchBox("aw-q", query, "Search girls…")}
        ${view === "level" || view === "catholic" ? `<label class="trk-muted"><input type="checkbox" id="aw-moved"${movedUp ? " checked" : ""}> Include girls who have moved up</label>` : ""}
        <button class="btn btn-outline btn-sm" id="aw-print" title="Print this list (or save it as a PDF)">Print</button>
      </div>
      <div id="aw-body"></div>`;
    root().querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => { view = b.dataset.view; setPref("awards.view", view); render(); }));
    $("aw-level").addEventListener("change", (e) => { level = e.target.value; setPref("awards.level", level); catholicId = null; render(); });
    if ($("aw-catholic")) $("aw-catholic").addEventListener("change", (e) => { catholicId = e.target.value; body(); });
    if ($("aw-moved")) $("aw-moved").addEventListener("change", (e) => { movedUp = e.target.checked; body(); });
    $("aw-q").addEventListener("input", (e) => { query = e.target.value; body(); });
    $("aw-print").addEventListener("click", printList);
    body();
  }

  function body() {
    if (view === "stars") starsBody(); else awardBody();
  }

  // ------------------------------------------------ an award ------------
  function awardBody() {
    const a = current();
    if (!a) { $("aw-body").innerHTML = '<p class="trk-muted">This award isn\'t in the tracker yet.</p>'; return; }
    const girls = girlsFor();
    const rows = girls.map((g) => ({ g, st: g.awards[a.badgeId] })).filter((x) => x.st);
    const ready = rows.flatMap(({ g, st }) => a.requirements.filter((r) => st.items[r.id] && st.items[r.id].status === "ready").map((r) => ({ g, r, it: st.items[r.id] })));
    $("aw-body").innerHTML = `
      <details class="trk-panel"><summary><strong>${esc(a.name)}</strong> <span class="trk-muted">${a.requirements.length} requirements${pagesLabel(a)}</span></summary>
        ${a.intro ? a.intro.split("\n\n").map((p) => `<p>${esc(p)}</p>`).join("") : ""}
        ${a.textSource === "ahgfamily" ? '<p class="trk-muted">Requirement wording is AHGFamily\'s short titles.</p>' : ""}
      </details>
      ${ready.length ? `<div class="trk-panel"><h3>Ready to record <span class="trk-pill warn">${ready.length}</span></h3>
        <p class="trk-muted">Her record already shows these. Nothing is recorded until you do it; recording queues it for AHGFamily like any completion.</p>
        <div class="trk-wrap"><table class="trk-table"><thead><tr><th><input type="checkbox" id="aw-r-all" checked aria-label="Select all"></th><th>Girl</th><th>Requirement</th><th>Because</th><th>Date</th></tr></thead><tbody>
        ${ready.map((x, i) => `<tr><td><input type="checkbox" data-ready="${i}" checked></td><td>${esc(girlName(x.g))}</td><td>${reqLabel(x.r)} — ${esc(x.r.title)}</td><td>${esc(x.it.why)}</td>
          <td><input type="date" data-ready-date="${i}" value="${esc(x.it.completedOn || today())}"></td></tr>`).join("")}
        </tbody></table></div>
        <div class="trk-row-tools"><button class="btn btn-blue btn-sm" id="aw-r-go">Record selected</button></div></div>` : ""}
      ${rows.length ? `<div class="trk-wrap"><table class="trk-table">
        <thead><tr><th>Girl</th><th>Level</th><th>Done</th><th>Status</th></tr></thead>
        <tbody>${rows.map(({ g, st }) => `<tr>
          <td><a href="#" data-girl="${g.girlId}"><strong>${esc(girlName(g))}</strong></a>${g.mapped ? "" : '<div class="trk-muted" title="Not matched to AHGFamily yet — nothing can be pushed for her">not on AHGFamily yet</div>'}</td>
          <td>${esc(g.ahgLevel)}</td><td>${st.done}/${st.total}</td><td>${statusPills(st)}</td></tr>
          <tr class="pf-detail" data-detail="${g.girlId}"${open.has(g.girlId) ? "" : " hidden"}><td colspan="4">${girlDetail(g, a, st)}</td></tr>`).join("")}</tbody></table></div>`
        : `<p class="trk-muted">${status.girls.length ? "No girl matches." : "No active girls on the roster."}</p>`}`;

    $("aw-body").querySelectorAll("a[data-girl]").forEach((l) => l.addEventListener("click", (e) => {
      e.preventDefault();
      const id = Number(l.dataset.girl);
      if (open.has(id)) open.delete(id); else open.add(id);
      $("aw-body").querySelector(`[data-detail="${id}"]`).hidden = !open.has(id);
    }));
    if (ready.length) {
      $("aw-r-all").addEventListener("change", (e) => $("aw-body").querySelectorAll("[data-ready]").forEach((c) => { c.checked = e.target.checked; }));
      $("aw-r-go").addEventListener("click", async () => {
        const picks = [...$("aw-body").querySelectorAll("[data-ready]:checked")].map((c) => Number(c.dataset.ready));
        if (!picks.length) { toast("Nothing selected"); return; }
        const list = picks.map((i) => ({ x: ready[i], date: $("aw-body").querySelector(`[data-ready-date="${i}"]`).value }));
        if (list.some((p) => !p.date)) { toast("Every row needs a date", true); return; }
        await recordAll(list.map(({ x, date }) => ({ girlId: x.g.girlId, requirementId: x.r.id, completedOn: date, notes: x.it.why })));
      });
    }
    $("aw-body").querySelectorAll("[data-rec]").forEach((b) => b.addEventListener("click", () => {
      const [girlId, reqId] = [Number(b.dataset.recGirl), b.dataset.rec];
      const box = b.closest("[data-rec-row]");
      recordAll([{ girlId, requirementId: reqId, completedOn: box.querySelector("input[type=date]").value, notes: box.querySelector("input[type=text]").value }]);
    }));
    $("aw-body").querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => removeCompletion(Number(b.dataset.rm), b.dataset.pushed === "1")));
    $("aw-body").querySelectorAll("[data-print-girl]").forEach((b) => b.addEventListener("click", () => {
      const g = status.girls.find((x) => x.girlId === Number(b.dataset.printGirl));
      window.Tracker.printPage(`${a.name} — ${girlName(g)}`, girlSheet(g, a, g.awards[a.badgeId]));
    }));
  }

  const statusPills = (st) => (st.complete ? '<span class="trk-pill ok">earned</span>' : [
    st.ready ? `<span class="trk-pill warn">${st.ready} ready</span>` : "",
    st.pending ? `<a class="trk-pill warn" href="leaders-review.html">${st.pending} waiting on Review</a>` : "",
    !st.ready && !st.pending ? (st.done ? '<span class="trk-pill mut">under way</span>' : '<span class="trk-pill mut">not started</span>') : "",
  ].join(" "));

  function girlDetail(g, a, st) {
    return `<div class="aw-reqs">
      ${st.serviceYears && st.serviceYears.length ? `<p class="trk-muted">Approved service hours: ${st.serviceYears.map((y) => `${y.year}–${String(y.year + 1).slice(2)}: ${y.hours}`).join(" · ")}</p>` : ""}
      ${a.requirements.map((r) => reqRow(g, r, st.items[r.id])).join("")}
      <div class="trk-row-tools"><button class="btn-link" data-print-girl="${g.girlId}">Print her tracking sheet</button></div></div>`;
  }

  function reqRow(g, r, it) {
    const text = `<strong>${reqLabel(r)}</strong> ${esc(r.text)}${r.subItems.length ? `<ul>${r.subItems.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}`;
    if (it && it.status === "confirmed") {
      const p = it.push && PUSH[it.push.status];
      return `<div class="aw-req done"><div>✓ ${text}<div class="trk-muted">${fmtDate(it.completedOn)}${it.notes ? ` — ${esc(it.notes)}` : ""}</div></div>
        <div>${p ? `<span class="trk-pill ${p[0]}" title="${esc(it.push.error || "")}">${p[1]}</span> ` : ""}${it.source === "manual" ? `<button class="btn-link" data-rm="${it.completionId}" data-pushed="${it.push && it.push.status === "sent" ? 1 : 0}">remove</button>` : ""}</div></div>`;
    }
    if (it && it.status === "proposed") {
      return `<div class="aw-req"><div>… ${text}<div class="trk-muted">${fmtDate(it.completedOn)}</div></div><div><a class="trk-pill warn" href="leaders-review.html">waiting on Review</a></div></div>`;
    }
    return `<div class="aw-req" data-rec-row><div>○ ${text}${it && it.status === "ready" ? `<div class="trk-muted">Ready: ${esc(it.why)}</div>` : ""}</div>
      <div class="aw-rec"><input type="date" value="${esc((it && it.completedOn) || today())}" aria-label="Date"><input type="text" placeholder="Note" value="${esc((it && it.why) || "")}" aria-label="Note">
        <button class="btn btn-outline btn-sm" data-rec="${esc(r.id)}" data-rec-girl="${g.girlId}">Record</button></div></div>`;
  }

  async function recordAll(rows) {
    if (rows.some((r) => !r.completedOn)) { toast("Pick a date", true); return; }
    let done = 0;
    try {
      for (const body of rows) { await api("/completions", { body }); done += 1; }
      toast(`Recorded ${done} requirement${done === 1 ? "" : "s"}`);
    } catch (e) { toast(`${done} recorded, then: ${e.message}`, true); }
    await reload();
  }

  async function removeCompletion(id, pushed) {
    const msg = pushed
      ? "This is already on AHGFamily. Un-check it there by hand first. Has that been done?"
      : "Remove this completion?";
    if (!window.confirm(msg)) return;
    try {
      await api(`/completions/${id}${pushed ? "?afterAhgRemoval=1" : ""}`, { method: "DELETE" });
      toast("Removed");
      await reload();
    } catch (e) { toast(e.message, true); }
  }

  // ------------------------------------------------ Stars & Stripes -----
  function starsBody() {
    const s = cat.starsAndStripes;
    const girls = status.girls.filter((g) => g.starsAndStripes && g.ahgLevel === level && matches(query, girlName(g)));
    $("aw-body").innerHTML = `
      <div class="trk-panel"><h3>Stars & Stripes readiness</h3>
        <p class="trk-muted">The capstone award: it goes to AHG national for approval. AHGFamily doesn't track it, so these marks stay in the tracker and are never pushed. Badges and the Level Award fill in on their own. Application and full requirements: handbook pp. ${(s.pages || []).join("–")} and AHG's Stars & Stripes Award Guide.</p></div>
      ${girls.length ? `<div class="trk-wrap"><table class="trk-table"><thead><tr><th>Girl</th><th>${esc(s.prerequisite)} Level Award</th><th>Required badges</th><th>Done</th></tr></thead>
        <tbody>${girls.map((g) => { const st = g.starsAndStripes; return `<tr>
          <td><a href="#" data-girl="${g.girlId}"><strong>${esc(girlName(g))}</strong></a></td>
          <td>${st.prerequisite.done ? '<span class="trk-pill ok">earned</span>' : '<span class="trk-pill mut">not yet</span>'}</td>
          <td>${st.required.filter((r) => r.done).length}/${st.required.length}</td><td>${st.done}/${st.total}</td></tr>
          <tr class="pf-detail" data-detail="${g.girlId}"${open.has(g.girlId) ? "" : " hidden"}><td colspan="4">${starsDetail(g)}</td></tr>`; }).join("")}</tbody></table></div>`
        : `<p class="trk-muted">No ${esc(level)} matches.</p>`}`;
    $("aw-body").querySelectorAll("a[data-girl]").forEach((l) => l.addEventListener("click", (e) => {
      e.preventDefault();
      const id = Number(l.dataset.girl);
      if (open.has(id)) open.delete(id); else open.add(id);
      $("aw-body").querySelector(`[data-detail="${id}"]`).hidden = !open.has(id);
    }));
    $("aw-body").querySelectorAll("[data-mark]").forEach((b) => b.addEventListener("click", async () => {
      const box = b.closest("[data-rec-row]");
      const doneOn = box.querySelector("input[type=date]").value;
      if (!doneOn) { toast("Pick a date", true); return; }
      try {
        await api("/awards/stars/mark", { body: { girlId: Number(b.dataset.markGirl), step: b.dataset.mark, doneOn, notes: box.querySelector("input[type=text]").value } });
        await reload();
      } catch (e) { toast(e.message, true); }
    }));
    $("aw-body").querySelectorAll("[data-unmark]").forEach((b) => b.addEventListener("click", async () => {
      try {
        await api("/awards/stars/unmark", { body: { girlId: Number(b.dataset.unmarkGirl), step: b.dataset.unmark } });
        await reload();
      } catch (e) { toast(e.message, true); }
    }));
  }

  function starsDetail(g) {
    const st = g.starsAndStripes;
    const frontiers = [...new Set(st.required.map((r) => r.frontier))];
    return `<div class="aw-reqs">
      <h4 class="trk-yr-h4">Required badges</h4>
      ${frontiers.map((f) => `<div><span class="trk-muted">${esc(f)}:</span> ${st.required.filter((r) => r.frontier === f).map((r) => `${r.done ? "✓" : "○"} ${esc(r.name)}`).join(" · ")}</div>`).join("")}
      <h4 class="trk-yr-h4">Steps</h4>
      ${st.steps.map((x) => (x.done
        ? `<div class="aw-req done"><div>✓ ${esc(x.label)}<div class="trk-muted">${x.auto && !x.marked ? esc(x.auto) : `${fmtDate(x.doneOn)}${x.notes ? ` — ${esc(x.notes)}` : ""}`}</div></div><div>${x.marked ? `<button class="btn-link" data-unmark="${esc(x.key)}" data-unmark-girl="${g.girlId}">remove</button>` : ""}</div></div>`
        : `<div class="aw-req" data-rec-row><div>○ ${esc(x.label)}</div><div class="aw-rec"><input type="date" value="${today()}" aria-label="Date"><input type="text" placeholder="Note" aria-label="Note"><button class="btn btn-outline btn-sm" data-mark="${esc(x.key)}" data-mark-girl="${g.girlId}">Mark done</button></div></div>`)).join("")}
    </div>`;
  }

  // ------------------------------------------------ printing ------------
  function girlSheet(g, a, st) {
    return `<h1>${esc(a.name)}</h1><p class="meta">${esc(girlName(g))} · ${esc(g.ahgLevel)} · ${st.done} of ${st.total} done${pagesLabel(a)}</p>
      <table><thead><tr><th></th><th>Requirement</th><th>Date</th></tr></thead><tbody>
      ${a.requirements.map((r) => { const it = st.items[r.id]; return `<tr><td class="num">${it && it.status === "confirmed" ? "✓" : "☐"} ${reqLabel(r)}</td>
        <td>${esc(r.text)}${r.subItems.length ? `<ul>${r.subItems.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}${it && it.status === "ready" ? `<div class="muted">Ready: ${esc(it.why)}</div>` : ""}</td>
        <td>${it && it.status === "confirmed" ? fmtDate(it.completedOn) : ""}</td></tr>`; }).join("")}</tbody></table>`;
  }

  function printList() {
    if (view === "stars") {
      const girls = status.girls.filter((g) => g.starsAndStripes && g.ahgLevel === level && matches(query, girlName(g)));
      window.Tracker.printPage("Stars & Stripes readiness", `<h1>Stars & Stripes readiness</h1><p class="meta">${esc(level)}</p>
        ${girls.map((g) => { const st = g.starsAndStripes; return `<div class="section"><h2>${esc(girlName(g))}</h2>
          <p class="meta">${esc(st.prerequisite.name || "Level Award")}: ${st.prerequisite.done ? "earned" : "not yet"}</p>
          <table><tbody>${st.required.map((r) => `<tr><td class="num">${r.done ? "✓" : "☐"}</td><td>${esc(r.name)} <span class="muted">${esc(r.frontier)}</span></td></tr>`).join("")}
          ${st.steps.map((x) => `<tr><td class="num">${x.done ? "✓" : "☐"}</td><td>${esc(x.label)} <span class="muted">${x.auto && !x.marked ? esc(x.auto) : x.doneOn ? fmtDate(x.doneOn) : ""}</span></td></tr>`).join("")}</tbody></table></div>`; }).join("")}`);
      return;
    }
    const a = current();
    if (!a) return;
    const rows = girlsFor().filter((g) => g.awards[a.badgeId]);
    window.Tracker.printPage(a.name, `<h1>${esc(a.name)}</h1><p class="meta">${rows.length} girl${rows.length === 1 ? "" : "s"}${pagesLabel(a)}</p>
      <table><thead><tr><th>Girl</th><th>Level</th><th>Done</th><th>Still to do</th></tr></thead><tbody>
      ${rows.map((g) => { const st = g.awards[a.badgeId]; const left = a.requirements.filter((r) => !st.items[r.id] || st.items[r.id].status !== "confirmed");
        return `<tr><td>${esc(girlName(g))}</td><td>${esc(g.ahgLevel)}</td><td class="num">${st.done}/${st.total}</td><td>${st.complete ? "Earned" : left.map((r) => reqLabel(r)).join(", ")}</td></tr>`; }).join("")}</tbody></table>`);
  }

  init(async () => { await reload(); });
})();
