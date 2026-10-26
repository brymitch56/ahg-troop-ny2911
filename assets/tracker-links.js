// ============================================================
//  "Links & files" on a plan — shared by the Planning and Faith
//  pages. One block per thing on the plan that can carry links
//  (a badge, a faith badge or Faith Award study, a Bible study):
//  paste a web link, upload into SharePoint, pick existing
//  SharePoint files, and add or hide its "previously used" links
//  (the tracker's link library, filled by every plan save).
// ============================================================
(function () {
  "use strict";
  const { api, esc, toast, fmtDate } = window.Tracker;

  // owner = { badgeId } | { studyId }; a link carries its owner's field
  const ownerKey = (o) => (o.badgeId != null ? "b:" + o.badgeId : "s:" + o.studyId);
  const ownerOf = (l) => (l.badgeId != null ? { badgeId: l.badgeId } : { studyId: l.studyId });
  const libraryPath = (o) => (o.badgeId != null ? `/badges/${encodeURIComponent(o.badgeId)}` : `/faith/studies/${o.studyId}`);
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (_) { return ""; } };
  const kindPill = (l) => `<span class="trk-pill ${l.kind === "sharepoint" ? "ok" : "mut"}">${l.kind === "sharepoint" ? "SharePoint" : "Web"}</span>`;

  const library = {}; // libraryPath → that owner's previously used links

  /** Forget the cached suggestions (a save has just filed new links). */
  const forget = () => { for (const k of Object.keys(library)) delete library[k]; };

  /** Drop links whose owner is no longer among `groups` (in place). */
  function prune(links, groups) {
    const keep = new Set(groups.map((g) => ownerKey(g.owner)));
    for (let k = links.length - 1; k >= 0; k--) if (!keep.has(ownerKey(links[k]))) links.splice(k, 1);
  }

  /** The links as the tracker's PUT body wants them. */
  const toBody = (links) => links.map((l) => ({
    ...ownerOf(l), url: l.url, title: l.title, kind: l.kind, driveId: l.driveId || undefined, itemId: l.itemId || undefined,
  }));

  /**
   * Draw the section into `host`. groups: [{ owner, name, folder }] — folder
   * is where uploads go ({ library, path }, see tracker-sp.js). `links` is
   * the plan's working array, changed in place; onChange() marks the plan
   * dirty. `unit` names this plan's unit, so uses by other units say so.
   */
  function panel(host, { groups, links, unit, onChange }) {
    const SP = window.TrackerSP;
    const spOk = !!(SP && SP.available());
    const changed = () => { if (onChange) onChange(); draw(); };
    const addLink = (l) => {
      if (links.some((x) => ownerKey(x) === ownerKey(l) && x.url === l.url)) { toast(`“${l.title}” is already on this plan`); return false; }
      links.push(l);
      return true;
    };

    function draw() {
      if (!groups.length) { host.innerHTML = ""; return; }
      host.innerHTML = `<h4 class="trk-links-h">Links &amp; files</h4>${groups.map((g, gi) => {
        const mine = links.map((l, i) => ({ l, i })).filter(({ l }) => ownerKey(l) === ownerKey(g.owner));
        return `<div class="trk-links-badge" data-lgroup="${gi}">
          <div class="trk-links-title"><strong>${esc(g.name)}</strong></div>
          ${mine.length ? `<ul class="trk-links">${mine.map(({ l, i }) => `<li>
              ${kindPill(l)}
              <a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.title)}</a>
              <span class="trk-muted">${esc(l.kind === "sharepoint" ? "" : hostOf(l.url))}</span>
              <button class="btn-link trk-danger" data-ldel="${i}">remove</button></li>`).join("")}</ul>` : '<p class="trk-muted" style="margin:0.2rem 0">No links yet.</p>'}
          <div class="trk-row-tools trk-links-add">
            <input type="url" data-lurl placeholder="Paste a web address (https://…)" style="flex:2;min-width:12rem">
            <input type="text" data-ltitle placeholder="Name (optional)" style="flex:1;min-width:8rem">
            <button class="btn btn-outline btn-sm" data-ladd>Add link</button>
            ${spOk ? `<button class="btn btn-outline btn-sm" data-lup title="Upload into ${esc(SP.folderLabel(g.folder))} on the troop SharePoint">Upload file…</button>
            <input type="file" data-lfile multiple hidden>
            <button class="btn btn-outline btn-sm" data-lpick>Choose from SharePoint…</button>` : ""}
          </div>
          <div class="trk-muted" data-lstatus></div>
          <div class="trk-links-sugg" data-lsugg></div>
        </div>`;
      }).join("")}`;
      host.querySelectorAll("[data-ldel]").forEach((btn) => btn.addEventListener("click", () => { links.splice(Number(btn.dataset.ldel), 1); changed(); }));
      host.querySelectorAll("[data-lgroup]").forEach((blk) => {
        const g = groups[Number(blk.dataset.lgroup)];
        const status = blk.querySelector("[data-lstatus]");
        blk.querySelector("[data-ladd]").addEventListener("click", () => {
          const raw = blk.querySelector("[data-lurl]").value.trim();
          if (!raw) { toast("Paste a web address first"); return; }
          let url;
          try { url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : "https://" + raw); } catch (_) { toast("That isn't a web address", true); return; }
          if (!/^https?:$/.test(url.protocol)) { toast("Only http and https links can be saved", true); return; }
          const title = blk.querySelector("[data-ltitle]").value.trim() || decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || url.hostname);
          if (addLink({ ...g.owner, url: url.href, title, kind: "web" })) changed();
        });
        if (spOk) {
          const fileIn = blk.querySelector("[data-lfile]");
          blk.querySelector("[data-lup]").addEventListener("click", () => fileIn.click());
          fileIn.addEventListener("change", async () => {
            const files = Array.from(fileIn.files || []);
            fileIn.value = "";
            let added = 0;
            for (const f of files) {
              status.textContent = `Uploading ${f.name}…`;
              try {
                const it = await SP.upload(f, g.folder, (p) => { status.textContent = `Uploading ${f.name}… ${Math.round(p * 100)}%`; });
                if (it && addLink(SP.asLink(g.owner, it))) added += 1;
              } catch (e) { toast(`${f.name}: ${e.message}`, true); }
            }
            status.textContent = "";
            if (added) { toast(`Uploaded ${added} file${added === 1 ? "" : "s"} to SharePoint — save the plan to keep the link${added === 1 ? "" : "s"} on it`); changed(); }
          });
          blk.querySelector("[data-lpick]").addEventListener("click", async () => {
            const picked = await SP.pick(g.name, g.folder);
            let added = 0;
            for (const it of picked) if (it.webUrl && addLink(SP.asLink(g.owner, it))) added += 1;
            if (added) changed();
          });
        }
        suggestions(blk.querySelector("[data-lsugg]"), g);
      });
    }

    // the owner's library, minus what's already on this plan
    async function suggestions(box, g, fresh) {
      const path = libraryPath(g.owner);
      let lib;
      try {
        if (fresh || !library[path]) library[path] = await api(`${path}/links`);
        lib = library[path];
      } catch (e) { box.innerHTML = `<p class="trk-muted">Previously used links couldn't be loaded (${esc(e.message)}).</p>`; return; }
      const on = new Set(links.filter((l) => ownerKey(l) === ownerKey(g.owner)).map((l) => l.url));
      const offer = lib.filter((l) => !on.has(l.url));
      if (!offer.length) { box.innerHTML = ""; return; }
      const usedOn = (l) => {
        if (!l.uses.length) return "not on any plan now";
        const u = l.uses[0];
        return `used ${fmtDate(u.date)}${u.unit !== unit ? ` (${u.unit})` : ""}${l.uses.length > 1 ? ` + ${l.uses.length - 1} more` : ""}`;
      };
      box.innerHTML = `<div class="trk-muted" style="margin-top:0.4rem">Previously used for ${g.owner.badgeId != null ? "this badge" : "this study"}:</div>
        <ul class="trk-links">${offer.map((l) => `<li>
          <button class="btn btn-outline btn-sm" data-sadd="${l.id}" title="Put this link on the plan">+ Add</button>
          ${kindPill(l)}
          <a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.title)}</a>
          <span class="trk-muted">${esc(usedOn(l))}</span>
          <button class="btn-link trk-muted" data-shide="${l.id}" title="Stop suggesting this link here">hide</button></li>`).join("")}</ul>`;
      box.querySelectorAll("[data-sadd]").forEach((btn) => btn.addEventListener("click", () => {
        const l = offer.find((x) => String(x.id) === btn.dataset.sadd);
        if (addLink({ ...g.owner, url: l.url, title: l.title, kind: l.kind, driveId: l.driveId, itemId: l.itemId })) changed();
      }));
      box.querySelectorAll("[data-shide]").forEach((btn) => btn.addEventListener("click", async () => {
        const l = offer.find((x) => String(x.id) === btn.dataset.shide);
        if (!window.confirm(`Stop suggesting “${l.title}” for ${g.name}? Plans that already use it keep it, and adding it to a plan again brings it back.`)) return;
        try {
          await api(`${path}/links/${l.id}/hidden`, { body: { hidden: true } });
          suggestions(box, g, true);
        } catch (e) { toast(e.message, true); }
      }));
    }

    draw();
  }

  /**
   * Links on paper: the name and full address, grouped under `nameOf(owner)`
   * (owners in first-seen order). "" when there are none.
   */
  function printHtml(links, nameOf) {
    const keys = [...new Set((links || []).map(ownerKey))];
    if (!keys.length) return "";
    return `<h3>Links &amp; files</h3>${keys.map((k) => {
      const mine = links.filter((l) => ownerKey(l) === k);
      return `<p><strong>${esc(nameOf(ownerOf(mine[0])))}</strong></p>
        <ul class="text">${mine.map((l) => `<li>${esc(l.title)} — <span class="muted">${esc(l.url)}</span></li>`).join("")}</ul>`;
    }).join("")}`;
  }

  window.TrackerLinks = { panel, prune, forget, toBody, printHtml };
})();
