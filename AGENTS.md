# AGENTS.md

Rules for AI coding agents and humans who work on `dwio`.

## What this is
`dwio <file>` is a CLI. It serves the stock draw.io web app from a local, loopback-only HTTP server. It syncs edits to a `.drawio` or `.drawio.svg` file on disk. There is no cloud and there are no accounts. The CLI downloads the draw.io web app one time into `~/.cache/dwio`, then serves it offline.

## Commands
[CONTRIBUTING.md](CONTRIBUTING.md) has the full list. [docs/releasing.md](docs/releasing.md) has the release steps.

| Task | Command |
| --- | --- |
| Install dependencies (also enables the commit hook) | `bun install` |
| Typecheck and test (run before every commit) | `bun run check` |
| Test only | `bun test` |
| Run from source | `bun src/cli.ts <file> --no-open` |
| Build a binary: this platform / all five | `bun run build` / `bun run build:all` (output in `dist-bin/`) |
| Build the npm bundle (one Node-compatible file) | `bun run build:npm`, then `node dist/cli.js …` |
| Browser round-trip test (opt-in) | See the header of `scripts/e2e.mjs`. Set `DWIO_BIN=dist-bin/dwio-linux-x64` to test a binary. |
| Export a diagram to an image (use this to look at your result) | `bun src/cli.ts export <file> -o /tmp/look.png` (needs Chrome, Chromium, or Edge) |
| Fetch the draw.io web app | `bun src/cli.ts setup` |

Use Bun (>= 1.2) only. Do not use Node or npm to develop, test, or release. Tests use `bun:test`. There are no runtime dependencies. Do not add any.

## Layout
- `src/cli.ts`: argument parsing, command dispatch, browser launch. Default port is 3946. It tries up to 20 higher ports if the port is busy. An explicit `--port` never changes. Stdout has only the URL or JSON. Logs go to stderr.
- `src/server.ts`: HTTP server. It serves draw.io, `/api/file` (GET/PUT), and `/api/events` (SSE). It watches the folder and writes files atomically.
- `src/format.ts`: pure functions for `.drawio` and `.drawio.svg` (read and escape the `content` attribute, inflate compressed pages).
- `src/web-assets.ts`, `src/meta.ts`: the web page and the version, as plain modules. `scripts/inline-plugin.ts` replaces them with constants in a Bun build. Code that reads a file relative to `import.meta.url` must use such a module. Otherwise it fails in the binary.
- `src/web/host.{html,js}`: the page that holds the draw.io iframe. It connects the draw.io postMessage protocol to the API. Plain JS, no build step. See "Editor page" below.
- `src/stable.ts`: `stableEndpoint()`. The editor token is `HMAC(secret, realpath(file))`. The secret is in a private per-user folder (`$XDG_STATE_HOME/dwio`; `DWIO_STATE_DIR` overrides it). The last port for each file is in `ports.json`. A restart gives the same URL, so an open tab reconnects. `--new-token` makes a new secret. If the folder is not trusted, the token is random. A missing file is an error unless `--create` is set.
- `src/export.ts`, `src/cdp.ts`, `src/browser.ts`: `dwio export`. It starts the normal loopback server and starts a local Chrome, Chromium, or Edge in headless mode. It controls the browser with the DevTools protocol (global `WebSocket`) and loads `/export` (`src/web/export.{html,js}`). PDF is printed from the SVG. The browser profile is in the OS temp folder and is deleted after use.
- `src/upgrade.ts`: `dwio upgrade` and `dwio update`. It reads the latest tag from the `/releases/latest` redirect, downloads the file and `SHA256SUMS`, checks the hash, runs the new file, then replaces the old file (atomic rename on Unix; rename-aside on Windows, untested). `DWIO_RELEASES_URL` points to a mirror or test server.
- `src/xml.ts`, `src/diagram.ts`: read and edit diagram XML. `xml.ts` is an XML reader that keeps positions, plus text-patch helpers. `diagram.ts` has `describe()` and `editMxfile()`. The ops are `add_vertex`, `add_edge`, `update` (label, style, `style_set`, box, parent/source/target), and `delete` (also deletes children and attached edges). Edits splice text and never serialize again, so `git diff` shows only the change. New cells copy the attribute order and ` />` style of the editor. Unchanged values are skipped. Input can be compressed; output is plain. Errors name the op and suggest similar ids. A call succeeds fully or changes nothing.
- `src/diagram-file.ts`: `readDiagramFile()` and `editDiagramFile()`. For `.drawio` it writes plain XML atomically. For `.drawio.svg` it edits the embedded XML, then redraws the picture through the editor export. With no browser it updates the data only and returns a `warning`.
- `src/instances.ts`: instance files. Each running `dwio <file>` writes `<pid>.json` (file, port, agent token) into a private per-user folder (`$XDG_RUNTIME_DIR/dwio`, mode 0700/0600; `DWIO_RUN_DIR` overrides it in tests). `listInstances()` trusts a file only if the pid is alive and the port answers `GET /api/agent/ping?n=<nonce>` with `HMAC(agentToken, nonce|pid|file)`. A dead pid or wrong proof removes the file. A timeout does not. Only the port is used as an address. The agent token is not the editor token. It opens only `/api/agent/*`.
- `src/safe-path.ts`: `resolveInside()`. The only way to turn an agent path into a real path.
- `src/mcp.ts`: `dwio mcp`, an MCP server with no dependencies (newline-delimited JSON-RPC 2.0 on stdio). Tools: `list_open_diagrams`, `get_diagram`, `apply_changes`, `render`, `create_diagram`, `get_style_guide`. Every tool takes `file`. Edits go through `editDiagramFile` under a lock for each file. `parseOps` checks all input from the model. A tool failure returns an `isError` result (not a protocol error) with a message that helps the model fix its call. **Stdout has protocol messages only.** Do not use `console.log` in code that the MCP path can reach. Log to stderr. `render` images are also saved in a temp folder that is removed on exit. Verified with Claude Code (`claude -p --mcp-config … --strict-mcp-config --allowedTools 'mcp__dwio__*'`) and with opencode. Setup for each agent is in [docs/agent-setup.md](docs/agent-setup.md). Not built yet: `get_selection` (needs a request/reply channel between server and browser, and an instance file).
- `src/style-guide.ts`: the text that `get_style_guide` returns. It is for editing with render-and-look. Do not copy it from the draw.io MCP reference. `test/style-guide.test.ts` draws `SHAPE_STYLES`, `COLORS`, and `EDGE_STYLES` with the real editor, so a wrong style fails the test. The MCP `instructions` tell the agent to use our tools for file changes and a shape search tool (for example `search_shapes` of the draw.io MCP) for icons. dwio does not depend on the official MCP.
- `src/progress.ts`: the download loader (`createProgress`, `renderProgress`, `readWithProgress`). It shows a bar with percent and sizes, or a spinner if the total is unknown. It draws on stderr only when stderr is a terminal. Otherwise callers print plain lines. It is throttled, never wider than the terminal (width 0 or unknown counts as 80), and always restores the cursor, also on Ctrl+C and errors. Call `finish()` in `catch`.
- `src/assets.ts`: one-time download and cache of the pinned draw.io release (`DRAWIO_VERSION`).
- `install.sh`: all code is in functions, and the last line is `main "$@"`. A cut download then runs nothing (`test/install-sh.test.ts` cuts the script at every line). It has the same loader and palette (curl in the background, file size read every 0.1 s, total from a HEAD request). Keep it POSIX `sh`: no arrays, no `local`.
- `test/`: `bun:test` suites. `format` is pure. `server` is an integration test with a fake web app folder.

### Editor page
- Draw.io shows the file name and sync state in its own menu bar (the `title` of `load` and the `status` action). Problems show as toasts in the corner.
- The favicon is two inline PNGs (32 and 64 px) with a transparent background. `test/favicon.test.ts` decodes them and fails if a corner is not transparent. `host.js` draws a status dot on the icon at run time: blue is unsaved or saving, red is a problem (save failed, cannot read or merge, connection lost). The tab title stays `name | dwio`.
- The view after a reload: `host.js` wraps `EditorUi.prototype.getCurrentFile` of the same-origin iframe to get the editor object. It remembers the zoom and the diagram point at the top-left corner (`currentView`) and restores them when the editor reports the load (`applyView`). This uses draw.io internals of the pinned version. If the hook fails, the view is not restored. `viewSurvivesOutsideChange` in `scripts/e2e.mjs` checks it.
- Outside changes: a clean tab gets `load`. A dirty tab gets `merge`. Never send `merge` to a clean tab: the draw.io baseline is old and a reset by git would not apply.
- `host.js` keeps unsaved edits in `localStorage` (`dwio-draft`) and offers them on the next load.
- `window.__dwio` is a test hook for `scripts/e2e.mjs`. Run that script after you change `host.js` or the server API.

## Invariants: do not break
1. **Loopback by default.** Bind `127.0.0.1` unless the user passes `--host`. Check every request: Host (IP literal or localhost, never a DNS name), Origin (must equal Host, if present), and the editor token. The token is stable for each file (see `src/stable.ts`), not for each run. Do not relax these checks to make tests easier.
2. **Write only the one file from the command line**, with `atomicWrite` (temp file and rename in the same folder).
3. **Own writes must not echo** as external changes. The server tracks `lastHash`. Keep the SSE test passing.
4. **SVG saves come from the draw.io `xmlsvg` export.** Never build them by hand, so the picture and the data agree. The save request must not have `xml` or `spin`. With `xml`, the editor loads the diagram again, which resets the view and erases the undo history on each save (measured: a 148 px jump and a broken Ctrl+Z). With `spin`, an overlay covers the editor while the user types. `viewStaysPut` in `scripts/e2e.mjs` checks both file types.
5. **No network except `setup` (and the first-run download) and `upgrade`.** The editor iframe uses `offline=1&stealth=1&pwa=0`. `upgrade` must check the SHA256 and run the new file (`--version`) before it replaces the old file. It must refuse to replace anything that is not the standalone binary (node, bun, npm bundle).
6. **Colors** (`src/color.ts`, and the same palette in `install.sh`): dim, red, one accent (Catppuccin Mocha green `#a6e3a1`; true color when `COLORTERM` says so, else 256-color 151), and cyan for links. Use color only on a TTY. A pipe or file is always plain, so stdout stays machine-readable. The only styled stdout item is the editor URL (cyan on a TTY). `NO_COLOR` always wins. `FORCE_COLOR` forces color. Errors print as `error: <message>`. Stdout is for machine-readable output only. Human messages go to stderr. (`export -o -` writes the image to stdout.)
7. **MCP file access stays inside the roots.** The default root is the folder where `dwio mcp` starts. `--root` adds folders. Every tool must get its path from `resolveInside()` (real paths, so links cannot lead out; new files are checked through the nearest existing parent). Never use `resolve(args.file)`, and never write to an agent path without `resolveInside()`. Diagram text is untrusted input to the agent.
8. **Instance files are private and never trusted blindly.** Keep the folder checks, the HMAC challenge, and the loopback-only `/api/agent/*` routes. The agent token never opens file read or write. Never put a token on a command line or in a log. A new `/api/agent/*` route must be loopback-only and must not return a secret.
9. **Export adds no runtime dependency and opens no non-loopback port.** It always closes the browser and deletes its profile, also on errors.

## Conventions
- **Conventional Commits.** `.githooks/commit-msg` enforces them (`bun install` wires it up). Format: `type(scope): subject`. Types: `feat fix docs style refactor perf test build ci chore revert`. Scopes: for example `cli server format assets web`. Use the imperative mood. Keep the subject to 72 characters or fewer. For a breaking change, add `!` and a `BREAKING CHANGE:` footer.
- Make small, focused commits. Put tests in the same commit as the behavior they cover.
- TypeScript is strict ESM. Use `.ts` extensions in relative imports. `erasableSyntaxOnly` is on: no enums, namespaces, or parameter properties.
- Comments give the reason (the why). Match the style around them.
