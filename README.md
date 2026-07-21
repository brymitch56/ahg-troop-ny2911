# AHG Troop NY2911 Website

Website for American Heritage Girls Troop NY2911 — Rochester, NY. Hosted on GitHub Pages.

## Pages

- `index.html` — landing page (meeting info, about the troop)
- `calendar.html` — public calendar fed by an iCal (.ics) feed
- `members.html` — password-gated link to the troop SharePoint
- `giving.html` — embedded Zeffy payment/fundraiser form

## Updating the site

Everything configurable lives in **`assets/config.js`**: meeting info, contact email, iCal feed URL, SharePoint URL, Zeffy embed URL, and the members-area password hash. Edit that one file and commit — no other changes needed.

To change the members password: open the site in a browser, press F12, and in the console run `sha256("YourNewPassword").then(console.log)`, then paste the result into `passwordSha256` in `assets/config.js`.

Note: the password gate is a courtesy screen, not real security. The SharePoint site's own Microsoft sign-in is what protects troop data.

## Custom domain

When ready, add the domain in the repo Settings → Pages → Custom domain, and create the DNS records GitHub shows there.
