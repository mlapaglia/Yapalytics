# 013 Picking which sender is you, in a dialog

Status: Approved: built · PR:

## Problem

WhatsApp, iMessage (custom-named exports), Telegram, Instagram and Messenger exports
don't always say which sender is you. The app guesses, and puts a **You on …** dropdown
in the filter bar for each of those apps so you can correct it. Load four of them and
the filter bar gains four dropdowns. They push the filters you use all the time onto
more rows, for a setting you usually check once.

## Goals and non-goals

- Move every **You on …** dropdown out of the filter bar into one dialog, opened by a
  button beside **Link people**.
- Keep what the dropdowns do: the guess, the choice of names, and that a change applies
  at once and relabels sent and received.
- Not in scope: changing how the owner is guessed, saving the choice across reloads, and
  showing which messages each name sent.

## Requirements

- **R1** The filter bar has no **You on …** dropdowns.
- **R2** A **👤 Which one is you?** button sits beside **Link people**. It's shown only
  when at least one loaded app has a sender to pick (the apps that showed a dropdown
  before); hidden otherwise. Its tooltip says what it's for: "Pick which sender is you
  in apps whose exports don't say".
- **R9** Like Link people's suggestion count, the button counts the apps whose owner is
  only a guess (R6): **👤 Which one is you? (2)**. With none, it shows no count. Its
  tooltip then names them: "Check WhatsApp and iMessage: who's you was guessed".
- **R3** The button opens a **Which one is you?** dialog with one row per such app, in
  the order the source filter lists apps. A row has the app's logo, its name and a
  picker of that app's sender names, most messages first, set to the current owner.
- **R4** Each row's picker is searchable like the conversation pickers (spec 012). An
  export can have hundreds of senders.
- **R5** Picking a name applies at once, as the dropdown did: messages from that name
  become sent, the rest received, and the dashboard redraws. The dialog stays open.
- **R6** A row says whether its current owner came from the export ("From your export
  profile"), was guessed ("Guessed: check this") or was picked by you ("Picked by
  you").
- **R7** The dialog closes with ✕, the backdrop or Escape, like the People dialog.
- **R8** Specs 004 and 009 that say "the filter bar shows **You on …**" are updated to
  point here.

## Privacy

Nothing changes in where data goes. The dialog lists sender names already loaded. No
message text is read, stored or sent.

## Design

**UI.**

```
 [Conversation ▾]  [🔗 Link people]  [👤 Which one is you? (1)]  [All | SMS | WhatsApp …]
```

```
 ┌──────────────────────────────────────────────┐
 │ Which one is you?                          ✕ │
 │ These exports don't say which sender is you. │
 │ Pick yourself so sent and received are right.│
 │                                              │
 │ [WA] WhatsApp    [Jamie Park            ▾]   │
 │                  Guessed: check this         │
 │ [IG] Instagram   [Jamie Park            ▾]   │
 │                  From your export profile    │
 └──────────────────────────────────────────────┘
```

**Markup.** `index.html` drops `#ownerFields` from the filter bar, adds
`<button id="ownerBtn" hidden>👤 Which one is you?</button>` after `#peopleBtn`, and adds
`<dialog id="ownerDlg" class="profile people-dlg">` built like `#peopleDlg`, with an
`#ownerList` for the rows.

**Code (`js/app.js`).**

- `applyOwners()` keeps setting `m.o` and `c.search`. Instead of building filter-bar
  fields it calls `renderOwnerDialog()` and `updateOwnerButton()`, which shows or hides
  `#ownerBtn` and sets its count and tooltip (R2, R9).
- `ownerChoices(source)`: the names and message counts `applyOwners` already collects
  from `ownerPool`. An app with no names (every conversation says "Me") gets no row.
- `renderOwnerDialog()`: one row per app with choices. Each row's `<select>` gets
  `data-search`/`data-name`/`data-count` options and `makePicker` (spec 012), and its
  change calls the existing `setOwner(source, name)`.
- `ownerSource(source)`: `'export'` when a conversation in `ownerPool` has `c.owner`
  equal to the current name and the user hasn't picked, `'picked'` when
  `S.owners[source].auto` is false, else `'guess'` (R6).
- `initOwners()` wires the button, ✕, backdrop and Escape (R7), like `initPeople()`.
- Picking a name re-renders only the row's value and origin note; rows are rebuilt only
  when the apps or their names change, so focus stays in the dialog.

**Pickers in dialogs.** A dialog scrolls its content, so a floating picker list near its
bottom was cut off, and a modal dialog is drawn above the page, so the list can't move
out to `<body>`. In a dialog the list takes up room in the layout and scrolls into view
when opened. This applies to the People dialog's pickers (spec 012) too.

**Tests.** Existing Telegram, Instagram and Messenger tests find the picker by
`#ownerFields label`. They move to a fixtures helper, `ownerPicker(page, app)`, that
opens the dialog and returns that app's `<select>`.

## Acceptance criteria

- **AC1** With WhatsApp and Instagram exports loaded, the filter bar has no **You on**
  dropdown and shows **👤 Which one is you?**.
- **AC2** With only an SMS backup loaded, the button is hidden.
- **AC3** The dialog lists WhatsApp and Instagram, each with its logo and the current
  owner picked.
- **AC4** Picking another name under Instagram swaps sent and received for Instagram
  messages and leaves WhatsApp's alone, with the dialog still open.
- **AC5** Typing part of a name in a row's picker narrows it to matching senders.
- **AC6** An Instagram export with your profile says "From your export profile"; a
  WhatsApp export says "Guessed: check this"; after picking a name, "Picked by you".
- **AC7** ✕, the backdrop and Escape close the dialog.
- **AC8** With a guessed WhatsApp owner and an Instagram owner from the export profile,
  the button reads **👤 Which one is you? (1)**. After picking a WhatsApp name it reads
  **👤 Which one is you?** with no count.

## Open questions

- None. Review settled the label (**👤 Which one is you?**) and added the guess count (R9).
