# 012 Searchable conversation pickers

Status: Draft: built, awaiting review · PR:

## Problem

The Conversation picker at the top of the dashboard is a plain dropdown. With a few
hundred conversations you scroll a long list to find one, and you can't find a group
chat by someone in it unless you remember the group's name. The two "Link by hand"
dropdowns in the People dialog (spec 005) have the same problem, and there you often
need to find the same person on two apps.

Each row also marks its app with an emoji (💬 🟢 🔵 ✈️ 📸 ⚡, and nothing for SMS). The
rest of the app (the source filter, the Files dialog) uses the apps' real logos, so the
emoji have to be learned and don't match.

The separate People text box next to the picker filters the dashboard by name, but it's
a second control for nearly the same job.

## Goals and non-goals

- Find a conversation by typing part of a participant's name, number, email or handle,
  in the Conversation picker and both "Link by hand" pickers.
- Show each conversation's app with its real logo in those pickers.
- Use an existing, maintained library for the searchable picker rather than writing one.
- Replace the People text box with the searchable picker.
- Not in scope: picking several conversations at once, fuzzy (misspelling-tolerant)
  matching, searching message text, and changing labels anywhere other than these three
  pickers.

## Requirements

- **R1** The Conversation picker filters its list as you type. A conversation matches
  when any of these contains the typed text (ignoring case and accents): its name, its
  phone numbers, emails or handles, or, for a group chat, any member's name or number.
  A linked person matches by any of its conversations' names or numbers (this carries
  over spec 005 R8).
  Conversations whose own name contains the typed text list first, then ones found
  only by a number, handle or member, so typing "matt" puts Matt above group chats
  they're in.
- **R2** "All conversations" stays first and can always be picked. Message and call
  counts are the same as today, and so is the order within each group of R1's results
  (and of the whole list when nothing is typed).
- **R3** The picker's list follows the app filter and the loaded files as it does today:
  with Instagram picked, only Instagram conversations (and linked people with Instagram
  messages) are listed and searched.
- **R4** Both "Link by hand" pickers in the People dialog search the same way (R1),
  over the conversations that can be linked.
- **R5** The People text box is removed, along with the dashboard-wide filter it drove.
  Spec 005 R8/AC13 and spec 007 R3's mention of it are struck through and point here.
- **R6** If the picker library doesn't load, the three pickers fall back to plain
  dropdowns that still work.
- **R7** Each row in the three pickers, and the picked item shown in the closed picker,
  shows its app's logo: the same `#logo-sms` … `#logo-messenger` symbols the source
  filter and Files dialog use. The emoji app marks don't appear in these pickers. SMS
  gets its logo too. A linked person shows one logo per app it spans and no 🔗 marker
  (the logos already say it's joined). A group chat keeps its 👥 marker after the logo.
- **R8** Logos are decorative to assistive tech (`aria-hidden`); each row's accessible
  text includes the app name, e.g. "Alex Rivera, Instagram, 120 messages".
- **R9** The picker works with the keyboard: focus, type, arrow keys to move, Enter to
  pick, Escape to close and keep the current conversation. Backspace in an empty search
  doesn't clear the Conversation picker (the dashboard always has a selection). Each
  picker's focusable control has the same accessible name as its `<select>`.
- **R10** The scope line under the filters no longer names People terms; it says
  "All conversations" or the picked conversation, as without the People box.
- **R11** Labels everywhere else (leaderboard, charts, message list, profile) are
  unchanged.

## Privacy

Nothing changes in where data goes. Search runs in the page over conversation names,
numbers and member names already in memory. No message text is searched, stored or
sent.

The library is a static script and stylesheet loaded from jsDelivr, the same way as
ECharts. Loading it sends no conversation data anywhere.

## Design

**Library: Tom Select 2.6.2** (Apache-2.0, no dependencies at runtime, no framework).
It enhances an existing `<select>`: the native element keeps its options, `value` and
`change` event, so the app's wiring stays. `data-*` attributes on an `<option>` become
searchable fields, and `render.option` / `render.item` take HTML, which gives R1 and R7.
It has ARIA combobox roles and keyboard handling built in (R9). We pin 2.6.2 (July 2026)
rather than 2.7.0, which came out two weeks before this spec.

Considered: Choices.js (bundles Fuse.js fuzzy matching; fuzzy hits are noisy for names),
Slim Select (fine, but less flexible about extra search fields).

**Loading.** `index.html` adds `tom-select@2.6.2/dist/css/tom-select.css` before
`css/styles.css` and `dist/js/tom-select.complete.min.js` next to ECharts. `tom-select`
is pinned as a devDependency and `tests/e2e/fixtures.mjs` serves both files from
`node_modules`, like ECharts and heic-to.

**Code (`js/app.js`).**

- `SOURCE_LOGO` maps a source number to its logo symbol id (`0: 'sms'`, `1: 'googlechat'`, …).
- `contactName(c)`: a conversation's label without the emoji app mark (split out of
  `contactLabel`, which keeps building `c.label` for everywhere else).
- `makePicker(sel)`: a Tom Select on `sel` that searches the `search` field, with no
  limit on rows. Its `score` gives "All conversations" 3 so it always stays (R2), a
  conversation whose `data-name` matches 2, and any other match 1; Tom Select breaks
  ties by the list's own order (R1, R2). It also writes the picked
  value straight to the `<select>`: Tom Select's own write-back moves the picked
  `<option>` to the end, which would reorder the plain list. It uses Tom Select's
  `dropdown_input` plugin, so the search box sits at the top of the open list and the
  closed picker keeps showing the picked conversation; typing on the closed picker opens
  it (R9). The list filters 100 ms after the last key (Tom Select's default is 300), and
  closing it clears the search and drops a pending refresh, so it can't reopen itself
  after a pick. Rows and the picked item
  come from one `pickerRowHtml(data)`: logos, name, muted count. Returns `null` when
  `TomSelect` isn't loaded (R6).
- `refreshPicker(sel)` re-reads the native options after they're rebuilt.
  `setPickerValue(sel, value)` sets the native value and the picker's shown item without
  firing `change`.
- `populateContacts()` and `renderPeopleDialog()` keep building native `<option>`s with
  today's text, adding `data-search` (`c.search` from `contactSearchText`),
  `data-name`, `data-sources`, `data-count` and group/person flags. Then they call
  `refreshPicker`.
- Removed: `S.filter.people`, `S.peopleKeys`, `matchPeople`, `setPeople`, the
  `#peopleInput` handler, and their uses in `populateContacts`, `baseMessages`,
  `baseCalls` and `docFreqFor`.

**UI.**

```
 CONVERSATION
 ┌───────────────────────────────────────────┐
 │ [IG] Alex Rivera                    120 ▾ │
 └───────────────────────────────────────────┘
 ┌───────────────────────────────────────────┐
 │ sam▏   (search box, top of the open list) │
 ├───────────────────────────────────────────┤
 │ All conversations                      560 │
 │ [SMS][IG] Pat Lee                     340 │
 │ [WA] 👥 Sam, Jordan, Casey            88 │
 │ [TG] Sam Okafor                        12 │
 └───────────────────────────────────────────┘
```

`[IG]` etc. stand for the app logos. The control and its dropdown use the app's
colour tokens so light and dark themes match the other filter controls. Each dropdown
stays inside its picker's wrapper: the sticky filter bar doesn't clip it, and it stays
attached while the page scrolls.

## Acceptance criteria

- **AC1** Given a group chat with Jordan in it, typing "jordan" in the Conversation
  picker lists that group chat.
- **AC2** Typing part of a 1-on-1's phone number lists that conversation.
- **AC3** Picking a search result selects that conversation and the dashboard shows it.
- **AC4** With Pat Lee (SMS) and Sam Patel (Instagram) linked, typing "sam patel" lists
  the linked Pat Lee.
- **AC5** In the People dialog, searching each "Link by hand" picker, picking two
  conversations and clicking **Link** links them.
- **AC6** With the Instagram filter on, typing a name that only matches an SMS
  conversation lists nothing but "All conversations".
- **AC7** The People text box is gone.
- **AC8** An Instagram conversation's row shows the Instagram logo and no 📸; an SMS
  row shows the SMS logo; the closed picker shows the picked conversation's logo.
- **AC9** A linked person on SMS and Instagram shows both logos and no 🔗.
- **AC10** In the People dialog, picker rows show the app logo.
- **AC11** Each row's accessible text names its app.
- **AC12** With the library blocked, the Conversation picker is a plain dropdown and
  picking a conversation still works.
- **AC13** Focusing the picker, typing, pressing ↓ and Enter picks the highlighted
  conversation; Escape closes it without changing the conversation.
- **AC14** In dark mode, the closed picker with a conversation picked has the dark
  surface and text colours, as when it's open.
- **AC15** Typing "sam" lists Sam Patel's 1-on-1 above the group chat Sam Patel is in,
  with "All conversations" still first.

## Open questions

- None.
