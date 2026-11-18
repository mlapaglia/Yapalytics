# Yapalytics
<img width="200" height="200" alt="logo" src="https://github.com/user-attachments/assets/aeddef68-a668-4885-8236-212975230a9f" />

What your SMS, Google Chat, WhatsApp, iMessage, Telegram, Instagram and Messenger messages reveal about you

1. Export your messages:
   - **SMS / MMS:** back up your Android Google Messages chats using [SMS Backup & Restore](https://play.google.com/store/apps/details?id=com.riteshsahu.SMSBackupRestore).
   - **Google Chat:** go to [Google Takeout](https://takeout.google.com/), click "Deselect all", select only **Google Chat**, and export as a **.zip**. Large exports are split into several zips (`takeout-…-001.zip`, `-002.zip`, …); download all of them. Dates are only understood when your Google account language is English.
   - **WhatsApp:** open a chat, then ⋮ / the contact or group name → **Export chat** (with or without media). Repeat for each chat you want; you get `WhatsApp Chat with ….txt` (Android) or `WhatsApp Chat - ….zip` (iPhone).
   - **iMessage:** on a Mac, install [imessage-exporter](https://github.com/ReagentX/imessage-exporter) (`brew install imessage-exporter`) and run `imessage-exporter -f txt` (add `-c clone` to also copy attachments, `-p <backup folder>` to read an iPhone backup instead). It writes one `.txt` per conversation to `~/imessage_export`; select them all, or zip the folder to include attachment sizes.
   - **Telegram:** in [Telegram Desktop](https://desktop.telegram.org/), open **Settings → Advanced → Export Telegram data** (or a chat's ⋮ menu → **Export chat history** for one chat), and set **Format** to **Machine-readable JSON**. Pick the `result.json` it writes, or zip the whole export folder so photos can be opened too. Channels and Saved Messages are left out; the HTML format can't be read. See Telegram's [export format](https://core.telegram.org/import-export).
   - **Instagram:** in the app, open **Settings → Accounts Center → Your information and permissions → [Export your information](https://accountscenter.instagram.com/info_and_permissions/dyi/) → Create export → Export to device**. Under **Customize information** pick **Messages** (and **Personal information**, so the app knows which sender is you), set **Date range** to **All time** and **Format** to **JSON**. Download the `.zip` when it's ready; large exports come in several parts, so pick them all together. Message requests you never accepted are left out; the HTML format can't be read.
   - **Messenger:** Messenger needs two downloads. The first is Facebook's export: in [Accounts Center](https://accountscenter.facebook.com/info_and_permissions/dyi/), **Export your information → Create export → Export to device**, pick **Messages** (and **Personal information**, so the app knows which sender is you), **All time** and **JSON**. That export leaves out end-to-end encrypted chats, which Messenger has used for personal chats since late 2023. Get those on a computer in Messenger: **Settings → Privacy & safety → End-to-end encrypted chats → Message storage → Download secure storage data** (only there if secure storage was turned on). Pick both downloads together. The older and newer halves of a chat that became encrypted show up as two conversations; **Link people** suggests joining them. See [spec 009](specs/009-messenger-import.md).
2. Navigate to https://yapalytics.online
3. Import the xml backup(s), Takeout zip(s), WhatsApp exports, iMessage `.txt` files, Telegram exports, Instagram zips and/or Messenger downloads. Pick every part of a split Takeout export together. WhatsApp exports don't say which sender is you; the app guesses, and you can correct it with **You on WhatsApp** (and **You on Telegram** / **You on Instagram** / **You on Messenger**, when those exports don't say). A `message_1.json` picked on its own could be Instagram's or Facebook's: the app guesses, and **📁 Files** lets you change it.
4. Look at fancy graphs! When both kinds are loaded, use the All / SMS / Google Chat / WhatsApp / iMessage / Telegram / Instagram / Messenger switch to compare them.

All processing occurs in the browser, your data is never uploaded anywhere! The one exception is opt-in: if you choose Claude under **AI analysis** and enter your own Anthropic API key, the conversation you picked goes from your browser straight to Anthropic.

## AI features

Both are off until you ask for them.

- **AI mood scores.** On the **Mood over time** card, switch from **VADER** to **AI model**. A sentiment model (about 126 MB) downloads once and runs in the tab. It reads tone better than VADER's word list, sarcasm included. See [spec 001](specs/001-ai-mood-scoring.md).
- **Conversation analysis.** Pick a conversation, then under **AI analysis** get a summary, each side's tone, notable moments and topics, or ask a question. Choose where the model runs (see [spec 002](specs/002-ai-conversation-analysis.md)):
  - **In this browser** with [WebLLM](https://github.com/mlc-ai/web-llm). Needs WebGPU (recent Chrome or Edge) and downloads a 0.9–3.7 GB model once. Nothing leaves your device.
  - **Ollama** on your computer. Start it with `OLLAMA_ORIGINS=https://yapalytics.online` so the page can reach it. Nothing leaves your device.
  - **LM Studio** on your computer. Start its server (Developer tab → Start server) and turn on **Enable CORS** in Server Settings. Load the model with a longer context to analyze more of a conversation. Nothing leaves your device.
  - **Claude** with your own API key. You see what will be sent, and roughly what it costs, before anything is sent. Names, numbers, emails and links can be hidden first. The key is never saved.

## Credits
Mood scores come from [VADER](https://github.com/cjhutto/vaderSentiment) (Hutto & Gilbert, 2014) via its JavaScript port [vaderSentiment-js](https://github.com/vaderSentiment/vaderSentiment-js), © Comcast, Apache-2.0. A copy lives in `js/vendor/` with its license and notice.

AI mood scores use [Transformers.js](https://github.com/huggingface/transformers.js) (Apache-2.0) with [twitter-roberta-base-sentiment-latest](https://huggingface.co/cardiffnlp/twitter-roberta-base-sentiment-latest) by Cardiff NLP (Loureiro et al., 2022; CC BY 4.0), in the ONNX conversion by [Xenova](https://huggingface.co/Xenova/twitter-roberta-base-sentiment-latest). Conversation analysis loads [WebLLM](https://github.com/mlc-ai/web-llm) (Apache-2.0) or the [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript) (Apache-2.0) from jsDelivr, only when you use them.

HEIC photos are converted in browsers that can't show them by [heic-to](https://github.com/hoppergee/heic-to) (LGPL-3.0), built on [libheif](https://github.com/strukturag/libheif) (LGPL-3.0). It is loaded unmodified from jsDelivr, and only when a HEIC photo needs converting.

## Demo
Navigate to https://yapalytics.online and click "Try Demo Data".

<img width="1314" height="1180" alt="Screenshot 2026-10-13 at 10 48 47 AM" src="https://github.com/user-attachments/assets/35c3dd66-bdbe-44b8-85af-024b50aa1150" />

## Development
New features start with a spec in [`specs/`](specs/README.md): requirements and acceptance criteria first, then code, with a test for each criterion.

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
