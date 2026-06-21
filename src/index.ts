#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

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

// ── whoami (sanity check) ───────────────────────────────────────────────────
server.tool(
  "whoami",
  "Verify the configured token by fetching the authenticated Figma user.",
  {},
  async () => jsonResult(await figma(`/me`)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[figma-rest-mcp] running on stdio");
