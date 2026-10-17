# dwio

Edit draw.io diagrams that are files in your project. Do it from the terminal.

```sh
dwio docs/architecture.drawio.svg
```

This command opens the draw.io editor in your browser. The editor saves each change to the file. You keep the diagram in git with your code. You do not move files in and out of a web app.

## Why use dwio

- **It works offline.** dwio runs a small server on your computer. No data leaves your computer.
- **It saves automatically.** Each change goes to your file within one second.
- **It follows outside changes.** If another program changes the file, the editor shows the new version. Examples are `git checkout`, a text editor, or an AI agent. If you have unsaved edits at that time, dwio merges the outside changes into your open diagram. It does not ask you to choose.
- **It works with git.** A `.drawio.svg` file shows the picture on GitHub. The same file also holds the diagram data. dwio saves the data as plain XML, so you can read the git diffs.
- **It works with two file types.** Use `.drawio` (XML) or `.drawio.svg` (SVG picture with the diagram inside).

## Install

Run this command on Linux or macOS:

```sh
curl -fsSL https://raw.githubusercontent.com/griimick/dwio/main/install.sh | sh
```

The script does these steps:

1. It downloads one program file for your system. You do not need Node.js.
2. It checks the file with a checksum.
3. It puts the file in `~/.local/bin/dwio`.

Make sure `~/.local/bin` is in your `PATH`.

### Run without installing

If you have Node.js 18.3 or newer, you can run dwio with `npx`. You do not install anything.

```sh
npx @griimick/dwio diagram.drawio.svg
pnpm dlx @griimick/dwio diagram.drawio.svg
bunx @griimick/dwio diagram.drawio.svg
```

To install the command for all projects, run `npm install -g @griimick/dwio`.

To install in a different folder, set `DWIO_INSTALL_DIR`. To install a specific version, set `DWIO_VERSION`, for example `DWIO_VERSION=v0.1.0`.

On Windows, download `dwio-windows-x64.exe` from the [Releases page](https://github.com/griimick/dwio/releases).

The first time you run dwio, it downloads the draw.io editor (about 50 MB). It saves the editor in your cache folder. On Linux this is `$XDG_CACHE_HOME/dwio`, or `~/.cache/dwio` if that variable is not set. On macOS it is `~/Library/Caches/dwio`. On Windows it is `%LOCALAPPDATA%\dwio\Cache`. To use a different folder, set `DWIO_CACHE_DIR`. After that, dwio does not use the network. To download the editor in advance, run `dwio setup`.

## Quick start

1. Run `dwio my-diagram.drawio.svg`. If the file does not exist, dwio makes it.
2. Draw in the browser tab. The menu bar shows the file name and the state, for example "saved 3:45:11 PM".
3. Close the browser tab. dwio stops by itself after a few seconds.

To stop dwio at any time, press `Ctrl+C`.

## Commands

| Command | What it does |
| --- | --- |
| `dwio <file>` | Opens the file in the editor and keeps the file in sync. |
| `dwio xml <file>` | Prints the diagram as plain XML. Use it in scripts. |
| `dwio export <file>` | Makes a picture of the diagram: PNG, SVG, PDF, or `.drawio.svg`. See [Export a picture](#export-a-picture). |
| `dwio upgrade [version]` | Installs the newest release, or the version that you name. See [Upgrade dwio](#upgrade-dwio). |
| `dwio mcp` | Runs dwio as an MCP server for AI agents. See [Use dwio with AI agents](#use-dwio-with-ai-agents). |
| `dwio setup` | Downloads the draw.io editor. |
| `dwio --help` | Shows all options. |
| `dwio --version` | Shows the dwio version and the draw.io version. |

## Options

| Option | What it does |
| --- | --- |
| `--no-open` | Does not open a browser. dwio prints the URL only. |
| `--port <n>` | Uses this port. dwio stops with an error if the port is busy. |
| `--check` | With `upgrade`: says if a newer release exists. Changes nothing. |
| `--keep-alive` | Keeps dwio running after you close the browser tab. |
| `--no-create` | Stops with an error if the file does not exist. |
| `--json` | Prints one line of JSON instead of the URL. |
| `--host <address>` | Listens on this address. See [Use dwio from another computer](#use-dwio-from-another-computer). |
| `--allow-host <name>` | Accepts this host name. You can use this option more than once. |
| `--public-port <n>` | Tells dwio which port the browser uses. Use it with a tunnel. |
| `--drawio-version <v>` | Uses this version of the draw.io editor. |

The default port is `3946`. This number is "dwio" on a phone keypad. If port 3946 is busy, dwio tries the next ports, up to 3966. To change the default port, set the environment variable `DWIO_PORT`.

## Upgrade dwio

```sh
dwio upgrade            # installs the newest release
dwio upgrade --check    # says if a newer release exists, and changes nothing
dwio upgrade 0.1.0      # installs a specific version
```

`dwio update` does the same as `dwio upgrade`. Use `--json` to get the result as JSON.

The command downloads the program file for your system from the [Releases page](https://github.com/griimick/dwio/releases). It checks the checksum and runs the new file one time. Then it replaces itself. If a step fails, your old program stays in place.

This works for the program that `install.sh` installs. If you use `npx`, you always get the newest version. If you installed with npm, run `npm install -g @griimick/dwio` to upgrade.

dwio uses the network only when you run `dwio upgrade` or `dwio setup`, and the first time that it needs the draw.io editor. To use a mirror of the Releases page, set `DWIO_RELEASES_URL`.

## Export a picture

Use `dwio export` to see how a diagram looks. It does not open the editor. It draws the diagram and writes an image file.

```sh
dwio export diagram.drawio.svg                 # writes diagram.png next to the file
dwio export diagram.drawio -o /tmp/look.png    # choose the output file
dwio export diagram.drawio -o diagram.pdf      # the extension sets the format
dwio export diagram.drawio -o -  > out.png     # write to standard output
dwio export diagram.drawio -o copy.drawio.svg  # make a .drawio.svg from a .drawio file
```

dwio needs a Chrome, Chromium, or Edge browser on your computer to draw the diagram. dwio looks for one in `PATH`, in the usual install folders, and in the Playwright cache. To use a specific browser, set `DWIO_BROWSER` or use `--browser <path>`. dwio does not open a window. The browser runs without a screen.

| Option | What it does |
| --- | --- |
| `-o`, `--output <path>` | Output file. The extension sets the format. Use `-` for standard output. |
| `--format <f>` | `png`, `svg`, `pdf`, or `drawio.svg`. This overrides the extension. |
| `--page <n or name>` | Exports one page. Use the page number (from 1) or the exact page name. The default is page 1. |
| `--all-pages` | Exports each page to its own file: `name-1.png`, `name-2.png`, and so on. |
| `--scale <x>` | Zoom factor. The default is 2 for PNG and 1 for the other formats. |
| `--border <px>` | Space around the drawing. The default is 10. |
| `--background <color>` | Background color, for example `"#ffffff"`. PNG and PDF are white by default. |
| `--transparent` | Makes the PNG background transparent. |
| `--timeout <seconds>` | Stops after this time. The default is 60. |
| `--json` | Prints the result as JSON: file path, format, page, size in bytes, and image size in pixels. |

A `.drawio.svg` export keeps all pages of the file unless you set `--page` or `--all-pages`. Other formats export page 1 unless you choose a page. If the file has more pages, dwio prints a note on standard error.

## Use dwio from another computer

By default, dwio accepts connections from your own computer only. To use it from another computer, for example over Tailscale, do this:

```sh
dwio diagram.drawio.svg --host 0.0.0.0
```

dwio prints one URL for each network address. Each URL has a secret token. Anyone who has the URL can read and change the file. The connection is plain HTTP, so use this option only on a network that you trust.

### Error: "bad host"

dwio refuses a request if the address in the browser is not an IP address, `localhost`, or the name of your computer. This rule protects you from attacks on local servers. The error message tells you what to do.

To open dwio with a different name, allow the name:

```sh
dwio diagram.drawio.svg --host 0.0.0.0 --allow-host mybox.example.ts.net
```

To use an SSH tunnel with a different port, set both ports:

```sh
ssh -L 8080:127.0.0.1:3946 server
dwio diagram.drawio.svg --public-port 8080
```

## Use dwio with AI agents

dwio can run as an [MCP](https://modelcontextprotocol.io) server. An agent such as Claude Code or opencode can then read, draw, and edit your diagrams. If you have the diagram open in the dwio editor, you see each change within a second.

Add dwio to your agent one time:

```sh
claude mcp add dwio -- dwio mcp
```

For opencode, add this to `opencode.json` in your project (not tested yet):

```json
{ "mcp": { "dwio": { "type": "local", "command": ["dwio", "mcp"] } } }
```

Then ask the agent in plain words, in a folder that has a diagram:

> In architecture.drawio.svg, add a Cache box below the server and connect them with a dashed arrow labeled "hot reads". Then look at the picture.

The agent gets four tools:

| Tool | What it does |
| --- | --- |
| `get_diagram` | Lists the pages and the cells: id, type, label, style, position, size, and the two ends of each connector. |
| `apply_changes` | Adds shapes and connectors, changes cells, or deletes cells. All changes in one call succeed together, or none is made. |
| `render` | Draws the diagram as a PNG image, so the agent can look at the result. |
| `create_diagram` | Makes a new, empty diagram file. |

Each tool takes the path of the file. The file can be a `.drawio` or a `.drawio.svg` file.

- `apply_changes` changes only the text that must change, so `git diff` shows only the new or changed lines. This is true for `.drawio` files. A `.drawio.svg` file keeps the whole diagram on one line.
- For a `.drawio.svg` file, `apply_changes` also redraws the picture. This needs a Chrome, Chromium, or Edge browser. If there is none, the data is updated, the answer has a warning, and the picture stays old until the editor saves the file.
- `render` also needs a browser. See [Export a picture](#export-a-picture).
- The agent cannot see what you select in the editor yet. Tell it which shape you mean, for example by its label.

Without MCP, an agent can still run `dwio xml <file>` to read a diagram and `dwio export <file> -o /tmp/look.png` to see it. With `--json`, dwio writes only the result to standard output. It writes all other messages to standard error. The exit codes are `0` (success), `1` (error), and `2` (wrong usage).

Agents that work on the dwio code must read [AGENTS.md](AGENTS.md).

## Troubleshooting

**"has no embedded draw.io data".** The SVG file does not come from draw.io. Open a `.drawio.svg` file that draw.io made, or make a new file.

**"port … is in use".** Another program uses the port. Use a different port with `--port`.

**A message says "Merged changes from disk".** The file changed while you had unsaved edits. dwio combined both. If you and the outside change edited the same shape, the version from the disk wins for that shape. Use Undo (`Ctrl+Z`) in the editor to go back.

**A message says "Lost connection to dwio".** dwio is not running, or the computer went to sleep. The editor keeps your diagram, but it cannot save. Use **File**, **Export as** to keep your work. Then start dwio again.

**"No Chrome, Chromium or Edge browser found".** `dwio export` needs a browser to draw the diagram. Install one, or set `DWIO_BROWSER` to its full path.

**"cannot write to ..." when you upgrade.** dwio has no permission to change its own folder. Install again with `install.sh` and set `DWIO_INSTALL_DIR` to a folder that you own, or run `dwio upgrade` with the right permission.

**The colors are wrong or you do not want colors.** dwio uses colors only when the output goes to a terminal. Output that you pipe or redirect has no colors. To turn colors off, set `NO_COLOR=1`. To force colors on, set `FORCE_COLOR=1`. The URL or JSON that dwio writes to standard output never has colors.

**The browser does not open.** Use `--no-open`, and open the printed URL yourself. On Linux, dwio uses `xdg-open`. To use a different browser, set the `BROWSER` environment variable.

## Change dwio

To change the code, read [CONTRIBUTING.md](CONTRIBUTING.md). Maintainers find the release steps in [docs/releasing.md](docs/releasing.md).

## Disclaimer about AI-generated content

A large language model (LLM) wrote much of the code and the documentation in this project. The LLM is Claude, made by Anthropic. A person gave the instructions and looked at the results. A person did not read every line.

Do not trust this software without a review. Test it before you use it for important work. Read the code before you run dwio on a network. The authors give no warranty. See the license for the full terms.

## License

[MIT](LICENSE).

draw.io is a registered trademark of draw.io Ltd and draw.io AG. dwio is an independent project. It is not connected with, approved by, or sponsored by draw.io Ltd or draw.io AG. The name "draw.io" appears in this project only to say which file format and editor dwio works with.

dwio does not include draw.io. The first time you run dwio, it downloads draw.io from the [upstream project](https://github.com/jgraph/drawio). The upstream project uses the Apache-2.0 license.
