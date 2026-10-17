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

## Run your changes

You can run your code in two ways.

**1. From the repository folder.** Use this for quick checks.

```sh
bun run dev -- /full/path/to/diagram.drawio.svg --no-open
```

`bun run dev` runs inside the repository folder. A short file name is looked up there, so give the full path of a file in another folder.

**2. From any folder, with a second command.** Use this to open your own diagrams, and to test `dwio mcp` with an agent. Make a link with a name that is not `dwio`:

```sh
chmod +x src/cli.ts     # one time, if the file is not executable
ln -sf "$PWD/src/cli.ts" ~/.local/bin/dwio-dev
```

Now `dwio-dev` runs the code of the branch that you have checked out. You do not need to build. Change branches with `git switch`, and `dwio-dev` follows.

- Keep the name `dwio` for the released program. The install script and `dwio upgrade` replace `~/.local/bin/dwio`, and they remove a link with that name.
- `dwio-dev` needs `bun` in your `PATH`. A login shell has it. Some other programs, such as editors and agent launchers, do not.
- You can run `dwio` and `dwio-dev` at the same time. The second one uses the next free port.
- To see which one you run, look for a new command. For example, `dwio-dev --help | grep mcp` shows a line only if the code has `mcp`. The two commands can print the same version number.
- `dwio-dev upgrade` refuses to run. It replaces only the released program.
- To remove the link, run `rm ~/.local/bin/dwio-dev`.

To test an agent with your code, use a separate name, and remove it when you finish:

```sh
claude mcp add dwio-dev -- dwio-dev mcp
claude mcp remove dwio-dev
```

To try a branch while you keep working on another one, make a second copy of the repository with `git worktree`, and make a link to it with a different name (for example `dwio-pr`):

```sh
git worktree add ~/workspace/dwio-pr feat/some-branch
(cd ~/workspace/dwio-pr && bun install)
ln -sf ~/workspace/dwio-pr/src/cli.ts ~/.local/bin/dwio-pr
```

A running dwio saves into the file that it has open. Use copies of the example diagrams for experiments, for example `cp examples/flow.drawio /tmp/try.drawio`.

## Project layout

| Path | Content |
| --- | --- |
| `src/cli.ts` | Reads the options and starts the server. |
| `src/server.ts` | The local web server, the file API, and the file watcher. |
| `src/format.ts` | Reads and writes `.drawio` and `.drawio.svg` files. |
| `src/export.ts`, `src/cdp.ts`, `src/browser.ts` | `dwio export`. It runs a browser without a screen and reads the picture from the draw.io editor. |
| `src/xml.ts`, `src/diagram.ts`, `src/diagram-file.ts` | Reads and edits the cells of a diagram (for agents), in `.drawio` and `.drawio.svg` files. It changes only the text that must change. |
| `src/progress.ts` | The loader that shows download progress in a terminal. `install.sh` has its own copy in shell. |
| `src/instances.ts` | Instance files: how `dwio mcp` finds the diagram that you have open. The folder must stay private. |
| `src/safe-path.ts` | Keeps the MCP tools inside the allowed folders. Use it for every path that an agent gives. |
| `src/style-guide.ts` | The style guide that agents read with `get_style_guide`. Change the lists at the top, and the test draws every style. |
| `src/mcp.ts` | `dwio mcp`. The MCP server that lets an agent read and edit diagrams. It must write protocol messages only to standard output. |
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
