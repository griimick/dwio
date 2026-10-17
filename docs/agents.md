# Use dwio with AI agents

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
- `render` also needs a browser. See [Export a picture](export.md).
- The agent cannot see what you select in the editor yet. Tell it which shape you mean, for example by its label.

Without MCP, an agent can still run `dwio xml <file>` to read a diagram and `dwio export <file> -o /tmp/look.png` to see it. With `--json`, dwio writes only the result to standard output. It writes all other messages to standard error. The exit codes are `0` (success), `1` (error), and `2` (wrong usage).

Agents that work on the dwio code must read [AGENTS.md](../AGENTS.md).
