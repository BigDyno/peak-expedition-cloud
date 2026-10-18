# PEAK Expedition Cloud — First Deployable Edition

Turn the original PEAK Expedition Edition website into a free-to-join, multi-race web app. This project contains a Cloudflare Worker API, a Cloudflare D1 SQL database migration, and the existing PEAK frontend with the Expedition theme preserved.

**Status:** deployable prototype for testing; not yet deployed to an actual Cloudflare account. Run the staging checks before inviting the public.

## What it supports

- Create a new expedition with a unique public code (`PEAK-XXXXXXXX`).
- Share the **spectator URL** or code: no account required. Each race has its own data.
- Privately manage scoring with the **organizer URL** (a long random key in the URL fragment).
- Recover access by entering your code and separate **recovery key**, which rotates both keys.
- Keep existing PEAK scoring: teams, ghosts, drag-and-drop campfires, configurable placement points, charts, PeakMap, archives, and podium.
- Read-only spectator mode and podium presentation; auto-refresh from the API every 30 seconds.
- Reject stale writes with `409 Conflict` rather than overwriting results from another device.
- Retain unsaved changes locally during a network failure. A conflicted copy can be exported as JSON before reloading.

## Deploy to Cloudflare Workers + D1

### Requirements

- A free Cloudflare account.
- Node.js 20+ and npm on a computer for deployment.
- An optional GitHub repository for version-controlled website code.

### 1. Install and sign in

Open a terminal in this ZIP's extracted root folder, then run:

```bash
npm install
npx wrangler login
```

### 2. Create the database

```bash
npx wrangler d1 create peak-races
```

The command prints a **database_id** (a UUID). Copy this into `wrangler.jsonc`, replacing the literal `REPLACE_WITH_YOUR_D1_DATABASE_ID`. Keep `database_name` as `peak-races` and the binding as `DB`.

### 3. Apply the SQL migration

```bash
npm run db:remote
```

This applies `migrations/0001_init.sql` to your remote Cloudflare D1 database and creates the `races` and `create_limits` tables.

### 4. Deploy the website and API together

```bash
npm run deploy
```

Wrangler will provide a URL similar to `https://peak-expedition-cloud.YOUR-SUBDOMAIN.workers.dev`. Both the frontend and `/api/races` API run on the same hostname. **No `web.config`, IIS, JSONBin API key, or private server is used.**

Visit the URL and use **Create an expedition**. Write down the race code, copy the **private organizer link**, and **save the recovery key**. The recovery key is displayed only on creation or rotation.

### 5. Verify before sharing

1. Visit `/api/health` and confirm JSON with `"ok":true`.
2. Create a test race and copy the organizer link and recovery key.
3. Add 2 racers, create a draft campfire, reorder players, finalize it, and wait for “Cloud synced”.
4. Open the spectator link in a separate private-browser window and verify standings.
5. Edit again as organizer; confirm the spectator receives the change within roughly 30 seconds.
6. Export race JSON, try importing it into a *different new test race*, and verify the points.
7. Try two admin windows changing the same race simultaneously; the stale save must be rejected with a conflict, not silently overwrite the other window.

## Local testing

```bash
npm install
npm run db:local
npm run dev
```

Wrangler provides a localhost URL. Local D1 data is separate from the production D1 database.

Run API tests with:

```bash
npm test
```

The tests use Node's built-in SQLite module and do not need to connect to Cloudflare.

## Import your existing PEAK race

**Your uploaded website ZIP contains source code, not a saved race JSON export.** Race data isn't automatically extracted from your old JSONBin database.

1. On the *current working IIS site*, open **Race Vault → Export race backup** and download the JSON file.
2. Create a new cloud race (it initially contains no racers or campfires).
3. Using the **organizer link** for that new race, open **Race Vault → Import JSON**.
4. Select your exported race file. Wait for **Cloud synced**.
5. Open its spectator link and compare leaderboard totals with the old site.
6. Keep IIS running until you are satisfied with the new hosted copy. The two systems do **not** synchronize with each other.

## How access works — important

- The **race code** is a public locator, not a password. Everyone with it can view player names and results. There is no public directory or user account system.
- The **organizer link** grants edit authority. Treat it like a password, not like a public invite.
- The **recovery key** is another secret, used to issue a new organizer link if the previous one is lost. Keep it offline; losing both may permanently prevent management of that race.
- The browser remembers organizer rights only for the current browsing session. Bookmark or save the organizer URL securely for future use.
- The Worker stores only SHA-256 hashes of organizer and recovery keys in D1. Secrets are not embedded in the JavaScript and are not included in public race reads.
- This version lets the organizer rotate both secrets under **Organizer keys → Rotate keys**.

## Handling save conflicts

Saving a race requires the revision number it was last downloaded at. If someone else saved revision 14 while you were editing revision 13, the Worker responds with **409 Conflict** and PEAK stops automatic retries. Your edits stay in the browser. Export a JSON backup first; choose **Reload cloud** to accept the newer revision (a local recovery copy is kept as well). Automatic merging is not yet implemented.

## Current scope and limits

- The current model stores a full race JSON document per race in D1, but it is revision-protected.
- Basic per-IP creation throttling (20 race creations/day) helps deter casual abuse. It is **not** complete production-grade abuse protection.
- API writes are limited to 350 KB, and the app validates count and structure limits (up to 300 racers, 100 teams, 250 campfires, 100 scoring positions).
- Spectators poll approximately every 30 seconds rather than using real-time WebSockets.
- Local archives remain in each browser; they are not globally synced, while each current race state is stored in D1.
- No account-based player identities, public directory, automatic match-making, or cross-race player profiles are included in this initial release.
- PeakMap still relies on its public third-party JSON schedule. If it is unavailable, races and manual campfire scoring still work.
- Cloudflare usage limits and pricing can change; check current Workers and D1 quotas before broad public launch.

## GitHub workflow

Commit the project source to a repository (including `public/`, `src/`, `migrations/`, and `wrangler.jsonc`). Do not commit `node_modules/`, `.dev.vars`, or secret URLs. After initial testing, connect the repository to Cloudflare Workers Builds if you want automatic deployments.

**The Cloudflare D1 database is persistent storage, not a file in the GitHub repository.** GitHub stores website code and changes; Cloudflare serves the site and stores live race records.

## Directory structure

```text
public/            # index.html, app.js, styles.css, expedition.css,
                   # cloud.css and Expedition artwork
src/worker.js      # Cloudflare Worker API and access control
migrations/        # D1 SQL schema
wrangler.jsonc     # Cloudflare deployment configuration (add database UUID)
package.json       # Deployment scripts
README.md          # This file
API.md             # API reference and behaviour
```
