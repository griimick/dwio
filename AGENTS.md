# AGENTS.md

Guidance for AI coding agents (and humans) working on `dwio`.

## What this is
A CLI (`dwio <file>`) that serves the stock draw.io web app from a local, loopback-only HTTP server
and syncs edits to a `.drawio` or `.drawio.svg` file on disk. No cloud, no accounts; the draw.io
webapp is downloaded once into `~/.cache/dwio` and served offline afterwards.

## Commands
| Task | Command |
| --- | --- |
| Install deps (also enables the commit hook) | `bun install` |
| Typecheck + tests (run before every commit) | `bun run check` |
| Tests only | `bun test` |
| Run from source | `bun src/cli.ts <file> --no-open` |
| Standalone binary, this platform / all five | `bun run build` / `bun run build:all` → `dist-bin/` |
| Browser round-trip test (opt-in) | see the header of `scripts/e2e.mjs`; set `DWIO_BIN=dist-bin/dwio-linux-x64` to test a compiled binary |
| npm bundle (`npx dwio`), a Node-compatible single file | `bun run build:npm` → `dist/cli.js` (test with `node dist/cli.js …`) |
| Fetch the draw.io webapp | `bun src/cli.ts setup` |

Tooling is Bun only (>= 1.2): no Node or npm needed to develop, test or release. Tests use `bun:test`. No runtime dependencies — keep it that way.

## Layout
- `src/cli.ts` – default port 3946 (slides up to +20 if busy; explicit `--port` never slides), arg parsing, command dispatch, browser launch. Stdout carries only the URL/JSON; logs go to stderr.
- `src/server.ts` – HTTP server: static draw.io, `/api/file` (GET/PUT), `/api/events` (SSE), dir watcher, atomic writes.
- `src/format.ts` – pure functions for `.drawio` / `.drawio.svg` (extract/escape `content` attr, inflate compressed pages).
- `src/web-assets.ts`, `src/meta.ts` – web page + version as plain modules; `scripts/inline-plugin.ts` (used by `build-binaries.ts` and `build-npm.ts`) swaps them for inlined constants when compiling with Bun. Anything that reads files relative to `import.meta.url` must go through such a module or it will break in the binary.
- `src/assets.ts` – one-time download/cache of the pinned draw.io release (`DRAWIO_VERSION`).
- `src/web/host.{html,js}` – page that hosts the draw.io iframe and bridges its postMessage JSON protocol to the API. Plain JS, no build step.
- `test/` – `bun:test` suites. `format` is pure; `server` is an integration test with a fake webapp dir.

## Invariants — do not break
1. **Loopback by default.** Bind `127.0.0.1` unless the user passes `--host`; every request is checked for Host (IP literal or localhost, never a DNS name), Origin (must equal Host, if present) and the per-run token. Never relax these to ease testing.
2. **Only ever write the one file given on the command line**, via `atomicWrite` (temp file + rename in the same dir).
3. **Own writes must not echo** as external changes (server tracks `lastHash`). Keep the SSE test green.
4. **SVG saves come from draw.io's `xmlsvg` export**, never hand-built, so rendering and embedded data stay consistent.
5. **No network after `setup`.** The editor iframe uses `offline=1&stealth=1&pwa=0`.
6. Stdout is for machine-readable output only; human messages go to stderr.

## Conventions
- **Conventional Commits** (enforced by `.githooks/commit-msg`; `bun install` wires it up):
  `type(scope): subject`, types `feat fix docs style refactor perf test build ci chore revert`,
  scopes like `cli server format assets web`. Subject imperative, <= 72 chars. Breaking change: `!` + `BREAKING CHANGE:` footer.
- Small, focused commits; tests in the same commit as the behavior they cover.
- TypeScript strict, ESM, `.ts` extensions in relative imports, `erasableSyntaxOnly` (no enums/namespaces/parameter properties).
- Keep comments for the *why*; match surrounding style.

## Known gaps / ideas
- The postMessage bridge (`host.js`) is covered by `scripts/e2e.mjs` (opt-in, needs Playwright; see the header of that file); run it after touching `host.js` or the server API.
- `dwio export <file> <out.png|pdf>` for CI rendering.
