# Yapalytics

Plain HTML, CSS and JavaScript with no build step. Scripts share globals (no modules) and
load in the order listed at the bottom of `index.html`. Parsers run as Web Workers built
from serialized functions, so worker code must be self-contained.

## New features are spec-driven

Before writing code for a new feature, write or update its spec in `specs/` (process and
template: [specs/README.md](specs/README.md)) and get it reviewed. Each acceptance
criterion needs a test that names it (`AC3: …`). If the build shows the spec was wrong,
fix the spec in the same change. Bug fixes and small refactors don't need a spec.

## Privacy

Messages must not leave the browser unless the user explicitly sends them somewhere
(spec 002's Claude backend is the only such path). Anything new that touches message
text says in its spec where the text goes.

## Tests

`npm test` runs both suites (Node 22+). `npm run test:unit` runs the Node unit tests in
`tests/unit/`, which load the scripts with `tests/helpers/load.mjs`. `npm run test:e2e`
runs the Playwright tests in `tests/e2e/`. Those block every external request, so
anything loaded from a CDN must be served locally or stubbed in
`tests/e2e/fixtures.mjs` or the spec file.
