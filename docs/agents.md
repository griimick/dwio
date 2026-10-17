# Use dwio with AI agents

dwio can run as an [MCP](https://modelcontextprotocol.io) server. An agent such as Claude Code or opencode can then read, draw, and edit your diagrams. If you have the diagram open in the dwio editor, you see each change within a second.

Add dwio to your agent one time:

```sh
claude mcp add dwio -- dwio mcp
```

For opencode, add this to `opencode.json` (or `opencode.jsonc`) in your project, or to `~/.config/opencode/opencode.json` for all projects:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": { "servers": { "dwio": { "type": "local", "command": ["dwio", "mcp"] } } }
}
```

Older opencode versions, and the opencode MCP docs page, use the flat form `"mcp": { "dwio": { … } }`. The current schema marks it deprecated.

Then ask the agent in plain words, in a folder that has a diagram:

> In architecture.drawio.svg, add a Cache box below the server and connect them with a dashed arrow labeled "hot reads". Then look at the picture.

The agent gets six tools:

| Tool | What it does |
| --- | --- |
| `get_style_guide` | Returns a short guide to the style strings, colors, arrows, containers, and layout rules. The agent reads it once before it draws new shapes. |
| `list_open_diagrams` | Lists the diagrams that you have open in the dwio editor now. Use it when you say "this diagram". |
| `get_diagram` | Lists the pages and the cells: id, type, label, style, position, size, and the two ends of each connector. |
| `apply_changes` | Adds shapes and connectors, changes cells, or deletes cells. All changes in one call succeed together, or none is made. |
| `render` | Draws the diagram as a PNG image, so the agent can look at the result. |
| `create_diagram` | Makes a new, empty diagram file. |

Each tool takes the path of the file. The file can be a `.drawio` or a `.drawio.svg` file. If you have exactly one diagram open in the dwio editor, the agent can leave the path out, and dwio uses the open diagram. The answer says which file it used. If no diagram is open, or more than one is, the agent gets an error that says so.

The tools can use only files inside one folder: the folder where `dwio mcp` starts. Agents normally start it in your project folder. A path that leaves this folder, with `..`, an absolute path, or a symbolic link, is refused with a message. This protects you if the agent makes a mistake, or if text inside a diagram misleads it. To allow another folder, add `--root`, for example `claude mcp add dwio -- dwio mcp --root . --root ~/diagrams`.

- `apply_changes` changes only the text that must change, so `git diff` shows only the new or changed lines. This is true for `.drawio` files. A `.drawio.svg` file keeps the whole diagram on one line.
- For a `.drawio.svg` file, `apply_changes` also redraws the picture. This needs a Chrome, Chromium, or Edge browser. If there is none, the data is updated, the answer has a warning, and the picture stays old until the editor saves the file.
- `render` also needs a browser. See [Export a picture](export.md).
- The agent can see which diagram you have open, but not what you select in the editor yet. Tell it which shape you mean, for example by its label.

### Icons, logos, and other draw.io tools

For cloud, network, Kubernetes, or brand icons, the agent needs the exact style string of the icon. It should not guess. The official [draw.io MCP](https://github.com/jgraph/drawio-mcp) has a tool, `search_shapes`, that returns these strings for about 10,000 shapes. The agent passes the string from the result as `style` to `apply_changes`. This works with no extra code in dwio. We tested it with an AWS Lambda icon.

To add the official server to Claude Code:

```sh
claude mcp add --transport http drawio https://mcp.draw.io/mcp
```

If you use Claude Code with a claude.ai account, the draw.io connector can be there already. Check with `claude mcp list`.

- The official server runs on the internet. For `search_shapes`, it receives only the words that the agent searches for, such as "aws lambda". It does not receive your diagram. Its other tool, `create_diagram`, receives diagram XML, and dwio does not need it.
- The official `create_diagram` shows a diagram in the chat. It does not change your file. The dwio instructions tell the agent to use the dwio tools when you want a file in your project changed.

### How the agent finds the open diagram

When you run `dwio <file>`, dwio writes a small instance file about itself, and it removes the file when it stops. `dwio mcp` reads these files. On Linux the folder is `$XDG_RUNTIME_DIR/dwio`. On macOS it is in the per-user temporary folder. On Windows it is `%LOCALAPPDATA%\dwio\run`.

The folder and the files are private to your user account. dwio checks this each time. It does not use a folder that is a link, that belongs to another user, or that others can open. A file is trusted only if its program is running and answers a random question correctly. The answer needs a secret that is inside the file, and the secret is never sent. A leftover file after a crash is removed. The secret is not the token of the editor page, and it opens no route that reads or writes your diagram. Programs that run as your own user can read these files, as they can read your other files.

Without MCP, an agent can still run `dwio xml <file>` to read a diagram and `dwio export <file> -o /tmp/look.png` to see it. With `--json`, dwio writes only the result to standard output. It writes all other messages to standard error. The exit codes are `0` (success), `1` (error), and `2` (wrong usage).

Agents that work on the dwio code must read [AGENTS.md](../AGENTS.md).
