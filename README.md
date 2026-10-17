# dwio

Edit draw.io diagrams that are files in your project. Do it from the terminal.

```sh
dwio docs/architecture.drawio.svg
```

This command opens the draw.io editor in your browser. The editor saves each change to the file. You keep the diagram in git with your code. You do not move files in and out of a web app.

## Why use dwio

- **It works offline.** dwio runs a small server on your computer. No data leaves your computer.
- **It saves automatically.** Each change goes to your file within one second.
- **It reloads changed files.** If another program changes the file, the editor loads the new version. Examples are `git checkout`, a text editor, or an AI agent.
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

To install in a different folder, set `DWIO_INSTALL_DIR`. To install a specific version, set `DWIO_VERSION`, for example `DWIO_VERSION=v0.1.0`.

On Windows, download `dwio-windows-x64.exe` from the [Releases page](https://github.com/griimick/dwio/releases).

The first time you run dwio, it downloads the draw.io editor (about 50 MB). It saves the editor in `~/.cache/dwio`. After that, dwio does not use the network. To download the editor in advance, run `dwio setup`.

## Quick start

1. Run `dwio my-diagram.drawio.svg`. If the file does not exist, dwio makes it.
2. Draw in the browser tab. The status bar at the top shows "saved" after each change.
3. Close the browser tab. dwio stops by itself after a few seconds.

To stop dwio at any time, press `Ctrl+C`.

## Commands

| Command | What it does |
| --- | --- |
| `dwio <file>` | Opens the file in the editor and keeps the file in sync. |
| `dwio xml <file>` | Prints the diagram as plain XML. Use it in scripts. |
| `dwio setup` | Downloads the draw.io editor. |
| `dwio --help` | Shows all options. |
| `dwio --version` | Shows the dwio version and the draw.io version. |

## Options

| Option | What it does |
| --- | --- |
| `--no-open` | Does not open a browser. dwio prints the URL only. |
| `--port <n>` | Uses this port. dwio stops with an error if the port is busy. |
| `--keep-alive` | Keeps dwio running after you close the browser tab. |
| `--no-create` | Stops with an error if the file does not exist. |
| `--json` | Prints one line of JSON instead of the URL. |
| `--host <address>` | Listens on this address. See [Use dwio from another computer](#use-dwio-from-another-computer). |
| `--allow-host <name>` | Accepts this host name. You can use this option more than once. |
| `--public-port <n>` | Tells dwio which port the browser uses. Use it with a tunnel. |
| `--drawio-version <v>` | Uses this version of the draw.io editor. |

The default port is `3946`. This number is "dwio" on a phone keypad. If port 3946 is busy, dwio tries the next ports, up to 3966. To change the default port, set the environment variable `DWIO_PORT`.

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

An agent cannot use the browser editor. An agent can do these tasks:

- Read a diagram: `dwio xml <file>` prints plain XML.
- Start the editor for you: `dwio <file> --no-open --json` prints one line of JSON with the URL.

dwio writes only the URL (or the JSON) to standard output. It writes all other messages to standard error. The exit codes are `0` (success), `1` (error), and `2` (wrong usage).

Agents that work on the dwio code must read [AGENTS.md](AGENTS.md).

## Troubleshooting

**"has no embedded draw.io data".** The SVG file does not come from draw.io. Open a `.drawio.svg` file that draw.io made, or make a new file.

**"port … is in use".** Another program uses the port. Use a different port with `--port`.

**The editor shows "file changed on disk".** The file changed while you had unsaved edits. Click **Reload from disk** to load the new file. Click **Overwrite disk** to keep your edits.

**The browser does not open.** Use `--no-open`, and open the printed URL yourself. On Linux, dwio uses `xdg-open`. To use a different browser, set the `BROWSER` environment variable.

## Develop dwio

You need Node.js 22.18 or newer. Bun is only necessary to build the program file.

```sh
npm install          # also turns on the commit message check
npm run check        # type check and tests
node src/cli.ts some.drawio --no-open
npm run build:bin    # builds one program file in dist-bin/ (needs Bun)
```

Commit messages must follow [Conventional Commits](https://www.conventionalcommits.org), for example `feat(server): add a new endpoint`.

### Make a release

1. Change `version` in `package.json`. Commit the change.
2. Run `git tag vX.Y.Z` and then `git push origin vX.Y.Z`.

The `release` workflow checks that the tag matches `package.json`. It runs the tests, builds the program files for all five systems, and publishes them with a `SHA256SUMS` file on the Releases page.

## Disclaimer about AI-generated content

A large language model (LLM) wrote much of the code and the documentation in this project. The LLM is Claude, made by Anthropic. A person gave the instructions and looked at the results. A person did not read every line.

Do not trust this software without a review. Test it before you use it for important work. Read the code before you run dwio on a network. The authors give no warranty. See the license for the full terms.

## License

[MIT](LICENSE).

draw.io is a trademark of JGraph Ltd. dwio does not include draw.io. dwio downloads draw.io from the upstream Apache-2.0 project the first time you run it.
