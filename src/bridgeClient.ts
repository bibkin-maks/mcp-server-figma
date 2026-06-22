// MCP-side client for the relay. Connects lazily, joins the configured channel,
// and correlates request/response payloads by id. Used only by the write/design
// tools; the read-only REST tools never touch this.
import WebSocket from "ws";

const URL = process.env.FIGMA_BRIDGE_URL ?? "ws://localhost:3055";
const CHANNEL = process.env.FIGMA_BRIDGE_CHANNEL ?? "default";

let ws: WebSocket | null = null;
let joined = false;
let joinWaiters: Array<() => void> = [];
const pending = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void; timer: NodeJS.Timeout }>();

function ensure(): Promise<void> {
  if (ws && ws.readyState === WebSocket.OPEN && joined) return Promise.resolve();

  return new Promise((resolve, reject) => {
    joinWaiters.push(resolve);

    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;

    joined = false;
    ws = new WebSocket(URL);

    const failTimer = setTimeout(() => {
      reject(new Error(`Bridge relay not reachable at ${URL}. Start it with:  npm run bridge`));
      joinWaiters = joinWaiters.filter((w) => w !== resolve);
    }, 3000);

    ws.on("open", () => ws!.send(JSON.stringify({ type: "join", channel: CHANNEL })));

    ws.on("message", (data) => {
      let msg: any;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.type === "joined") {
        clearTimeout(failTimer);
        joined = true;
        joinWaiters.forEach((w) => w());
        joinWaiters = [];
        return;
      }
      if (msg.type === "broadcast" && msg.payload?.kind === "response") {
        const p = pending.get(msg.payload.id);
        if (!p) return;
        clearTimeout(p.timer);
        pending.delete(msg.payload.id);
        if (msg.payload.error) p.reject(new Error(msg.payload.error));
        else p.resolve(msg.payload.result);
      }
    });

    ws.on("error", (e) => {
      clearTimeout(failTimer);
      reject(e);
    });

    ws.on("close", () => {
      joined = false;
      ws = null;
      for (const [, p] of pending) {
        clearTimeout(p.timer);
        p.reject(new Error("Bridge connection closed"));
      }
      pending.clear();
    });
  });
}

export async function sendCommand(command: string, params: any = {}, timeoutMs = 30000): Promise<any> {
  await ensure();
  const id = Math.random().toString(36).slice(2);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(
        new Error(
          `Timed out waiting for the Figma plugin. Open Figma, run the "Code MCP Bridge" plugin, ` +
            `and make sure it's connected to channel "${CHANNEL}".`,
        ),
      );
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    ws!.send(JSON.stringify({ type: "broadcast", payload: { kind: "request", id, command, params } }));
  });
}
