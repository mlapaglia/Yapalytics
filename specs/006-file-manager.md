# 006 Managing loaded files

Status: Approved · PR: [#13](https://github.com/mlapaglia/Yapalytics/pull/13)

## Problem

Once files are loaded, the dashboard lists every file name in one comma-separated line
under the filters, and the filter bar has a **+ Add files** button. With more than a few
exports (a split Takeout, a dozen iMessage `.txt` files) the line gets long and hard to
read. Files can be added but never taken back out: to drop a wrong or outdated export,
the user has to reload the page and choose everything again.

## Goals and non-goals

- One place to see which files are loaded, add more, leave some out for now, or remove
  them.
- Take the file list and **+ Add files** out of the main dashboard.
- Not in scope: per-file statistics (messages each file added), reordering files,
  remembering the file list across page reloads, editing a file's contents.

## Requirements

- **R1** The filter bar has a **Files** button in place of **+ Add files**. It shows how
  many files are loaded (`📁 Files (3)`), or how many are in use when some are switched
  off (`📁 Files (2 of 3)`). The dashboard no longer lists file names.
- **R2** The button opens a Files dialog that lists each loaded file on its own line:
  a checkbox, the app's logo, the file name, its size, and a remove (✕) button.
- **R3** Unchecking a file leaves its contents out of the dashboard: its messages,
  calls, conversations and attachments. Checking it again brings them back. The file
  stays in the list either way.
- **R4** Removing a file takes it out of the list and its contents out of the dashboard.
- **R5** The dialog has an **Add files** button (same file types as the landing page).
  Added files join the list, checked. A file already in the list (same name, size and
  last-modified time) is not added twice.
- **R6** Changes in the dialog are pending until **Apply**. **Apply** is disabled when
  nothing has changed, and while files just added are still being checked. Closing the dialog (✕, Escape, the backdrop or **Cancel**)
  discards pending changes.
- **R7** Content shared by several files stays while any checked file still has it:
  removing one of two overlapping exports keeps the messages the other one also has.
- **R8** A file the app can't read is marked on its row with the reason when it's
  added (for example "This is Telegram's HTML export, which can't be read…"). Its
  checkbox is disabled and it isn't loaded on **Apply**. It can be removed.
- **R9** **Apply** is disabled when files are listed but none of them is checked and
  readable, with the hint "Check at least one file, or remove them all to start over."
  Removing every file and applying returns to the landing page with nothing loaded.
- **R10** After **Apply**, the filters keep what still makes sense: the selected app
  and conversation stay if they're still loaded (otherwise they go back to All), the
  date range and other settings stay. Names picked by hand under "You are" stay. Saved
  people links (spec 005) apply again to what's loaded.
- **R11** An AI analysis report (spec 002) is cleared when **Apply** leaves out or
  removes any file, since it may describe messages that are no longer loaded. AI mood
  scores (spec 001) are kept for messages that are still loaded and not scored again.
- **R12** Dropping files on the page while the dashboard is shown still loads them
  right away, as today, and they appear in the list. Dropping files while the dialog is
  open adds them to the list as pending, like **Add files**.
- ~~**R13** The note about reactions not counted as messages stays in the line under the
  filters.~~ Dropped: the note is removed.
- **R14** A file that fails to read on **Apply** or a drop is left out of the list, the
  dashboard shows exactly the other checked files, and the error is shown. Nothing from
  the failed file stays loaded where the dialog can't take it out.
- **R15** Changes to the loaded files happen one at a time. While files are being read,
  the Files button is disabled, and files dropped meanwhile load once the read finishes.
- **R16** Files of an export that's parsed as a whole (Google Chat Takeout parts,
  Instagram export parts, WhatsApp exports) are read together. Adding or checking one
  while others of its kind are loaded reads every checked file again, so a re-checked
  Instagram media part brings back its photos on messages from the other part.
- **R17** The dialog works from the keyboard: **Add files** is a button, and checking or
  unchecking a file keeps focus on its checkbox. Removing a row moves focus to the next
  row's remove button (or **Add files** when none is left).

## Privacy

Nothing new leaves the browser. The dialog shows file names and sizes only. The app
keeps a reference to each loaded `File` (it already does for zips and SMS XML, to open
attachments) so it can read a file again when another one is switched off or removed.
These references live in memory for the page's lifetime and are never stored.

## Design

**UI.** In the filter bar, `<button id="filesBtn" class="btn small">` replaces the
**+ Add files** label. `#fileInfo` and the reactions note in it are removed from the scope
line.

A new `<dialog id="filesDlg" class="profile files-dlg">`, styled like the People dialog:

```
 Files                                              ✕
 Uncheck a file to leave it out, or remove it.
 ┌─────────────────────────────────────────────────┐
 │ ☑ [SMS] sms-20240611.xml           4.2 MB    ✕  │
 │ ☑ [IG]  instagram-part1.zip        180 MB    ✕  │
 │ ☐ [IG]  instagram-part2.zip         95 MB    ✕  │
 │ ☑ [WA]  Riley Chen.txt  (new)       12 KB    ✕  │
 │ ⚠       messages.html               3 KB     ✕  │
 │         This is Telegram's HTML export, which…  │
 └─────────────────────────────────────────────────┘
 [+ Add files]                       [Cancel] [Apply]
```

Rows added since the dialog opened say "(new)". The hint from R9 shows above the
buttons when it applies.

**State.** `S.files` becomes the list of loaded files:
`{ id, file, name, size, lastModified, kind, on }`, in the order they were added. `kind`
is `fileKind`'s result, worked out once. The dialog edits a copy (`S.filesDraft`) with
the same shape plus `error` for unreadable files; **Apply** compares it with `S.files`.

**Applying.** Loading from the landing page or a drop goes through the same path, with
the new files appended to `S.files`.
- Only additions (new files, or files checked again): read just those, as adding files
  always has, unless one is of a kind read together (R16) and others of that kind are
  loaded. Then rebuild.
- Anything unchecked or removed: rebuild. Reset the loaded data (`msgs`, `calls`,
  `contacts`, `seenMsgs`, `seenCalls`, `reactions`, `firstSeen`, `docFreq`, `vocab`) and
  parse the checked files again in list order, through the same code path as loading.
  This is what makes R7 hold: deduplication runs over exactly the checked files. AI mood
  scores come back from `AiMood.known` (keyed by text), so they aren't recomputed.
- `S.archives` is not reset. It stays append-only, so an attachment's index into it
  (`att.z`) never points at a different file after a rebuild. Attachment previews are
  cached by that index.

- A failed read (R14) has already merged part of its data. The failing parse job's files
  are dropped from the list and the remaining checked files are read again from scratch,
  repeating if another fails. If none is left, the landing page shows the error.
- Loads and applies run through one queue (`queueFileOp`), and the Files button is
  disabled while it's busy (R15). A read can't be overtaken by a later change and then
  commit its stale file list.

The rebuild re-reads every checked file, so it takes as long as loading them did. The
progress screen shows while it runs. The alternative, tagging every message, call and
contact with the files it came from, would make toggling instant but touch every parser
and the merge logic; that isn't worth it for an action users take rarely.

**Code.** `loadFiles(fileList)` (landing page, drops, demo) works out each file's kind
and calls `applyFiles(S.files + new entries)`, as **Apply** calls it with the dialog's
list. `applyFiles` reads with `readFiles(entries)` (group into jobs and parse; null, or
`{ error, failed }`), and ends with `finishLoad()` (sort, owners, links, filters, show the
dashboard). A rebuild calls `resetLoaded()` first. A pure helper in `js/files.js`,
`planFileChanges(current, draft)` → `{ changed, rebuild, read }`, decides between the two
paths and is unit tested. The dialog's rendering and events live in app.js, next to the
People dialog's.

## Acceptance criteria

- **AC1** After loading two files, the filter bar shows `📁 Files (2)`, there's no
  **+ Add files** button, and no file names appear on the dashboard.
- **AC2** Opening the Files dialog lists both files with checkbox, app logo, name, size
  and a remove button.
- **AC3** Unchecking the Telegram export of an SMS + Telegram load and applying removes
  the Telegram conversations from the picker and the app filter, and the button reads
  `📁 Files (1 of 2)`. Checking it again and applying brings them back with
  the same message count as before.
- **AC4** Removing a file and applying takes it out of the list and its conversations
  out of the picker.
- **AC5** Loading the same SMS backup under two names, then removing one, keeps the
  total message count the same (R7).
- **AC6** Adding a file from the dialog and applying loads its conversations; adding the
  same file again doesn't add a second row.
- **AC7** Unchecking a file and then closing the dialog without applying changes
  nothing; reopening shows it checked.
- **AC8** **Apply** is disabled when nothing changed, and when every listed file is
  unchecked (with the R9 hint).
- **AC9** Removing every file and applying shows the landing page.
- **AC10** Adding a Telegram HTML export in the dialog shows the reason on its row with
  a disabled checkbox, and applying loads the other changes without an error.
- **AC11** With a conversation selected that survives the change, applying keeps it
  selected; with one from a removed file selected, the picker goes back to All
  conversations.
- **AC12** An AI analysis report is cleared after a file is unchecked and applied.
- **AC13** Messages already scored by the AI mood model keep their scores after a
  rebuild without the model running again.
- **AC14** `planFileChanges(current, draft)` → `{ changed, rebuild, read }`: additions
  only (or a file checked again) → `rebuild: false` and `read` lists just those; leaving
  out or removing a loaded file, or adding one that's read together with a loaded file
  of its kind (R16) → `rebuild: true` and `read` lists every checked file; no difference
  → `changed: false`.
- ~~**AC15** The demo's reactions note still shows under the filters.~~ Dropped with R13.
- **AC16** Adding a broken `result.json` next to a loaded SMS backup shows the error,
  leaves it out of the list, and leaves exactly the SMS messages loaded.
- **AC17** While files are being read the Files button is disabled, and it's enabled
  again when the read finishes.
- **AC18** Unchecking the media part of a split Instagram export and checking it again
  brings back the same number of attachments that can be opened.
- **AC19** **Add files** can be focused and opens the file picker from the keyboard;
  toggling a checkbox with Space keeps focus on it; removing a row moves focus to the
  next row's remove button.
- **AC20** **Apply** is disabled while added files are still being checked, and enabled
  once they're listed.

## Decisions

- Changes wait for **Apply** (R6): unchecking several files re-reads once.
- Dropping files on the dashboard with the dialog closed loads them right away, without
  opening the dialog (R12).
- No per-file message counts: grouped exports are parsed together, so a count would be
  per group, not per file.
