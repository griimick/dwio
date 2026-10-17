# dwio

Edit local `.drawio` and `.drawio.svg` files in the real draw.io editor, straight from your terminal.
Diagrams stay next to your code in git; no copying files in and out of a web app.

```sh
dwio docs/architecture.drawio.svg     # opens the editor; every change is saved to that file
```

- **Local only.** A loopback HTTP server serves the draw.io web app (downloaded once to `~/.cache/dwio`). Nothing leaves your machine after setup.
- **Two-way sync.** Edits autosave to disk atomically. If the file changes underneath (git checkout, an agent, another editor) the editor reloads, or asks if you have unsaved changes.
- **Git-friendly.** `.drawio.svg` renders on GitHub and embeds the editable diagram; saved XML is uncompressed so diffs are readable.
- **Agent-friendly.** `dwio xml <file>` prints plain mxfile XML; `--json` gives machine-readable output; see [AGENTS.md](AGENTS.md).

## Usage

```
dwio <file>          open/create a diagram and sync it
dwio xml <file>      print uncompressed mxfile XML
dwio setup           pre-download the draw.io web app
```

Flags: `--no-open`, `--port <n>` (default 3946 — "dwio" on a phone keypad — falling back to the next free port; `DWIO_PORT` sets another default), `--allow-host <name>`, `--public-port <n>` (for hostnames and tunnels, see below), `--host <addr>` (e.g. `0.0.0.0` to reach it from another machine; the URL token is then the only protection, over plain HTTP), `--keep-alive`, `--no-create`, `--json`, `--drawio-version <v>`. See `dwio --help`.

Requires Node >= 22.18.

## Development

```sh
npm install      # also enables the Conventional Commits git hook
npm run check    # typecheck + tests
node src/cli.ts some.drawio --no-open
```

### Reaching it by name or through a tunnel

The server rejects any `Host` header that isn't an IP address, `localhost` or (with a non-loopback `--host`) this machine's own hostname (this blocks DNS rebinding).
If you get `bad host`, the error says what to pass:

```sh
dwio f.drawio --host 0.0.0.0 --allow-host mybox.tailnet.ts.net   # open it by name
ssh -L 8080:127.0.0.1:44000 server                                # tunnel to a different local port…
dwio f.drawio --port 44000 --public-port 8080                     # …and tell the server about it
```

## License

[MIT](LICENSE). draw.io is a trademark of JGraph Ltd.; it is downloaded from the upstream Apache-2.0 project at first run and is not redistributed here.
