# Yapalytics
<img width="200" height="200" alt="logo" src="https://github.com/user-attachments/assets/aeddef68-a668-4885-8236-212975230a9f" />

What your SMS, Google Chat, WhatsApp, iMessage, Telegram and Instagram messages reveal about you

1. Export your messages:
   - **SMS / MMS:** back up your Android Google Messages chats using [SMS Backup & Restore](https://play.google.com/store/apps/details?id=com.riteshsahu.SMSBackupRestore).
   - **Google Chat:** go to [Google Takeout](https://takeout.google.com/), click "Deselect all", select only **Google Chat**, and export as a **.zip**. Large exports are split into several zips (`takeout-…-001.zip`, `-002.zip`, …); download all of them. Dates are only understood when your Google account language is English.
   - **WhatsApp:** open a chat, then ⋮ / the contact or group name → **Export chat** (with or without media). Repeat for each chat you want; you get `WhatsApp Chat with ….txt` (Android) or `WhatsApp Chat - ….zip` (iPhone).
   - **iMessage:** on a Mac, install [imessage-exporter](https://github.com/ReagentX/imessage-exporter) (`brew install imessage-exporter`) and run `imessage-exporter -f txt` (add `-c clone` to also copy attachments, `-p <backup folder>` to read an iPhone backup instead). It writes one `.txt` per conversation to `~/imessage_export`; select them all, or zip the folder to include attachment sizes.
   - **Telegram:** in [Telegram Desktop](https://desktop.telegram.org/), open **Settings → Advanced → Export Telegram data** (or a chat's ⋮ menu → **Export chat history** for one chat), and set **Format** to **Machine-readable JSON**. Pick the `result.json` it writes, or zip the whole export folder so photos can be opened too. Channels and Saved Messages are left out; the HTML format can't be read. See Telegram's [export format](https://core.telegram.org/import-export).
   - **Instagram:** in the app, open **Settings → Accounts Center → Your information and permissions → [Export your information](https://accountscenter.instagram.com/info_and_permissions/dyi/) → Create export → Export to device**. Under **Customize information** pick **Messages** (and **Personal information**, so the app knows which sender is you), set **Date range** to **All time** and **Format** to **JSON**. Download the `.zip` when it's ready; large exports come in several parts, so pick them all together. Message requests you never accepted are left out; the HTML format can't be read.
2. Navigate to https://yapalytics.online
3. Import the xml backup(s), Takeout zip(s), WhatsApp exports, iMessage `.txt` files, Telegram exports and/or Instagram zips. Pick every part of a split Takeout export together. WhatsApp exports don't say which sender is you; the app guesses, and you can correct it with **You on WhatsApp** (and **You on Telegram** / **You on Instagram**, when those exports don't say).
4. Look at fancy graphs! When both kinds are loaded, use the All / SMS / Google Chat / WhatsApp / iMessage / Telegram / Instagram switch to compare them.

All processing occurs in the browser, your data is never uploaded anywhere!

## Credits
Mood scores come from [VADER](https://github.com/cjhutto/vaderSentiment) (Hutto & Gilbert, 2014) via its JavaScript port [vaderSentiment-js](https://github.com/vaderSentiment/vaderSentiment-js), © Comcast, Apache-2.0. A copy lives in `js/vendor/` with its license and notice.

HEIC photos are converted in browsers that can't show them by [heic-to](https://github.com/hoppergee/heic-to) (LGPL-3.0), built on [libheif](https://github.com/strukturag/libheif) (LGPL-3.0). It is loaded unmodified from jsDelivr, and only when a HEIC photo needs converting.

## Demo
Navigate to https://yapalytics.online and click "Try Demo Data".

<img width="1314" height="1180" alt="Screenshot 2026-10-13 at 10 48 47 AM" src="https://github.com/user-attachments/assets/35c3dd66-bdbe-44b8-85af-024b50aa1150" />

## Development
The site is plain HTML, CSS and JavaScript with no build step: serve the folder (`npm run serve`, then open http://127.0.0.1:4173) and edit.

Tests need Node 22 or newer:

```sh
npm install
npx playwright install chromium   # once, for the browser tests
npm test                          # unit tests, then browser tests
npm run test:unit                 # just the logic (fast, no browser)
npm run test:e2e                  # just the browser tests
```

- `tests/unit/` load the app's scripts into Node and check the parsing and statistics.
- `tests/e2e/` drive the real page in Chromium with Playwright, using the demo data and small exports built in `tests/helpers/`. echarts and heic-to are served from `node_modules` at the same pinned versions the site loads from the CDN, so the tests don't need the network.
- GitHub Actions runs both on every push to `main` and on pull requests (`.github/workflows/test.yml`); when browser tests fail, the Playwright report is attached to the run.
