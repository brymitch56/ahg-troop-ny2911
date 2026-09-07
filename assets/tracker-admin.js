// ============================================================
//  Badge Admin (leaders area): sync status and buttons,
//  AHGFamily credentials + girl↔AHGFamily mapping, conflicts,
//  the push queue (idle until the push feature ships), catalog
//  versions, audit. Admin-only actions are hidden for plain
//  leaders (the API enforces this regardless).
// ============================================================
(function () {
  "use strict";
  const { init, api, esc, toast, fmtDate, $ } = window.Tracker;
  const root = () => $("pg-admin");
  let me = { role: "leader" };

  const pill = (v) => `<span class="trk-pill ${esc(v)}">${esc(v)}</span>`;

  function shell() {
    root().innerHTML = `
      ${me.role !== "admin" ? `<p class="placeholder-note">You're a leader, not an admin — settings and sync actions are read-only here.</p>` : ""}
      <div class="trk-panel" id="trk-status"><h3>Status</h3><p class="trk-muted">Loading…</p></div>
      <div class="trk-panel" id="trk-conflicts"><h3>Conflicts</h3><p class="trk-muted">Loading…</p></div>
      <div class="trk-panel" id="trk-mapping"><h3>Girl ↔ AHGFamily mapping</h3><p class="trk-muted">Loading…</p></div>
      <div class="trk-panel" id="trk-queue"><h3>Push queue</h3><p class="trk-muted">Loading…</p></div>
      <div class="trk-panel" id="trk-access"><h3>Leaders &amp; admins</h3><p class="trk-muted">Loading…</p></div>
      <div class="trk-panel" id="trk-creds"><h3>AHGFamily credentials</h3><p class="trk-muted">Loading…</p></div>
      <div class="trk-panel" id="trk-catalog"><h3>Badge catalog</h3><p class="trk-muted">Loading…</p></div>
      <div class="trk-panel" id="trk-audit"><h3>Recent activity</h3><p class="trk-muted">Loading…</p></div>
    `;
    statusPanel(); conflictsPanel(); mappingPanel(); queuePanel(); accessPanel(); credsPanel(); catalogPanel(); auditPanel();
  }
  const guard = (fn) => async () => { try { await fn(); } catch (e) { toast(e.message, true); } };

  // ---------------------------------------------------------- status ----
  async function statusPanel() {
    const s = await api("/sync/status");
    const el = $("trk-status");
    el.innerHTML = `
      <h3>Status</h3>
      <div class="trk-statusline">
        <span>Check-in: ${s.checkinConfigured ? pill("ok") : pill("off")}</span>
        <span>AHGFamily: ${pill(s.ahgfamily)}</span>
        <span>Webhook deliveries: ${s.webhookDeliveries}</span>
        <span>Open conflicts: ${s.openConflicts}</span>
      </div>
      ${s.runs.length ? `<div class="trk-wrap"><table class="trk-table">
        <thead><tr><th>Job</th><th>Last run</th><th>Result</th></tr></thead>
        <tbody>${s.runs.map((r) => `<tr>
          <td>${esc(r.kind)}</td>
          <td class="trk-muted">${fmtDate(r.startedAt)} ${new Date(r.startedAt).toLocaleTimeString()}</td>
          <td>${r.ok === null ? pill("queued") : r.ok ? pill("ok") : `${pill("failed")} <span class="trk-muted">${esc(r.error || "")}</span>`}</td>
        </tr>`).join("")}</tbody></table></div>` : `<p class="trk-muted">No sync has run yet.</p>`}
      ${me.role === "admin" ? `<div class="trk-row-tools">
        <button class="btn btn-blue btn-sm" id="trk-sync-checkin">Sync check-in now</button>
        <button class="btn btn-blue btn-sm" id="trk-sync-pull">Pull from AHGFamily now</button>
        <span class="trk-muted">The pull signs in to AHGFamily (read-only). One failed login latches everything until credentials are re-entered.</span>
      </div>` : ""}
    `;
    if (me.role === "admin") {
      $("trk-sync-checkin").addEventListener("click", guard(async () => {
        toast("Syncing…");
        await api("/sync/checkin", { method: "POST" });
        toast("Check-in sync finished");
        statusPanel();
      }));
      $("trk-sync-pull").addEventListener("click", guard(async () => {
        toast("Pulling from AHGFamily — this can take a minute…");
        const r = await api("/sync/pull", { method: "POST" });
        toast(`Pull finished: ${r.checked} checked items, ${r.newFromAhg} new here, ${r.queued} queued, ${r.conflicts} conflicts`);
        shell();
      }));
    }
  }

  // -------------------------------------------------------- conflicts ---
  async function conflictsPanel() {
    const list = await api("/conflicts");
    const el = $("trk-conflicts");
    el.innerHTML = `
      <h3>Conflicts</h3>
      ${list.length ? `<div class="trk-wrap"><table class="trk-table">
        <thead><tr><th>Girl</th><th>Requirement</th><th>What happened</th><th></th></tr></thead>
        <tbody>${list.map((c) => `<tr>
          <td>${esc(c.firstName)} ${esc(c.lastName)}</td>
          <td>${esc(c.badgeName || "")} ${c.number != null ? c.number + esc(c.letter || "") : ""}</td>
          <td class="trk-muted">Complete here, but un-checked on AHGFamily (${fmtDate(c.detectedAt)})</td>
          <td style="white-space:nowrap">
            <button class="btn btn-outline btn-sm" data-res="accept_ahgfamily" data-id="${c.id}">AHGFamily is right</button>
            <button class="btn btn-outline btn-sm" data-res="keep_tracker" data-id="${c.id}">Tracker is right</button>
          </td>
        </tr>`).join("")}</tbody></table></div>
      <p class="trk-muted">"AHGFamily is right" retracts the tracker's record; "Tracker is right" queues it to push again once pushing ships.</p>`
        : `<p class="trk-muted">No open conflicts — the tracker and AHGFamily agree.</p>`}
    `;
    el.querySelectorAll("[data-res]").forEach((b) => b.addEventListener("click", guard(async () => {
      await api(`/conflicts/${b.dataset.id}/resolve`, { body: { resolution: b.dataset.res } });
      toast("Resolved");
      conflictsPanel(); statusPanel(); queuePanel();
    })));
  }

  // ---------------------------------------------------------- mapping ---
  async function mappingPanel() {
    const el = $("trk-mapping");
    if (me.role !== "admin") { el.innerHTML = `<h3>Girl ↔ AHGFamily mapping</h3><p class="trk-muted">Admins only.</p>`; return; }
    const m = await api("/admin/mapping");
    const youthName = (id) => { const y = m.youth.find((x) => x.id === id); return y ? y.name : id; };
    el.innerHTML = `
      <h3>Girl ↔ AHGFamily mapping</h3>
      <p class="trk-muted">${m.fetchedAt ? `AHGFamily member list fetched ${fmtDate(m.fetchedAt)} (${m.youth.length} youth).` : "The AHGFamily member list hasn't been fetched yet."}
        ${m.latched ? ' <span class="trk-pill latched">latched</span>' : ""}</p>
      <div class="trk-row-tools"><button class="btn btn-blue btn-sm" id="trk-map-refresh">Refresh from AHGFamily</button></div>
      ${m.unmappedGirls.length ? `<div class="trk-wrap"><table class="trk-table">
        <thead><tr><th>Girl (roster)</th><th>AHGFamily match</th><th></th></tr></thead>
        <tbody>${m.unmappedGirls.map((g) => {
          const sug = m.suggestions.find((s) => s.girlId === g.id);
          const free = m.youth.filter((y) => !y.girlId);
          return `<tr>
            <td>${esc(g.lastName)}, ${esc(g.firstName)}${g.ahgLevel ? ` <span class="trk-muted">(${esc(g.ahgLevel)})</span>` : ""}</td>
            <td><select data-map-girl="${g.id}">
              <option value="">— pick —</option>
              ${free.map((y) => `<option value="${esc(y.id)}" ${sug && sug.ahgYouthId === y.id ? "selected" : ""}>${esc(y.name)}${sug && sug.ahgYouthId === y.id ? " (suggested)" : ""}</option>`).join("")}
            </select></td>
            <td><button class="btn btn-outline btn-sm" data-map-confirm="${g.id}">Confirm</button></td>
          </tr>`;
        }).join("")}</tbody></table></div>`
        : `<p class="trk-muted">Every active girl on the roster is mapped${m.youth.length ? "" : " (or the AHGFamily list hasn't been fetched)"}.</p>`}
    `;
    $("trk-map-refresh").addEventListener("click", guard(async () => {
      toast("Signing in to AHGFamily…");
      await api("/admin/mapping/refresh", { method: "POST" });
      toast("Member list refreshed");
      mappingPanel();
    }));
    el.querySelectorAll("[data-map-confirm]").forEach((b) => b.addEventListener("click", guard(async () => {
      const girlId = Number(b.dataset.mapConfirm);
      const sel = el.querySelector(`[data-map-girl="${girlId}"]`);
      if (!sel.value) { toast("Pick an AHGFamily member first"); return; }
      if (!window.confirm(`Map this girl to "${youthName(sel.value)}" on AHGFamily?`)) return;
      await api("/admin/mapping/confirm", { body: [{ girlId, ahgYouthId: sel.value }] });
      toast("Mapped");
      mappingPanel();
    })));
  }

  // ------------------------------------------------------------ queue ---
  async function queuePanel() {
    const rows = await api("/sync/queue");
    const el = $("trk-queue");
    el.innerHTML = `
      <h3>Push queue</h3>
      ${rows.length ? `<div class="trk-wrap"><table class="trk-table">
        <thead><tr><th>Girl</th><th>Item</th><th>Date</th><th>Status</th></tr></thead>
        <tbody>${rows.slice(0, 50).map((q) => `<tr>
          <td>${esc(q.firstName)} ${esc(q.lastName)}</td>
          <td>${esc(q.badgeName || "")} ${q.number != null ? q.number + esc(q.letter || "") : ""} <span class="trk-muted">${esc(q.action)}</span></td>
          <td class="trk-muted">${q.date ? fmtDate(q.date) : ""}</td>
          <td>${pill(q.status)}${q.lastError ? ` <span class="trk-muted">${esc(q.lastError)}</span>` : ""}</td>
        </tr>`).join("")}</tbody></table></div>
      <p class="trk-muted">Items confirmed here but missing on AHGFamily wait in this queue. Pushing to AHGFamily is a later, explicitly-enabled step — nothing is sent yet.</p>`
        : `<p class="trk-muted">The queue is empty.</p>`}
    `;
  }

  // ----------------------------------------------------- leaders/admins ---
  async function accessPanel() {
    const el = $("trk-access");
    if (me.role !== "admin") { el.innerHTML = `<h3>Leaders &amp; admins</h3><p class="trk-muted">Admins only.</p>`; return; }
    const v = await api("/admin/access");
    // working copy: [{ email, role }]
    const rows = [
      ...v.adminEmails.map((e) => ({ email: e, role: "admin" })),
      ...v.leaderEmails.filter((e) => !v.adminEmails.includes(e)).map((e) => ({ email: e, role: "leader" })),
    ];
    const draw = () => {
      el.innerHTML = `
        <h3>Leaders &amp; admins</h3>
        <p class="trk-muted">Who can use these badge pages, by their Microsoft sign-in e-mail. Leaders plan and confirm; admins also manage settings, sync, and this list. Changes apply immediately.</p>
        ${v.env.adminEmails.length || v.env.leaderEmails.length || v.leaderGroupConfigured ? `<p class="trk-muted">Always allowed (set on the server, not editable here):
          ${v.env.adminEmails.map((e) => `<span class="trk-pill ok">${esc(e)} · admin</span>`).join(" ")}
          ${v.env.leaderEmails.map((e) => `<span class="trk-pill mut">${esc(e)} · leader</span>`).join(" ")}
          ${v.leaderGroupConfigured ? '<span class="trk-pill mut">a Microsoft security group also grants leader access</span>' : ""}</p>` : ""}
        ${rows.length ? `<div class="trk-wrap"><table class="trk-table">
          <thead><tr><th>E-mail</th><th>Role</th><th></th></tr></thead>
          <tbody>${rows.map((r, i) => `
            <tr>
              <td>${esc(r.email)}</td>
              <td><select data-acc-role="${i}"><option value="leader" ${r.role === "leader" ? "selected" : ""}>leader</option><option value="admin" ${r.role === "admin" ? "selected" : ""}>admin</option></select></td>
              <td><button class="btn-link trk-danger" data-acc-del="${i}">remove</button></td>
            </tr>`).join("")}</tbody>
        </table></div>` : `<p class="trk-muted">No one added here yet.</p>`}
        <div class="trk-row-tools">
          <input type="text" id="trk-acc-email" placeholder="name@church-tenant e-mail" autocomplete="off" style="min-width:230px">
          <select id="trk-acc-newrole"><option value="leader">leader</option><option value="admin">admin</option></select>
          <button class="btn btn-outline btn-sm" id="trk-acc-add">Add</button>
          <button class="btn btn-blue btn-sm" id="trk-acc-save">Save list</button>
        </div>`;
      el.querySelectorAll("[data-acc-role]").forEach((sel) => sel.addEventListener("change", () => { rows[Number(sel.dataset.accRole)].role = sel.value; }));
      el.querySelectorAll("[data-acc-del]").forEach((b) => b.addEventListener("click", () => { rows.splice(Number(b.dataset.accDel), 1); draw(); }));
      $("trk-acc-add").addEventListener("click", () => {
        const email = $("trk-acc-email").value.trim().toLowerCase();
        if (!email || !email.includes("@")) { toast("Enter an e-mail address"); return; }
        if (rows.some((r) => r.email === email)) { toast("Already on the list"); return; }
        rows.push({ email, role: $("trk-acc-newrole").value });
        draw();
      });
      $("trk-acc-save").addEventListener("click", guard(async () => {
        await api("/admin/access", { body: {
          leaderEmails: rows.filter((r) => r.role === "leader").map((r) => r.email),
          adminEmails: rows.filter((r) => r.role === "admin").map((r) => r.email),
        } });
        toast("Saved — changes are live");
        accessPanel();
      }));
    };
    draw();
  }

  // ------------------------------------------------------ credentials ---
  function credsPanel() {
    const el = $("trk-creds");
    if (me.role !== "admin") { el.innerHTML = `<h3>AHGFamily credentials</h3><p class="trk-muted">Admins only.</p>`; return; }
    el.innerHTML = `
      <h3>AHGFamily credentials</h3>
      <p class="trk-muted">The troop's AHGFamily sign-in, used read-only for the weekly pull and the mapping screen. Stored encrypted on the Pi; re-entering clears an auth latch.</p>
      <div class="trk-row-tools">
        <input type="text" id="trk-cred-email" placeholder="AHGFamily e-mail" autocomplete="off">
        <input type="password" id="trk-cred-pass" placeholder="Password" autocomplete="new-password">
        <button class="btn btn-blue btn-sm" id="trk-cred-save">Save</button>
      </div>
    `;
    $("trk-cred-save").addEventListener("click", guard(async () => {
      const email = $("trk-cred-email").value.trim();
      const password = $("trk-cred-pass").value;
      if (!email || !password) { toast("E-mail and password required"); return; }
      await api("/admin/ahgfamily/credentials", { body: { email, password } });
      $("trk-cred-pass").value = "";
      toast("Credentials stored (encrypted); latch cleared");
      statusPanel(); mappingPanel();
    }));
  }

  // ---------------------------------------------------------- catalog ---
  async function catalogPanel() {
    const el = $("trk-catalog");
    if (me.role !== "admin") { el.innerHTML = `<h3>Badge catalog</h3><p class="trk-muted">Admins only.</p>`; return; }
    const c = await api("/admin/catalog");
    el.innerHTML = `
      <h3>Badge catalog</h3>
      <p class="trk-muted">${c.current ? `Version ${c.current.id}: ${c.current.badge_count} badges, ${c.current.requirement_count} requirements (imported ${fmtDate(c.current.imported_at)}).` : "No catalog imported yet."}
      New badge builds are copied to the Pi and imported with <code>npm run import:catalog</code> (or the button below re-imports the folder already there).</p>
      <div class="trk-row-tools"><button class="btn btn-outline btn-sm" id="trk-cat-import">Re-import data/badges</button></div>
    `;
    $("trk-cat-import").addEventListener("click", guard(async () => {
      const r = await api("/admin/catalog/import", { method: "POST" });
      toast(`Imported version ${r.version}: ${r.badges} badges`);
      catalogPanel();
    }));
  }

  // ------------------------------------------------------------ audit ---
  async function auditPanel() {
    const el = $("trk-audit");
    if (me.role !== "admin") { el.innerHTML = `<h3>Recent activity</h3><p class="trk-muted">Admins only.</p>`; return; }
    const rows = await api("/admin/audit?limit=25");
    el.innerHTML = `
      <h3>Recent activity</h3>
      ${rows.length ? `<div class="trk-wrap"><table class="trk-table">
        <thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead>
        <tbody>${rows.map((a) => `<tr>
          <td class="trk-muted" style="white-space:nowrap">${fmtDate(a.at)} ${new Date(a.at).toLocaleTimeString()}</td>
          <td>${esc(a.actor)}</td>
          <td>${esc(a.action)} <span class="trk-muted">${esc(a.entity || "")} ${esc(a.entity_id || "")}</span></td>
        </tr>`).join("")}</tbody></table></div>` : `<p class="trk-muted">Nothing yet.</p>`}
    `;
  }

  init(async () => {
    me = await api("/me");
    shell();
  });
})();
