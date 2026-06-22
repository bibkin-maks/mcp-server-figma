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
