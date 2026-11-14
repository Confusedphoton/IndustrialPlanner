# IndustrialPlanner

Factory planner for Arknights: Endfield (fork of hsyhhssyy/IndustrialPlanner). React 19 + MobX + PixiJS, built with Vite, tested with Vitest. Pen/stylus input comes first; mouse and keyboard are close behind.

## Commands

- `npm run dev`: dev server on port 5173. That port belongs to the user; agents testing in a browser start their own server on another port.
- `npm test`: the normal Vitest suite (about a minute and a half).
- `npm run check`: lint, types, tests and build. Run it before calling work done.
- `npm run test:blueprint` (long real-factory simulations) and `npm run test:e2e` (Playwright) are opt-in.

## Code

- Delete dead code outright; git keeps the history. Never comment code out, never add `AI-REMOVED`/`AI-CORRECTION`-style markers, and never write dated change-note comments. Comments are for things the code can't say for itself.
- When an approach changes, remove the old one instead of layering the new one on top.
- Fix the shared function or abstraction rather than special-casing one call path.
- Module boundaries: `app` talks to other modules through `domain` contracts and `shared`, not their internals.
- Tests exist to catch real regressions. Don't write tests that pin CSS class names, exact copy, or default values, and don't keep debugging sessions as tests.

## UI

- All UI text goes through i18n keys (`src/shared/i18n`, both `en-us` and `zh-cn`). No hardcoded strings.
- Game item, device and recipe names come from the i18n tables. Look them up there; never invent a translation.
- No developer hints, explanatory subtitles or placeholder copy in the shipped UI.
- Mobile portrait isn't supported (a rotate-your-phone overlay exists), but short landscape windows are. Environment and size detection lives in `src/shared/browser`.

## Game data and assets

- Unpacked game data: use the `unpack-data-analysis` skill. Port coordinates map as `localCellX = position.x`, `localCellY = range.depth - 1 - position.z`, verified in game, so don't re-derive it.
- Building art from the Endfield-Building-TopView-Assets site: use the `import-building-assets` skill.

## Housekeeping

- Put scratch files under `.temp/.trash/` (gitignored) and clean them up afterwards.
- Close any browsers, servers and processes you start.
- Don't commit, push or run git commands that change state unless asked.
