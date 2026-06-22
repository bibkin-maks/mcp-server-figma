// Figma plugin main thread. Network access lives in ui.html (the iframe); this
// thread receives {command, params} from the UI, runs it against the Figma API,
// and posts the result back to the UI, which relays it over the WebSocket.

figma.showUI(__html__, { width: 340, height: 300 });

figma.ui.onmessage = async (msg) => {
  if (msg.type !== "execute") return;
  const { id, command, params } = msg;
  try {
    const result = await handle(command, params || {});
    figma.ui.postMessage({ type: "result", id, result });
  } catch (e) {
    figma.ui.postMessage({ type: "result", id, error: (e && e.message) ? e.message : String(e) });
  }
};

// ── helpers ──────────────────────────────────────────────────────────────────
function rgba(color) {
  if (!color) return { r: 0, g: 0, b: 0, a: 1 };
  if (typeof color === "string") {
    let h = color.replace("#", "").trim();
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }
  return {
    r: color.r != null ? color.r : 0,
    g: color.g != null ? color.g : 0,
    b: color.b != null ? color.b : 0,
    a: color.a != null ? color.a : 1,
  };
}

function solidPaint(color) {
  const c = rgba(color);
  return [{ type: "SOLID", color: { r: c.r, g: c.g, b: c.b }, opacity: c.a }];
}

async function getNode(id) {
  if (!id) return null;
  if (figma.getNodeByIdAsync) return await figma.getNodeByIdAsync(id);
  return figma.getNodeById(id);
}

async function place(node, parentId) {
  const parent = parentId ? await getNode(parentId) : figma.currentPage;
  if (parent && "appendChild" in parent) parent.appendChild(node);
  else figma.currentPage.appendChild(node);
}

function summarize(n) {
  const out = { id: n.id, name: n.name, type: n.type };
  if ("x" in n) { out.x = n.x; out.y = n.y; }
  if ("width" in n) { out.width = n.width; out.height = n.height; }
  return out;
}

async function loadFont(family, style) {
  const f = { family: family || "Inter", style: style || "Regular" };
  await figma.loadFontAsync(f);
  return f;
}

// ── command dispatcher ────────────────────────────────────────────────────────
async function handle(command, p) {
  switch (command) {
    case "ping":
      return { pong: true };

    case "get_document_info":
      return {
        name: figma.root.name,
        currentPage: figma.currentPage.name,
        pageCount: figma.root.children.length,
        selectionCount: figma.currentPage.selection.length,
      };

    case "get_selection":
      return figma.currentPage.selection.map(summarize);

    case "create_frame": {
      const f = figma.createFrame();
      f.x = p.x || 0; f.y = p.y || 0;
      f.resize(p.width || 400, p.height || 300);
      if (p.name) f.name = p.name;
      if (p.fillColor) f.fills = solidPaint(p.fillColor);
      await place(f, p.parentId);
      return summarize(f);
    }

    case "create_rectangle": {
      const r = figma.createRectangle();
      r.x = p.x || 0; r.y = p.y || 0;
      r.resize(p.width || 100, p.height || 100);
      if (p.name) r.name = p.name;
      if (p.fillColor) r.fills = solidPaint(p.fillColor);
      if (p.cornerRadius != null) r.cornerRadius = p.cornerRadius;
      await place(r, p.parentId);
      return summarize(r);
    }

    case "create_ellipse": {
      const e = figma.createEllipse();
      e.x = p.x || 0; e.y = p.y || 0;
      e.resize(p.width || 100, p.height || 100);
      if (p.name) e.name = p.name;
      if (p.fillColor) e.fills = solidPaint(p.fillColor);
      await place(e, p.parentId);
      return summarize(e);
    }

    case "create_text": {
      const font = await loadFont(p.fontFamily, p.fontStyle);
      const t = figma.createText();
      t.fontName = font;
      t.characters = p.text != null ? String(p.text) : "";
      if (p.fontSize) t.fontSize = p.fontSize;
      t.x = p.x || 0; t.y = p.y || 0;
      if (p.name) t.name = p.name;
      if (p.fontColor) t.fills = solidPaint(p.fontColor);
      await place(t, p.parentId);
      return summarize(t);
    }

    case "set_fill_color": {
      const n = await getNode(p.nodeId);
      if (!n) throw new Error("Node not found: " + p.nodeId);
      n.fills = solidPaint(p.color);
      return summarize(n);
    }

    case "set_stroke_color": {
      const n = await getNode(p.nodeId);
      if (!n) throw new Error("Node not found: " + p.nodeId);
      n.strokes = solidPaint(p.color);
      if (p.weight != null) n.strokeWeight = p.weight;
      return summarize(n);
    }

    case "set_corner_radius": {
      const n = await getNode(p.nodeId);
      if (!n) throw new Error("Node not found: " + p.nodeId);
      n.cornerRadius = p.radius;
      return summarize(n);
    }

    case "set_text": {
      const n = await getNode(p.nodeId);
      if (!n || n.type !== "TEXT") throw new Error("Not a text node: " + p.nodeId);
      await figma.loadFontAsync(n.fontName);
      n.characters = String(p.text);
      return summarize(n);
    }

    case "move_node": {
      const n = await getNode(p.nodeId);
      if (!n) throw new Error("Node not found: " + p.nodeId);
      n.x = p.x; n.y = p.y;
      return summarize(n);
    }

    case "resize_node": {
      const n = await getNode(p.nodeId);
      if (!n) throw new Error("Node not found: " + p.nodeId);
      n.resize(p.width, p.height);
      return summarize(n);
    }

    case "clone_node": {
      const n = await getNode(p.nodeId);
      if (!n) throw new Error("Node not found: " + p.nodeId);
      const c = n.clone();
      if (p.x != null) c.x = p.x;
      if (p.y != null) c.y = p.y;
      if (n.parent) n.parent.appendChild(c);
      return summarize(c);
    }

    case "append_child": {
      const parent = await getNode(p.parentId);
      const child = await getNode(p.childId);
      if (!parent || !("appendChild" in parent)) throw new Error("Bad parent: " + p.parentId);
      if (!child) throw new Error("Bad child: " + p.childId);
      parent.appendChild(child);
      return summarize(child);
    }

    case "delete_node": {
      const n = await getNode(p.nodeId);
      if (!n) throw new Error("Node not found: " + p.nodeId);
      n.remove();
      return { deleted: p.nodeId };
    }

    default:
      throw new Error("Unknown command: " + command);
  }
}
