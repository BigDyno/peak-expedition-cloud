# 🏔️ PEAK Expedition Cloud
> **Built for the climb. Made for the rivalry.**

**Your summit. Your rivals. Your race.** PEAK Expedition Cloud (a.k.a. **PEAK Race Control**) is a fan-made web companion for running friendly competitions in **PEAK**. Organize an expedition, track who reaches each campfire first, turn placements into points, and watch the leaderboard change as your crew climbs.

This isn't the game itself or an official PEAK service. It's the race-control desk for your group: a little competition, a little chaos, and one glorious podium.

## 🚀 Try the live expedition

### **[▲ Launch PEAK Race Control →](https://peak.dvdata.ca/)**

No account to create, no server to set up, no download required. Open the site on your phone or computer, create an expedition, and invite your crew. You can optionally install it on supported devices as a Progressive Web App (PWA).

**[Live website](https://peak.dvdata.ca/)** · **[API reference](API.md)** · **[Source code](https://github.com/BigDyno/peak-expedition-cloud)**

## 🧭 What is it?

Picture this: four friends racing through PEAK. Someone arrives at a campfire first, someone barely survives, and someone insists they *would* have won if the terrain hadn't betrayed them.

PEAK Race Control gives your group a shared place to record each checkpoint and settle the rivalry with numbers rather than arguments.

- **🏁 Expeditions:** Create separate races with unique shareable codes (`PEAK-XXXXXXXX`).
- **🔥 Campfire scoring:** Add checkpoints, reorder finishers with drag-and-drop, and award placement points using configurable scoring rules.
- **🧗 Racers & teams:** Track individual competitors or team play, including ghost racers.
- **🗺️ Expedition map:** Check the PeakMap-powered rotation/biomes, then create draft campfires to score; the final location can reflect Citadel or Kiln as appropriate.
- **📈 Analytics:** Follow standings and performance charts as the expedition progresses.
- **🏆 Podium:** Celebrate the result with a dedicated podium presentation.
- **👀 Spectator mode:** Share a read-only link with friends. Scores refresh approximately every 30 seconds.
- **🗃️ Race Vault:** Export and import backups, and keep browser-local archives.
- **🎨 Personalization:** Pick from Expedition, Alpine Frost, Tropical Canopy, Volcanic Ember, and Shoreline themes, or choose a custom accent. Appearance settings stay in your browser.
- **📱 Installable web app:** PWA manifest and service worker support an app-like experience on compatible devices. A connection is still needed for cloud updates.

## 🎮 How to run your first expedition

### 1. Create the expedition
Visit **[peak.dvdata.ca](https://peak.dvdata.ca/)** and choose **Create an expedition**. Give the race a name and keep the resulting **race code**, **private organizer link**, and **recovery key** somewhere safe.

> ⚠️ **Don't post your organizer link or recovery key in public chat.** Anyone with the organizer secret may control your race. Share the **spectator link or public code** instead.

### 2. Assemble the crew
Open **Racers & teams** to add competitors, set up teams if that's how you're racing, and choose your scoring format. Different groups have different house rules; PEAK Race Control can accommodate configurable placement points.

### 3. Follow the mountain
Use **Expedition map** to check the current map rotation and biome order through PeakMap integration. When you're ready, create draft campfires—or add them manually. PeakMap provides reference data; it doesn't automatically determine who finished first.

### 4. Score each campfire
Go to **Campfires**, place racers in finishing order, and finalize the results. Points flow into the overall standings. As organizer, watch for **Cloud synced** before closing your tab.

### 5. Invite the spectators
Send the read-only spectator URL to friends who want to follow the race without changing anything. View the **Overview**, **Analytics**, and **Podium** as the stakes get higher.

### 6. Crown the climbers
Show the **Podium**, celebrate the winners, and export a backup from **Race Vault** if you want a copy of the results. Ready for another climb? Create a new expedition with its own code and scoreboard.

## 📱 Install it like an app

PEAK is a **Progressive Web App**, so you can add it to your home screen without publishing a separate Android APK.

- **Android / Chrome:** Open the live site, then choose **Install app** or **Add to Home screen** from the browser menu when available.
- **iPhone / Safari:** Open the site, use the Share menu, then choose **Add to Home Screen**.
- **Desktop:** Supported browsers may offer an install icon in the address bar or an install option in the menu.

Availability and menu wording vary by browser and OS. The service worker helps with app resources, but **offline scoring and cloud synchronization aren't guaranteed without a network connection**.

## 🧰 Under the hood

| Layer | Technology | What it does |
| --- | --- | --- |
| Frontend | HTML, CSS, vanilla JavaScript | Race Control interface, scores, map, charts, and themes |
| PWA | Web app manifest + service worker | Installable, app-like browser experience |
| API | Cloudflare Worker (`src/worker.js`) | Race creation, reads, authenticated writes, key rotation |
| Database | Cloudflare D1 (SQLite) | Persistent shared race state and revision tracking |
| Hosting | Cloudflare Workers static assets | Serves the frontend and API under one origin |
| Development | Node.js + npm + Wrangler | Local server, migrations, deployment, and tests |
| Map data | Third-party PeakMap schedule | Reference biome/rotation data; scoring remains usable if unavailable |

**How updates work:** Organizers save race state through the Worker API → D1 stores it with a revision number → spectators fetch the latest state. Conflicting edits return HTTP `409` instead of silently overwriting someone else's work.

---
## 🛠️ Developer base camp

Want to host your own expedition or contribute code? Everything below is for developers and self-hosters. **If you only want to play, use the [live site](https://peak.dvdata.ca/).**

### Get the source

```bash
git clone https://github.com/BigDyno/peak-expedition-cloud.git
cd peak-expedition-cloud
npm install
```

You will need **Node.js 20+**, npm, and a Cloudflare account for cloud deployment. The live instance's D1 database is not included with the source code.

## Deploy to Cloudflare Workers + D1

### Requirements

- A free Cloudflare account.
- Node.js 20+ and npm on a computer for deployment.
- An optional GitHub repository for version-controlled website code.

### 1. Install and sign in

Open a terminal in the cloned repository's root folder, then run:

```bash
npm install
npx wrangler login
```

### 2. Create the database

```bash
npx wrangler d1 create peak-races
```

The command prints a **database_id** (a UUID). Update the `database_id` field in the `d1_databases` entry of `wrangler.jsonc` with **your own** database ID. The checked-in configuration contains an existing deployment's ID; do not reuse it for your own Cloudflare account. Keep `database_name` as `peak-races` and the binding as `DB`. Review the `previews.d1_databases` entry as well and configure a separate preview database if appropriate.

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

**Source code isn't a race backup.** Data from an older self-hosted/JSONBin edition isn't automatically imported into D1.

1. If you're migrating from an earlier self-hosted edition, open **Race Vault → Export race backup** there and download its JSON file.
2. Create a new cloud race (it initially contains no racers or campfires).
3. Using the **organizer link** for that new race, open **Race Vault → Import JSON**.
4. Select your exported race file. Wait for **Cloud synced**.
5. Open its spectator link and compare leaderboard totals with the old site.
6. Keep the old site available until you've verified the migration. The old and new systems do **not** synchronize with each other.

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
wrangler.jsonc     # Cloudflare deployment configuration (set your D1 UUID)
package.json       # Deployment scripts
README.md          # This file
API.md             # API reference and behaviour
```

## 🧯 Troubleshooting on the mountain

| Symptom | What to check |
| --- | --- |
| The map won't load | PeakMap's public data source might be unavailable. Score campfires manually. |
| Spectators don't see changes immediately | Wait for the next refresh (roughly 30 seconds) or refresh the page. Confirm the organizer saw **Cloud synced**. |
| You lost organizer access | Use the separate recovery key with the race code to rotate the credentials. Save the new keys. |
| Your save conflicts | Export the pending local copy before choosing **Reload cloud**; automatic merging isn't supported. |
| D1 errors when developing | Check `wrangler.jsonc` bindings and make sure you've applied migrations to the correct local or remote database. |
| PWA install isn't offered | Check browser/OS support, HTTPS, and whether the app is already installed. |

## 🤝 Contributing

Found a bug, have a house-rule scoring idea, or want to improve the mountain atmosphere? Open an issue or pull request in this repository. Keep organizer secrets, recovery keys, and real race exports out of commits and issue screenshots. Run `npm test` before proposing backend changes.

## ❤️ Credits and disclaimer

Inspired by the friendly rivalry of **PEAK** and built as an **unofficial, fan-made project**. Not affiliated with, endorsed by, or operated by the creators of PEAK.

Map/rotation information is sourced from the independent [PeakMap](https://qwojtpl.github.io/PeakMap/WebApp/) project. Availability and accuracy depend on that third-party source.

**Built for the climb. Made for the rivalry.** ▲
