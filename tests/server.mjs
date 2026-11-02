// Minimal static file server for the tests (GitHub Pages serves the same files).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

export function serve(root) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    if (rel.startsWith("..")) {
      res.writeHead(403).end();
      return;
    }
    const path = join(root, rel || "index.html");
    try {
      const body = await readFile(path);
      res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}
