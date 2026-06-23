# figma-rest-mcp

A free Figma MCP server backed by the **Figma REST API**. No paid Figma MCP calls — you
authenticate with your own personal access token and pay nothing beyond Figma's normal
API rate limits.

## What it can do

| Tool | Purpose |
|------|---------|
| `get_file` | Fetch a file's document tree + metadata (with `depth` to keep it small) |
| `get_file_nodes` | Fetch only specific nodes by id (cheaper than `get_file`) |
| `export_image` | Render nodes to PNG/SVG/JPG/PDF; optionally download to disk |
| `get_components` | List published components + component sets |
| `get_styles` | List published color/text/effect/grid styles |
| `get_comments` | Read all comments on a file |
| `post_comment` | Post / reply to a comment |
| `whoami` | Verify your token |

All tools accept either a raw **file key** or a full **figma.com URL**.

### Write / design tools (require the plugin bridge — see below)

| Tool | Purpose |
|------|---------|
| `bridge_status` | Check the plugin is connected |
| `get_document_info`, `get_selection` | Live state from the open file |
| `create_frame` / `create_rectangle` / `create_ellipse` / `create_text` | Create nodes |
| `set_fill_color` / `set_stroke_color` / `set_corner_radius` / `set_text` | Edit properties |
| `move_node` / `resize_node` / `clone_node` / `append_child` / `delete_node` | Manipulate nodes |
| `run_command` | Escape hatch — send any `{command, params}` to the plugin |

These work because the REST API **cannot** write designs — so creating/editing goes
through a Figma plugin running in the desktop app, over a local WebSocket relay.

## The plugin bridge (for creating / editing designs)

Three pieces talk to each other: **MCP server** ⇄ **relay** ⇄ **Figma plugin**.

1. **Start the relay** (keep it running in a terminal):
   ```
   npm run bridge
   ```
   Listens on `ws://localhost:3055`. Change with `FIGMA_BRIDGE_PORT`.

2. **Import the plugin into Figma desktop** (one time):
   - Figma → menu → *Plugins → Development → Import plugin from manifest…*
   - Select `figma-mcp/plugin/manifest.json`.

3. **Run the plugin** in the file you want to edit:
   - *Plugins → Development → Code MCP Bridge*.
   - It auto-connects to `ws://localhost:3055`, channel `default`. The status box turns
     green when connected. (Use a custom channel by setting `FIGMA_BRIDGE_CHANNEL` on the
     MCP server and typing the same channel in the plugin window.)

4. In Claude, run **`bridge_status`** to confirm, then e.g.
   *"create a 200×80 indigo rounded rectangle"*.

The relay holds no state and needs no token — only the REST tools use `FIGMA_TOKEN`.

## Setup

1. Create a personal access token: https://www.figma.com/developers/api#access-tokens
   (scopes needed: *File content* read; *Comments* write if you want `post_comment`).
2. Install + build (already done if you ran this):
   ```
   npm install
   npm run build
   ```

## Register with Claude Code

```
claude mcp add figma-rest --env FIGMA_TOKEN=YOUR_TOKEN_HERE -- node "C:\\Users\\maxko\\OneDrive\\Desktop\\my publicy known love\\figma-mcp\\dist\\index.js"
```

Or add to your MCP config (`.mcp.json` / Claude Desktop `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "figma-rest": {
      "command": "node",
      "args": ["C:\\Users\\maxko\\OneDrive\\Desktop\\my publicy known love\\figma-mcp\\dist\\index.js"],
      "env": { "FIGMA_TOKEN": "YOUR_TOKEN_HERE" }
    }
  }
}
```

Restart Claude, then try: *"use figma-rest whoami"* to confirm it's wired up.
