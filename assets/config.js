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
  // MEMBERS AREA: link to your SharePoint site, gated by a
  // shared password. To change the password:
  //   1. Open the browser console (F12) on any page of the site
  //   2. Run:  sha256("YourNewPassword").then(console.log)
  //   3. Paste the result below.
  // Current password: NY2911family
  // NOTE: this is a light gate, not real security — SharePoint's
  // own Microsoft sign-in is what actually protects your data.
  // -----------------------------------------------------------
  sharepointUrl: "REPLACE_WITH_SHAREPOINT_URL",
  passwordSha256: "732626e409d30e8780c0f16e4b72e10ee4a9085d5dedeb68ee77d2097b1aabd2",

  // -----------------------------------------------------------
  // GIVING: your Zeffy embed URL. In Zeffy: form → Share →
  // Embed → copy the URL inside src="..." of the iframe code.
  // -----------------------------------------------------------
  zeffyEmbedUrl: "REPLACE_WITH_ZEFFY_EMBED_URL"
};

// Helper used for password hashing (usable from the console too)
async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
