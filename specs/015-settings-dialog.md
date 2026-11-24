# 015 Settings dialog

Status: Approved: built · Author: · PR:

## Problem

Some choices change numbers all over the dashboard but sit on a single card. The
clearest one is how much quiet ends a conversation (30m to 24h). Its buttons are on
the Replies tab's Conversation length card, but the same gap decides reply times,
conversation starters, double texts and the longest conversation on the Replies tab,
the Overview numbers and highlights, the People leaderboard, Year in review and the
profile dialog. Someone on Overview can't tell where "within 6 hours" comes from or
where to change it, and someone who changes it on the card doesn't expect the other
tabs to move. The choice also resets to 6 hours on every reload.

The filter bar has the opposite problem. Next to what picks the messages
(conversation, app, dates) it holds three controls that are set once and then left
alone: 🔗 Link people, 👤 Which one is you? and Include group chats. They crowd the
bar, which wraps onto a second line on narrow screens, and they're in the way of the
controls people change all the time.

## Goals and non-goals

- Goal: one ⚙️ Settings button in the filter bar that opens a Settings dialog for
  choices that are set once and change numbers across the dashboard.
- Goal: move the conversation gap, Include group chats, Which one is you? and Link
  people into it, and take them out of the filter bar and the Conversation length card.
- Goal: keep the nudges Link people and Which one is you? give today (a count of
  suggested links and of guessed owners) visible without opening the dialog.
- Goal: remember the conversation gap across reloads.
- Not in scope: the Across apps tab's own gap (spec 007 R7). It only applies to that
  tab, so it stays there.
- Not in scope: the theme button (top bar), the mood scorer (Mood card), Instagram
  previews (Messages card), Claude settings (AI tab) and 📁 Files (it manages what's
  loaded, not how it's counted).
- Not in scope: changing what linking, picking an owner or the group chat filter do.
  Specs 005 and 013 still say how they work; this spec only moves where they're reached.

## Requirements

- **R1** The filter bar has a **⚙️ Settings** button where 🔗 Link people is today. It
  shows whenever the dashboard does. The filter bar no longer has the Link people
  button, the Which one is you? button or the Include group chats checkbox.
- **R2** The Settings button carries the count the two old buttons did: suggested links
  (spec 005) plus apps whose owner is only a guess (spec 013 R9), as
  "⚙️ Settings (3)". Its title says what the count is made of, e.g. "2 possible links
  between conversations with the same person · Check Telegram: who's you was guessed". With nothing to
  check it reads "⚙️ Settings" with no count.
- **R3** The button opens a Settings dialog styled like the Link people dialog: a
  title, a short description, one section per setting and a ✕ button. Escape, ✕ and a
  click on the backdrop close it.
- **R4** **Conversations** section. It offers the conversation gaps (`CONVO_GAPS`:
  30m, 1h, 3h, 6h, 12h, 24h) with the current one marked, and says what the gap
  changes: reply times, conversation starters, double texts and conversation lengths,
  on every tab except Across apps. Picking one applies right away
  (`View.set({ convoGap })`); every panel drawn with the gap redraws; the dialog
  stays open.
- **R5** The Conversation length card no longer has gap buttons.
- **R6** The picked gap is saved in this browser and used again on the next visit. A
  missing, unreadable or unknown saved value falls back to 6 hours. If storage is
  unavailable the gap lasts until the page closes, as other settings do (spec 014).
- **R7** **Group chats** section: the Include group chats checkbox, working as it does
  today (`View.set({ filter: { groups } })`), applying right away. It isn't saved,
  as today. The scope line under the filter bar already reads "All 1-on-1
  conversations" when it's off, so the bar still shows it.
- **R8** **Which one is you?** section, shown only when an app has senders to pick
  (spec 013 R2). It holds the rows the Which one is you? dialog has today, one per app
  with its searchable picker and where the current owner came from (spec 013 R3–R6),
  right in the Settings dialog. The separate Which one is you? dialog goes away.
  When an owner is guessed, the section heading shows the count, as the button did.
- **R9** **Linked people** section, shown only when two or more 1-on-1 conversations
  can be linked (spec 005). It says how many people are linked and how many links are
  suggested, and has a **Link people…** button that opens the Link people dialog on top
  of Settings. Closing Link people returns to Settings. The Link people dialog itself
  doesn't change, and the profile dialog still opens it directly.
- **R10** The Replies tab's notes that name the gap (Reply speed, Conversation length,
  Texting habits) each end with a **Change** button that opens Settings.
- **R11** Everything in the dialog works from the keyboard: the Settings button is
  reachable with Tab, the dialog takes focus when it opens, and the gap choices are
  buttons in a labelled group.
- **R12** Specs 005 and 013, where they say a button sits in the filter bar, are updated
  to point here, as spec 013 R8 did for 004 and 009.

## Privacy

Nothing here touches message text. The only new thing stored is the conversation gap,
a number of milliseconds, in localStorage under `yapa-convo-gap`. Owners and links are
stored (or not) exactly as specs 005 and 013 say. Nothing is sent anywhere.

## Design

**Filter bar.** `#peopleBtn`, `#ownerBtn` and the `#groupsChk` label leave `.filters`.
In their place, after the conversation picker, goes
`<button class="btn people-btn" type="button" id="settingsBtn">⚙️ Settings</button>`.

**Dialog.** It reuses the people dialog's classes:

```html
<dialog id="settingsDlg" class="profile people-dlg" aria-labelledby="settingsTitle">
  <button class="btn ghost icon profile-close" type="button" aria-label="Close">✕</button>
  <header class="people-head">
    <h2 id="settingsTitle">Settings</h2>
    <p class="sub">How the dashboard counts what's loaded.</p>
  </header>
  <section>
    <h3 class="profile-h">Conversations</h3>
    <p class="sub">A conversation ends after this much quiet. It decides reply times,
      conversation starters, double texts and conversation lengths on every tab except
      Across apps, which picks its own.</p>
    <div class="seg" id="gapSeg" role="group" aria-label="A conversation ends after this much quiet"></div>
  </section>
  <section>
    <h3 class="profile-h">Group chats</h3>
    <label class="check"><input type="checkbox" id="groupsChk" checked> Include group chats</label>
  </section>
  <section id="ownerSection" hidden>
    <h3 class="profile-h" id="ownerHead">Which one is you?</h3>
    <p class="sub">These exports don't say which sender is you. Pick yourself so sent and received are right.</p>
    <ul class="owner-list" id="ownerList"></ul>
  </section>
  <section id="linkSection" hidden>
    <h3 class="profile-h">Linked people</h3>
    <div class="settings-row">
      <p class="sub" id="linkSummary"></p>
      <button class="btn small" type="button" id="peopleBtn">🔗 Link people…</button>
    </div>
  </section>
</dialog>
```

Ids move with their controls (`#gapSeg`, `#groupsChk`, `#ownerList`, `#peopleBtn`),
so the code that fills and wires them changes little. `#ownerDlg` is removed.
Stacking: `#peopleDlg.showModal()` while `#settingsDlg` is open puts it on top, and
closing it returns focus to Settings.

**Code.** A new `js/ui/settings-dialog.js`, loaded after `owner-dialog.js` and
`people-dialog.js`:

- `openSettingsDialog()`, and an init that wires the button, ✕, backdrop and every
  `[data-settings]` button (the Replies notes' Change buttons) to it.
- `updateSettingsButton()` sums `PeopleDlg.suggestions.length` and the guessed owners,
  and sets the button's text and title (R2).
- The gap buttons are built here instead of `replies.js`, whose `init` goes away. They
  are re-marked when `gap` changes.

`updatePeopleButton()` (people-dialog.js) and `updateOwnerButton()` (owner-dialog.js)
become `updateLinkSection()` and `updateOwnerSection()`. Instead of setting text on
filter-bar buttons they show or hide their section, fill `#linkSummary` and
`#ownerHead`, and call `updateSettingsButton()`. `#peopleBtn` keeps the suggestion
count (`🔗 Link people… (1)`). `initOwners()` is gone: there's no dialog left to wire.
`#groupsChk`'s listener in `filters.js` stays as it is.

**State.** `View.convoGap` stays the source of truth, so caching and topics don't
change. `store.js` gets `STORE_KEYS.convoGap = 'yapa-convo-gap'`, `Prefs.convoGap` read
in `Prefs.load()` (kept only if it's in `CONVO_GAPS`) and `Prefs.saveConvoGap(ms)`.
At start-up (`initSettings()`) `View.convoGap = Prefs.convoGap`. The gap buttons' click
handler calls `Prefs.saveConvoGap` and then `View.set({ convoGap })`, so `View.set`
stays free of storage. Saving 6 hours (the default) removes the key.

**Tests.** `tests/e2e/fixtures.mjs` gets `openSettings`, `closeSettings`,
`openLinkPeople` and `closeLinkPeople` (which also closes Settings, since a modal
Settings blocks clicks on the dashboard). Existing tests that click `#peopleBtn`,
`#groupsChk` or `#gapSeg` open Settings first; `ownerPicker()` opens Settings instead
of `#ownerDlg`; spec 013's owner tests read the count off `#ownerHead` and
`#settingsBtn`. New tests go in `tests/e2e/settings.spec.mjs`, plus
`tests/unit/store.test.mjs` for `Prefs` reading and saving the gap.

## Acceptance criteria

- **AC1** Given a loaded dashboard, the filter bar shows ⚙️ Settings and has no Link
  people button, Which one is you? button or Include group chats checkbox.
- **AC2** Clicking Settings opens the dialog with the six gaps, 6h marked, and Include
  group chats checked.
- **AC3** Given the dialog is open, when 1h is picked, then 1h is marked, the dialog is
  still open, and after closing it the Replies notes and the Overview's "Your reply
  time" hover text say 1 hour.
- **AC4** Given 24h is picked, the Overview, People leaderboard and Replies numbers
  match `aggregateMessages(selection, 24h)`.
- **AC5** The Conversation length card has no gap buttons.
- **AC6** Given 3h was picked, when the page is reloaded and the same files are loaded,
  then the dialog marks 3h and the numbers use 3 hours.
- **AC7** Given localStorage holds `yapa-convo-gap` = `"abc"`, `"0"` or a number not in
  `CONVO_GAPS`, the gap is 6 hours.
- **AC8** Given localStorage throws on every call, picking a gap still applies it.
- **AC9** Unchecking Include group chats in Settings drops group chat messages from the
  dashboard and the scope line reads "All 1-on-1 conversations"; checking it brings
  them back.
- **AC10** Given only SMS is loaded (no senders to pick, nothing to link), Settings has
  no Which one is you? or Linked people section and the button shows no count.
- **AC11** Given a Telegram export whose owner is guessed and two conversations with a
  suggested link, the button reads "⚙️ Settings (2)", and its title names both.
- **AC12** Picking a different owner in Settings' Which one is you? section flips sent
  and received as spec 013 R5 says, and the button's count drops by one.
- **AC13** Clicking Link people… opens the Link people dialog on top of Settings;
  accepting a suggestion lowers the button's count; closing Link people leaves
  Settings open.
- **AC14** The profile dialog's link button still opens the Link people dialog.
- **AC15** Clicking Change on any of the three Replies notes opens Settings.
- **AC16** Picking a conversation gap leaves the Across apps tab's gap as it was, and
  its own buttons stay on that tab.
- **AC17** Escape, ✕ and a click on the backdrop each close Settings.
- **AC18** With the keyboard alone, a person can Tab to Settings, open it with Enter,
  Tab to a gap and pick it with Enter or Space.

## Decisions

- Include group chats isn't saved across reloads. It's a filter the scope line
  reflects, and a remembered "off" could make someone think group chats didn't load.
- Which one is you? rows sit inline in Settings, not behind their own dialog.
- The count on the Settings button is enough of a nudge for a guessed owner. Settings
  doesn't open by itself.
