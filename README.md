# figma-rest-mcp

A free Figma MCP server. Reads go straight to the Figma REST API with your own
personal access token; writes go through a small local relay into a companion
Figma plugin — because the REST API can read everything but can't edit anything.

No paid MCP calls, no cloud middleman. Your token, your machine, your files.

## How it fits together

```
Claude ──stdio──▶ MCP server ──ws──▶ relay ──ws──▶ Figma plugin
                     │                                  │
                     └────────── REST API ──────────────┘
                              (reads only)
```

- **Read tools** hit `api.figma.com` directly. All they need is `FIGMA_TOKEN`.
- **Write tools** broadcast commands over a local WebSocket relay
  (`ws://localhost:3055`) to the *Code MCP Bridge* plugin running in Figma
  desktop, which executes them with the full Plugin API.

## Quick start

1. **Get a token.** Figma → Settings → Security → *Personal access tokens*.
   Give it *File content: read* (and *Comments: write* if you want to post
   comments). It starts with `figd_` — if what you have is a shorter
   client-id-looking string, that's an OAuth credential and won't work here.

2. **Drop it in `.env`** at the project root (already gitignored):

   ```
   FIGMA_TOKEN=figd_your_token_here
   ```

3. **Install and build:**

   ```
   npm install
   npm run build
   ```

4. **Register with Claude Code** (the server loads `.env` itself, so no token
   in the config):

   ```
   claude mcp add --scope user figma-rest -- node "<absolute path>\dist\index.js"
   ```

   Then ask Claude to run `whoami` — it should come back with your account.

That's everything for reading. For writing, add the bridge:

5. **Start the relay** and leave it running: `npm run bridge`
6. **Import the plugin** (once): Figma desktop → Plugins → Development →
   *Import plugin from manifest…* → pick `plugin/manifest.json`.
7. **Run "Code MCP Bridge"** in the file you want to edit. The wire in the
   plugin window goes solid when it's connected; `bridge_status` confirms it
   from Claude's side.

## Tools

### Read (REST API)

| Tool | What it does |
|------|--------------|
| `get_file` | Document tree + metadata, with `depth` to keep responses small |
| `get_file_nodes` | Just the nodes you ask for — much cheaper than `get_file` |
| `export_image` | Render nodes to PNG/SVG/JPG/PDF, optionally save to disk |
| `get_components` | Published components and component sets |
| `get_styles` | Published color/text/effect/grid styles |
| `get_comments` / `post_comment` | Read and write file comments |
| `whoami` | Sanity-check the token |

Every tool accepts either a raw file key or a full `figma.com/design/…` URL.

### Write (plugin bridge)

| Tool | What it does |
|------|--------------|
| `create_frame` / `create_rectangle` / `create_ellipse` / `create_text` | Make nodes |
| `set_fill_color` / `set_stroke_color` / `set_corner_radius` / `set_text` | Edit them |
| `move_node` / `resize_node` / `clone_node` / `append_child` / `delete_node` | Rearrange them |
| `get_document_info` / `get_selection` | Live state from the open file |
| `bridge_status` | Is the plugin connected? |
| `run_command` | Escape hatch: send any `{command, params}` to the plugin |

The plugin understands a few extras through `run_command`:

- **`batch`** — a list of steps executed in one round trip. Steps can reference
  nodes created earlier in the same batch with `"$3.id"`-style placeholders.
  This is *the* way to build anything nontrivial; one call instead of thirty.
- **`find_nodes`** / **`get_page_children`** — look nodes up by name, so a lost
  response never means guessing ids.

## The plugin window

The UI is a status instrument, not a form. A copper wire runs
`CLAUDE ──●── FIGMA`; it pulses when a command travels through, breaks apart
in gray when the relay drops, and reconnects itself with backoff (there's a
countdown and a *Retry now* if you're impatient). Below it, a traffic log —
each command timestamped, resolving to `ok` or `err` with the actual error
message indented under the row. Relay URL and channel live behind *Settings*
in the footer; defaults are right unless you changed them on the server side.

## Configuration

| Variable | Default | Used by |
|----------|---------|---------|
| `FIGMA_TOKEN` | — (required) | REST tools |
| `FIGMA_BRIDGE_PORT` | `3055` | relay |
| `FIGMA_BRIDGE_URL` | `ws://localhost:3055` | MCP server |
| `FIGMA_BRIDGE_CHANNEL` | `default` | MCP server (match it in the plugin) |

`.env` at the project root is loaded automatically; real environment
variables win over the file.

## When something's off

- **`403 Invalid token`** — the token isn't a personal access token. PATs
  start with `figd_`. Client IDs and client secrets won't authenticate.
- **"Timed out waiting for the Figma plugin"** — the plugin isn't running, or
  it's on a different channel, or the batch is just slow: Figma throttles
  plugins whose window is in the background, so keep Figma visible during big
  batches. The `run_command` timeout is 180s for exactly this reason.
- **`EADDRINUSE` on 3055** — a relay is already running. That one's fine;
  use it.
- **Edited `plugin/code.js` and nothing changed?** — Figma loads plugin code
  at launch. Close and re-run the plugin.
