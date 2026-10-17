# Add dwio to your agent

dwio runs as an [MCP](https://modelcontextprotocol.io) server with the command `dwio mcp`. Add it to your agent one time. For what the agent can do then, see [Use dwio with AI agents](agents.md).

Before you start, make sure that `dwio` is in your `PATH`. Use `dwio --version` to check.

## Claude Code

```sh
claude mcp add dwio -- dwio mcp
```

To check the setup, use `claude mcp list`. To remove dwio, use `claude mcp remove dwio`.

## Codex

```sh
codex mcp add dwio -- dwio mcp
```

To check the setup, use `codex mcp list`. To remove dwio, use `codex mcp remove dwio`.

The command writes this to `~/.codex/config.toml`. You can also add it by hand:

```toml
[mcp_servers.dwio]
command = "dwio"
args = ["mcp"]
```

Codex also reads `.codex/config.toml` in a project that you trust. Put the same lines there to add dwio for that project only.

## opencode

Add this to `opencode.json` (or `opencode.jsonc`) in your project. To add dwio for all projects, use `~/.config/opencode/opencode.json`.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": { "servers": { "dwio": { "type": "local", "command": ["dwio", "mcp"] } } }
}
```

Older opencode versions, and the opencode MCP docs page, use the flat form `"mcp": { "dwio": { … } }`. The current schema marks it as deprecated.

## Allow more folders

The agent can use only files inside the folder where `dwio mcp` starts. To allow other folders, add `--root` for each folder. For example:

```sh
claude mcp add dwio -- dwio mcp --root . --root ~/diagrams
codex mcp add dwio -- dwio mcp --root . --root ~/diagrams
```

In a config file, add the same words to the argument list: `args = ["mcp", "--root", ".", "--root", "~/diagrams"]`.
