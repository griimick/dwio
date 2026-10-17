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
- **It works with AI agents.** An agent such as Claude Code can read and edit your diagrams. See [Use dwio with AI agents](docs/agents.md).
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

The first time you run dwio, it downloads the draw.io editor (about 50 MB) and saves it in your cache folder. After that, dwio does not use the network. To download the editor in advance, run `dwio setup`. See [the cache folder](docs/reference.md#the-drawio-editor-and-the-cache-folder).

## Quick start

1. Run `dwio my-diagram.drawio.svg`. To start a new diagram, add `--create`: dwio makes the file if it does not exist.
2. Draw in the browser tab. The menu bar shows the file name and the state, for example "saved 3:45:11 PM".
   The icon of the browser tab shows a blue dot while there are unsaved edits, and a red dot if something is wrong.
3. Close the browser tab. dwio stops by itself after a few seconds.

To stop dwio at any time, press `Ctrl+C`.

## Commands

| Command | What it does |
| --- | --- |
| `dwio <file>` | Opens the file in the editor and keeps the file in sync. |
| `dwio xml <file>` | Prints the diagram as plain XML. Use it in scripts. |
| `dwio export <file>` | Makes a picture of the diagram: PNG, SVG, PDF, or `.drawio.svg`. See [Export a picture](docs/export.md). |
| `dwio upgrade [version]` | Installs the newest release, or the version that you name. See [Upgrade dwio](docs/reference.md#upgrade-dwio). |
| `dwio mcp` | Runs dwio as an MCP server for AI agents. See [Use dwio with AI agents](docs/agents.md). |
| `dwio setup` | Downloads the draw.io editor. |
| `dwio --help` | Shows all options. They are also in the [reference](docs/reference.md#options). |
| `dwio --version` | Shows the dwio version and the draw.io version. |

## Guides

- [Export a picture](docs/export.md): make a PNG, SVG, PDF, or `.drawio.svg` from a diagram.
- [Use dwio with AI agents](docs/agents.md): let Claude Code, Codex, and other agents read and edit your diagrams. It also shows how to add cloud and brand icons with the official draw.io MCP.
- [Add dwio to your agent](docs/agent-setup.md): MCP setup for Claude Code, Codex, and opencode.
- [Use dwio from another computer](docs/remote-access.md): `--host`, tunnels, and the "bad host" error.
- [Reference](docs/reference.md): options, upgrade, and the cache folder.
- [Troubleshooting](docs/troubleshooting.md)

## Change dwio

To change the code, read [CONTRIBUTING.md](CONTRIBUTING.md). Maintainers find the release steps in [docs/releasing.md](docs/releasing.md).

## Disclaimer about AI-generated content

A large language model (LLM) wrote much of the code and the documentation in this project. The LLM is Claude, made by Anthropic. A person gave the instructions and looked at the results. A person did not read every line.

Do not trust this software without a review. Test it before you use it for important work. Read the code before you run dwio on a network. The authors give no warranty. See the license for the full terms.

## License

[MIT](LICENSE).

draw.io is a registered trademark of draw.io Ltd and draw.io AG. dwio is an independent project. It is not connected with, approved by, or sponsored by draw.io Ltd or draw.io AG. The name "draw.io" appears in this project only to say which file format and editor dwio works with.

dwio does not include draw.io. The first time you run dwio, it downloads draw.io from the [upstream project](https://github.com/jgraph/drawio). The upstream project uses the Apache-2.0 license.
