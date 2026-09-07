// ============================================================
//  LOCAL DEV ONLY — copy to assets/config.local.js (gitignored)
//  to test the leaders badge pages on your PC against the real
//  tracker on the Pi, before Entra/the tunnel exist.
//
//  1. On your PC:   ssh -L 3100:127.0.0.1:3100 <user>@192.168.86.125
//  2. On the Pi (that ssh window):
//       sudo systemctl stop ahg-badge-tracker
//       cd /opt/ahg-badge-tracker && AUTH_DISABLED=true \
//         SITE_ORIGIN=http://127.0.0.1:8080 node server/index.js
//  3. On your PC:   node scripts/serve-local.js   (in this repo)
//  4. Open http://127.0.0.1:8080/leaders-badges.html
//  When done: Ctrl+C both, then on the Pi:
//       sudo systemctl start ahg-badge-tracker
//
//  Never put these values in config.js and never deploy this
//  file — the pages show a "Development mode" banner while it
//  is active.
// ============================================================
window.TROOP_CONFIG.tracker = {
  baseUrl: "http://127.0.0.1:3100",
  scope: "REPLACE-WITH-TRACKER-SCOPE",
  authMode: "disabled"
};
