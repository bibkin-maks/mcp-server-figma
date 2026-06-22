#!/usr/bin/env node
// Relay WebSocket server. The MCP server and the Figma plugin both connect here
// and exchange messages over a shared "channel". This process keeps no Figma
// state — it just routes request/response payloads between the two sides.
import { WebSocketServer, WebSocket } from "ws";

const PORT = Number(process.env.FIGMA_BRIDGE_PORT ?? 3055);

type Client = WebSocket & { channel?: string };
const channels = new Map<string, Set<Client>>();

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (raw) => {
  const ws = raw as Client;

  ws.on("message", (data) => {
    let msg: any;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (msg.type === "join") {
      ws.channel = String(msg.channel ?? "default");
      let set = channels.get(ws.channel);
      if (!set) channels.set(ws.channel, (set = new Set()));
      set.add(ws);
      ws.send(JSON.stringify({ type: "joined", channel: ws.channel }));
      return;
    }

    if (msg.type === "broadcast" && ws.channel) {
      const set = channels.get(ws.channel);
      if (!set) return;
      const out = JSON.stringify({ type: "broadcast", payload: msg.payload });
      for (const peer of set) {
        if (peer !== ws && peer.readyState === peer.OPEN) peer.send(out);
      }
    }
  });

  ws.on("close", () => {
    if (ws.channel) channels.get(ws.channel)?.delete(ws);
  });
});

console.error(`[figma-bridge] relay listening on ws://localhost:${PORT}`);
