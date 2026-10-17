# Contributing to dwio

Thank you for helping. This page tells you how to change dwio and test your change.

## Set up

You need [Bun](https://bun.sh) 1.2 or newer. You do not need Node.js or npm.

```sh
bun install          # installs the tools and turns on the commit message check
bun run check        # type check and tests. Run this before each commit.
```

## Commands

| Command | What it does |
| --- | --- |
| `bun src/cli.ts <file> --no-open` | Runs dwio from the source code. |
| `bun test` | Runs the tests. |
| `bun run typecheck` | Checks the types. |
| `bun run build` | Builds one program file for your system in `dist-bin/`. |
| `bun run build:all` | Builds the program files for all five systems. |
| `bun run build:npm` | Builds `dist/cli.js`, the file that `npx` runs. Test it with `node dist/cli.js`. |

## Project layout

| Path | Content |
| --- | --- |
| `src/cli.ts` | Reads the options and starts the server. |
| `src/server.ts` | The local web server, the file API, and the file watcher. |
| `src/format.ts` | Reads and writes `.drawio` and `.drawio.svg` files. |
| `src/export.ts`, `src/cdp.ts`, `src/browser.ts` | `dwio export`. It runs a browser without a screen and reads the picture from the draw.io editor. |
| `src/xml.ts`, `src/diagram.ts` | Reads and edits the cells of a diagram (for agents). It changes only the text that must change. |
| `src/upgrade.ts` | `dwio upgrade`. It downloads a release, checks it, and replaces the running program. |
| `src/assets.ts` | Downloads and caches the draw.io editor. |
| `src/web/` | The page that holds the editor and talks to the server. |
| `scripts/` | Build scripts and the browser test. |
| `test/` | The tests. |

[AGENTS.md](AGENTS.md) has more detail and the rules that you must not break. The most important rules are these:

- dwio listens on `127.0.0.1` unless the user sets `--host`.
- dwio writes only the one file that the user gives, and it writes the file in one atomic step.
- The program does not use the network after `dwio setup`.

## Tests

Add a test with each change in behavior. Most tests in `test/` do not need a browser. The export tests that use a real browser skip themselves when no browser or no cached draw.io editor is found. Run `bun src/cli.ts setup` once to cache the editor.

To test the editor in a real browser, use `scripts/e2e.mjs`. This test is optional. It needs the `playwright` package and a browser. Do not commit them.

```sh
bun add -d playwright && bunx playwright install chromium
bun scripts/e2e.mjs
DWIO_BIN=dist-bin/dwio-linux-x64 bun scripts/e2e.mjs   # tests a built program file
```

Run this test after you change `src/web/host.js` or the server API.

## Commit messages

Commit messages must follow [Conventional Commits](https://www.conventionalcommits.org). A git hook checks the first line.

```
type(scope): short description in the imperative
```

- Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- Scopes (optional): `cli`, `server`, `format`, `assets`, `web`.
- Keep the first line to 72 characters or fewer.
- For a breaking change, add `!` after the type, and add a `BREAKING CHANGE:` line in the body.

Examples: `feat(server): add the --host option` and `fix(format): keep line breaks in the content attribute`.

Make small commits. Put a test in the same commit as the change that it tests.

## Style

- TypeScript in strict mode, with ES modules. Write `.ts` in relative imports.
- Do not add runtime dependencies.
- Write comments that tell why, not what.
- Write documentation in short sentences. Use the same words for the same things.

## Releases

Only maintainers make releases. The steps are in [docs/releasing.md](docs/releasing.md).
