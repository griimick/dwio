# AGENTS.md

Guidance for AI coding agents (and humans) working on `dwio`.

## What this is
A CLI (`dwio <file>`) that serves the stock draw.io web app from a local, loopback-only HTTP server
and syncs edits to a `.drawio` or `.drawio.svg` file on disk. No cloud, no accounts; the draw.io
webapp is downloaded once into `~/.cache/dwio` and served offline afterwards.

## Commands
| Task | Command |
| --- | --- |
| Install deps | `npm install` |
| Typecheck + tests (run before every commit) | `npm run check` |
| Tests only | `npm test` (Node built-in runner, runs `.ts` directly) |
| Run from source | `node src/cli.ts <file> --no-open` |
| Build for publishing | `npm run build` → `dist/` |
| Fetch the draw.io webapp | `node src/cli.ts setup` |

Requires Node >= 22.18 (native TypeScript type stripping). No runtime dependencies — keep it that way.

## Layout
- `src/cli.ts` – default port 3946 (slides up to +20 if busy; explicit `--port` never slides), arg parsing, command dispatch, browser launch. Stdout carries only the URL/JSON; logs go to stderr.
- `src/server.ts` – HTTP server: static draw.io, `/api/file` (GET/PUT), `/api/events` (SSE), dir watcher, atomic writes.
- `src/format.ts` – pure functions for `.drawio` / `.drawio.svg` (extract/escape `content` attr, inflate compressed pages).
- `src/assets.ts` – one-time download/cache of the pinned draw.io release (`DRAWIO_VERSION`).
- `src/web/host.{html,js}` – page that hosts the draw.io iframe and bridges its postMessage JSON protocol to the API. Plain JS, no build step.
- `test/` – `node:test` suites. `format` is pure; `server` is an integration test with a fake webapp dir.

## Invariants — do not break
1. **Loopback by default.** Bind `127.0.0.1` unless the user passes `--host`; every request is checked for Host (IP literal or localhost, never a DNS name), Origin (must equal Host, if present) and the per-run token. Never relax these to ease testing.
2. **Only ever write the one file given on the command line**, via `atomicWrite` (temp file + rename in the same dir).
3. **Own writes must not echo** as external changes (server tracks `lastHash`). Keep the SSE test green.
4. **SVG saves come from draw.io's `xmlsvg` export**, never hand-built, so rendering and embedded data stay consistent.
5. **No network after `setup`.** The editor iframe uses `offline=1&stealth=1&pwa=0`.
6. Stdout is for machine-readable output only; human messages go to stderr.

## Conventions
- **Conventional Commits** (enforced by `.githooks/commit-msg`; `npm install` wires it up):
  `type(scope): subject`, types `feat fix docs style refactor perf test build ci chore revert`,
  scopes like `cli server format assets web`. Subject imperative, <= 72 chars. Breaking change: `!` + `BREAKING CHANGE:` footer.
- Small, focused commits; tests in the same commit as the behavior they cover.
- TypeScript strict, ESM, `.ts` extensions in relative imports, `erasableSyntaxOnly` (no enums/namespaces/parameter properties).
- Keep comments for the *why*; match surrounding style.

## Known gaps / ideas
- The postMessage bridge (`host.js`) is covered by `scripts/e2e.mjs` (opt-in: needs Playwright, run `npx -p playwright node scripts/e2e.mjs`); run it after touching `host.js` or the server API.
- `dwio export <file> <out.png|pdf>` for CI rendering.
- Publish to npm as `dwio`.
