# 026 Exporting stats as CSV

Status: Draft · PR: [#34](https://github.com/mlapaglia/Yapalytics/pull/34)

## Problem

Some people want to take the numbers further: chart them their own way, join them with
other data, or keep a copy after the tab closes. Yapalytics shows the numbers only as
charts and tables. The leaderboard has 11 columns (`LEADER_COLS` in
`js/panels/people.js`) and can't be copied cleanly, and each chart's "Save PNG" gives a
picture, not data.

## Goals and non-goals

- Download the computed numbers behind the dashboard, for the current selection, as
  CSV files that open in Excel, Numbers, Google Sheets and pandas.
- Not in scope: exporting messages. No message text, captions, file names or link
  addresses (see Open questions for word lists and link sites).
- Not in scope: other formats (JSON, .xlsx), scheduled exports, importing a CSV back,
  per-chart download buttons.

## Requirements

- **R1** The scope line under the filters has an **Export stats** button, beside
  **View profile**. It is disabled when the selection has no messages.
- **R2** It opens the Export dialog. The dialog lists the tables below, each with its
  row count and a **Download** button, plus **Download all (.zip)**. Every table covers
  the selection as picked (conversation, app, group chats, dates) and the conversation
  gap from Settings.
- **R3** The tables and their columns, in this order:

| File | One row per | Columns |
|---|---|---|
| `summary.csv` | figure | `metric`, `value`: `messages`, `sent`, `received`, `first_message`, `last_message`, `active_days`, `span_days`, `busiest_day`, `busiest_day_messages`, `longest_streak_days`, `longest_silence_days`, `conversations`, `group_chats`, `your_median_reply_s`, `their_median_reply_s`, `words_sent`, `words_received`, `emoji_sent`, `emoji_received`, `attachments_sent`, `attachments_received`, `night_messages`, `conversation_gap_s` |
| `conversations.csv` | conversation | `conversation`, `apps`, `group`, `messages`, `sent`, `received`, `sent_share`, `your_median_reply_s`, `their_median_reply_s`, `you_start_share`, `avg_length_sent`, `avg_length_received`, `longest_streak_days`, `first_message`, `last_message` |
| `months.csv` | month with messages | `month`, `sent`, `received`, `avg_length_sent`, `avg_length_received`, `one_on_one`, `group`, `night`, then one column per app in the selection (`sms`, `whatsapp`, …, from `Sources`) |
| `days.csv` | day with messages | `date`, `sent`, `received` |
| `hours.csv` | hour 0–23 | `hour`, `sent`, `received`, `your_median_reply_s`, `their_median_reply_s` |
| `weekdays.csv` | weekday | `weekday` (`Sunday`…), `sent`, `received` |
| `heatmap.csv` | weekday and hour | `weekday`, `hour`, `messages` |
| `reply_times.csv` | reply-time bin | `bin` (`< 1 min`, …, as `replyBins`), `your_replies`, `their_replies` |
| `emoji.csv` | emoji | `emoji`, `sent`, `received`, most used first |
| `attachments.csv` | month with attachments | `month`, `photos`, `videos`, `gifs`, `audio`, `other_files` |
| `calls.csv` | conversation with calls | `conversation`, `calls`, `talk_s`. Only listed when the selection has calls in its date range. |
| `group_senders.csv` | group-chat sender | `sender`, `messages`. Only listed when the selection has group chats. |

- **R4** Values are machine-readable, not formatted for reading:
  - counts are plain integers, with no thousands separators
  - shares are fractions from 0 to 1 with up to 4 decimals (`0.6342`)
  - durations are whole seconds, talk time too (`talk_s`, not minutes, so every
    duration has one unit); a missing median is an empty cell
  - averages (message length) have up to 2 decimals
  - dates are local `YYYY-MM-DD`, months `YYYY-MM`
  - `group` is `true` or `false`; `apps` lists app names joined with `; `
- **R5** The files follow RFC 4180: comma-separated, CRLF line ends, a header row, and a
  field in double quotes when it has a comma, a double quote, CR or LF, with its double
  quotes doubled. Files are UTF-8 with a byte-order mark, so Excel reads accents and
  emoji.
- **R6** Formula guard: a text cell that starts with `=`, `+`, `-`, `@`, a tab or CR gets
  a `'` in front, so a spreadsheet shows it as text and doesn't run it. Number cells are
  never changed, so negative numbers stay numbers.
- **R7** Names: `conversation` is `plainName`, `sender` is `senderLabel`, as on the
  dashboard (a phone number when there's no name). The dialog has a **Replace names
  with Conversation 1, 2, …** checkbox, off by default. With it on, conversations are
  numbered by messages, most first, and the same number is used in every file. Senders
  are numbered the same way (`Sender 1`, …). "You" stays. Conversations that only
  have calls are numbered after the ones with messages. The checkbox is off every time
  the dialog opens.
- **R8** **Download** saves one file by its name. **Download all (.zip)** saves
  `yapalytics-stats-YYYY-MM-DD.zip` (today's date) with every listed table in it. Neither
  makes a network request.

## Privacy

Nothing leaves the browser. The files are built in the page and saved with a download
link (`URL.createObjectURL`), as Year in review's `saveWrapped` does. Nothing is stored.

No message text goes into a file: only counts, times, durations, app names, emoji, and
names. Emoji are counted as in the Top emoji chart, without the messages they came
from.

The files do hold names and, when a contact has no name, phone numbers. They're
personal data about other people. Unlike a summary image (spec 025) the files are for
the user's own analysis, where knowing who's who is the point, so names are in by
default. The dialog says the files contain names and stay on this device unless the
user sends them somewhere, and offers R7's checkbox for anyone who wants to share them.

## Design

**Code.** A new file, `js/export.js`, loaded after `js/panels.js` in `index.html`:

- `statsTables(A, C, { anon, labelFor, senderLabel, appsOf, sources })`: a pure
  function of `aggregateMessages` (`A`) and `aggregateCalls` of the selection's calls in
  its date range (`C`, or null). It returns `[{ file, title, header, rows }]` for R3,
  with raw values (R4). It reads `A.byContact`, `A.months`, `A.days`, `A.hour`, `A.dow`,
  `A.heat`, `A.reply`, `A.replyBins`, `A.replyHourMedian`, `A.emojiFreq`,
  `A.mediaMonths`, `A.groupMonths`, `A.sourceMonths`, `A.groupSenders` and `A.night`.
  The per-conversation rows use the fields `renderLeaderboard` reads. `appsOf` is
  `Data.keySources`, so a linked person lists every app; app columns in `months.csv`
  are named by the registry's `kind`. Dates use `isoDay` from js/ai-analysis.js.
- `toCsv(header, rows)`: R4–R6. Returns a string starting with the byte-order mark.
- `zipStore(files)`: the files in a zip with no compression (method 0, CRC-32 per file)
  and today's time on each entry. It returns a `Blob`. `js/zip.js` only reads zips, and
  it runs inside workers, so the writer goes here instead. The demo already had one
  (`buildStoredZip` and `crc32` in js/demo.js): it moved here as `storedZip`, with the
  modified time added, and the demo uses it.
- `saveBlob(blob, name)`: the download link, shared with `saveWrapped`.

**UI.** `index.html` gets `#exportBtn` in `.scope` and `<dialog id="exportDlg">` with the
other dialogs' classes: the selection it covers (`#exportScope`, the scope line's text),
a note about what's in the files, the names checkbox (`#exportAnon`), the list of
tables (`#exportList`, which scrolls) and **Download all (.zip)** (`#exportAll`).
`js/ui/export-dialog.js` (`initExport`, called from `init`) wires it and works the
tables out when the dialog opens or the checkbox changes. The `scope` panel in
`js/ui/filters.js` enables or disables the button (R1). Year in review's
`saveWrapped` now uses `saveBlob`.

## Acceptance criteria

- **AC1** With the demo loaded, **Export stats** is in the scope line and opens a dialog
  listing the tables with row counts. With an empty date range the button is disabled.
- **AC2** `statsTables` for a known history gives `conversations.csv` rows whose
  messages, sent, received, medians and start share match `aggregateMessages`, and
  `summary.csv` values that match the Overview KPIs.
- **AC3** `months.csv` has one row per month with messages and one column per app in
  the selection; `days.csv` sums to the total.
- **AC4** `toCsv` quotes `Smith, Jr.`, `say "hi"` and a value with a line break
  correctly, uses CRLF, and starts with the byte-order mark.
- **AC5** `toCsv` writes a conversation named `=HYPERLINK("x")` as `'=HYPERLINK(""x"")`
  in quotes, and `+1 555 0100` as `'+1 555 0100`, but `-3` (a number) as `-3`.
- **AC6** A missing median is an empty cell; a share is `0.6342`, not `63%`; a count is
  `12345`, not `12,345`.
- **AC7** With **Replace names** on, no file contains any conversation or sender name,
  and the same conversation has the same number in `conversations.csv` and
  `calls.csv`.
- **AC8** For a history whose messages contain the word `zebracorn` and a link to
  `example.org`, no table contains either.
- **AC9** **Download** on `months.csv` saves `months.csv`; **Download all** saves
  `yapalytics-stats-<today>.zip`, which opens with the repo's own `listZip` and holds
  every listed file with the same bytes. Neither makes a network request.
- **AC10** `calls.csv` is listed only when the selection has calls, and
  `group_senders.csv` only when it has group chats.

## Open questions

- **Words and link sites.** `aggregateContent` has the most-used words and shared link
  domains. They're stats, but they're built from message text, and a word list can
  give away what people talk about. Left out for now. Add them behind their own
  checkbox?
- **Mood.** Monthly positive and negative shares (`C.mood`) are text-derived scores, not
  text. Add a `mood.csv` once spec 001 is approved?
- **One wide file or many?** Many small tables are easier to read in a spreadsheet and
  match the charts. A single long "tidy" file (`table`, `key`, `metric`, `value`) is
  easier for pandas. Many files for now.
