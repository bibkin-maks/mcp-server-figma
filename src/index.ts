#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { sendCommand } from "./bridgeClient.js";

const API = "https://api.figma.com/v1";
const TOKEN = process.env.FIGMA_TOKEN ?? process.env.FIGMA_PERSONAL_ACCESS_TOKEN;

if (!TOKEN) {
  console.error(
    "[figma-rest-mcp] Missing FIGMA_TOKEN. Create a personal access token at " +
      "https://www.figma.com/developers/api#access-tokens and set FIGMA_TOKEN.",
  );
  process.exit(1);
}

/** Accepts a raw file key or any figma.com/file|design URL and returns the key. */
function fileKey(input: string): string {
  const m = input.match(/figma\.com\/(?:file|design)\/([a-zA-Z0-9]+)/);
  return m ? m[1] : input.trim();
}

/** Pull a node id out of a Figma URL (?node-id=1-2 or 1%3A2), else return as-is. */
function nodeId(input: string): string {
  const m = input.match(/node-id=([0-9]+[:%A-Za-z0-9-]*)/);
  const raw = m ? m[1] : input.trim();
  return decodeURIComponent(raw).replace(/-/g, ":");
}

async function figma(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "X-Figma-Token": TOKEN!,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg = body?.err || body?.message || res.statusText;
    throw new Error(`Figma API ${res.status}: ${msg}`);
  }
  return body;
}

function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

const server = new McpServer({ name: "figma-rest-mcp", version: "0.1.0" });

// ── Read file / node JSON ───────────────────────────────────────────────────
server.tool(
  "get_file",
  "Fetch a Figma file's document tree and metadata. Accepts a file key or a figma.com URL. " +
    "Use `depth` to limit how deep the node tree is traversed (keeps responses small).",
  {
    file: z.string().describe("Figma file key or figma.com/design/... URL"),
    depth: z.number().int().min(1).max(10).optional().describe("Tree traversal depth (default: full)"),
    geometry: z.boolean().optional().describe("Include vector geometry paths (default false)"),
  },
  async ({ file, depth, geometry }) => {
    const params = new URLSearchParams();
    if (depth) params.set("depth", String(depth));
    if (geometry) params.set("geometry", "paths");
    const qs = params.toString();
    return jsonResult(await figma(`/files/${fileKey(file)}${qs ? `?${qs}` : ""}`));
  },
);

server.tool(
  "get_file_nodes",
  "Fetch specific nodes (frames/components/etc.) from a Figma file by node id. " +
    "Far cheaper than get_file when you only need a few nodes.",
  {
    file: z.string().describe("Figma file key or URL"),
    ids: z.array(z.string()).min(1).describe("Node ids (e.g. ['1:2']) or full node URLs"),
    depth: z.number().int().min(1).max(10).optional(),
  },
  async ({ file, ids, depth }) => {
    const params = new URLSearchParams();
    params.set("ids", ids.map(nodeId).join(","));
    if (depth) params.set("depth", String(depth));
    return jsonResult(await figma(`/files/${fileKey(file)}/nodes?${params.toString()}`));
  },
);

// ── Export images ───────────────────────────────────────────────────────────
server.tool(
  "export_image",
  "Render Figma nodes to PNG/SVG/JPG/PDF. Returns the temporary Figma CDN URLs and, " +
    "if `saveDir` is given, downloads each image to disk and returns the file paths.",
  {
    file: z.string().describe("Figma file key or URL"),
    ids: z.array(z.string()).min(1).describe("Node ids or node URLs to render"),
    format: z.enum(["png", "svg", "jpg", "pdf"]).default("png"),
    scale: z.number().min(0.01).max(4).default(2).describe("Raster scale, 0.01–4 (png/jpg only)"),
    saveDir: z.string().optional().describe("Absolute dir to download rendered files into"),
  },
  async ({ file, ids, format, scale, saveDir }) => {
    const key = fileKey(file);
    const nodeIds = ids.map(nodeId);
    const params = new URLSearchParams();
    params.set("ids", nodeIds.join(","));
    params.set("format", format);
    if (format === "png" || format === "jpg") params.set("scale", String(scale));
    const data = await figma(`/images/${key}?${params.toString()}`);
    const images: Record<string, string | null> = data.images ?? {};

    const saved: Record<string, string> = {};
    if (saveDir) {
      const dir = resolve(saveDir);
      await mkdir(dir, { recursive: true });
      for (const [id, url] of Object.entries(images)) {
        if (!url) continue;
        const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
        const path = join(dir, `${id.replace(/[:/]/g, "-")}.${format}`);
        await writeFile(path, buf);
        saved[id] = path;
      }
    }
    return jsonResult({ images, ...(saveDir ? { saved } : {}) });
  },
);

// ── Components & styles ─────────────────────────────────────────────────────
server.tool(
  "get_components",
  "List published components and component sets in a Figma file.",
  { file: z.string().describe("Figma file key or URL") },
  async ({ file }) => {
    const key = fileKey(file);
    const [components, sets] = await Promise.all([
      figma(`/files/${key}/components`),
      figma(`/files/${key}/component_sets`),
    ]);
    return jsonResult({
      components: components?.meta?.components ?? [],
      component_sets: sets?.meta?.component_sets ?? [],
    });
  },
);

server.tool(
  "get_styles",
  "List published styles (colors, text, effects, grids) in a Figma file.",
  { file: z.string().describe("Figma file key or URL") },
  async ({ file }) => {
    const data = await figma(`/files/${fileKey(file)}/styles`);
    return jsonResult(data?.meta?.styles ?? []);
  },
);

// ── Comments ────────────────────────────────────────────────────────────────
server.tool(
  "get_comments",
  "Read all comments on a Figma file.",
  { file: z.string().describe("Figma file key or URL") },
  async ({ file }) => {
    const data = await figma(`/files/${fileKey(file)}/comments`);
    return jsonResult(data?.comments ?? []);
  },
);

server.tool(
  "post_comment",
  "Post a comment on a Figma file. Optionally reply to an existing comment.",
  {
    file: z.string().describe("Figma file key or URL"),
    message: z.string().min(1),
    comment_id: z.string().optional().describe("Parent comment id to reply to"),
  },
  async ({ file, message, comment_id }) => {
    const body: Record<string, unknown> = { message };
    if (comment_id) body.comment_id = comment_id;
    const data = await figma(`/files/${fileKey(file)}/comments`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return jsonResult(data);
  },
);

// ── whoami (sanity check) ───────────────────────────────────────────────────
server.tool(
  "whoami",
  "Verify the configured token by fetching the authenticated Figma user.",
  {},
  async () => jsonResult(await figma(`/me`)),
);

// ════════════════════════════════════════════════════════════════════════════
// WRITE / DESIGN tools — these talk to the Figma plugin over the bridge relay.
// They require: (1) `npm run bridge` running, (2) the "Code MCP Bridge" plugin
// open in Figma and connected to the same channel.
// ════════════════════════════════════════════════════════════════════════════

const Color = z
  .union([
    z.string().describe("hex color, e.g. #4F46E5 or #4F46E5FF"),
    z.object({ r: z.number(), g: z.number(), b: z.number(), a: z.number().optional() }),
  ])
  .describe("Color as hex string or {r,g,b,a} with channels 0–1");

server.tool(
  "bridge_status",
  "Check whether the Figma plugin is connected and responding over the bridge.",
  {},
  async () => {
    try {
      await sendCommand("ping", {}, 3000);
      return jsonResult({ connected: true });
    } catch (e: any) {
      return jsonResult({ connected: false, reason: e.message });
    }
  },
);

server.tool(
  "get_document_info",
  "Get the current Figma document name, current page, and selection summary (live, via plugin).",
  {},
  async () => jsonResult(await sendCommand("get_document_info")),
);

server.tool(
  "get_selection",
  "Get the currently selected nodes in the open Figma file (via plugin).",
  {},
  async () => jsonResult(await sendCommand("get_selection")),
);

server.tool(
  "create_frame",
  "Create a frame in the current Figma page.",
  {
    x: z.number().default(0),
    y: z.number().default(0),
    width: z.number().default(400),
    height: z.number().default(300),
    name: z.string().optional(),
    fillColor: Color.optional(),
    parentId: z.string().optional().describe("Append into this node id instead of the page"),
  },
  async (a) => jsonResult(await sendCommand("create_frame", a)),
);

server.tool(
  "create_rectangle",
  "Create a rectangle in the current Figma page.",
  {
    x: z.number().default(0),
    y: z.number().default(0),
    width: z.number().default(100),
    height: z.number().default(100),
    name: z.string().optional(),
    fillColor: Color.optional(),
    cornerRadius: z.number().optional(),
    parentId: z.string().optional(),
  },
  async (a) => jsonResult(await sendCommand("create_rectangle", a)),
);

server.tool(
  "create_ellipse",
  "Create an ellipse in the current Figma page.",
  {
    x: z.number().default(0),
    y: z.number().default(0),
    width: z.number().default(100),
    height: z.number().default(100),
    name: z.string().optional(),
    fillColor: Color.optional(),
    parentId: z.string().optional(),
  },
  async (a) => jsonResult(await sendCommand("create_ellipse", a)),
);

server.tool(
  "create_text",
  "Create a text node. Inter Regular is loaded by default; pass fontFamily/fontStyle for others.",
  {
    x: z.number().default(0),
    y: z.number().default(0),
    text: z.string(),
    fontSize: z.number().default(16),
    fontColor: Color.optional(),
    fontFamily: z.string().optional(),
    fontStyle: z.string().optional(),
    name: z.string().optional(),
    parentId: z.string().optional(),
  },
  async (a) => jsonResult(await sendCommand("create_text", a)),
);

server.tool(
  "set_fill_color",
  "Set the solid fill color of an existing node.",
  { nodeId: z.string(), color: Color },
  async (a) => jsonResult(await sendCommand("set_fill_color", a)),
);

server.tool(
  "set_stroke_color",
  "Set the stroke color (and optional weight) of an existing node.",
  { nodeId: z.string(), color: Color, weight: z.number().optional() },
  async (a) => jsonResult(await sendCommand("set_stroke_color", a)),
);

server.tool(
  "set_corner_radius",
  "Set the corner radius of a node that supports it.",
  { nodeId: z.string(), radius: z.number() },
  async (a) => jsonResult(await sendCommand("set_corner_radius", a)),
);

server.tool(
  "set_text",
  "Replace the characters of an existing text node.",
  { nodeId: z.string(), text: z.string() },
  async (a) => jsonResult(await sendCommand("set_text", a)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[figma-rest-mcp] running on stdio");
