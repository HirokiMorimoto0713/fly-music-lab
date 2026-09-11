import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".gz": "application/octet-stream",
  ".md": "text/plain; charset=utf-8",
};
const port = Number(process.env.PORT || 4389);
http
  .createServer(async (req, res) => {
    try {
      const route = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      const file = path.resolve(
        root,
        "." + (route === "/" ? "/index.html" : route),
      );
      if (
        !file.startsWith(root + path.sep) ||
        route.split("/").some((p) => p.startsWith("."))
      ) {
        res.writeHead(403);
        res.end();
        return;
      }
      if (!(await stat(file)).isFile()) throw Error();
      res.writeHead(200, {
        "Content-Type": types[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("ファイルがありません");
    }
  })
  .listen(port, "127.0.0.1", () =>
    console.log(`Fly Music Lab http://127.0.0.1:${port}`),
  );
