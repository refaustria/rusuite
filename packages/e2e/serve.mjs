// Tiny static server: apps/<app>/dist-web served under /<app>/ (calc, write, show, notes), apps/portal at /
// and a stub /version.json (the deploy script writes the real one). With `NOTES_RELAY_PORT`, `/api/notes/` goes to
// a local notes relay on that port (HTTP and the WebSocket upgrade, like nginx's deploy/nginx/notes-relay.conf).
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../apps");
const port = Number(process.env.E2E_PORT ?? 4173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

// The same security headers as production: the policy is read from the nginx vhost (ADR 0009), so the
// local suite fails on anything the live CSP would block.
const vhost = fs.readFileSync(path.resolve(root, "../deploy/nginx/rusuit.es.conf"), "utf8");
const nginxVar = (name) => vhost.match(new RegExp(`set \\$${name} "([^"]*)";`))?.[1] ?? "";
const connect = nginxVar("csp_connect");
const securityHeaders = {
  "content-security-policy": nginxVar("csp").replaceAll("$csp_connect", connect),
  "permissions-policy": nginxVar("permissions_policy"),
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

const relayPort = Number(process.env.NOTES_RELAY_PORT ?? 0);

const server = http
  .createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname.startsWith("/api/notes/")) {
      if (!relayPort) return void res.writeHead(404).end("no relay");
      const up = http.request({ host: "127.0.0.1", port: relayPort, path: req.url, method: req.method, headers: req.headers }, (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      });
      up.on("error", () => res.writeHead(502).end());
      req.pipe(up);
      return;
    }
    const [, app, ...rest] = decodeURIComponent(url.pathname).split("/");
    if (app === "version.json" && rest.length === 0) {
      res.writeHead(200, { ...securityHeaders, "content-type": types[".json"] });
      const version = JSON.parse(fs.readFileSync(path.join(root, "calc", "package.json"), "utf8")).version;
      res.end(JSON.stringify({ version, commit: "local", builtAt: new Date().toISOString() }));
      return;
    }
    const isApp = ["calc", "write", "show", "notes"].includes(app);
    const dist = isApp ? path.join(root, app, "dist-web") : path.join(root, "portal");
    let file = path.join(dist, ...(isApp ? rest : [app, ...rest]).filter((p) => p && p !== ".."));
    if (!file.startsWith(dist)) return void res.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) return void res.writeHead(404).end("not found");
    res.writeHead(200, { ...securityHeaders, "content-type": types[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });

// WebSocket upgrade for /api/notes/ws: a raw TCP pipe to the relay (the handshake is replayed as received).
server.on("upgrade", (req, socket, head) => {
  if (!relayPort || !(req.url ?? "").startsWith("/api/notes/")) return void socket.destroy();
  const up = net.connect(relayPort, "127.0.0.1", () => {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    up.write(lines.join("\r\n") + "\r\n\r\n");
    if (head?.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  const close = () => {
    up.destroy();
    socket.destroy();
  };
  up.on("error", close);
  socket.on("error", close);
  up.on("close", () => socket.destroy());
  socket.on("close", () => up.destroy());
});

server.listen(port, "127.0.0.1", () => console.log(`e2e server on http://127.0.0.1:${port}/ (portal, calc, write, show, notes)`));
