# Leaders Area — One-Time Setup

The Leaders page (`leaders.html`) lets troop leaders sign in with their own Microsoft account and browse the troop SharePoint libraries right on the website. It uses Microsoft's MSAL library for sign-in and the Microsoft Graph API to read SharePoint.

It needs one thing from the person who manages the troop's Microsoft 365 / SharePoint: an **app registration** in Microsoft Entra ID. This takes about ten minutes and doesn't require any code changes. Nothing secret is involved — the website is a public "single-page application" client, so all it needs is two IDs that are safe to publish.

## How it works (for the admin)

- The website never stores files or credentials. It asks Microsoft to sign the leader in, receives a short-lived token in the browser, and calls Graph with it.
- Access is entirely governed by SharePoint permissions. If a leader can't see a library in SharePoint, they can't see it on the website either. Removing someone from the SharePoint site removes their access here too.
- Permissions requested are read-only (`User.Read`, `Sites.Read.All` — delegated, meaning "on behalf of the signed-in user", limited to what that user can already see). Leaders edit files by clicking through to SharePoint/Office, which opens in a new tab.
- Leaders stay signed in on their own device (tokens are cached in the browser and refreshed silently) until they click **Sign out**.

## Step 1 — Register the app in Entra ID

1. Go to https://entra.microsoft.com and sign in as an admin of the troop's tenant.
2. **Identity → Applications → App registrations → New registration.**
3. Fill in:
   - **Name:** `AHG NY2911 Website – Leaders`
   - **Supported account types:** *Accounts in this organizational directory only (Single tenant)*
   - **Redirect URI:** choose platform **Single-page application (SPA)** and enter
     `https://ahg2911.org/leaders.html`
4. Click **Register**.
5. On the Overview page copy two values — you'll paste them into the website config:
   - **Application (client) ID**
   - **Directory (tenant) ID**

> If leaders were invited to the tenant as guests (personal Microsoft accounts or accounts from another organization), Single tenant is still correct — guests sign in through the troop's tenant.

## Step 2 — Add redirect URIs for other addresses (optional but recommended)

Under **Authentication → Single-page application**, add any other address the page is served from, each ending in `/leaders.html`:

- `https://www.ahg2911.org/leaders.html` (if the www address resolves)
- `https://brymitch56.github.io/ahg-troop-ny2911/leaders.html` (GitHub's default address)
- `http://localhost:8000/leaders.html` (only if someone wants to test locally)

The sign-in fails with error **AADSTS50011** if the page's exact address isn't listed here. Leave the "Implicit grant" checkboxes unchecked — the SPA platform uses the newer auth-code flow.

## Step 3 — API permissions

Under **API permissions**:

1. The registration starts with **Microsoft Graph → User.Read** (delegated). Keep it.
2. **Add a permission → Microsoft Graph → Delegated permissions**, search for and add **`Sites.Read.All`**.
3. Click **Grant admin consent for <tenant>** and confirm.

`Sites.Read.All` (delegated) doesn't strictly require admin consent, but granting it up front means leaders won't each see a consent prompt on first sign-in — and if the tenant has user consent turned off, this step is required.

## Step 4 — Paste the settings into the website

Open `assets/config.js` in the repo and fill in the `leaders` block:

```js
leaders: {
  clientId: "11111111-2222-3333-4444-555555555555",   // Application (client) ID
  tenantId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",   // Directory (tenant) ID
  siteUrl:  "https://<tenant>.sharepoint.com/sites/<SiteName>",  // SharePoint site home URL
  libraries: []   // optional — see below
},
```

`siteUrl` is the address of the SharePoint site's home page (open the site, copy the URL up to the site name — don't include `/SitePages/Home.aspx` or a library path).

Commit the change. GitHub Pages redeploys in about a minute.

### Choosing which libraries appear

By default the page shows every document library on the site (except SharePoint's own system libraries), alphabetically. To show only certain libraries, or control the order, list their names exactly as they appear in SharePoint:

```js
libraries: ["Badge Planning", "Planning", "Accounting"]
```

A leader can bookmark a specific library: `https://ahg2911.org/leaders.html#Badge%20Planning`.

## Step 5 — Test

1. Open https://ahg2911.org/leaders.html and click **Sign in with Microsoft**.
2. Sign in with a leader account. You should land back on the page with the library tabs showing.
3. Browse a folder, try a search, and click a file to confirm it opens in SharePoint/Office.
4. Try a second leader's account, including a guest if you have one.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "The sign-in redirect address isn't registered" / AADSTS50011 | The page URL (including `www` or not) isn't in the SPA redirect list — Step 2. |
| "This app hasn't been approved for your account" / AADSTS65001 | Consent wasn't granted — Step 3. |
| "That Microsoft account isn't a member of the troop's organization" / AADSTS50020 | The leader signed in with an account that isn't in the tenant (e.g. a personal account that hasn't been invited). Invite them as a guest or have them use their troop account. |
| Signed in, but "your account doesn't have access to the troop SharePoint site" | The leader is in the tenant but not a member of the SharePoint site. Add them under Site permissions. |
| "The SharePoint site in config.js couldn't be found" | `siteUrl` is wrong or includes extra path segments. |
| Libraries show but a folder is empty that shouldn't be | Library-level or folder-level permissions exclude that leader — same as they'd see in SharePoint. |
| "The Microsoft sign-in library failed to load" | The browser blocked `cdn.jsdelivr.net` (ad blocker or corporate proxy). |

## Recommended SharePoint setup for badge plans

The website simply reflects what's in SharePoint, so a little structure there pays off. Rather than one folder per badge, consider a **Badge Planning** library with a few columns: Badge, Level (Tenderheart / Explorer / Pioneer / Patriot), Last taught, and Leader. Then leaders can filter to "Explorer badges we've already done" in SharePoint, and the website search finds a badge by name no matter which folder it landed in.

## Extending later

- **Uploads/edits from the website:** possible by adding the `Sites.ReadWrite.All` delegated permission and an upload control. Not included yet — editing in SharePoint/Office directly is simpler and keeps version history.
- **A "recent changes" view across all libraries:** Graph supports it (`/sites/{id}/drives/{id}/root/delta`); a small addition to `assets/leaders.js`.
