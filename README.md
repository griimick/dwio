# drawio-local

Edit local `.drawio` and `.drawio.svg` files in the real draw.io editor, straight from your terminal.
Diagrams stay next to your code in git; no copying files in and out of a web app.

```sh
drawio docs/architecture.drawio.svg     # opens the editor; every change is saved to that file
```

- **Local only.** A loopback HTTP server serves the draw.io web app (downloaded once to `~/.cache/drawio-local`). Nothing leaves your machine after setup.
- **Two-way sync.** Edits autosave to disk atomically. If the file changes underneath (git checkout, an agent, another editor) the editor reloads, or asks if you have unsaved changes.
- **Git-friendly.** `.drawio.svg` renders on GitHub and embeds the editable diagram; saved XML is uncompressed so diffs are readable.
- **Agent-friendly.** `drawio xml <file>` prints plain mxfile XML; `--json` gives machine-readable output; see [AGENTS.md](AGENTS.md).

## Usage

```
drawio <file>          open/create a diagram and sync it
drawio xml <file>      print uncompressed mxfile XML
drawio setup           pre-download the draw.io web app
```

Flags: `--no-open`, `--port <n>`, `--keep-alive`, `--no-create`, `--json`, `--drawio-version <v>`. See `drawio --help`.

Requires Node >= 22.18.

## Development

```sh
npm install      # also enables the Conventional Commits git hook
npm run check    # typecheck + tests
node src/cli.ts some.drawio --no-open
```
