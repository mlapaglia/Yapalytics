# 003 Dashboard tabs

Status: Draft (built, awaiting review) · PR:

## Problem

The dashboard is one long page: KPIs, then about 50 cards in 11 sections, then the
message list and the attachment gallery. Getting to a chart near the bottom (Mood,
Calls, Year in review, the messages) means scrolling past everything above it, and
coming back up means scrolling again. Links that jump to the message list scroll the
reader away from the chart they were looking at, with no quick way back.

## Goals and non-goals

- Show one section of the dashboard at a time, picked from a bar that is always in
  reach, so any chart is one or two clicks away.
- Keep every chart, and keep the filters applying to all of them.
- Not in scope: rearranging or removing charts, user-customizable layouts, remembering
  the tab between visits or in the URL.

## Requirements

- **R1** A tab bar sits under the filter bar, with one tab per section: Overview,
  Activity, People, Groups, Replies, Words, Mood & emoji, Media & links, Calls,
  Sources, Year in review, AI analysis, Messages. Only the selected section is shown.
- **R2** The tab bar stays on screen while scrolling (under the sticky filters on wide
  screens, at the top on phones, where the filters don't stick).
- **R3** A section with nothing to show (Groups without group chats, Calls without a
  calls backup, Sources with one app, Year in review with no messages) has no tab. If
  the selected section loses its tab, Overview is selected.
- **R4** Switching tabs while scrolled down brings the new section's top just under
  the tab bar. Switching while at the top doesn't scroll.
- **R5** "Jump to…" lists every card shown, grouped by tab. Picking one selects its tab
  and scrolls the card into view under the sticky bars.
- **R6** Links into the message list (a Mood bar, "Read that day" in On this day and in
  AI analysis) select the Messages tab.
- **R7** Expensive sections still render only when shown: Words, Mood & emoji and Media
  & links share the content pass, which runs when any of them is first shown. It runs
  as the tab opens, so the layout is final before "Jump to…" scrolls (found while
  building AC5: rendering on the observer's next callback moved the card after the
  scroll).
- **R8** The tabs follow the ARIA tabs pattern: `tablist`, `tab` and `tabpanel` roles,
  `aria-selected`, and Left/Right/Home/End to move between tabs.
- **R9** The filters, the scope line and the date range apply to every tab, as before.
  Changing them keeps the selected tab.

## Privacy

No change. This only rearranges the page; no message text goes anywhere new.

## Design

**UI.** `#dashTabs` (`nav.tabs`) sits after the scope line: a horizontally scrolling
`#tabList` of tab buttons and a `#jumpSel` select. Each `.dash-section` in `#dash` is a
tab panel, labelled by `data-tab`. Section headings stay in the markup for screen
readers but are hidden visually, since the tab names the section.

The old Content section is split three ways:

| Tab | Cards |
|---|---|
| Words | What you talk about, Most-used words, Word tracker, Vocabulary, Message length, Average length over time |
| Mood & emoji | Mood over time, Swearing, Top emoji, Emoji over time |
| Media & links | Pictures, videos & attachments, Attachments over time, Shared links, the attachment gallery |

The KPI tiles move into Overview with Highlights and On this day. The message list
becomes the Messages tab. The timeline's note now says every tab (not "everything
below") follows the zoomed range.

**State.** `Tabs.current` is the selected section's id (Overview, `sec-glance`, at
first). It survives redraws and loading more files.

**Code.** `js/tabs.js` (loaded before `app.js`):

- `Tabs.init()` builds the tab buttons from the sections, the card list for "Jump to…",
  and keeps `--filters-h` and `--tabs-h` on `#dash` up to date (ResizeObserver) for the
  sticky offset and `scroll-margin-top`.
- `Tabs.select(id, { scroll, focus })` shows one section (class `active`; CSS hides the
  rest), renders its lazy parts at once (`renderLazyIn`, R7), updates the tabs, and
  scrolls per R4.
- `Tabs.sync()`, at the end of `refresh()`: hides tabs of hidden sections, falls back to
  Overview (R3), and rebuilds the "Jump to…" options from the visible cards.
- `Tabs.jump(card)`: R5.

The lazy sections in `app.js` are keyed by `data-lazy` when an element has one, so the
three content tabs share `#sec-content`'s pass (R7).

**Tests.** `scrollTo` in `tests/e2e/fixtures.mjs` clicks the tab holding the element
first (`openTabOf`), so tests written for the long page still reach their cards. Charts drawn into a hidden tab are
sized by their ResizeObserver when the tab is shown, as hidden sections already were.

## Acceptance criteria

- **AC1** After loading the demo, the tab bar shows the R1 tabs that have data,
  Overview is selected, and only Overview's cards are visible.
- **AC2** Clicking a tab shows only that section and marks the tab selected
  (`aria-selected="true"`).
- **AC3** Scrolled down in a long tab, clicking another tab puts the new section's top
  at the tab bar's bottom edge.
- **AC4** With the source filter on one app, the Sources tab is hidden. If Sources was
  selected, Overview is selected instead.
- **AC5** Picking "Swearing" in "Jump to…" selects Mood & emoji and scrolls the Swearing
  card into view below the tab bar.
- **AC6** Clicking a bar on the Mood chart selects the Messages tab, with the list
  filtered to those messages.
- **AC7** The content pass (e.g. the Mood chart) has not run before a content tab is
  first shown, and runs when Words, Mood & emoji or Media & links is shown.
- **AC8** Right arrow on the selected tab selects and focuses the next shown tab; End
  selects the last.
- **AC9** Changing the date range on a tab other than Overview keeps that tab selected.
- **AC10** At phone width (390 px), the tab bar sticks to the top of the screen when
  scrolled.

## Open questions

- Should the tab go in the URL (`#mood`), so Back returns to the previous tab and a
  reload keeps it? Reloading loses the data anyway, so it would help Back more than
  reloads.
- Is Messages better placed right after Overview? It's the most used section after the
  charts, but it's also the only one that isn't a summary.
