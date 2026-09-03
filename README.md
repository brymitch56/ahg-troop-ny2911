# AHG Troop NY2911 Website

Website for American Heritage Girls Troop NY2911 — Rochester, NY. Hosted on GitHub Pages at https://ahg2911.org.

## Pages

- `index.html` — landing page (meeting info, about the troop)
- `calendar.html` — public calendar fed by an iCal (.ics) feed
- `leaders.html` — leaders sign in with their Microsoft account and manage the troop SharePoint libraries (badge plans, accounting, planning): browse, search, upload, folders, rename, move, delete, download
- `giving.html` — embedded Zeffy payment/fundraiser form

## Updating the site

Everything configurable lives in **`assets/config.js`**: meeting info, contact email, iCal feed URL, the leaders-area Microsoft app settings, and the Zeffy embed URL. Edit that one file and commit — no other changes needed.

## Leaders area

The Leaders page uses Microsoft sign-in (MSAL) and Microsoft Graph to read and manage files on the troop SharePoint site. Each leader signs in with their own account, so access is controlled entirely by SharePoint permissions — there is no shared password and the site never stores documents.

One-time setup (an Entra app registration in the troop's Microsoft 365 tenant) is described in **[`docs/LEADERS-SETUP.md`](docs/LEADERS-SETUP.md)**. Until that's done, the page shows a "not configured yet" notice.

## Custom domain

The domain is set in `CNAME`. To change it, update that file and the DNS records shown under repo Settings → Pages → Custom domain.
