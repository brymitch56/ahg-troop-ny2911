// ============================================================
//  AHG Troop NY2911 — Site Configuration
//  Edit the values below, commit, and the site updates.
// ============================================================
window.TROOP_CONFIG = {
  troopNumber: "NY2911",

  // Meeting info (shown on the landing page)
  meetingDay: "Mondays, 6:30–8:00 PM",
  meetingLocation: "Harvest Bible Fellowship",
  meetingAddress: "1125 Calkins Road, Rochester, NY 14623",

  // Contact — replace with the troop's email address
  contactEmail: "ahgtroopny2911@outlook.com",

  // -----------------------------------------------------------
  // CALENDAR: the site reads data/calendar.ics, which a GitHub
  // Action refreshes hourly from the AHGfamily feed (the feed
  // blocks direct browser access). To change the source feed,
  // edit .github/workflows/sync-calendar.yml
  // -----------------------------------------------------------
  icalUrl: "data/calendar.ics",
  corsProxy: "",

  // -----------------------------------------------------------
  // LEADERS AREA: leaders sign in with their own Microsoft
  // account (MSAL) and the page reads the troop SharePoint site
  // through Microsoft Graph. Nothing here is secret — the app is
  // a public "single-page application" client. Setup steps for
  // the Entra app registration are in docs/LEADERS-SETUP.md.
  //
  //   clientId   — "Application (client) ID" from the app registration
  //   tenantId   — "Directory (tenant) ID" from the same page
  //   siteUrl    — the SharePoint site's home URL, e.g.
  //                https://contoso.sharepoint.com/sites/AHGLeaders
  //   libraries  — optional: only show these document libraries,
  //                in this order (names as they appear in SharePoint).
  //                Leave empty to show every library on the site.
  // -----------------------------------------------------------
  leaders: {
    clientId: "f6763f66-416b-4ac6-8a10-077737c57cbb",
    tenantId: "4a0d1b0b-b695-4650-8318-4aaca5358749",
    siteUrl: "https://harvestbibleroc.sharepoint.com/sites/AHG-2911",
    libraries: []
  },

  // -----------------------------------------------------------
  // GIVING: your Zeffy embed URL. In Zeffy: form → Share →
  // Embed → copy the URL inside src="..." of the iframe code.
  // -----------------------------------------------------------
  zeffyEmbedUrl: "https://www.zeffy.com/en-US/organizations/american-heritage-girls-ny2911-at-harvest-bible-fellowship"
};
