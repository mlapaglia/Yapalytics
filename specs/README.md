# Specs

New features start as a spec in this folder, before any code. The spec says what the
feature does and how we'll know it works. Code and tests follow from it.

## The loop

1. **Write the spec.** Copy [TEMPLATE.md](TEMPLATE.md) to `NNN-short-name.md` (next free
   number). Fill in the problem, requirements, design and acceptance criteria. Mark it
   `Status: Draft`.
2. **Review it.** Read it before writing code: in the PR, or directly with whoever is
   building it. Settle the open questions. Mark it `Status: Approved`.
3. **Build it.** Each acceptance criterion gets at least one test that names it, e.g.
   `test('AC3: stopping keeps VADER scores', …)` in a `describe('spec 001 …')` block.
   If building it shows the spec was wrong, change the spec in the same PR. Don't let
   the two drift apart.
4. **Close it.** When every criterion has a passing test, mark it
   `Status: Implemented` and link the PR.

Small fixes and refactors don't need a spec. Use one when a change adds something users
see, changes what data leaves the browser, or takes more than a day to build.

## Writing good criteria

- Make each one checkable by a test: a state, an input and what the user sees or what
  the data says. Write "Clicking Stop leaves the chart on VADER scores", not "Stopping
  works well".
- Number requirements (`R1`…) and criteria (`AC1`…) and never renumber them. Strike
  through ones that are dropped, so test names still point somewhere.
- Privacy is a requirement, not a footnote. Yapalytics promises that messages stay in
  the browser unless the user explicitly sends them somewhere. Any spec that touches
  message text must say where that text goes.

## Index

| Spec | Status |
|---|---|
| [001 AI mood scoring](001-ai-mood-scoring.md) | Draft: built, awaiting review |
| [002 AI conversation analysis](002-ai-conversation-analysis.md) | Draft: built, awaiting review |
| [003 Dashboard tabs](003-dashboard-tabs.md) | Draft: built, awaiting review |
| [004 Shared posts and reactions on messages](004-shares-and-reactions.md) | Implemented ([#10](https://github.com/mlapaglia/Yapalytics/pull/10)) |
| [005 Linked people across apps](005-linked-people.md) | Draft: built, awaiting review |
| [006 Managing loaded files](006-file-manager.md) | Approved: built ([#13](https://github.com/mlapaglia/Yapalytics/pull/13)) |
| [007 Cross-app habits](007-cross-app-habits.md) | Approved: built ([#14](https://github.com/mlapaglia/Yapalytics/pull/14)) |
| [008 More highlights](008-more-highlights.md) | Approved: built ([#15](https://github.com/mlapaglia/Yapalytics/pull/15)) |
| [009 Facebook Messenger import](009-messenger-import.md) | Approved: built ([#16](https://github.com/mlapaglia/Yapalytics/pull/16)) |
| [010 App switches in the message list](010-app-switch-markers.md) | Approved: built ([#17](https://github.com/mlapaglia/Yapalytics/pull/17)) |
| [011 Bots in Google Chat conversations](011-google-chat-bot-members.md) | Implemented ([#18](https://github.com/mlapaglia/Yapalytics/pull/18)) |
| [012 Searchable conversation pickers](012-searchable-conversation-pickers.md) | Draft: built, awaiting review |
| [013 Picking which sender is you, in a dialog](013-you-dialog.md) | Approved: built |
